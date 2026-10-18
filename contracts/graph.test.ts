import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { GRAPH, checkCypherNames, EDGE_AS_OF, NODE_AS_OF, VALID_FOREVER, TEMPORAL_INDEXES } from './graph.ts';
import { connect } from './testdb.ts';

test('graph name builders', () => {
  assert.equal(GRAPH.team('funds'), 'team_funds');
  assert.equal(GRAPH.cust('C-42'), 'cust_c_42');
  assert.throws(() => GRAPH.user('--'));
});

test('checkCypherNames accepts contract names and reports drift', () => {
  assert.deepEqual(checkCypherNames('MATCH (c:Customer)-[:RAISED]->(t:Ticket)-[a:ABOUT]->(:Issue) RETURN c'), []);
  assert.deepEqual(checkCypherNames('MATCH (r:Release)-[:INTRODUCED|ABOUT*1..3]->(x) RETURN x'), []);
  assert.deepEqual(checkCypherNames("MATCH (t:Tickt)-[:ABOUTS]->(i) WHERE t.subject = '(x:Nope)' RETURN t").sort(), ['edge ABOUTS', 'label Tickt']);
});

const G = 'contracts_test_temporal';
const db = await connect();
after(async () => { await db.selectGraph(G).delete().catch(() => {}); await db.close(); });

test('as-of fragments against FalkorDB', async () => {
  const g = db.selectGraph(G);
  await g.delete().catch(() => {});
  const T = 1_000_000, T2 = 2_000_000;
  await g.query(`
    CREATE (c:Customer {id:'C-1', created_at:0, source:'seed'}), (b:Plan {name:'basic', created_at:0, source:'seed'}), (p:Plan {name:'premium', created_at:0, source:'seed'}),
           (c)-[:ON_PLAN {valid_from:0, valid_until:$T}]->(b), (c)-[:ON_PLAN {valid_from:$T, valid_until:$F}]->(p),
           (:Suggestion {id:'S-1', created_at:$T2, source:'dream'})`, { params: { T, T2, F: VALID_FOREVER } });
  for (const ix of TEMPORAL_INDEXES) await g.query(ix).catch(() => {}); // idempotent: index may exist

  const plan = `MATCH (:Customer {id:'C-1'})-[r:ON_PLAN]->(p:Plan) WHERE ${EDGE_AS_OF('r')} RETURN p.name AS plan`;
  const now = await g.roQuery<{ plan: string }>(plan, { params: { as_of: Date.now() } });
  assert.deepEqual(now.data?.map((r) => r.plan), ['premium']);
  const before = await g.roQuery<{ plan: string }>(plan, { params: { as_of: T - 1 } });
  assert.deepEqual(before.data?.map((r) => r.plan), ['basic']);

  const sugg = `MATCH (s:Suggestion) WHERE ${NODE_AS_OF('s')} RETURN count(s) AS n`;
  assert.equal((await g.roQuery<{ n: number }>(sugg, { params: { as_of: T2 - 1 } })).data?.[0].n, 0);
  assert.equal((await g.roQuery<{ n: number }>(sugg, { params: { as_of: Date.now() } })).data?.[0].n, 1);

  const planText = (await g.explain(plan.replaceAll("$as_of", String(Date.now())))).join('\n');
  assert.match(planText, /Index Scan/i, planText);
});

test('MERGED_INTO is a contract edge', () => {
  assert.deepEqual(checkCypherNames('MATCH (a:Ticket)-[:MERGED_INTO]->(b:Ticket) RETURN a'), []);
});

test('REMEMBERS Episode is a contract edge', () => {
  assert.deepEqual(checkCypherNames('MATCH (:Customer)-[:REMEMBERS]->(e:Episode), (:AgentUser)-[:REMEMBERS]->(:Episode) RETURN e'), []);
});
