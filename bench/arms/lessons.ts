// Learning from past tickets without the graph: the same lessons decision traces learn from, kept four other ways.
// Warm: one lesson per earlier resolved ticket from bench/arms/trace.ts ticketTasks (the 40 warm tasks), written
// deterministically from the dataset JSON (summary, cause, fix, KB), never by an LLM, so only the memory structure
// differs. Eval: the same 40 later tickets, scored with the same contains(). Approaches:
//   C              arm C as is (dream pass: MEMORY.md + notes; pick files, then answer), no lessons
//   C_lessons      arm C + an append-only LESSONS.md
//   devin_knowledge  Devin-style Knowledge (modelled on Devin's documented Knowledge feature, not Devin itself):
//                  entries {trigger, content}; step one sees only the triggers and picks, step two answers from content
//   vector_lessons lessons embedded with embed(), top-3 by cosine for the new ticket, then answer
//   sql_lessons    lessons as node:sqlite rows; the model writes one read-only SELECT (arm E style), then answers
// Every approach gets the question plus the new ticket's subject and body (what the agent sees on the desk; D and the
// traces read it through tools). Staleness: runs/staleness.ts with lessons warmed on the event questions before the
// events; nothing updates a lesson afterwards (append-only), C_lessons still runs arm C's maintain on its own notes.
//   node bench/arms/lessons.ts --run-id ls --max-usd 3 --out bench/artifacts/parts/lessons.json [--dry] [--limit n]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import type { Dataset, EvalQuestion } from '@mochi/contracts';
import { embed, readData } from '../deps.ts';
import { add, createLlm, ZERO, type Usage } from '../llm.ts';
import { contains, type Vote } from '../score.ts';
import { pct } from '../runs/main.ts';
import { runStaleness } from '../runs/staleness.ts';
import { ANSWER_SYSTEM, ask, names, timed, type Arm, type Ctx } from './index.ts';
import { armC } from './c.ts';
import { ticketTasks } from './trace.ts';

export type Lesson = { key: string; trigger: string; summary: string; cause: string; fix: string; kb: string };
export const KEYS = ['C', 'C_lessons', 'devin_knowledge', 'vector_lessons', 'sql_lessons'] as const;
type Key = (typeof KEYS)[number];
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const tid = (s: string) => s.match(/\bT-\d+\b/)?.[0] ?? null;

export function lessonMaker(d: Dataset) {
  const tickets = new Map(d.tickets.map((t) => [t.id, t])), issues = new Map(d.issues.map((i) => [i.id, i]));
  const res = new Map(d.resolutions.map((r) => [r.id, r]));
  const cause = new Map(d.releases.flatMap((r) => r.introduces.map((x) => [x.issue_id, r.version] as const)));
  const firstLine = (s: string) => { const ps = s.split(/\n\s*\n/).map((x) => x.replace(/\s+/g, ' ').trim()); return (ps.find((x) => x.length > 25) ?? ps[0]).slice(0, 240); };
  return {
    ticket(id: string): Lesson {
      const t = tickets.get(id)!, i = t.issue_id ? issues.get(t.issue_id) : undefined, r = t.resolution_id ? res.get(t.resolution_id) : undefined;
      return {
        key: t.id, trigger: `Ticket ${t.id} "${t.subject}"${i ? ` (${i.name}, area ${i.area})` : ''}`,
        summary: `${t.subject}. ${firstLine(t.body)}`,
        cause: i ? `${i.id} ${i.name}${cause.has(i.id) ? `, introduced in release ${cause.get(i.id)}` : ', no release recorded'}` : 'unknown',
        fix: r ? `${r.id} (${r.kind}): ${r.summary}` : 'none recorded', kb: r?.kb_id ?? 'none',
      };
    },
    /** A plan question has no ticket: the lesson is what the plan was when it was asked (the pre-event truth). */
    plan(customerId: string, plan: string, at: number): Lesson {
      const c = d.customers.find((x) => x.id === customerId)!;
      return { key: customerId, trigger: `Customer ${c.id} (${c.name}) plan question`, summary: `Customer ${c.id} (${c.name}) asked which plan they are on`,
        cause: 'n/a', fix: `On plan ${plan} as of ${day(at)}`, kb: 'none' };
    },
    /** The question with the new ticket's text, as the agent sees it on the desk. */
    question(q: EvalQuestion) {
      const t = tid(q.question) ? tickets.get(tid(q.question)!) : undefined;
      return t ? `${q.question}\n\nTicket ${t.id}: ${t.subject}\n${t.body}` : q.question;
    },
  };
}

export const md = (l: Lesson) => `## ${l.key}\nSummary: ${l.summary}\nCause: ${l.cause}\nFix: ${l.fix}\nKB: ${l.kb}`;
const content = (l: Lesson) => `Cause: ${l.cause}\nFix: ${l.fix}\nKB: ${l.kb}`;
export const cosine = (a: number[], b: number[]) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / (Math.sqrt(x * y) || 1);
};
/** Ids the model named, in the order it named them, kept only if they exist. */
export const picked = (text: string, ids: string[]) => { const ok = new Set(ids); return [...new Set(text.match(/\b[A-Z]{1,3}-\d+\b/g) ?? [])].filter((x) => ok.has(x)); };

const SQL_SCHEMA = 'CREATE TABLE lessons (ticket_id TEXT, summary TEXT, issue TEXT, area TEXT, cause TEXT, fix TEXT, kb_id TEXT);';
/** Read-only guard for model-written SQL: one SELECT/WITH statement, run on a read-only handle. */
export const isSelect = (sql: string) => /^\s*(select|with)\b/i.test(sql) && !/;\s*\S/.test(sql.replace(/;\s*$/, ''));

function approach(ctx: Ctx, key: Key, L: ReturnType<typeof lessonMaker>, lessons: () => Lesson[], dreamed: Map<string, string>, tag = ''): Arm {
  const arch = key as never;
  if (key === 'C' || key === 'C_lessons') {
    let c: Arm;
    return {
      arch,
      async prepare() { c = armC(ctx, { dreamed, dir: `memory-${key}${tag}`, lessons: key === 'C' ? undefined : lessons().map(md).join('\n\n') }); return c.prepare(); },
      answer: (q) => c.answer({ ...q, question: L.question(q) }),
      apply: (e) => c.apply(e),
    };
  }
  let ls: Lesson[] = [], vecs: number[][] = [], db: DatabaseSync | null = null;
  const answerFrom = async (q: EvalQuestion, context: string, first: Usage) => {
    const r = await ctx.llm.complete(key, ask(context || '(nothing found)', { ...q, question: L.question(q) }), { system: ANSWER_SYSTEM });
    return { text: r.text, usage: add(first, r.usage) };
  };
  return {
    arch,
    async prepare() {
      ls = lessons();
      if (key === 'vector_lessons') vecs = await embed(ls.map(md));
      if (key === 'sql_lessons') {
        const file = join(ctx.artifacts, 'lessons.sqlite');
        const w = new DatabaseSync(file);
        w.exec(`DROP TABLE IF EXISTS lessons; ${SQL_SCHEMA}`);
        const ins = w.prepare('INSERT INTO lessons VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const l of ls) ins.run(l.key, l.summary, l.cause.split(',')[0], l.trigger.match(/area (\w+)/)?.[1] ?? null, l.cause, l.fix, l.kb);
        w.close();
        db = new DatabaseSync(file, { readOnly: true });
      }
      return ZERO;
    },
    async answer(q) {
      const question = L.question(q);
      let reads = 0, first: Usage = ZERO, context = '';
      const [, retrieval_ms] = await timed(async () => {
        if (key === 'devin_knowledge') {
          const p = await ctx.llm.complete('devin_pick', `Knowledge triggers (one per entry):\n${ls.map((l) => `${l.key}: ${l.trigger}`).join('\n')}\n\nQuestion: ${question}\n\nReply with the ids of the entries that apply, one per line, nothing else.`);
          first = p.usage;
          const ids = picked(p.text, ls.map((l) => l.key));
          context = ls.filter((l) => ids.includes(l.key)).map((l) => `## ${l.key}\n${content(l)}`).join('\n\n');
          reads = ids.length;
        } else if (key === 'vector_lessons') {
          const [e] = await embed([question]);
          const top = ls.map((l, i) => [l, cosine(e, vecs[i])] as const).sort((a, b) => b[1] - a[1]).slice(0, 3);
          context = top.map(([l]) => md(l)).join('\n\n');
          reads = top.length;
        } else {
          const p = await ctx.llm.complete('sql_write', `SQLite schema:\n${SQL_SCHEMA}\nEach row is a lesson from one earlier resolved ticket. Write one read-only SELECT (at most 20 rows) that finds the lessons needed to answer the question. Reply with the SQL only.\n\nQuestion: ${question}`);
          first = p.usage;
          const sql = p.text.replace(/```(?:sql)?/gi, '').trim();
          try {
            if (!isSelect(sql)) throw new Error('not a single SELECT');
            const rows = db!.prepare(sql).all().slice(0, 20);
            reads = rows.length;
            context = `SQL: ${sql}\nRows:\n${rows.map((r) => JSON.stringify(r)).join('\n')}`;
          } catch (err) { context = `SQL: ${sql}\nThe query failed: ${(err as Error).message}`; }
        }
      });
      const r = await answerFrom(q, context, first);
      return { answer: r.text, usage: r.usage, retrieval_ms, reads };
    },
    async apply() { return { usage: ZERO, ms: 0 }; }, // append-only: nothing retires a lesson
  };
}

type Rec = { approach: Key; task_id: string; correct: boolean; input_tokens: number; output_tokens: number; cost_usd: number; llm_calls: number; reads: number; total_ms: number; answer: string };

export function summarize(recs: Rec[]) {
  return Object.fromEntries([...Map.groupBy(recs, (r) => r.approach)].map(([k, rs]) => {
    const mean = (f: (r: Rec) => number) => Math.round((rs.reduce((s, r) => s + f(r), 0) / rs.length) * 1e6) / 1e6;
    const ms = rs.map((r) => r.total_ms);
    return [k, { n: rs.length, accuracy: rs.filter((r) => r.correct).length / rs.length, cost_usd_mean: mean((r) => r.cost_usd), cost_usd_total: rs.reduce((s, r) => s + r.cost_usd, 0),
      input_tokens_mean: mean((r) => r.input_tokens), output_tokens_mean: mean((r) => r.output_tokens), llm_calls_mean: mean((r) => r.llm_calls), reads_mean: mean((r) => r.reads),
      p50_ms: pct(ms, 50), p95_ms: pct(ms, 95) }];
  }));
}

export async function runLessons(ctx: Ctx, ev: Awaited<ReturnType<typeof readData>>['eval'], o: { limit?: number; only?: Key[] } = {}) {
  const L = lessonMaker(ctx.dataset);
  const { warm, eval: tasks } = ticketTasks(ctx.dataset, o.limit ? { warm: o.limit, eval: o.limit } : undefined);
  const warmLessons = [...new Set(warm.map((q) => tid(q.question)!))].map((id) => L.ticket(id));
  // Staleness lessons: the event questions as they stood before the events (what the trace journal warmed on).
  const events = new Map(ctx.dataset.contradiction_events.map((e) => [e.id, e]));
  const staleQs = ev.questions.filter((q) => q.after_event);
  const staleValue = (q: EvalQuestion) => { const e = events.get(q.after_event!)!; return e.kind === 'plan_change' ? e.from : L.ticket(tid(q.question)!).cause.match(/release (\S+)/)?.[1] ?? null; };
  const staleLessons = staleQs.map((q) => { const e = events.get(q.after_event!)!; return e.kind === 'plan_change' ? L.plan(e.customer_id, e.from, e.at - 1) : L.ticket(tid(q.question)!); });
  const dreamed = new Map<string, string>();
  const keys = o.only ?? [...KEYS];
  const recs: Rec[] = [], staleness: Record<string, unknown>[] = [], votes: Vote[] = [], setup: Record<string, number> = {};
  for (const key of keys) {
    const arm = approach(ctx, key, L, () => warmLessons, dreamed);
    const prep = await arm.prepare();
    setup[key] = prep.cost; // one-off: arm C's dream pass (C_lessons reuses C's dream, so 0 there); lessons cost nothing to write
    for (const q of tasks) {
      const t0 = performance.now();
      const r = await arm.answer(q);
      recs.push({ approach: key, task_id: q.id, correct: contains(r.answer, q.answer), input_tokens: r.usage.input, output_tokens: r.usage.output, cost_usd: r.usage.cost,
        llm_calls: 2, reads: r.reads ?? 0, total_ms: Math.round((performance.now() - t0) * 100) / 100, answer: r.answer });
    }
    console.log(`lessons: ${key} done ($${ctx.llm.spent().toFixed(4)} so far, prepare ${prep.input + prep.output} tok)`);
    if (key === 'C') continue; // plain arm C staleness is already in results.staleness
    const answers: Record<string, string> = {};
    const s = approach(ctx, key, L, () => staleLessons, dreamed, '-stale');
    const st = await runStaleness({ llm: ctx.llm, dataset: ctx.dataset, eval: ev, votes, artifacts: ctx.artifacts,
      arms: [{ ...s, answer: async (q) => { const r = await s.answer(q); answers[q.id] = r.answer; return r; } }] });
    for (const row of st.staleness) {
      const q = staleQs.find((x) => x.after_event === row.event_id), old = q && staleValue(q);
      staleness.push({ ...row, arch: key, answer: q ? answers[q.id] : null, stale_value: old, stale_resurfaced: !!(q && old && contains(answers[q.id] ?? '', old)) });
    }
    console.log(`lessons: ${key} staleness done ($${ctx.llm.spent().toFixed(4)} so far)`);
  }
  writeFileSync(join(ctx.artifacts, 'lessons-votes.json'), JSON.stringify(votes, null, 2));
  const summary = summarize(recs);
  return {
    tasks: { warm: warm.length, warm_lessons: warmLessons.length, eval: tasks.length },
    lesson_fields: 'summary (subject + first paragraph), cause (issue + introducing release), fix (resolution), KB: written from the dataset JSON, no LLM',
    question: 'eval question + the new ticket subject and body (D and graph traces read the ticket through tools)',
    scoring: 'bench/score.ts contains on the 40 eval tasks, as trace.ts; staleness uses runs/staleness.ts (arm-D judge)',
    names: { devin_knowledge: "Devin-style Knowledge (modelled on Devin's documented Knowledge feature, not Devin itself)" },
    approaches: Object.fromEntries(keys.map((k) => {
      const rows = staleness.filter((s) => s.arch === k);
      return [k, { ...summary[k], setup_usd: setup[k], ...(rows.length ? { staleness: { fresh: rows.filter((s) => s.answer_fresh).length, stale_resurfaced: rows.filter((s) => s.stale_resurfaced).length, of: rows.length } } : {}) }];
    })),
    records: recs, staleness,
  };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { 'run-id': { type: 'string' }, out: { type: 'string' }, dry: { type: 'boolean' }, 'max-usd': { type: 'string' }, limit: { type: 'string' }, only: { type: 'string' } } });
  const runId = values['run-id'] ?? 'lessons';
  if (!/^[a-z0-9]+$/i.test(runId)) throw new Error('--run-id must be alphanumeric');
  const HERE = new URL('..', import.meta.url).pathname;
  const out = resolve(values.out ?? join(HERE, 'artifacts/parts/lessons.json'));
  const artifacts = join(HERE, 'artifacts/shards', runId);
  mkdirSync(artifacts, { recursive: true }); mkdirSync(dirname(out), { recursive: true });
  const llm = createLlm({ dry: !!values.dry, maxUsd: Number(values['max-usd'] ?? 3) });
  const data = await readData();
  const ctx: Ctx = { llm, db: null as never, dataset: data.dataset, names: names(`bench_${runId}`), artifacts }; // no graph: these approaches never touch FalkorDB
  const r = await runLessons(ctx, data.eval, { limit: values.limit ? Number(values.limit) : undefined, only: values.only?.split(',') as Key[] | undefined });
  const part = { partial: true, only: 'lessons', run_id: runId, run_at: Date.now(), seed: data.dataset.seed, models: [llm.answerModel], judge_model: llm.judgeModel, dry: !!values.dry, spent_usd: llm.spent(),
    decision_traces: { approaches: r.approaches, approaches_run: { model: llm.answerModel, judge_model: llm.judgeModel, ...r, approaches: undefined, spent_usd: llm.spent() } } };
  writeFileSync(out, JSON.stringify(part, null, 2) + '\n');
  writeFileSync(join(artifacts, 'usage.json'), JSON.stringify({ spent_usd: llm.spent(), by_caller: llm.byCaller }, null, 2));
  console.log(`lessons: wrote ${out} ($${llm.spent().toFixed(4)} spent)`);
  process.exit(0);
}
