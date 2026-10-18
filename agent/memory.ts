// The tiers below the brain (SPEC §1 memory tiers): `cust_<id>` episodic memory and `user_<id>` preferences.
// Writes go through user_demo (its ACL allows user_demo + cust_*). Reads come back as stored queries, so every
// row is a receipt that names its own graph. Precedence: briefing facts come only from mochi_company; these
// tiers add history (cust_*) and preferences (user_*), each row tagged with source / source_session.
import { GRAPH, NODE_AS_OF, type StoredQuery, type ToolCard } from '@mochi/contracts';
import { returnColumns, runStored } from './queries/index.ts';

type Params = { params?: Record<string, unknown> };
export type MemDb = { selectGraph(name: string): { roQuery<T>(q: string, o?: Params): Promise<{ data?: T[] }>; query<T>(q: string, o?: Params): Promise<{ data?: T[] }> } };

// ponytail: one ACL user per human and only the demo login exists, so the personal graph is the one user_demo owns.
// The agent id (A-1) is the AgentUser node inside it. Add per-login ACL users when there is more than one person.
export const DEMO_USER_GRAPH = GRAPH.user('demo');

export const MEM_CYPHER = {
  episode: `/* mochi:memory.episode@v1 */
MERGE (c:Customer {id: $customerId}) ON CREATE SET c.created_at = $now, c.source = 'session'
MERGE (e:Episode {id: $id})
ON CREATE SET e.ticket_id = $ticketId, e.at = $now, e.summary = $summary, e.source = 'session', e.source_session = $session, e.created_at = $now
MERGE (c)-[:REMEMBERS]->(e)`,
  remember: `/* mochi:memory.remember@v1 */
MERGE (a:AgentUser {id: $user}) ON CREATE SET a.created_at = $now, a.source = 'session'
MERGE (e:Episode {id: $id})
ON CREATE SET e.kind = 'preference', e.text = $text, e.source = 'session', e.source_session = $session, e.created_at = $now
MERGE (a)-[:REMEMBERS]->(e)`,
  customerBefore: `/* mochi:memory.customer_before@v1 */
MATCH (:Customer {id: $customerId})-[:REMEMBERS]->(e:Episode) WHERE ${NODE_AS_OF('e')}
RETURN e.ticket_id AS ticket, e.summary AS summary, e.at AS at, e.source AS source, e.source_session AS source_session
ORDER BY e.at DESC, e.id LIMIT 5`,
  preferences: `/* mochi:memory.preferences@v1 */
MATCH (:AgentUser {id: $user})-[:REMEMBERS]->(e:Episode {kind: 'preference'}) WHERE ${NODE_AS_OF('e')}
RETURN e.text AS preference, e.source AS source, e.source_session AS source_session
ORDER BY e.created_at DESC, e.id LIMIT 10`,
} as const;

export function appendEpisode(db: MemDb, e: { customerId: string; ticketId: string; summary: string; session: string; id: string }) {
  return db.selectGraph(GRAPH.cust(e.customerId)).query(MEM_CYPHER.episode, { params: { ...e, now: Date.now() } });
}

export function rememberPreference(db: MemDb, graph: string, p: { user: string; text: string; session: string; id: string }) {
  return db.selectGraph(graph).query(MEM_CYPHER.remember, { params: { ...p, now: Date.now() } });
}

/** A tier graph that was never written does not exist yet; that reads as no rows, not an error. */
async function readTier(db: MemDb, graph: string, cypher: string, params: Record<string, unknown>, as_of: number): Promise<StoredQuery> {
  try { return await runStored(db, graph, cypher, params, as_of); } catch (e) {
    if (!/empty key|does not exist|Invalid graph operation/i.test(String((e as Error).message))) throw e;
    return { cypher, graph, params, columns: returnColumns(cypher), rows: [], ran_at: Date.now() };
  }
}

export const readPreferences = (db: MemDb, graph: string, user: string, as_of = Date.now()) =>
  readTier(db, graph, MEM_CYPHER.preferences, { user }, as_of);

/** Add "This customer before" (cust_*) and "From your memory" (user_*) to a briefing card, then log this briefing
 *  as an episode. Reads first, so "before" shows earlier episodes only. A failed episode write never fails the brief. */
export async function briefWithMemory(card: ToolCard, db: MemDb, o: { user: string; userGraph: string; session: string; episodeId?: string }, as_of = Date.now()): Promise<ToolCard> {
  const profile = card.queries.q_1?.rows[0];
  if (!profile) return card;
  const customerId = String(profile.customer_id);
  const ticketId = String(card.queries.q_1.params.ticketId);
  const n = Object.keys(card.queries).length;
  const [cq, uq] = [`q_${n + 1}`, `q_${n + 2}`];
  const out = structuredClone(card);
  out.queries[cq] = await readTier(db, GRAPH.cust(customerId), MEM_CYPHER.customerBefore, { customerId }, as_of);
  out.queries[uq] = await readPreferences(db, o.userGraph, o.user, as_of);
  out.blocks.push(
    { type: 'table', query_id: cq, label: 'This customer before', columns: ['ticket', 'summary', 'source', 'source_session'] },
    { type: 'table', query_id: uq, label: 'From your memory', columns: ['preference', 'source', 'source_session'] },
  );
  const fix = card.queries.q_3?.rows[0]?.resolution;
  await appendEpisode(db, {
    customerId, ticketId, session: o.session, id: o.episodeId ?? `EP-${o.session}-${ticketId}`,
    summary: `${String(profile.ticket_subject ?? ticketId)}: briefed${fix ? `, likely fix "${String(fix)}"` : ''}`,
  }).catch((e: Error) => console.error(`[memory] episode for ${ticketId}: ${e.message}`));
  return out;
}
