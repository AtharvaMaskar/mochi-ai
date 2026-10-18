// Test double of @mochi/gen applyEvent (add-gen graph-loader spec "Event replay"): retire the live
// fact at `at`, create its replacement, delete nothing; a second apply retires 0.
import { EDGE_AS_OF, VALID_FOREVER, type ContradictionEvent } from '@mochi/contracts';
import type { Graph } from 'falkordb';

export async function applyEvent(event: ContradictionEvent, graph: Graph, at = event.at): Promise<{ retired: number }> {
  const params = { as_of: at, at } as any;
  if (event.kind === 'plan_change') {
    const r = await graph.query<{ n: number }>(
      `MATCH (c:Customer {id: $cid})-[e:ON_PLAN]->(:Plan {name: $from}) WHERE ${EDGE_AS_OF('e')}
       SET e.valid_until = $at
       WITH c, count(e) AS n
       MATCH (p:Plan {name: $to}) WHERE n > 0
       CREATE (c)-[:ON_PLAN {valid_from: $at, valid_until: ${VALID_FOREVER}}]->(p)
       RETURN n`, { params: { ...params, cid: event.customer_id, from: event.from, to: event.to } });
    return { retired: r.data?.[0]?.n ?? 0 };
  }
  const r = await graph.query<{ n: number }>(
    `MATCH (:Release)-[e:INTRODUCED]->(:Issue {id: $iid}) WHERE ${EDGE_AS_OF('e')} SET e.valid_until = $at RETURN count(e) AS n`,
    { params: { ...params, iid: event.issue_id } });
  return { retired: r.data?.[0]?.n ?? 0 };
}
