// Tier-isolation refusal cases (SPEC §1 ledger row). acl.test.ts asserts them; bench records them.
import { GRAPH } from './graph.ts';

type Graph = { query(q: string): Promise<unknown>; roQuery(q: string): Promise<unknown>; delete(): Promise<unknown> };
type Db = { selectGraph(name: string): Graph };

export const REFUSAL_CASES: { case: string; run: (db: Db) => Promise<unknown> }[] = [
  { case: 'RO_QUERY CREATE on company', run: (db) => db.selectGraph(GRAPH.company).roQuery("CREATE (:Ticket {id:'evil'})") },
  { case: 'GRAPH.QUERY on company', run: (db) => db.selectGraph(GRAPH.company).query('MATCH (t:Ticket) RETURN count(t)') },
  { case: 'RO_QUERY on a user_* graph', run: (db) => db.selectGraph(GRAPH.user('demo')).roQuery('RETURN 1') },
  { case: 'GRAPH.DELETE company', run: (db) => db.selectGraph(GRAPH.company).delete() },
];
