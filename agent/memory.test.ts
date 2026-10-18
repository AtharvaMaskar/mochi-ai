// Tiers below the brain: cust_* episodes and user_* preferences, written and read on throwaway graphs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { GRAPH, validateCard, type ToolCard } from '@mochi/contracts';
import { admin } from './__test__/load-fixture.ts';
import { userDb, closeAll } from './db.ts';
import { appendEpisode, briefWithMemory, readPreferences, rememberPreference } from './memory.ts';

const CUST = `tiers-test-${process.pid}`, USER_G = GRAPH.user(`tiers_test_${process.pid}`);
const db = await admin();
after(async () => {
  for (const g of [GRAPH.cust(CUST), USER_G]) await db.selectGraph(g).delete().catch(() => {});
  await db.close();
  await closeAll();
});

const card = (): ToolCard => ({
  kind: 'briefing', title: 'test', path: null, blocks: [],
  queries: { q_1: { cypher: 'RETURN $as_of AS t', graph: GRAPH.company, params: { ticketId: 'T-X' }, columns: ['customer_id', 'ticket_subject'], rows: [{ customer_id: CUST, ticket_subject: 'Order stuck' }], ran_at: 0 } },
});

test('both tiers: write, read back with provenance, receipts name their graph', async () => {
  await rememberPreference(db as never, USER_G, { user: 'A-T', text: 'I prefer short replies', session: 's-1', id: 'PR-1' });
  assert.deepEqual((await readPreferences(db as never, USER_G, 'A-T')).rows, [{ preference: 'I prefer short replies', source: 'session', source_session: 's-1' }]);

  const first = await briefWithMemory(card(), db as never, { user: 'A-T', userGraph: USER_G, session: 's-1' });
  assert.equal(first.queries.q_2.rows.length, 0, 'no earlier episodes before the first brief');
  const second = await briefWithMemory(card(), db as never, { user: 'A-T', userGraph: USER_G, session: 's-2' });
  const v = validateCard(second);
  assert.ok(v.ok, v.ok ? '' : v.errors.join('; '));
  assert.match(second.queries.q_2.graph, /^cust_/);
  assert.match(second.queries.q_3.graph, /^user_/);
  assert.equal(second.queries.q_2.rows[0].ticket, 'T-X');
  assert.equal(second.queries.q_2.rows[0].source, 'session');
  assert.match(String(second.queries.q_2.rows[0].summary), /Order stuck: briefed/);
  assert.equal(second.queries.q_3.rows[0].preference, 'I prefer short replies');
  assert.deepEqual(second.blocks.map((b) => (b as { label: string }).label), ['This customer before', 'From your memory']);

  // The real write path: user_demo may write cust_*; the MERGE by id keeps a replay from duplicating.
  const e = { customerId: CUST, ticketId: 'T-Y', summary: 'answered', session: 'desk', id: 'EP-ans-1' };
  await appendEpisode((await userDb()) as never, e);
  await appendEpisode((await userDb()) as never, e);
  const n = await db.selectGraph(GRAPH.cust(CUST)).roQuery<{ n: number }>(`MATCH (e:Episode {id: 'EP-ans-1'}) RETURN count(e) AS n`);
  assert.equal(n.data?.[0].n, 1);
});

test('an unwritten tier reads as no rows', async () => {
  assert.equal((await readPreferences(db as never, GRAPH.user(`tiers_none_${process.pid}`), 'A-T')).rows.length, 0);
});
