// Hover cards on IDs: GET /api/entity/:id → { kind, fields, queries }. Every field is read off a stored query's rows,
// so the card's receipt pill opens the Cypher that produced it. Read-only through mochi_reader, $as_of = now.
import type { StoredQuery } from '@mochi/contracts';
import { CYPHER, runStored, type Db } from '../queries/index.ts';
import { SimError } from './sim.ts';

/** @-mention autocomplete: up to 8 tickets/customers/issues, kinds interleaved so one kind never crowds out the rest. */
export async function entitySearch(db: Db, graph: string, q: string) {
  const r = await runStored(db, graph, CYPHER.entity.search, { q: q.trim().toLowerCase().slice(0, 64) }, Date.now());
  const by = ['ticket', 'customer', 'issue'].map((k) => r.rows.filter((x) => x.kind === k));
  const rows = Array.from({ length: 8 }, (_, i) => by.map((b) => b[i])).flat().filter(Boolean).slice(0, 8);
  return { results: rows as { kind: 'ticket' | 'customer' | 'issue'; id: string; name: string }[], query: { ...r, rows } };
}

export async function entityCard(db: Db, graph: string, id: string) {
  const as_of = Date.now();
  const run = (cypher: string, params: Record<string, unknown>) => runStored(db, graph, cypher, params, as_of);
  let queries: Record<string, StoredQuery>;
  let fields: Record<string, unknown> | undefined;
  let kind: 'customer' | 'ticket' | 'kb';
  if (/^C-\d+$/.test(id)) {
    kind = 'customer';
    const q_1 = await run(CYPHER.customerProfile.profile, { customerId: id });
    const q_2 = await run(CYPHER.entity.customerActivity, { customerId: id });
    queries = { q_1, q_2 };
    fields = q_1.rows[0] && { ...q_1.rows[0], ...q_2.rows[0] };
  } else if (/^T-\d+$/.test(id)) {
    kind = 'ticket';
    const q_1 = await run(CYPHER.entity.ticket, { ticketId: id });
    queries = { q_1 };
    fields = q_1.rows[0];
  } else if (/^KB-\d+$/.test(id)) {
    kind = 'kb';
    const q_1 = await run(CYPHER.entity.kb, { kbId: id });
    queries = { q_1 };
    fields = q_1.rows[0];
  } else throw new SimError(400, `${id} is not a customer, ticket or KB article id.`);
  if (!fields) throw new SimError(404, `I have no ${kind === 'kb' ? 'KB article' : kind} ${id} in memory yet.`);
  return { kind, id, ...fields, queries };
}
