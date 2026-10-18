// The one seam to other slices (design decision 2). Types mirror the interfaces in the
// add-gen / add-agent-core / add-dream proposals. Until those merge, the bodies below are
// stubs built on contracts' tinyDataset()/tinyEval(); at the integration sweep each STUB
// block becomes a re-export:
//   export { loadDataset, applyEvent, embed, EMBED_DIM } from '@mochi/gen';
//   export * as queries from '../agent/queries/index.ts';
//   export { runMismatchRules } from '../agent/dream/rules.ts';
//   export { runDreamNow, type DreamReport } from '../agent/dream/index.ts';
//   readData(): validateDataset/validateEval over data/dataset.json + data/eval.json.
// Integration check: bench passes runDreamNow a pi-ai catalog Model. Under --dry the real dream
// must not reach the provider with it (route it to faux, or skip the dream's LLM steps).
import type { FalkorDB } from 'falkordb';
import type { Api, Model } from '@earendil-works/pi-ai';
import { GRAPH, tinyDataset, tinyEval, type Dataset, type Eval, type ContradictionEvent, type ToolCard, type StoredQuery } from '@mochi/contracts';
import * as C from './cypher.ts';

type Graph = ReturnType<FalkorDB['selectGraph']>;
export type Db = Pick<FalkorDB, 'selectGraph'>;
export type DreamGraphs = { company: string; prev: string; scratch: string };
export type DreamReport = {
  usage: { step: string; input: number; output: number }[];
  retired: number; created: number; dropped: number; suggestions: number; clusters: number;
  batches: { id: string; size: number }[]; story_id: string | null; ms: number;
};
export type MismatchEdge = { type: 'CONTRADICTS' | 'UNDOCUMENTED'; kb_id: string | null; area: string };
export type QueryResult = { card: ToolCard; queries: Record<string, StoredQuery> };
type Q<A> = (db: Db, args: A, as_of: number) => Promise<QueryResult>;
export type Queries = {
  briefing: Q<{ ticketId: string }>; likelyCause: Q<{ ticketId: string }>; whoKnows: Q<{ issueId: string }>;
  emergingClusters: Q<{ days: number }>; blastRadius: Q<{ version: string }>; searchSimilar: Q<{ text: string; k: number }>;
};

export const STUBBED = true;

// ---- STUB: @mochi/gen ----
export const EMBED_DIM = 384;
const DAY = 86_400_000;

export async function readData(): Promise<{ dataset: Dataset; eval: Eval }> {
  return { dataset: tinyDataset(), eval: tinyEval() };
}

export async function loadDataset(dataset: Dataset, db: Db, { graph = GRAPH.company as string, fresh = false }: { graph?: string; fresh?: boolean } = {}): Promise<void> {
  const g = db.selectGraph(graph);
  if (fresh) await g.delete().catch(() => {});
  const params = { d: dataset as any, now: dataset.generated_at, demo_day: dataset.generated_at - DAY };
  for (const q of C.STUB_LOAD) await g.query(q, { params });
}

export async function applyEvent(event: ContradictionEvent, graph: Graph, at = event.at): Promise<{ retired: number }> {
  const [q, id] = event.kind === 'plan_change' ? [C.STUB_PLAN_CHANGE, event.customer_id] : [C.STUB_ISSUE_FIXED, event.issue_id];
  const r = await graph.query<{ retired: number }>(q, { params: { id, to: event.kind === 'plan_change' ? event.to : '', as_of: at } });
  return { retired: r.data?.[0]?.retired ?? 0 };
}

// Deterministic fake embedding: hashed bag of words, L2-normalised.
export async function embed(texts: string[]): Promise<number[][]> {
  return texts.map((t) => {
    const v = new Array(EMBED_DIM).fill(0);
    for (const w of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let h = 0;
      for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      v[h % EMBED_DIM] += 1;
    }
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  });
}

// ---- STUB: agent/queries ----
async function stub(db: Db, kind: ToolCard['kind'], title: string, cypher: string, params: Record<string, unknown>, as_of: number): Promise<QueryResult> {
  const g = db.selectGraph(GRAPH.company);
  const r = await g.roQuery<Record<string, unknown>>(cypher, { params: { ...params, as_of } });
  const rows = r.data ?? [];
  const q: StoredQuery = { cypher, graph: GRAPH.company, params: { ...params, as_of }, columns: Object.keys(rows[0] ?? {}), rows, ran_at: Date.now() };
  const ids = [...new Set(rows.flatMap((row) => Object.values(row).filter((v): v is string => typeof v === 'string' && /^[A-Z]+-\d+$/.test(v))))];
  const path = ids.length ? { query_id: 'q_1', nodes: ids.map((id) => ({ id, label: 'Ticket', name: id })), edges: [] } : null;
  const card: ToolCard = { kind, title, queries: { q_1: q }, path, blocks: [] };
  return { card, queries: card.queries };
}
export const queries: Queries = {
  briefing: (db, a, t) => stub(db, 'briefing', `Briefing ${a.ticketId}`, C.STUB_BRIEFING, { id: a.ticketId }, t),
  likelyCause: (db, a, t) => stub(db, 'likely_cause', `Likely cause ${a.ticketId}`, C.STUB_LIKELY_CAUSE, { id: a.ticketId }, t),
  whoKnows: (db, a, t) => stub(db, 'who_knows', `Who knows ${a.issueId}`, C.STUB_WHO_KNOWS, { id: a.issueId }, t),
  emergingClusters: (db, a, t) => stub(db, 'clusters', 'Emerging clusters', C.STUB_CLUSTERS, { since: t - a.days * DAY }, t),
  blastRadius: (db, a, t) => stub(db, 'blast_radius', `Blast radius ${a.version}`, C.STUB_BLAST, { id: a.version }, t),
  searchSimilar: async (_db, a) => ({ card: { kind: 'similar', title: `Similar to "${a.text}"`, queries: {}, path: null, blocks: [] }, queries: {} }),
};

// ---- STUB: agent/dream/rules.ts ----
export async function runMismatchRules(_db: Db, _graphs?: DreamGraphs): Promise<MismatchEdge[]> {
  return [];
}

// ---- STUB: agent/dream ----
// Ingests un-ingested tickets in batches, one query per batch with batch_id/batch_size (the dream's
// stated contract), so the concurrency torn-read check has a real writer. No LLM, so usage is empty.
export async function runDreamNow(o: { db: Db; as_of?: number; model: Model<Api>; graphs?: DreamGraphs }): Promise<DreamReport> {
  const t0 = Date.now();
  const g = o.db.selectGraph(o.graphs?.company ?? GRAPH.company);
  const ids = ((await g.query<{ id: string }>(C.STUB_UNINGESTED)).data ?? []).map((r) => r.id);
  const batches: DreamReport['batches'] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20), batch = `stub-${t0}-${i}`;
    await g.query(C.STUB_INGEST_BATCH, { params: { ids: chunk, now: Date.now(), batch, size: chunk.length } });
    batches.push({ id: batch, size: chunk.length });
  }
  return { usage: [], retired: 0, created: 0, dropped: 0, suggestions: 0, clusters: 0, batches, story_id: null, ms: Date.now() - t0 };
}
