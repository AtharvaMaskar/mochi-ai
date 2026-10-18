import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlm, CostCapError } from './llm.ts';

test('faux calls return provider usage, summed per caller', async () => {
  const llm = createLlm({ dry: true, maxUsd: 1, reply: (p) => `echo ${p}` });
  const a = await llm.complete('x', 'hello world');
  await llm.complete('x', 'again');
  assert.equal(a.text, 'echo hello world');
  assert.ok(a.usage.input > 0 && a.usage.output > 0);
  assert.ok(llm.byCaller.x.input > a.usage.input);
});

test('the cap throws once crossed, and blocks further calls', async () => {
  const llm = createLlm({ dry: true, maxUsd: 0.5 });
  llm.record('a', { input: 1, output: 1, cost: 0.4 });
  assert.throws(() => llm.record('a', { input: 1, output: 1, cost: 0.2 }), CostCapError);
  await assert.rejects(llm.complete('a', 'hi'), CostCapError);
});

test('a missing model variable is named', () => {
  const saved = process.env.MOCHI_MODEL;
  delete process.env.MOCHI_MODEL;
  try { assert.throws(() => createLlm({ dry: true, maxUsd: 1 }), /missing MOCHI_MODEL/); }
  finally { process.env.MOCHI_MODEL = saved; }
});
