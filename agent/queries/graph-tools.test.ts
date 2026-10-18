import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { GRAPH, validateCard, type ToolCard } from '@mochi/contracts';
import { admin, loadFixture, testGraph, T0, DAY } from '../__test__/load-fixture.ts';
import { buildSimilar } from '../dream/index.ts';
import { graphAlgorithm, queryGraph, SCHEMA_PROMPT, type Algorithm, type AlgoParams } from './graph-tools.ts';

const G = testGraph('qgraph');
const REAL = testGraph('qgraph_real');
const NOW = T0 + 43 * DAY + 3_600_000; // an hour into the day T-3 was raised
let db: Awaited<ReturnType<typeof admin>>;
const drop = () => Promise.all([G, `${G}_scratch`, REAL, `${REAL}_scratch`].map((g) => db.selectGraph(g).delete().catch(() => {})));

before(async () => {
  db = await admin();
  await drop();
  await loadFixture(db, G);
  // stub embeddings: keep every kNN neighbour. The vector index fills asynchronously, so retry until it answers.
  for (let i = 0; i < 50 && !(await buildSimilar(db as never, G, NOW, 2)).created; i++) await new Promise((r) => setTimeout(r, 200));
});
after(async () => { await drop(); await db.close(); });

const valid = (card: ToolCard) => { const r = validateCard(card); assert.ok(r.ok, r.ok ? '' : r.errors.join('; ')); };
const ctx = () => ({ write: db as never });

test('query_graph: hand-written "last 20 tickets today" returns rows and a valid table card', async () => {
  const cypher = `MATCH (c:Customer)-[:RAISED]->(t:Ticket) WHERE t.created_at <= $as_of AND t.created_at >= $as_of - ($as_of % 86400000)
RETURN t.id AS ticket, t.subject AS subject, t.status AS status, c.id AS customer ORDER BY t.created_at DESC LIMIT 20`;
  const { card } = await queryGraph(db, { cypher, purpose: 'Last 20 tickets today' }, NOW, G);
  valid(card);
  assert.deepEqual(card.queries.q_1.rows.map((r) => r.ticket), ['T-3']);
  assert.equal(card.blocks[0].type, 'table');
  assert.equal(card.queries.q_1.cypher, cypher); // the receipt is the exact text
});

test('query_graph refuses writes, a missing $as_of and made-up names with a fix-it message', async () => {
  const run = (cypher: string) => queryGraph(db, { cypher, purpose: 'x' }, NOW, G);
  await assert.rejects(run(`CREATE (t:Ticket {id: 'X', created_at: $as_of}) RETURN t.id`), /read-only/);
  await assert.rejects(run(`MATCH (t:Ticket) RETURN t.id AS id`), /must reference \$as_of.*retry/);
  await assert.rejects(run(`MATCH (t:Gizmo) WHERE t.created_at <= $as_of RETURN t.id`), /label Gizmo/);
  await assert.rejects(queryGraph(db, { cypher: 'MATCH (n) WHERE n.created_at <= $as_of RETURN n.id', purpose: 'x', graph: 'user_someone_else' }, NOW, G), /not readable/);
});

const algo = (algorithm: Algorithm, params: AlgoParams = {}, graph = G) => graphAlgorithm(db, { algorithm, params, purpose: algorithm }, NOW, graph, ctx());

test('shortest_path over a temporal edge runs on the projection and returns a path receipt', async () => {
  const { card } = await algo('shortest_path', { source: { label: 'Customer', id: 'C-1' }, target: { label: 'Release', id: '2.4.0' } });
  valid(card);
  assert.ok(card.path && card.path.edges.some((e) => e.type === 'INTRODUCED'), JSON.stringify(card.path));
  assert.match(card.queries.q_1.cypher, /^\/\* projection[\s\S]*valid_until > \$as_of[\s\S]*CALL algo\.SPpaths/);
});

test('shortest_path over non-temporal edges runs directly on the company graph (RO_QUERY accepts CALL algo.*)', async () => {
  const { card } = await algo('shortest_path', { source: { label: 'Customer', id: 'C-1' }, target: { label: 'Issue', id: 'I-1' }, relTypes: ['RAISED', 'ABOUT'] });
  valid(card);
  assert.equal(card.queries.q_1.graph, G);
  assert.equal(card.path?.nodes.length, 3);
});

for (const [name, params] of [['pagerank', {}], ['communities', {}], ['components', {}], ['betweenness', {}], ['neighbourhood', { source: { label: 'Customer', id: 'C-1' }, relTypes: ['RAISED'] }]] as const) {
  test(`${name}: contract-valid card with rows`, async () => {
    const { card } = await algo(name, params as AlgoParams);
    valid(card);
    assert.ok(card.queries.q_1.rows.length > 0, `${name} returned no rows`);
    assert.match(card.queries.q_1.cypher, /\$as_of/);
  });
}

test('schema prompt names every algorithm and the as-of rule', () => {
  for (const a of ['shortest_path', 'pagerank', 'communities', 'components', 'betweenness', 'neighbourhood', 'valid_until > $as_of', 'last 20 tickets today']) assert.ok(SCHEMA_PROMPT.includes(a), a);
});

// ── Anti-gimmick: each default against its plain-Cypher baseline, on a copy of the real loaded data ───────────────

const ari = (a: unknown[], b: unknown[]) => {
  const n = a.length, c2 = (x: number) => (x * (x - 1)) / 2;
  const cell = new Map<string, number>(), ra = new Map<unknown, number>(), rb = new Map<unknown, number>();
  a.forEach((x, i) => { cell.set(`${x}|${b[i]}`, (cell.get(`${x}|${b[i]}`) ?? 0) + 1); ra.set(x, (ra.get(x) ?? 0) + 1); rb.set(b[i], (rb.get(b[i]) ?? 0) + 1); });
  const idx = [...cell.values()].reduce((s, v) => s + c2(v), 0), sa = [...ra.values()].reduce((s, v) => s + c2(v), 0), sb = [...rb.values()].reduce((s, v) => s + c2(v), 0);
  const exp = (sa * sb) / c2(n), max = (sa + sb) / 2;
  return (idx - exp) / (max - exp);
};
const ranks = (xs: number[]) => { const o = xs.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = Array(xs.length); o.forEach(([, i], k) => (r[i] = k)); return r as number[]; };
const spearman = (x: number[], y: number[]) => {
  const [a, b] = [ranks(x), ranks(y)], m = (v: number[]) => v.reduce((s, z) => s + z, 0) / v.length;
  const [ma, mb] = [m(a), m(b)];
  const cov = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0);
  return cov / Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) * b.reduce((s, v) => s + (v - mb) ** 2, 0));
};

test('anti-gimmick on real data', { skip: !(await (async () => { const d = await admin(); const ok = (await d.list()).includes(GRAPH.company); await d.close(); return ok; })()) }, async (t) => {
  await db.selectGraph(GRAPH.company).copy(REAL);
  const now = Date.now();
  const sim = await buildSimilar(db as never, REAL, now);
  const run = (a: Algorithm, p: AlgoParams = {}) => graphAlgorithm(db, { algorithm: a, params: p, purpose: a }, now, REAL, ctx());
  console.log(`similar_to edges: ${sim.created}`);

  await t.test('communities: ARI against issue labels < 0.95', async () => {
    await run('communities');
    const rows = (await db.selectGraph(`${REAL}_scratch`).roQuery<{ id: string; c: number; issue: string }>(
      `CALL algo.labelPropagation({nodeLabels: ['Ticket'], relationshipTypes: ['SIMILAR_TO'], maxIterations: 10}) YIELD node, communityId RETURN node.id AS id, communityId AS c, node.issue AS issue`)).data!;
    const s = ari(rows.map((r) => r.c), rows.map((r) => r.issue));
    console.log(`communities ARI vs issue = ${s.toFixed(3)} over ${rows.length} tickets`);
    assert.ok(s < 0.95, `ARI ${s}`);
  });

  await t.test('pagerank: Spearman against solved-count degree < 0.98', async () => {
    const { card } = await run('pagerank', { top: 50 });
    const rows = card.queries.q_1.rows as { score: number; solved: number }[];
    const rho = spearman(rows.map((r) => r.score), rows.map((r) => r.solved));
    console.log(`pagerank Spearman vs degree = ${rho.toFixed(3)} over ${rows.length} agents`);
    assert.ok(rho < 0.98, `rho ${rho}`);
  });

  await t.test('betweenness: at least two distinct non-zero scores', async () => {
    const { card } = await run('betweenness', { top: 50 });
    const nz = new Set((card.queries.q_1.rows as { score: number }[]).map((r) => r.score).filter((s) => s > 0));
    console.log(`betweenness distinct non-zero = ${nz.size}: ${JSON.stringify(card.queries.q_1.rows.slice(0, 5))}`);
    assert.ok(nz.size >= 2);
  });
});
