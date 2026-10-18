import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDataset, validateEval } from '@mochi/contracts';
import { simulate } from '../sim/generate.ts';
import { derive, plantFailures, compact, stable } from './derive.ts';

const { truth } = await simulate(42, { offline: true });
const out = derive(truth);
const d = out.dataset;
const read = (p: string) => readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8');

test('committed data/ equals a fresh derive from the sim (seed 42, warm cache)', () => {
  assert.equal(read('dataset.json'), compact(out.dataset));
  assert.equal(read('bench/dataset.json'), compact(out.bench));
  assert.equal(read('eval.json'), stable(out.eval));
});

test('full dataset: counts in range, every helpdesk field populated', () => {
  assert.equal(d.broker, 'E Corp Securities');
  const seg = (s: string) => d.customers.filter((c) => c.segment === s).length;
  assert.deepEqual([d.customers.length, seg('retail'), seg('premium'), seg('hni')], [1000, 600, 300, 100]);
  assert.equal(new Set(d.customers.map((c) => c.city)).size, 8);
  assert.ok(d.tickets.length >= 2800 && d.tickets.length <= 3200, `${d.tickets.length}`);
  assert.ok(d.conversations.length >= 9000 && d.conversations.length <= 11000, `${d.conversations.length}`);
  assert.deepEqual([d.issues.length, new Set(d.issues.map((i) => i.area)).size, d.teams.length, d.agents.length, d.kb_articles.length, d.releases.length, d.plans.length, d.contradiction_events.length, d.sla_policies.length],
    [18, 6, 4, 12, 25, 8, 2, 10, 12]);
  for (const t of d.tickets) {
    assert.ok(t.requester_email && t.status_history.length && t.fr_due_by && t.due_by, t.id);
    if (t.resolved_at !== null) assert.ok(t.first_responded_at !== null && t.first_responded_at <= t.resolved_at, t.id);
    if (t.status === 'closed') assert.ok(t.closed_at, t.id);
  }
  assert.ok(d.customers.every((c) => c.email!.endsWith('@mail.example')));
  assert.ok(d.tickets.some((t) => t.cc_emails.length) && d.tickets.some((t) => t.on_behalf_of) && d.tickets.some((t) => t.fr_escalated) && d.tickets.some((t) => t.is_escalated));
  for (const s of ['waiting_on_customer', 'waiting_on_third_party']) assert.ok(d.tickets.some((t) => t.status_history.some((h) => h.status === s)), s);
});

test('demo window: 30-60 tickets, every event inside it, events match live facts', () => {
  const start = d.generated_at - 86_400_000;
  const demo = d.tickets.filter((t) => t.created_at >= start).length;
  assert.ok(demo >= 30 && demo <= 60, `${demo}`);
  assert.ok(d.contradiction_events.every((e) => e.at >= start && e.at < d.generated_at));
  for (const e of d.contradiction_events) {
    if (e.kind === 'issue_fixed') assert.equal(d.releases.flatMap((r) => r.introduces).filter((x) => x.issue_id === e.issue_id && x.valid_until === null).length, 1);
    else assert.equal(d.customers.find((c) => c.id === e.customer_id)!.plan_history.at(-1)!.plan, e.from);
  }
});

test('bench slice: 400 tickets, valid alone, every plant intact; eval over the slice', () => {
  const s = validateDataset(out.bench);
  assert.ok(s.ok);
  assert.equal(out.bench.tickets.length, 400);
  assert.deepEqual(plantFailures(out.bench, { minChains: 20, minMerged: 5 }), []);
  assert.deepEqual(plantFailures(d, { minChains: 20, minMerged: 5 }), []);
  assert.ok(validateEval(out.eval, s.value).ok);
  const b = (x: string) => out.eval.questions.filter((q) => q.bucket === x).length;
  assert.deepEqual([out.eval.questions.length, b('single_fact'), b('multi_hop'), b('structural')], [50, 20, 20, 10]);
  assert.equal(out.eval.questions.filter((q) => q.after_event).length, 10);
  assert.deepEqual(out.eval.planted_mismatches.map((m) => m.kind).sort(), ['contradicts', 'contradicts', 'contradicts', 'undocumented', 'undocumented']);
  const ids = new Set(out.bench.tickets.map((t) => t.id));
  assert.ok(out.eval.planted_mismatches.every((m) => m.ticket_ids.every((t) => ids.has(t))));
});
