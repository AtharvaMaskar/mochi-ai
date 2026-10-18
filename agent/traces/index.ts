// Decision traces (change decision-traces): a journal of answers that worked, so the next similar ticket or question
// starts from the path that worked instead of from zero. One Trace = the question, its embedding, the read-tool Steps
// in order, the stored Queries (receipts) it cited, the outcome and valid_from/valid_until. It lives in its own graph
// (TRACE_LABELS.graph); Trace.ticket_id names a Ticket in the company graph and is resolved there at read time, never
// by a cross-graph edge. Retrieval re-checks every cited query against the company graph at the current as_of and
// closes (valid_until = now) a trace whose receipts emptied, changed shape, or rest on a KB article the dream marked
// CONTRADICTS, so a retired fact is never handed back as a hint.
import { EDGE_AS_OF, TRACE_LABELS as J, NODE_AS_OF, VALID_FOREVER, type StoredQuery } from '@mochi/contracts';

type Opts = { params?: Record<string, unknown> };
type Graph = { query<T>(q: string, o?: Opts): Promise<{ data?: T[] }>; roQuery<T>(q: string, o?: Opts): Promise<{ data?: T[] }> };
export type JournalDb = { selectGraph(name: string): Graph };
export type ReadDb = { selectGraph(name: string): Pick<Graph, 'roQuery'> };

export type Step = { tool: string; args: Record<string, unknown> };
export type Cited = Pick<StoredQuery, 'cypher' | 'graph' | 'params' | 'columns'> & { row_count: number };
export type TraceIn = { id: string; ticket_id?: string | null; question: string; steps: Step[]; queries: StoredQuery[]; outcome: string; source?: string };
export type Trace = { id: string; ticket_id: string; question: string; outcome: string; score: number; steps: Step[]; queries: Cited[] };

/** Tools whose calls a trace keeps: the read tools. Writes (record_resolution, teach, …) are never replayed. */
export const TRACE_TOOLS = new Set(['briefing', 'likely_cause', 'who_knows', 'emerging_clusters', 'blast_radius', 'search_similar', 'customer_profile', 'query_graph', 'graph_algorithm']);
/** Cosine distance (FalkorDB's vector score; smaller = closer). Hint below HINT_MAX; replay only below REPLAY_MAX. */
export const HINT_MAX = 0.35, REPLAY_MAX = 0.15;
const ID = /\b(?:[A-Z]{1,3}-\d+|\d+\.\d+\.\d+)\b/g;
export const ticketOf = (s: string) => s.match(/\bT-\d+\b/)?.[0] ?? null;

const exists = (e: unknown) => /already (indexed|exists)/i.test(String((e as Error)?.message ?? e));
export async function ensureJournal(db: JournalDb, dim: number, graph: string = J.graph) {
  await db.selectGraph(graph).query(`CREATE VECTOR INDEX FOR (t:${J.Trace}) ON (t.embedding) OPTIONS {dimension:${dim}, similarityFunction:'cosine'}`)
    .catch((e) => { if (!exists(e)) throw e; });
}

export async function recordTrace(db: JournalDb, t: TraceIn, embedding: number[], now: number, graph: string = J.graph) {
  const steps = t.steps.filter((s) => TRACE_TOOLS.has(s.tool)).map((s, i) => ({ i, tool: s.tool, args: JSON.stringify(s.args) }));
  const queries = t.queries.map((q) => ({ cypher: q.cypher, graph: q.graph, params: JSON.stringify(q.params), columns: JSON.stringify(q.columns), row_count: q.rows.length }));
  const g = db.selectGraph(graph);
  await g.query(`CREATE (t:${J.Trace} {id: $id, ticket_id: $ticket, question: $question, outcome: $outcome, embedding: vecf32($embedding),
  valid_from: $now, valid_until: ${VALID_FOREVER}, created_at: $now, source: $source})
WITH t UNWIND $steps AS s CREATE (t)-[:${J.STEP} {i: s.i}]->(:${J.Step} {tool: s.tool, args: s.args, created_at: $now})`,
  { params: { id: t.id, ticket: t.ticket_id ?? '', question: t.question, outcome: t.outcome.slice(0, 500), embedding, now, source: t.source ?? 'session', steps } });
  if (queries.length) await g.query(`MATCH (t:${J.Trace} {id: $id})
UNWIND $queries AS q CREATE (t)-[:${J.CITED}]->(:${J.Query} {cypher: q.cypher, graph: q.graph, params: q.params, columns: q.columns, row_count: q.row_count, created_at: $now})`,
  { params: { id: t.id, queries, now } });
}

/** The k nearest live traces to an embedding, with their steps in order and their cited queries. */
export async function nearest(db: JournalDb, embedding: number[], now: number, k = 8, graph: string = J.graph): Promise<Trace[]> {
  const r = await db.selectGraph(graph).roQuery<{ t: Record<string, any>; score: number; steps: { i: number; tool: string; args: string }[]; queries: Record<string, any>[] }>(
    `CALL db.idx.vector.queryNodes('${J.Trace}', 'embedding', $k, vecf32($e)) YIELD node, score
WITH node, score WHERE node.valid_until > $now
OPTIONAL MATCH (node)-[s:${J.STEP}]->(st:${J.Step})
WITH node, score, collect({i: s.i, tool: st.tool, args: st.args}) AS steps
OPTIONAL MATCH (node)-[:${J.CITED}]->(q:${J.Query})
RETURN {id: node.id, ticket_id: node.ticket_id, question: node.question, outcome: node.outcome} AS t, score, steps,
       collect({cypher: q.cypher, graph: q.graph, params: q.params, columns: q.columns, row_count: q.row_count}) AS queries
ORDER BY score`, { params: { e: embedding, k, now } }).catch((e) => { if (/no such index|not indexed|unknown index/i.test(String(e?.message))) return { data: [] }; throw e; });
  return (r.data ?? []).map((x) => ({
    ...x.t, score: x.score,
    steps: x.steps.filter((s) => s.tool).sort((a, b) => a.i - b.i).map((s) => ({ tool: s.tool, args: JSON.parse(s.args) })),
    queries: x.queries.filter((q) => q.cypher).map((q) => ({ cypher: q.cypher, graph: q.graph, params: JSON.parse(q.params), columns: JSON.parse(q.columns), row_count: q.row_count })),
  })) as Trace[];
}

/** Resolved tickets like this one: the dream's live SIMILAR_TO edges first, the Ticket vector index as fallback. */
export async function similarTickets(read: ReadDb, graph: string, ticketId: string, as_of: number, k = 10): Promise<string[]> {
  const g = read.selectGraph(graph);
  const p = { params: { ticketId, as_of, k } };
  const viaEdges = await g.roQuery<{ id: string }>(`MATCH (t:Ticket {id: $ticketId})-[s:SIMILAR_TO]-(o:Ticket)
WHERE ${EDGE_AS_OF('s')} AND ${NODE_AS_OF('o')} AND o.resolved_at <= $as_of
RETURN o.id AS id ORDER BY s.score, id LIMIT $k`, p);
  if (viaEdges.data?.length) return viaEdges.data.map((x) => x.id);
  const viaVector = await g.roQuery<{ id: string }>(`MATCH (t:Ticket {id: $ticketId})
CALL db.idx.vector.queryNodes('Ticket', 'embedding', $k, t.embedding) YIELD node, score
WITH node AS o, score WHERE o.id <> $ticketId AND ${NODE_AS_OF('o')} AND o.resolved_at <= $as_of
RETURN o.id AS id ORDER BY score, id`, p).catch(() => ({ data: [] }));
  return (viaVector.data ?? []).map((x) => x.id);
}

/**
 * Still true? Re-run each cited query at the current as_of: a receipt that had rows and now has none, or whose columns
 * changed, means the fact under the trace was retired; so does a cited KB article with a live CONTRADICTS edge. A stale
 * trace is closed (valid_until = now) so it is never offered again.
 */
export async function fresh(read: ReadDb, journal: JournalDb, t: Trace, as_of: number, journalGraph: string = J.graph): Promise<boolean> {
  const kbs = new Set<string>();
  let ok = true;
  for (const q of t.queries) {
    const r = await read.selectGraph(q.graph).roQuery<Record<string, unknown>>(q.cypher, { params: { ...q.params, as_of } }).catch(() => null);
    const rows = r?.data ?? [];
    if (!r || (q.row_count > 0 && !rows.length) || (rows.length && Object.keys(rows[0]).join() !== q.columns.join())) { ok = false; break; }
    for (const row of rows) if (typeof row.kb_id === 'string') kbs.add(row.kb_id);
  }
  if (ok && kbs.size) {
    const g = t.queries[0].graph;
    const c = await read.selectGraph(g).roQuery<{ n: number }>(`MATCH (:ObservedPattern)-[c:CONTRADICTS]->(k:KBArticle)
WHERE k.id IN $kbs AND ${EDGE_AS_OF('c')} RETURN count(c) AS n`, { params: { kbs: [...kbs], as_of } });
    ok = !(c.data?.[0]?.n ?? 0);
  }
  if (!ok) await journal.selectGraph(journalGraph).query(`MATCH (t:${J.Trace} {id: $id}) SET t.valid_until = $now`, { params: { id: t.id, now: as_of } });
  return ok;
}

export type Plan = { trace: Trace; hint: string; replay: Step[] | null };

/**
 * The best live trace for a question. With a ticket in the question, traces of that ticket or its similar resolved
 * tickets win; otherwise the nearest trace under HINT_MAX. replay is set when the match is under REPLAY_MAX and every
 * id the stored steps take maps onto one id of the same kind in the new question.
 */
export async function plan(o: { journal: JournalDb; read: ReadDb; graph: string; question: string; embedding: number[]; as_of: number; journalGraph?: string }): Promise<Plan | null> {
  const near = (await nearest(o.journal, o.embedding, o.as_of, 8, o.journalGraph)).filter((t) => t.score <= HINT_MAX);
  if (!near.length) return null;
  const ticket = ticketOf(o.question);
  const similar = ticket ? new Set([ticket, ...await similarTickets(o.read, o.graph, ticket, o.as_of)]) : new Set<string>();
  const ordered = [...near.filter((t) => similar.has(t.ticket_id)), ...near.filter((t) => !similar.has(t.ticket_id))];
  for (const t of ordered) {
    if (!(await fresh(o.read, o.journal, t, o.as_of, o.journalGraph))) continue;
    const replay = t.score <= REPLAY_MAX ? substitute(t.steps, o.question) : null;
    return { trace: t, replay, hint: hintText(t, similar.has(t.ticket_id)) };
  }
  return null;
}

/** Steps with their ids swapped for the new question's, or null when an id has no unambiguous counterpart. */
export function substitute(steps: Step[], question: string): Step[] | null {
  if (!steps.length) return null;
  const now = [...new Set(question.match(ID) ?? [])];
  const kind = (id: string) => (/^\d/.test(id) ? 'version' : id.split('-')[0]);
  const map = new Map<string, string>();
  for (const s of steps) for (const old of JSON.stringify(s.args).match(ID) ?? []) {
    const cands = now.filter((x) => kind(x) === kind(old));
    if (cands.length !== 1) return null;
    map.set(old, cands[0]);
  }
  const swap = (v: string) => v.replace(ID, (m) => map.get(m) ?? m);
  return steps.map((s) => ({ tool: s.tool, args: JSON.parse(swap(JSON.stringify(s.args))) }));
}

const tag = (cypher: string) => cypher.match(/\/\*\s*(mochi:[^*]+?)\s*\*\//)?.[1] ?? cypher.replace(/\s+/g, ' ').slice(0, 160);
export function hintText(t: Trace, similarTicket: boolean): string {
  const steps = t.steps.map((s) => `${s.tool}(${JSON.stringify(s.args)})`).join(' -> ');
  const cypher = [...new Set(t.queries.map((q) => tag(q.cypher)))].join('; ');
  return [`Journal: ${similarTicket ? `similar resolved ticket ${t.ticket_id}` : 'a similar past question'} ("${t.question.slice(0, 120)}") was answered with ${steps || 'no tools'}.`,
    // A chat answer is a fact that may since have been retired, so only a ticket's fix (re-checked by fresh()) is shown.
    `Cypher: ${cypher || 'none'}.${similarTicket ? ` Fix that held there: ${t.outcome.slice(0, 160)}.` : ''} Use current tool results for facts.`].join('\n');
}
