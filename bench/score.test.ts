import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyEval } from '@mochi/contracts';
import { contains, normalize, score, type Vote } from './score.ts';
import { createLlm } from './llm.ts';

const [exact, judged] = tinyEval().questions;

test('normalization: lowercase, trimmed, punctuation and whitespace collapsed, versions kept', () => {
  assert.equal(normalize('  Premium.  '), 'premium');
  assert.equal(normalize('Release  2.4.0!'), 'release 2.4.0');
  assert.equal(normalize('T-1'), normalize('t 1'));
  assert.ok(contains('It was release 2.4.0.', '2.4.0'));
  assert.ok(!contains('2.4.01', '2.4.0'));
});

test('exact questions use normalized exact match, no judge call', async () => {
  const llm = createLlm({ dry: true, maxUsd: 1 });
  const votes: Vote[] = [];
  assert.equal(await score(llm, exact, 'A', 'Premium.', votes), true);
  assert.equal(await score(llm, exact, 'A', 'basic', votes), false);
  assert.equal(votes.length, 0);
  assert.equal(llm.byCaller.judge, undefined);
});

test('a judge vote that disagrees with containment triggers two more, majority wins', async () => {
  const replies = ['incorrect', 'correct', 'correct'];
  const llm = createLlm({ dry: true, maxUsd: 1, reply: () => replies.shift()! });
  const votes: Vote[] = [];
  assert.equal(await score(llm, judged, 'B', 'Most likely release 2.4.0', votes), true);
  assert.deepEqual(votes[0].votes, [false, true, true]);
  assert.equal(votes[0].heuristic, true);
});

test('an agreeing judge vote is final', async () => {
  const llm = createLlm({ dry: true, maxUsd: 1, reply: () => 'incorrect' });
  const votes: Vote[] = [];
  assert.equal(await score(llm, judged, 'B', 'release 2.3.9', votes), false);
  assert.deepEqual(votes[0].votes, [false]);
});
