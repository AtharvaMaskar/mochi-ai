import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyEval } from '@mochi/contracts';
import { armA } from './arms/a.ts';
import { armB, K } from './arms/b.ts';
import { armC, parseFiles } from './arms/c.ts';
import { armD } from './arms/d.ts';
import { chunks } from './arms/index.ts';
import { testCtx } from './testctx.ts';

const [q1, q2] = tinyEval().questions;

test('A truncates at a tiny limit and records it', async () => {
  const ctx = await testCtx('arm_a');
  try {
    const a = armA(ctx, { limitTokens: 4100 });
    await a.prepare();
    assert.equal((await a.answer(q1)).truncated, true);
    const big = armA(ctx);
    await big.prepare();
    assert.equal((await big.answer(q1)).truncated, false);
  } finally { await ctx.cleanup(); }
});

test('B returns 8 chunks from the FalkorDB vector index, nearest first', async () => {
  const ctx = await testCtx('arm_b');
  try {
    const b = armB(ctx);
    await b.prepare();
    const target = chunks(ctx.dataset).find((c) => c.id === 'KB-1')!;
    const hits = await b.retrieve(target.text);
    assert.equal(hits.length, K);
    assert.equal(hits[0], target.text, 'score is a distance: the exact text ranks first');
  } finally { await ctx.cleanup(); }
});

test('C sums the usage of the pick call and the answer call', async () => {
  const ctx = await testCtx('arm_c', (p) => (p.includes('Reply with the file names') ? 'area-orders.md' : '=== FILE: MEMORY.md ===\narea-orders.md: orders\n=== FILE: area-orders.md ===\nI-1 introduced by 2.4.0'));
  try {
    const c = armC(ctx);
    await c.prepare();
    const before = ctx.llm.byCaller;
    const a = await c.answer(q2);
    assert.equal(a.usage.input, before.arm_c_pick.input + before.arm_c.input);
    assert.equal(a.usage.output, before.arm_c_pick.output + before.arm_c.output);
    assert.deepEqual([...parseFiles('=== FILE: x/MEMORY.md ===\nhi').keys()], ['MEMORY.md']);
  } finally { await ctx.cleanup(); }
});

test('D prompt holds query rows and the path, not raw dataset text', async () => {
  let prompt = '';
  const ctx = await testCtx('arm_d', (p) => { prompt = p; return '2.4.0'; });
  try {
    const d = armD(ctx, { ingest: false });
    await d.prepare();
    await d.answer({ ...q2, question: 'Which release likely caused T-2?' });
    assert.match(prompt, /path: \(Ticket /);
    assert.match(prompt, /"release":"2\.4\.0"/);
    assert.ok(!prompt.includes(ctx.dataset.tickets[0].body), 'no raw ticket body');
    assert.ok(!prompt.includes('Ticket {'), 'no corpus lines');
  } finally { await ctx.cleanup(); }
});
