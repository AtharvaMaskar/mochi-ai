import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embed, EMBED_DIM } from './embed.ts';

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

test('shape, order and norm', async () => {
  const [a, b] = await embed(['a', 'b']);
  assert.equal(a.length, EMBED_DIM);
  assert.equal(b.length, EMBED_DIM);
  assert.ok(Math.abs(Math.sqrt(dot(a, a)) - 1) < 1e-4);
  const [a2] = await embed(['a']);
  assert.ok(dot(a, a2) > 0.9999, 'first vector corresponds to the first input');
});

test('similar text is closer', async () => {
  const [q, near, far] = await embed(['payment debited, order not placed', 'money cut but no order', 'change my email address']);
  assert.ok(dot(q, near) > dot(q, far));
});
