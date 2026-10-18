// Decision traces: id substitution for replay, and one journal round trip where a retired fact closes the trace.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { admin } from '../__test__/load-fixture.ts';
import { ensureJournal, fresh, nearest, recordTrace, substitute } from './index.ts';

test('substitute maps each stored id onto the one same-kind id in the new question, else refuses', () => {
  const steps = [{ tool: 'likely_cause', args: { ticketId: 'T-1' } }];
  assert.deepEqual(substitute(steps, 'Which release likely caused ticket T-9?'), [{ tool: 'likely_cause', args: { ticketId: 'T-9' } }]);
  assert.equal(substitute(steps, 'Compare T-9 and T-10'), null); // ambiguous
  assert.equal(substitute(steps, 'Who knows issue I-3?'), null); // no ticket to map onto
});

const J = `test_journal_${process.pid}`, C = `test_traces_company_${process.pid}`;
const db = await admin();
after(async () => {
  for (const g of [J, C]) await db.selectGraph(g).delete().catch(() => {});
  await db.close();
});

test('a trace whose cited receipt empties is closed and never returned again', async () => {
  const live = `MATCH (t:Ticket {id: $ticketId}) WHERE t.created_at <= $as_of AND t.live RETURN t.id AS ticket`;
  await db.selectGraph(C).query(`CREATE (:Ticket {id: 'T-1', created_at: 0, live: true})`);
  await ensureJournal(db, 4, J);
  await recordTrace(db, {
    id: 'TR-1', ticket_id: 'T-1', question: 'cause of T-1?', steps: [{ tool: 'likely_cause', args: { ticketId: 'T-1' } }],
    queries: [{ cypher: live, graph: C, params: { ticketId: 'T-1' }, columns: ['ticket'], rows: [{ ticket: 'T-1' }], ran_at: 0 }], outcome: '3.1.0',
  }, [1, 0, 0, 0], 1, J);
  const [t] = await nearest(db, [1, 0, 0, 0], 2, 8, J);
  assert.equal(t.id, 'TR-1');
  assert.deepEqual(t.steps, [{ tool: 'likely_cause', args: { ticketId: 'T-1' } }]);
  assert.equal(await fresh(db, db, t, 2, J), true);
  await db.selectGraph(C).query(`MATCH (t:Ticket {id: 'T-1'}) SET t.live = false`); // the fact is retired
  assert.equal(await fresh(db, db, t, 3, J), false);
  assert.deepEqual(await nearest(db, [1, 0, 0, 0], 4, 8, J), []);
});
