import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintSource } from './type-lint.ts';

test('literal sizes, families and weights are flagged', () => {
  assert.equal(lintSource('.a { font-size: 12px; }').length, 1);
  assert.equal(lintSource('.a { font-family: Arial; }').length, 1);
  assert.equal(lintSource('.a { font-weight: 600; }').length, 1);
  assert.equal(lintSource("<p style={{ fontSize: 14 }} />").length, 1);
});

test('scale variables pass', () => {
  assert.deepEqual(lintSource('.a { font-size: var(--fs-caption); font-weight: var(--fw-caption); font-family: var(--font-sans); }'), []);
});

test('serif only for the mochi wordmark and mood', () => {
  assert.equal(lintSource('.title { font-family: var(--font-serif); }').length, 1);
  assert.deepEqual(lintSource('.mb-wordmark { font-family: var(--font-serif); }'), []);
});
