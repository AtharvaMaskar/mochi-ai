// Replays one contradiction event with the temporal rule: retire the live fact, then create the new one.
// Deletes nothing; a second apply finds no live fact to retire and returns {retired: 0}.
import { EDGE_AS_OF, VALID_FOREVER, type ContradictionEvent } from '@mochi/contracts';
import type { Graph } from 'falkordb';

export async function applyEvent(event: ContradictionEvent, graph: Graph, at = event.at): Promise<{ retired: number }> {
  const q = event.kind === 'plan_change'
    ? `MATCH (c:Customer {id:$id}), (np:Plan {name:$to})
       OPTIONAL MATCH (c)-[e:ON_PLAN]->(p:Plan) WHERE ${EDGE_AS_OF('e')} AND p.name <> $to
       FOREACH (x IN CASE WHEN e IS NULL THEN [] ELSE [e] END | SET x.valid_until = $as_of)
       WITH c, np, count(e) AS retired
       FOREACH (_ IN CASE WHEN retired > 0 THEN [1] ELSE [] END | CREATE (c)-[:ON_PLAN {valid_from:$as_of, valid_until:$forever}]->(np))
       RETURN retired`
    : `OPTIONAL MATCH (:Release)-[e:INTRODUCED]->(:Issue {id:$id}) WHERE ${EDGE_AS_OF('e')}
       FOREACH (x IN CASE WHEN e IS NULL THEN [] ELSE [e] END | SET x.valid_until = $as_of)
       RETURN count(e) AS retired`;
  const params = { id: event.kind === 'plan_change' ? event.customer_id : event.issue_id, to: event.kind === 'plan_change' ? event.to : '', as_of: at, forever: VALID_FOREVER };
  const r = await graph.query<{ retired: number }>(q, { params });
  return { retired: r.data?.[0]?.retired ?? 0 };
}
