import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDataset, validateEval } from './data.ts';
import { tinyDataset, tinyEval } from './fixtures.ts';

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
