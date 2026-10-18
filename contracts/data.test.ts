import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDataset, validateEval } from './data.ts';
import { tinyDataset, tinyEval, tinyHelpdeskDataset } from './fixtures.ts';

test('valid dataset and eval pass', () => {
  const d = validateDataset(tinyDataset());
  assert.ok(d.ok, JSON.stringify(!d.ok && d.errors));
  assert.ok(validateEval(tinyEval(), d.value).ok);
});

test('missing field names the record and field', () => {
  const d: any = tinyDataset();
  delete d.tickets[1].body;
  const r = validateDataset(d);
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => e.includes('tickets[T-2].body')), r.errors.join('\n'));
});

test('dangling issue_id is reported', () => {
  const d = tinyDataset();
  d.tickets[0].issue_id = 'I-404';
  const r = validateDataset(d);
  assert.ok(!r.ok);
  assert.deepEqual(r.errors, ['dangling reference: tickets[T-1].issue_id=I-404']);
});

test('eval references are checked against the dataset', () => {
  const e = tinyEval();
  e.questions[2].after_event = 'E-404';
  const r = validateEval(e, tinyDataset());
  assert.ok(!r.ok && r.errors[0].includes('E-404'));
});

test('helpdesk fields: merge, waiting status, conversations, SLA', async () => {
  const { FD_STATUS, FD_SOURCE, Dataset } = await import('./data.ts');
  const d = validateDataset(tinyHelpdeskDataset());
  assert.ok(d.ok, !d.ok ? d.errors.join('\n') : '');
  const t3 = d.value.tickets.find((t) => t.id === 'T-3')!;
  assert.equal(t3.merged_into, 'T-2');
  assert.equal(FD_STATUS.waiting_on_customer, 6);
  assert.equal(FD_SOURCE.email, 1);
  assert.equal(d.value.conversations.length, 2);
  assert.equal(d.value.sla_policies[0].respond_within_ms, 4 * 3_600_000);
  // An older dataset without the new keys still validates, with defaults filled.
  const old: any = tinyHelpdeskDataset(); delete old.conversations; delete old.sla_policies;
  for (const t of old.tickets) for (const k of ['cc_emails', 'merged_into', 'status_history', 'fr_escalated']) delete t[k];
  const parsed = Dataset.parse(old);
  assert.deepEqual(parsed.conversations, []);
  assert.equal(parsed.tickets[0].fr_escalated, false);
});

test('merge chains, self-merges and dangling conversations are rejected', () => {
  const chain = tinyHelpdeskDataset(); chain.tickets[1].merged_into = 'T-1'; // T-3 -> T-2 -> T-1
  assert.match((validateDataset(chain) as any).errors.join(), /no merge chains/);
  const self = tinyHelpdeskDataset(); self.tickets[0].merged_into = 'T-1';
  assert.match((validateDataset(self) as any).errors.join(), /merge into itself/);
  const dangling = tinyHelpdeskDataset(); dangling.conversations![0].ticket_id = 'T-404';
  assert.match((validateDataset(dangling) as any).errors.join(), /conversations\[CV-1\]\.ticket_id=T-404/);
});
