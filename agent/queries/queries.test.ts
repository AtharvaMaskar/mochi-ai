import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateCard, checkCypherNames, type ToolCard } from '@mochi/contracts';
import { admin, loadFixture, richFixture, expectedCounts, testGraph, T0, DAY } from '../__test__/load-fixture.ts';
import { embedStub } from '../__test__/embed-stub.ts';
import { CYPHER, allCypher, briefing, likelyCause, whoKnows, emergingClusters, blastRadius, searchSimilar, returnColumns } from './index.ts';

const G = testGraph('queries');
const NOW = T0 + 45 * DAY; // after T-2 is raised, before I-1's fix (E-2 at T0+50d)
let db: Awaited<ReturnType<typeof admin>>;

before(async () => {
  db = await admin();
  await db.selectGraph(G).delete().catch(() => {});
  await loadFixture(db, G);
});
after(async () => {
  await db.selectGraph(G).delete().catch(() => {});
  await db.close();
});

const valid = (card: ToolCard) => {
  const r = validateCard(card);
  assert.ok(r.ok, r.ok ? '' : r.errors.join('; '));
  for (const q of Object.values(card.queries)) assert.match(q.cypher, /\$as_of/);
};

test('fixture loader writes the expected node and edge counts', async () => {
  const g = db.selectGraph(G);
  const n = (await g.roQuery<{ n: number }>('MATCH (x) RETURN count(x) AS n')).data![0].n;
  const e = (await g.roQuery<{ n: number }>('MATCH ()-[r]->() RETURN count(r) AS n')).data![0].n;
  assert.deepEqual({ nodes: n, edges: e }, expectedCounts(richFixture()));
});

test('every CYPHER string uses only contract names and takes $as_of', () => {
  for (const [name, c] of allCypher()) {
    assert.deepEqual(checkCypherNames(c), [], name);
    assert.match(c, /\$as_of/, name);
  }
});

test('returnColumns reads aliases and bare variables', () => {
  assert.deepEqual(returnColumns(CYPHER.whoKnows), ['agent_id', 'agent', 'team', 'solved', 'example_ticket', 'issue']);
  assert.deepEqual(returnColumns(CYPHER.emergingClusters), ['cluster', 'tickets', 'growth']);
});

test('briefing on T-2 finds T-1 / R-1 / KB-1 and a path from T-2 to KB-1', async () => {
  const { card } = await briefing(db, { ticketId: 'T-2' }, NOW, G);
  valid(card);
  assert.equal(card.queries.q_1.rows[0].plan, 'premium');
  assert.deepEqual(card.queries.q_3.rows.map((r) => [r.ticket, r.resolution_id, r.kb_id]), [['T-1', 'R-1', 'KB-1']]);
  const ids = card.path!.nodes.map((n) => n.id);
  assert.equal(ids[0], 'T-2');
  assert.equal(ids.at(-1), 'KB-1');
  assert.deepEqual(card.path!.edges.map((e) => e.type), ['ABOUT', 'ABOUT', 'RESOLVED_BY', 'BASED_ON']);
});

test('NODE_AS_OF hides a ticket raised after as_of', async () => {
  const { card } = await briefing(db, { ticketId: 'T-2' }, T0 + 20 * DAY, G);
  valid(card);
  assert.equal(card.queries.q_1.rows.length, 0); // T-2 created at T0+42d: excluded by NODE_AS_OF
});

test('briefing falls back to the vector index when the ticket has no ABOUT edge', async () => {
  const { card } = await briefing(db, { ticketId: 'T-3' }, NOW, G);
  valid(card);
  assert.match(card.queries.q_3.cypher, /db\.idx\.vector\.queryNodes/);
  assert.match(card.title, /vector→graph/);
  assert.equal(card.queries.q_3.rows[0].ticket, 'T-1');
  assert.equal(card.path!.nodes.at(-1)!.id, 'KB-1');
});

test('likelyCause answers differ on either side of the fix', async () => {
  const before = await likelyCause(db, { ticketId: 'T-2' }, NOW, G);
  const afterFix = await likelyCause(db, { ticketId: 'T-2' }, T0 + 55 * DAY, G);
  valid(before.card); valid(afterFix.card);
  assert.equal(before.card.queries.q_1.rows[0].release, '2.4.0');
  assert.equal(afterFix.card.queries.q_1.rows.length, 0);
  assert.equal(afterFix.card.path, null);
});

test('whoKnows ranks A-1 first with count(s)', async () => {
  const { card } = await whoKnows(db, { issueId: 'I-1' }, NOW, G);
  valid(card);
  assert.match(card.queries.q_1.cypher, /count\(s\)/);
  assert.deepEqual([card.queries.q_1.rows[0].agent_id, card.queries.q_1.rows[0].solved], ['A-1', 1]);
});

test('whoKnows finds the issue by name as well as id (chat passes the name)', async () => {
  const byId = await whoKnows(db, { issueId: 'I-1' }, NOW, G);
  const name = String(byId.card.queries.q_1.rows[0].issue);
  const { card } = await whoKnows(db, { issueId: name.toUpperCase() }, NOW, G);
  valid(card);
  assert.deepEqual(card.queries.q_1.rows, byId.card.queries.q_1.rows);
});

test('emergingClusters reads live IN_CLUSTER, empty before the dream wrote them', async () => {
  const { card } = await emergingClusters(db, { days: 7 }, NOW, G);
  valid(card);
  assert.deepEqual(card.queries.q_1.rows, [{ cluster: 'CL-T-1', tickets: 2, growth: 2 }]);
  const early = await emergingClusters(db, { days: 7 }, T0 + 43 * DAY, G);
  valid(early.card);
  assert.equal(early.card.queries.q_1.rows.length, 0);
});

test('blastRadius returns segments, open tickets and the Release→Customer path', async () => {
  const { card } = await blastRadius(db, { version: '2.4.0' }, NOW, G);
  valid(card);
  assert.deepEqual(card.queries.q_1.rows, [{ segment: 'premium', customers: 1, tickets: 2 }]);
  assert.deepEqual(card.queries.q_2.rows[0], { customers: 1, tickets: 2, open_tickets: 1 });
  assert.deepEqual(card.path!.edges.map((e) => e.type), ['INTRODUCED', 'ABOUT', 'RAISED']);
});

test('searchSimilar ranks the closest ticket first (score is a distance)', async () => {
  const { card } = await searchSimilar(db, { text: 'Order not placed, paisa kat gaya, order nahi laga', k: 2 }, NOW, G, embedStub);
  valid(card);
  const rows = card.queries.q_1.rows;
  assert.equal(rows.length, 2);
  assert.ok(['T-1', 'T-3'].includes(String(rows[0].ticket)));
  assert.ok(Number(rows[0].score) <= Number(rows[1].score));
});
