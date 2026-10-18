import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDataset } from '@mochi/contracts';
import { simulate, stable, CATALOGUE, REPLAY_START, type Flag } from './generate.ts';
import { validParaphrase } from './text.ts';

const warm = await simulate(42, { offline: true });
const d = warm.truth.dataset;

test('counts, broker and contract validity', () => {
  assert.equal(d.broker, 'E Corp Securities');
  assert.ok(validateDataset(d).ok);
  assert.equal(d.customers.length, 1000);
  assert.ok(d.tickets.length >= 2800 && d.tickets.length <= 3200, `${d.tickets.length} tickets`);
  assert.ok(d.conversations!.length >= 9000 && d.conversations!.length <= 11000, `${d.conversations!.length} conversations`);
  assert.deepEqual([d.agents.length, d.teams.length, d.issues.length, d.sla_policies!.length], [12, 4, 18, 12]);
  assert.ok(d.customers.every((c) => c.email?.endsWith('@mail.example')));
  const demo = d.tickets.filter((t) => t.created_at >= REPLAY_START).length;
  assert.ok(demo >= 30 && demo <= 60, `${demo} demo-window tickets`);
  for (const t of d.tickets) assert.equal(t.status, t.status_history!.at(-1)!.status, t.id);
});

test('every catalogue flag occurs, each within ±50% of its estimate', () => {
  for (const f of Object.keys(CATALOGUE) as Flag[]) {
    const c = warm.truth.catalogue[f];
    assert.ok(c.count >= 1, `${f} never occurs`);
    if (c.target !== null) assert.ok(Math.abs(c.freq / c.target - 1) <= 0.5, `${f}: ${c.freq} vs ${c.target}`);
  }
});

test('merges: duplicates point to an unmerged primary of the same customer', () => {
  const byId = new Map(d.tickets.map((t) => [t.id, t]));
  const merged = d.tickets.filter((t) => t.merged_into);
  assert.ok(merged.length >= 5);
  for (const t of merged) {
    const p = byId.get(t.merged_into!)!;
    assert.ok(p && !p.merged_into && p.customer_id === t.customer_id && t.status === 'closed' && t.issue_id === null, t.id);
    assert.equal(warm.truth.tickets[t.id].duplicate_of, p.id);
  }
});

test('warm cache: two runs are byte-identical; templates-only too', async () => {
  const again = await simulate(42, { offline: true });
  assert.equal(again.stats!.calls, 0);
  assert.equal(stable(again.inbox), stable(warm.inbox));
  assert.equal(stable(again.truth), stable(warm.truth));
  const [a, b] = [await simulate(42, { templatesOnly: true }), await simulate(42, { templatesOnly: true })];
  assert.equal(stable(a.inbox), stable(b.inbox));
});

test('paraphrase validator: a dropped placeholder or language switch falls back', () => {
  const sk = 'Money was debited, the amount is {{AMOUNT}}.';
  assert.ok(validParaphrase(sk, 'en', 'My bank took {{AMOUNT}} but nothing arrived.'));
  assert.ok(!validParaphrase(sk, 'en', 'My bank took the money but nothing arrived.'));
  assert.ok(!validParaphrase(sk, 'en', 'Paisa {{AMOUNT}} kat gaya par nahi aaya.'));
  assert.ok(!validParaphrase(sk, 'en', '<div>{{AMOUNT}}</div>'));
});
