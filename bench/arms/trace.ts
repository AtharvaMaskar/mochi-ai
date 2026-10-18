// Arm D+trace (change decision-traces): arm D's tool loop with the decision-trace journal in front of it. Ticket-shaped:
// the journal is warmed on resolved tickets from the earlier part of the window, then the likely-cause and the
// what-fixed-similar tasks are asked on later, unseen tickets. Conditions, same tasks, same model, same scorer:
//   D           plain arm D (no journal)
//   cold        the journal path with an empty journal (embedding + lookup overhead only)
//   warm_hint   warmed journal, the nearest live trace as a text hint (what the harness hook does)
//   warm_replay warmed journal, and when the match is close and the stored steps take only ids, the stored Cypher is
//               re-run for the new ticket and its rows go in the prompt (the model may still call tools)
// Staleness: bench's staleness harness (runs/staleness.ts) on a fresh graph, D vs D+trace warmed on the event questions
// BEFORE the events are applied, so a trace that survived retirement would hand back the stale answer.
//   node bench/arms/trace.ts --run-id tr --max-usd 2 --out bench/artifacts/parts/trace.json [--dry] [--limit n]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Tool } from '@earendil-works/pi-ai';
import { GRAPH, TRACE_LABELS as J, VALID_FOREVER, type Dataset, type Eval, type EvalQuestion } from '@mochi/contracts';
import { applyEvent, embed, EMBED_DIM, readData, READ_TOOL_SPECS, type QueryResult } from '../deps.ts';
import { createLlm, ZERO, type Usage } from '../llm.ts';
import { connect } from '../db.ts';
import { contains, score, type Vote } from '../score.ts';
import { pct } from '../runs/main.ts';
import { runStaleness } from '../runs/staleness.ts';
import { names, type Arm, type Ctx } from './index.ts';
import { armD, ensureWorld, remap, render, toolLoop, TOOL_SYSTEM } from './d.ts';
import { ensureJournal, plan, recordTrace, ticketOf, type JournalDb, type Step } from '../../agent/traces/index.ts';

export type Mode = 'D' | 'cold' | 'warmup' | 'warm_hint' | 'warm_replay';
export type TaskRec = {
  mode: Mode; task_id: string; kind: string; correct: boolean; input_tokens: number; output_tokens: number; cost_usd: number;
  tool_calls: number; replayed_queries: number; total_ms: number; used: 'none' | 'hint' | 'replay'; trace_id: string | null; answer: string;
};

const DAY = 86_400_000;
const pick = <T>(xs: T[], n: number) => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)]));

/** Ticket tasks from the dataset JSON (ground truth never read from the graph). Warm: earlier resolved tickets; eval: later ones. */
export function ticketTasks(d: Dataset, perKind = { warm: 20, eval: 20 }) {
  const cause = new Map(d.releases.flatMap((r) => r.introduces.map((x) => [x.issue_id, r.version] as const)));
  const kbOf = new Map(d.resolutions.map((r) => [r.id, r.kb_id]));
  const counts = new Map<string, Map<string, number>>();
  for (const t of d.tickets) {
    // A resolution with no KB article (a workaround) counts against every KB, so the truth is never a minority fix.
    const kb = t.resolution_id ? kbOf.get(t.resolution_id) ?? 'none' : null;
    if (t.issue_id && kb) { const m = counts.get(t.issue_id) ?? new Map(); m.set(kb, (m.get(kb) ?? 0) + 1); counts.set(t.issue_id, m); }
  }
  // The fix question has one right answer only where one KB article closes at least 3 in 4 of the issue's tickets.
  const fix = new Map([...counts].flatMap(([issue, m]) => {
    const [kb, n] = [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return kb !== 'none' && n / [...m.values()].reduce((s, x) => s + x, 0) >= 0.75 ? [[issue, kb] as const] : [];
  }));
  // Demo-day tickets have no ABOUT edge until the dream extracts one, so only earlier tickets are used.
  const ts = d.tickets.filter((t) => t.issue_id && t.created_at < d.generated_at - DAY).sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  const cut = Math.floor((ts.length * 2) / 3);
  const early = ts.slice(0, cut).filter((t) => t.status === 'resolved' || t.status === 'closed'), late = ts.slice(cut);
  const mk = (t: (typeof ts)[number], kind: 'cause' | 'fix'): EvalQuestion => kind === 'cause'
    ? { id: `TC-${t.id}`, bucket: 'multi_hop', scoring: 'exact', question: `Which release likely caused ticket ${t.id}?`, answer: cause.get(t.issue_id!)! }
    : { id: `TF-${t.id}`, bucket: 'multi_hop', scoring: 'exact', question: `Which KB article fixed tickets similar to ${t.id}?`, answer: fix.get(t.issue_id!)! };
  const of = (pool: typeof ts, n: number) => [
    ...pick(pool.filter((t) => cause.has(t.issue_id!)), n).map((t) => mk(t, 'cause')),
    ...pick(pool.filter((t) => fix.has(t.issue_id!)), n).map((t) => mk(t, 'fix')),
  ];
  return { warm: of(early, perKind.warm), eval: of(late, perKind.eval) };
}

export function traceRunner(ctx: Ctx, world: string, journalGraph: string) {
  const company = remap(ctx.db, world);
  const journal = ctx.db as unknown as JournalDb;
  const specs = new Map(READ_TOOL_SPECS.map((s) => [s.name, s]));
  const tools: Tool[] = READ_TOOL_SPECS.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const asOf = () => Math.max(Date.now(), ctx.dataset.generated_at);
  const exec = async (name: string, args: any): Promise<QueryResult> => {
    const spec = specs.get(name as never);
    if (!spec) throw new Error(`unknown tool ${name}`);
    return spec.run(company, args, asOf(), GRAPH.company);
  };

  /** One task; record: 'correct' (main warm-up: the answer matched, i.e. the ticket was resolved right) or 'answered'. */
  async function run(mode: Mode, q: EvalQuestion, o: { record?: 'correct' | 'answered'; judge?: (answer: string) => Promise<boolean> } = {}) {
    const t0 = performance.now();
    let prompt = q.question, used: TaskRec['used'] = 'none', trace_id: string | null = null, replayed = 0, e: number[] | null = null;
    if (mode !== 'D') [e] = await embed([q.question]);
    if (mode === 'warm_hint' || mode === 'warm_replay') {
      const p = await plan({ journal, read: company, graph: GRAPH.company, question: q.question, embedding: e!, as_of: asOf(), journalGraph });
      if (p) {
        trace_id = p.trace.id;
        if (mode === 'warm_replay' && p.replay) {
          const rs = await Promise.all(p.replay.map((s) => exec(s.tool, s.args).catch(() => null)));
          const ok = rs.filter((r): r is QueryResult => !!r);
          replayed = ok.reduce((s, r) => s + Object.keys(r.card.queries).length, 0);
          used = 'replay';
          prompt = `${q.question}\n\nMochi already ran ${p.replay.map((s) => `${s.tool}(${JSON.stringify(s.args)})`).join(', ')} for this question just now (the path a similar resolved case took). These are the current results, so they count as your tool lookup: answer from them, and call a tool only if they do not answer the question.\n${render(ok)}`;
        } else { used = 'hint'; prompt = `${p.hint}\n\n${q.question}`; }
      }
    }
    const steps: Step[] = [], results: QueryResult[] = [];
    const r = await toolLoop(ctx, `trace_${mode}`, TOOL_SYSTEM, tools, { ...q, question: prompt }, async (name, args) => {
      const res = await exec(name, args);
      steps.push({ tool: name, args }); results.push(res);
      return render([res]);
    });
    const total_ms = Math.round((performance.now() - t0) * 100) / 100;
    const correct = o.judge ? await o.judge(r.answer) : contains(r.answer, q.answer);
    const errored = r.calls.length !== steps.length;
    if (o.record && steps.length && !errored && (o.record === 'answered' || correct)) {
      await recordTrace(journal, {
        id: `TR-${q.id}-${steps.length}`, ticket_id: ticketOf(q.question), question: q.question, steps,
        queries: results.flatMap((x) => Object.values(x.card.queries)), outcome: r.answer, source: 'bench',
      }, e!, asOf(), journalGraph);
    }
    const rec: TaskRec = {
      mode, task_id: q.id, kind: q.id.slice(0, 2), correct, input_tokens: r.usage.input, output_tokens: r.usage.output, cost_usd: r.usage.cost,
      tool_calls: r.calls.length, replayed_queries: replayed, total_ms, used, trace_id, answer: r.answer,
    };
    return { rec, usage: r.usage as Usage, retrieval_ms: r.retrieval_ms };
  }
  return { run, asOf };
}

export function summarize(recs: TaskRec[]) {
  const by = Map.groupBy(recs, (r) => r.mode);
  return Object.fromEntries([...by].map(([mode, rs]) => {
    const mean = (f: (r: TaskRec) => number) => Math.round((rs.reduce((s, r) => s + f(r), 0) / rs.length) * 1e6) / 1e6;
    const ms = rs.map((r) => r.total_ms);
    return [mode, {
      n: rs.length, accuracy: rs.filter((r) => r.correct).length / rs.length, cost_usd_mean: mean((r) => r.cost_usd), cost_usd_total: rs.reduce((s, r) => s + r.cost_usd, 0),
      input_tokens_mean: mean((r) => r.input_tokens), output_tokens_mean: mean((r) => r.output_tokens), tool_calls_mean: mean((r) => r.tool_calls),
      replayed_queries_mean: mean((r) => r.replayed_queries), p50_ms: pct(ms, 50), p95_ms: pct(ms, 95),
      used: { none: rs.filter((r) => r.used === 'none').length, hint: rs.filter((r) => r.used === 'hint').length, replay: rs.filter((r) => r.used === 'replay').length },
    }];
  }));
}

async function liveTraces(ctx: Ctx, g: string) {
  const r = await ctx.db.selectGraph(g).roQuery<{ live: number; closed: number }>(
    `MATCH (t:${J.Trace}) RETURN sum(CASE WHEN t.valid_until = ${VALID_FOREVER} THEN 1 ELSE 0 END) AS live, sum(CASE WHEN t.valid_until < ${VALID_FOREVER} THEN 1 ELSE 0 END) AS closed`).catch(() => null);
  return r?.data?.[0] ?? { live: 0, closed: 0 };
}

export async function runTrace(ctx: Ctx, ev: Eval, o: { limit?: number } = {}) {
  const n = ctx.names, journalGraph = `${n.world}_journal`;
  const { warm, eval: tasks } = ticketTasks(ctx.dataset, o.limit ? { warm: o.limit, eval: o.limit } : undefined);
  await ensureWorld(ctx, n.world, true);
  await ensureJournal(ctx.db as unknown as JournalDb, EMBED_DIM, journalGraph);
  const R = traceRunner(ctx, n.world, journalGraph);
  const recs: TaskRec[] = [];
  const pass = async (mode: Mode, qs: EvalQuestion[], record?: 'correct') => {
    for (const q of qs) recs.push((await R.run(mode, q, { record })).rec);
    console.log(`trace: ${mode} done ($${ctx.llm.spent().toFixed(4)} so far)`);
  };
  await pass('D', tasks);
  await pass('cold', tasks);
  await pass('warmup', warm, 'correct');
  const journalAfterWarmup = await liveTraces(ctx, journalGraph);
  await pass('warm_hint', tasks);
  await pass('warm_replay', tasks);

  // Staleness: D vs D+trace on bench's staleness harness; D+trace warms on the event questions before the events.
  const sj = `${n.stale}_journal`;
  const votes: Vote[] = [];
  const stale = traceRunner(ctx, n.stale, sj);
  const used: Record<string, TaskRec['used']> = {};
  const traceArm: Arm = {
    arch: 'D+trace' as never,
    async prepare() {
      await ensureWorld(ctx, n.stale, true);
      await ctx.db.selectGraph(sj).delete().catch(() => {});
      await ensureJournal(ctx.db as unknown as JournalDb, EMBED_DIM, sj);
      for (const q of ev.questions.filter((x) => x.after_event)) await stale.run('warmup', q, { record: 'answered' });
      return ZERO;
    },
    async answer(q) {
      const r = await stale.run('warm_replay', q);
      used[q.id] = r.rec.used;
      return { answer: r.rec.answer, usage: r.usage, retrieval_ms: r.retrieval_ms };
    },
    async apply(e) { await applyEvent(e, ctx.db.selectGraph(n.stale), e.at); return { usage: ZERO, ms: 0 }; },
  };
  const st = await runStaleness({ llm: ctx.llm, arms: [armD(ctx, { ingest: false, graph: n.stale }), traceArm], dataset: ctx.dataset, eval: ev, votes, artifacts: ctx.artifacts });
  const after = await liveTraces(ctx, sj);
  writeFileSync(join(ctx.artifacts, 'trace-votes.json'), JSON.stringify(votes, null, 2));
  const qOf = new Map(ev.questions.filter((q) => q.after_event).map((q) => [q.after_event!, q.id]));
  const staleness = st.staleness.map((s) => ({ ...s, used: s.arch === ('D+trace' as never) ? used[qOf.get(s.event_id) ?? ''] ?? 'none' : undefined }));
  for (const g of [journalGraph, sj]) await ctx.db.selectGraph(g).delete().catch(() => {});
  return {
    tasks: { warm: warm.length, eval: tasks.length, kinds: { TC: 'Which release likely caused ticket T-x? (likely_cause)', TF: 'Which KB article fixed tickets similar to T-x? (briefing)' } },
    scoring: 'normalized containment of the dataset-JSON truth (bench/score.ts contains), identical for every mode; staleness uses the arm-D judge',
    journal_after_warmup: journalAfterWarmup,
    summary: summarize(recs),
    records: recs,
    staleness: {
      rows: staleness,
      fresh: { D: st.staleness.filter((s) => s.arch === 'D' && s.answer_fresh).length, 'D+trace': st.staleness.filter((s) => s.arch === ('D+trace' as never) && s.answer_fresh).length, of: st.staleness.length / 2 },
      traces_closed_by_retirement: after.closed,
      traces_live_after: after.live,
    },
  };
}

const PARAPHRASES = new URL('./trace-paraphrases.json', import.meta.url);
const words = (s: string) => new Set(s.toLowerCase().replace(/\b(?:[A-Z]{1,3}-\d+|\d+\.\d+\.\d+)\b/gi, ' ').match(/[a-z]+/g) ?? []);
/** Word overlap of two questions with ids removed (Jaccard); a paraphrase must stay under 0.7 to count as reworded. */
export const overlap = (a: string, b: string) => { const x = words(a), y = words(b); return [...x].filter((w) => y.has(w)).length / (new Set([...x, ...y]).size || 1); };

/** Haiku rewords each pre-event eval question once; the file is committed so every run evaluates the same text. */
async function paraphrases(ctx: Ctx, qs: EvalQuestion[]): Promise<Record<string, { text: string; overlap: number }>> {
  if (existsSync(PARAPHRASES)) return JSON.parse(readFileSync(PARAPHRASES, 'utf8'));
  const out: Record<string, { text: string; overlap: number }> = {};
  for (const q of qs) {
    let text = '';
    for (const extra of ['', ' Use different words and a different sentence shape from the original.']) {
      text = (await ctx.llm.complete('paraphrase', `Reword this support question so it asks exactly the same thing in different words. Keep every id, name, number and version exactly as written.${extra} Reply with the reworded question only.\n\n${q.question}`, { maxTokens: 200 })).text.trim();
      if (overlap(q.question, text) < 0.7) break;
    }
    out[q.id] = { text, overlap: Math.round(overlap(q.question, text) * 100) / 100 };
  }
  writeFileSync(PARAPHRASES, JSON.stringify(out, null, 2) + '\n');
  return out;
}

/** Secondary, chat-shaped: warm on the original eval questions, evaluate on committed paraphrases (memorisation guard). */
export async function runChat(ctx: Ctx, ev: Eval) {
  const n = ctx.names, journalGraph = `${n.world}_cjournal`;
  const qs = ev.questions.filter((q) => !q.after_event);
  const para = await paraphrases(ctx, qs);
  const kept = qs.filter((q) => para[q.id] && overlap(q.question, para[q.id].text) < 0.7 && para[q.id].text !== q.question);
  await ensureWorld(ctx, n.world, true);
  await ensureJournal(ctx.db as unknown as JournalDb, EMBED_DIM, journalGraph);
  const R = traceRunner(ctx, n.world, journalGraph);
  const votes: Vote[] = [], recs: TaskRec[] = [];
  const judge = (q: EvalQuestion, arch: string) => (a: string) => score(ctx.llm, q, arch, a, votes);
  for (const q of kept) recs.push((await R.run('warmup', q, { record: 'correct', judge: judge(q, 'warmup') })).rec);
  for (const mode of ['D', 'warm_hint', 'warm_replay'] as const) {
    for (const q of kept) { const p = { ...q, question: para[q.id].text }; recs.push((await R.run(mode, p, { judge: judge(p, mode) })).rec); }
    console.log(`trace chat: ${mode} done ($${ctx.llm.spent().toFixed(4)} so far)`);
  }
  writeFileSync(join(ctx.artifacts, 'trace-chat-votes.json'), JSON.stringify(votes, null, 2));
  await ctx.db.selectGraph(journalGraph).delete().catch(() => {});
  return { tasks: kept.length, dropped_not_reworded: qs.length - kept.length, overlap_mean: Math.round((kept.reduce((s, q) => s + para[q.id].overlap, 0) / (kept.length || 1)) * 100) / 100,
    paraphrases_path: 'bench/arms/trace-paraphrases.json', scoring: 'arm D scoring: exact for single_fact, Opus 3-vote judge otherwise', summary: summarize(recs), records: recs };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { 'run-id': { type: 'string' }, out: { type: 'string' }, dry: { type: 'boolean' }, 'max-usd': { type: 'string' }, limit: { type: 'string' }, chat: { type: 'boolean' } } });
  const runId = values['run-id'] ?? 'trace';
  if (!/^[a-z0-9]+$/i.test(runId)) throw new Error('--run-id must be alphanumeric');
  const maxUsd = Number(values['max-usd'] ?? 2);
  const HERE = new URL('..', import.meta.url).pathname;
  const out = resolve(values.out ?? join(HERE, 'artifacts/parts/trace.json'));
  const artifacts = join(HERE, 'artifacts/shards', runId);
  mkdirSync(artifacts, { recursive: true }); mkdirSync(dirname(out), { recursive: true });
  const llm = createLlm({ dry: !!values.dry, maxUsd });
  const data = await readData();
  const db = await connect();
  const prefix = `bench_${runId}`;
  const ctx: Ctx = { llm, db, dataset: data.dataset, names: names(prefix), artifacts };
  try {
    const decision_traces = values.chat ? { chat: { ...(await runChat(ctx, data.eval)), spent_usd: llm.spent() } }
      : { model: llm.answerModel, judge_model: llm.judgeModel, embed_dim: EMBED_DIM, ...(await runTrace(ctx, data.eval, { limit: values.limit ? Number(values.limit) : undefined })), spent_usd: llm.spent() };
    const part = { partial: true, only: values.chat ? 'trace-chat' : 'trace', run_id: runId, run_at: Date.now(), seed: data.dataset.seed, models: [llm.answerModel], judge_model: llm.judgeModel, dry: !!values.dry, spent_usd: llm.spent(), decision_traces };
    writeFileSync(out, JSON.stringify(part, null, 2) + '\n');
    writeFileSync(join(artifacts, 'usage.json'), JSON.stringify({ spent_usd: llm.spent(), by_caller: llm.byCaller }, null, 2));
    console.log(`trace: wrote ${out} ($${llm.spent().toFixed(4)} spent)`);
  } finally {
    for (const g of await db.list()) if (g.startsWith(`${prefix}_`)) await db.selectGraph(g).delete().catch(() => {});
    await db.close();
  }
  process.exit(0);
}
