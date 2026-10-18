// fix-gate1-agent: mismatch suggestions in the per-ticket briefing, the Q5 incident note, retire_fact.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { validateCard, VALID_FOREVER, type ToolCard } from '@mochi/contracts';
import { admin, loadFixture, testGraph, T0, DAY } from './__test__/load-fixture.ts';
import { ctx, openTestHarness, toolResults } from './__test__/pi.ts';
import { closeAll } from './db.ts';
import { blastRadius, briefing } from './queries/index.ts';

const G = testGraph('gate1');
const NOW = T0 + 45 * DAY;
let db: Awaited<ReturnType<typeof admin>>;

before(async () => {
  db = await admin();
  await db.selectGraph(G).delete().catch(() => {});
  await loadFixture(db, G);
  // What the dream writes for a planted mismatch in T-2's area (orders, owned by trading).
  await db.selectGraph(G).query(`MATCH (kb:KBArticle {id: 'KB-1'}), (tm:Team {name: 'trading'})
CREATE (p:ObservedPattern {id: 'OP-1', area: 'orders', measured_tat_hours: 71, support_count: 6, source: 'dream', created_at: $c})
  -[:CONTRADICTS {promised: 24, measured: 71, delta: 47, valid_from: $c, valid_until: $f, source: 'dream', created_at: $c}]->(kb)
CREATE (s:Suggestion {id: 'S-1', area: 'orders', edge: 'CONTRADICTS', text: 'KB-1 promises a day; fixes take 71 hours.', status: 'open',
  support_count: 6, confidence: 0.8, expires_at: $exp, source: 'dream', created_at: $c})-[:FROM]->(p)
CREATE (s)-[:FOR]->(tm)`, { params: { c: T0 + 44 * DAY, f: VALID_FOREVER, exp: T0 + 60 * DAY } });
});
after(async () => {
  await db.selectGraph(G).delete().catch(() => {});
  await db.close();
  await closeAll();
});

const valid = (card: ToolCard) => { const r = validateCard(card); assert.ok(r.ok, r.ok ? '' : r.errors.join('; ')); };

test('briefing carries the live mismatch suggestion for the ticket\'s area, with receipts', async () => {
  const { card } = await briefing(db, { ticketId: 'T-2' }, NOW, G);
  valid(card);
  assert.match(card.queries.q_4.cypher, /\$as_of/);
  const s = card.blocks.find((b) => b.type === 'suggestion');
  assert.ok(s && s.type === 'suggestion');
  assert.equal(s.query_id, 'q_4');
  assert.equal(s.edge, 'CONTRADICTS');
  assert.deepEqual(s.actions, ['send_to_team:trading', 'draft_kb:KB-1', 'dismiss']);
  assert.deepEqual(s.nums.map((n) => n.column).sort(), ['measured', 'measured', 'promised', 'support'].sort());
  // before the dream wrote it, and after it expires, the briefing has no suggestion
  for (const t of [T0 + 43 * DAY, T0 + 61 * DAY]) {
    const r = await briefing(db, { ticketId: 'T-2' }, t, G);
    valid(r.card);
    assert.equal(r.card.blocks.filter((b) => b.type === 'suggestion').length, 0, String(t));
  }
});

test('blast_radius drafts an incident note for the owning team, figures as receipts', async () => {
  const { card } = await blastRadius(db, { version: '2.4.0' }, NOW, G);
  valid(card);
  assert.deepEqual(card.queries.q_4.rows.map((r) => [r.team, r.area]), [['trading', 'orders']]);
  const note = card.blocks.find((b) => b.type === 'suggestion');
  assert.ok(note && note.type === 'suggestion');
  assert.equal(note.tag, 'Incident note for trading');
  assert.match(note.text, /<num query_id="q_2" column="open_tickets">1<\/num> tickets are still open/);
});

test('retire_fact: root only; retires ON_PLAN and creates the replacement', async () => {
  const t = await openTestHarness(G, `test_agent_g1_${process.pid}`);
  try {
    assert.ok(!(await (await t.pi.createUserConversation()).agent(ctx)).tools.some((x) => x.name === 'retire_fact'));
    t.faux.setResponses([
      fauxAssistantMessage([fauxToolCall('retire_fact', { edge: 'ON_PLAN', from: 'C-1', to: 'premium', reason: 'downgraded', newPlan: 'basic' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('retire_fact', { edge: 'INTRODUCED', from: '2.4.0', to: 'I-9', reason: 'typo' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    ]);
    assert.equal((await (await t.pi.root.submit({ type: 'input', content: 'C-1 moved to basic', requestId: 'g1-1' }, ctx)).wait(ctx)).status, 'done');
    const [ok, miss] = await toolResults(t.pi.root);
    assert.equal(ok.isError, false, ok.content.map((c) => c.text).join());
    assert.equal(miss.isError, true);
    const live = (await db.selectGraph(G).roQuery<{ plan: string }>(`MATCH (:Customer {id: 'C-1'})-[e:ON_PLAN]->(p:Plan)
WHERE e.valid_until > $now RETURN p.name AS plan`, { params: { now: Date.now() } })).data!;
    assert.deepEqual(live.map((r) => r.plan), ['basic']);
  } finally { await t.close(); }
});
