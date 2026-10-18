// The nightly dream (SPEC §1, §4): snapshot → ingest → invalidate → clusters → practice →
// mismatch rules + suggestions → doctrine → morning report. mochi_dream is the sole writer;
// nothing in mochi_company is deleted, facts are retired by valid_until.
import { readFileSync } from 'node:fs';
import { createModels } from '@earendil-works/pi-ai/models';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { defineTask } from '@earendil-works/pi-durable';
import { GRAPH, validateDataset, type ContradictionEvent, type Story } from '@mochi/contracts';
import { applyEvent } from '@mochi/gen';
import { appendStory } from '../stories.ts';
import { Q } from './cypher.ts';
import { ingest, type Hook, type Memo } from './ingest.ts';
import { buildReport } from './report.ts';
import { hash, inputTokens, norm, rows, runIdOf, runMismatchRules, writeSuggestions, type MismatchEdge, type SuggestionOut } from './rules.ts';
import type { Db, DreamGraphs, DreamModel, DreamReport, StepUsage } from './types.ts';

export type { DreamReport, DreamGraphs, DreamModel } from './types.ts';
export { runMismatchRules, CONFIDENCE_FULL } from './rules.ts';

const DAY = 86_400_000;
const DEFAULT_GRAPHS: DreamGraphs = { company: GRAPH.company, prev: GRAPH.companyPrev, scratch: GRAPH.scratch };

export function resolveModel(id = process.env.MOCHI_MODEL ?? 'claude-haiku-5-5'): DreamModel {
  const models = createModels();
  models.setProvider(anthropicProvider());
  const model = models.getModel('anthropic', id);
  if (!model) throw new Error(`unknown model anthropic/${id} (MOCHI_MODEL)`);
  return { models, model };
}

function loadEvents(): ContradictionEvent[] {
  let raw: string;
  try { raw = readFileSync(new URL('../../data/dataset.json', import.meta.url), 'utf8'); } catch { return []; }
  const r = validateDataset(JSON.parse(raw));
  if (!r.ok) throw new Error(`data/dataset.json invalid: ${r.errors.slice(0, 3).join('; ')}`);
  return r.value.contradiction_events;
}

const ignoreMissing = (e: unknown) => { if (!/(empty key|invalid graph|not exist|no such)/i.test(String((e as Error)?.message))) throw e; };

export type RunOptions = {
  db: Db; as_of?: number; model?: DreamModel | string; graphs?: Partial<DreamGraphs>;
  /** Contradiction events to apply; default data/dataset.json. */
  events?: ContradictionEvent[];
  /** runtime.memo in DreamTask; default no persistence. */
  memo?: Memo;
  /** Called between steps (tests count, crash tests throw). */
  onStep?: Hook;
  /** agent-core's commitStory: the report lands in StoryDoc, served by GET /api/stories/:id and the WebSocket. */
  commitStory?: (story: Story) => Promise<unknown>;
};

// DreamTask's connection. Task input is JSON, so the harness injects its writer here (default: agent/db.ts mochi_dream).
let dbOf: () => Promise<Db> = async () => (await import('../db.ts')).writer();
export function useDb(f: () => Promise<Db>) { dbOf = f; }

export async function runDreamNow(opts: RunOptions): Promise<DreamReport> {
  const t0 = Date.now();
  const { db } = opts;
  const as_of = opts.as_of ?? Date.now();
  const run = runIdOf(as_of);
  const graphs: DreamGraphs = { ...DEFAULT_GRAPHS, ...opts.graphs };
  const company = db.selectGraph(graphs.company);
  const llm = typeof opts.model === 'object' ? opts.model : resolveModel(opts.model);
  if (!llm.models?.complete) throw new Error('runDreamNow: model must be a DreamModel {models, model}');
  const memo: Memo = opts.memo ?? ((_k, f) => f());
  const hook: Hook = opts.onStep ?? (() => {});
  const extract: StepUsage = { input: 0, output: 0, calls: 0 }, suggest: StepUsage = { input: 0, output: 0, calls: 0 };

  // 1 · snapshot: yesterday's brain, before any write.
  await db.selectGraph(graphs.prev).delete().catch(ignoreMissing);
  // GRAPH.COPY forks; Redis allows one child at a time (another copy, BGSAVE, AOF rewrite), so retry.
  for (let i = 0; ; i++) {
    try { await company.copy(graphs.prev); break; }
    catch (e) { if (i >= 50 || !/could not fork/i.test(String(e))) throw e; await new Promise((r) => setTimeout(r, 100 + 100 * Math.random())); }
  }
  await hook('snapshot');

  // 2 · ingest
  const ing = await ingest(db, graphs.company, as_of, llm, { memo, hook, usage: extract });
  await hook('ingest');

  // 2b · SIMILAR_TO: the kNN graph the algorithms run on.
  const sim = await buildSimilar(db, graphs.company, as_of);
  await hook('similar');

  // 3 · invalidate: due events through gen's idempotent applyEvent.
  let eventsRetired = 0;
  for (const e of (opts.events ?? loadEvents()).filter((e) => e.at <= as_of).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)))
    eventsRetired += (await applyEvent(e, company, e.at)).retired;
  await hook('invalidate');

  // 4 · clusters on a live-edge projection (algorithms ignore edge properties).
  const cl = await clusters(db, graphs, as_of);
  await hook('clusters');

  // 5 + 6 · practice and the deterministic mismatch rules.
  const rules = await runMismatchRules(db, graphs, { as_of });
  await hook('rules');
  const teams = graphs.teams ?? (await db.list()).filter((g) => g.startsWith('team_'));
  const sugg = await writeSuggestions(db, graphs, teams, rules.edges, as_of, async (e) => {
    const msg = await llm.models.complete(llm.model, {
      systemPrompt: 'You write two plain sentences for a support lead about a mismatch between company doctrine and practice. No numbers, no markdown, no lists.',
      messages: [{ role: 'user', content: JSON.stringify(proseFacts(e)), timestamp: Date.now() }],
    }, { maxTokens: 160, thinkingEnabled: false } as any); // two sentences; no extended thinking
    suggest.input += inputTokens(msg.usage); suggest.output += msg.usage.output; suggest.calls++;
    const text = msg.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join(' ').trim();
    return msg.stopReason === 'error' || !text ? null : text;
  });
  await hook('suggestions');

  // 7 · doctrine: team-tier candidates become company Policies with provenance.
  const policies = await commitDoctrine(db, graphs.company, teams, as_of);
  await hook('doctrine');

  // 8 · morning report
  // A quiet night creates no new suggestions; the report still lists the open ones, so a known mismatch never drops off.
  const open = sugg.length ? sugg : ((await rows(db, graphs.company, Q.openSuggestions, { as_of })) as unknown as SuggestionOut[]).map((s) => ({ ...s, prose: 'model' as const }));
  const { story, errors } = await buildReport(db, graphs.company, as_of, open);
  if (story && opts.commitStory) await opts.commitStory(story);
  await hook('report');

  return {
    run_id: run, as_of, ms: Date.now() - t0,
    retired: eventsRetired + cl.retired + rules.retired + sim.retired,
    retired_by: { events: eventsRetired, clusters: cl.retired, mismatches: rules.retired, similar: sim.retired },
    created: { tickets_ingested: ing.ingested, patterns: rules.patterns.length, mismatch_edges: rules.written,
      suggestions: sugg.length, policies: policies.length, cluster_edges: cl.created, similar_edges: sim.created },
    ingested: ing.ingested, dropped: ing.dropped, batches: ing.batches,
    clusters: { count: cl.ids.length, ids: cl.ids, retired: cl.retired, receipts: { projection: `${Q.windowPairs}\n// → ${graphs.scratch}:\n${Q.projectPairs}`, algorithm: Q.labelPropagation } },
    mismatches: rules.edges, suggestions: sugg.map((s) => s.id), policies,
    usage: { extract, suggest, total: { input: extract.input + suggest.input, output: extract.output + suggest.output } },
    story_id: story?.id ?? null, story, story_errors: errors,
  };
}

const proseFacts = (e: MismatchEdge) => e.type === 'CONTRADICTS'
  ? { mismatch: 'measured resolution time is far above what the document promises', document: e.target, area: e.area }
  : { mismatch: 'a repeated workaround appears in no document', workaround: e.summary, area: e.area };

/** τ is a percentile of the graph's own kNN distances, not a fixed number, so it holds for any embedding provider
 *  (MiniLM 384-d or OpenAI 1536-d). Measured on the seeded 3,015 MiniLM tickets (k=6): the median neighbour distance
 *  is 0.130, which leaves about 3 edges per ticket. */
export const SIMILAR_PERCENTILE = 0.5;

/** Nightly kNN: each ticket's ≤6 nearest neighbours within τ. Unchanged pairs stay live; dropped pairs are retired by
 *  valid_until; new pairs are created. Batches of 1,000 because RESULTSET_SIZE truncates at 10k rows (gotcha 5). */
export async function buildSimilar(db: Db, company: string, as_of: number, tauOverride?: number) {
  const ids = (await rows<{ id: string }>(db, company, Q.ticketIds, { as_of })).map((r) => r.id);
  const knn: { a: string; b: string; score: number }[] = [];
  type K = { a: string; b: string; score: number };
  const batch = (b: string[]) => rows<K>(db, company, Q.knn, { ids: b, as_of });
  try {
    for (let i = 0; i < ids.length; i += 1000) {
      const b = ids.slice(i, i + 1000);
      // A ticket embedded by another provider (dimension mismatch) fails the whole batch: retry one by one, skip it.
      knn.push(...await batch(b).catch(async (e) => {
        if (!/dimension/i.test(String(e))) throw e;
        return (await Promise.all(b.map((id) => batch([id]).catch(() => [] as K[])))).flat();
      }));
    }
  } catch (e) { if (/vector|index/i.test(String(e))) return { retired: 0, created: 0, tau: null }; throw e; } // no vector index yet
  const sorted = knn.map((r) => r.score).sort((x, y) => x - y);
  const tau = tauOverride ?? sorted[Math.floor(SIMILAR_PERCENTILE * (sorted.length - 1))] ?? 0;
  const next = knn.filter((r) => r.score <= tau);
  const live = await rows<{ a: string; b: string }>(db, company, Q.liveSimilar, { as_of });
  const key = (r: { a: string; b: string }) => `${r.a}|${r.b}`;
  const want = new Set(next.map(key)), have = new Set(live.map(key));
  const gone = live.filter((r) => !want.has(key(r))), fresh = next.filter((r) => !have.has(key(r)));
  let retired = 0, created = 0;
  for (let i = 0; i < gone.length; i += 2000) retired += (await rows<{ retired: number }>(db, company, Q.retireSimilar, { rows: gone.slice(i, i + 2000), as_of }))[0].retired;
  for (let i = 0; i < fresh.length; i += 2000) created += (await rows<{ created: number }>(db, company, Q.createSimilar, { rows: fresh.slice(i, i + 2000), as_of }))[0].created;
  return { retired, created, tau };
}

async function clusters(db: Db, graphs: DreamGraphs, as_of: number) {
  const pairs = await rows<{ t: string; i: string; name: string }>(db, graphs.company, Q.windowPairs, { as_of });
  const scratch = db.selectGraph(graphs.scratch);
  await scratch.delete().catch(ignoreMissing);
  if (!pairs.length) return { ids: [] as string[], retired: 0, created: 0 };
  for (let i = 0; i < pairs.length; i += 500) await scratch.query(Q.projectPairs, { params: { rows: pairs.slice(i, i + 500) } as any });
  const comm = await rows<{ communityId: number; id: string }>(db, graphs.scratch, Q.labelPropagation);
  const groups = new Map<number, string[]>();
  for (const r of comm) groups.set(r.communityId, [...(groups.get(r.communityId) ?? []), r.id]);
  const issueName = new Map(pairs.map((p) => [p.t, p.name]));
  const byNum = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
  const list = [...groups.values()].map((m) => m.sort(byNum)).map((members) => {
    const names = members.map((t) => issueName.get(t)!);
    const name = names.sort((a, b) => names.filter((x) => x === b).length - names.filter((x) => x === a).length || a.localeCompare(b))[0];
    return { id: `CL-${members[0]}`, name, members };
  });
  const out = list.flatMap((c) => c.members.map((t) => ({ t, c: c.id, name: c.name, members: c.members })));
  let retired = 0, created = 0;
  for (let i = 0; i < out.length; i += 500) {
    retired += (await rows<{ retired: number }>(db, graphs.company, Q.retireClusterEdges, { rows: out.slice(i, i + 500), as_of }))[0].retired;
    created += (await rows<{ created: number }>(db, graphs.company, Q.createClusterEdges, { rows: out.slice(i, i + 500), as_of }))[0]?.created ?? 0;
  }
  return { ids: list.map((c) => c.id).sort(byNum), retired, created };
}

async function commitDoctrine(db: Db, company: string, teams: string[], as_of: number): Promise<string[]> {
  const ids: string[] = [];
  for (const team of teams) {
    const cands = await rows<{ nid: number; text: string; area: string; promised: number | null; steps: string[] | null; taught_by: string | null; source_session: string | null; reviewed: boolean }>(db, team, Q.candidates);
    if (!cands.length) continue;
    // A candidate is committed only when two distinct sessions taught the same text, or a lead marked it reviewed.
    const groups = new Map<string, typeof cands>();
    for (const c of cands.filter((c) => c.text.trim())) {
      const key = `${c.area}|${norm(c.text)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c); // ordered by created_at: the earliest teaching keeps the provenance
    }
    const ready = [...groups.values()].filter((g) => g.some((c) => c.reviewed) || new Set(g.map((c) => c.source_session ?? `nid:${c.nid}`)).size >= 2);
    const list = ready.map(([c]) => ({
      id: `POL-${c.area}-${hash(norm(c.text))}`, area: c.area, text: c.text.trim(), promised: c.promised, steps: c.steps,
      taught_by: c.taught_by ?? 'unknown', source_session: c.source_session ?? 'unknown',
    }));
    // Identical text in one area merges onto one Policy id, so a duplicate is committed once.
    if (list.length) await rows(db, company, Q.commitPolicies, { rows: list, as_of });
    const done = ready.flat().map((c) => c.nid);
    if (done.length) await rows(db, team, Q.markReviewed, { ids: done, as_of });
    ids.push(...list.map((p) => p.id));
  }
  return [...new Set(ids)];
}

// ── Background task ─────────────────────────────────────────────────────────────────────────

type Summary = { run_id: string; as_of: number; story_id: string | null; retired: number; ingested: number; suggestions: number; errors: string[] };
type DreamInput = { every?: number; first?: number; graphs?: Partial<DreamGraphs>; model?: { provider: string; id: string } };
type DreamState = { phase: 'wait'; next: number; last?: Summary } | { phase: 'run'; as_of: number; last?: Summary };

const everyOf = (input: DreamInput) => input.every ?? Number(process.env.MOCHI_DREAM_EVERY_MS ?? DAY);

export const DreamTask = defineTask<DreamInput, DreamState, null>({
  name: 'mochi.dream',
  version: 1,
  initial: (input) => ({ phase: 'wait', next: Date.now() + (input.first ?? everyOf(input)) }),
  phases: {
    wait: async (task, rt, ctx) => {
      const { next, last } = task.state.checkpoint;
      if (next > rt.now()) await rt.sleep(next, ctx);
      // as_of is fixed in the checkpoint, so a resumed run has the same run id and memo keys.
      await rt.commit(() => ({ status: 'running', checkpoint: { phase: 'run', as_of: rt.now(), ...(last ? { last } : {}) } }), ctx);
    },
    run: async (task, rt, ctx) => {
      const { as_of } = task.state.checkpoint;
      const m = task.input.model ?? { provider: 'anthropic', id: process.env.MOCHI_MODEL ?? 'claude-haiku-5-5' };
      const model = rt.models.getModel(m.provider, m.id);
      if (!model) throw new Error(`unknown model ${m.provider}/${m.id}`);
      const report = await runDreamNow({
        db: await dbOf(), as_of, graphs: task.input.graphs, model: { models: rt.models, model },
        memo: async (key, compute) => {
          const hit = await rt.memo<any>(key, ctx);
          return hit !== undefined ? hit : rt.memo<any>(key, (await compute()) as any, ctx);
        },
      });
      const last: Summary = { run_id: report.run_id, as_of, story_id: report.story_id, retired: report.retired,
        ingested: report.ingested, suggestions: report.suggestions.length, errors: report.story_errors };
      await rt.commit(async (tx) => {
        if (report.story) await appendStory(tx, report.story);
        return { status: 'running', checkpoint: { phase: 'wait', next: rt.now() + everyOf(task.input), last } };
      }, ctx);
    },
  },
  abort: (_task, rt, ctx) => rt.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }) as any, ctx),
});
