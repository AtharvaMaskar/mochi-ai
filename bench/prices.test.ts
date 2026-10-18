import { test } from 'node:test';
import assert from 'node:assert/strict';
import { price } from './prices.ts';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('a 150K-token Haiku call is priced at the long-prompt rate', () => {
  close(price('claude-haiku-5-5', { input: 150_000, output: 1000, cacheRead: 0, cacheWrite: 0 }).cost, 0.15 * 0.5 + 0.001 * 2.5);
  close(price('claude-haiku-5-5', { input: 50_000, output: 1000, cacheRead: 0, cacheWrite: 0 }).cost, 0.05 * 0.1 + 0.001 * 0.5);
  // cached tokens count toward the tier threshold
  close(price('claude-haiku-5-5', { input: 10, output: 0, cacheRead: 120_000, cacheWrite: 0 }).cost, (10 * 0.5 + 120_000 * 0.05) * 1e-6);
});

test('cache reads and writes are priced apart; uncached prices them as input', () => {
  const p = price('claude-sonnet-5-5', { input: 1000, output: 100, cacheRead: 50_000, cacheWrite: 2000 });
  close(p.cost, (1000 * 2 + 50_000 * 0.2 + 2000 * 2.5 + 100 * 10) * 1e-6);
  close(p.uncached, (53_000 * 2 + 100 * 10) * 1e-6);
  close(price('claude-opus-5-5', { input: 0, output: 0, cacheRead: 1e6, cacheWrite: 0 }).cost, 0.2);
  assert.throws(() => price('claude-nope', { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }), /no published price/);
});
