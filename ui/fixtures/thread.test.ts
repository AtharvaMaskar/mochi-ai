import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldNoise, gapWords } from '../src/components/thread-text.ts';

test('folds sign-off and Sent from my iPhone', () => {
  const r = foldNoise('Hi team,\n\nMy PIN is blocked. This started on 18 Oct.\n\nThanks,\nZara\n\nSent from my iPhone');
  assert.equal(r.body, 'Hi team,\n\nMy PIN is blocked. This started on 18 Oct.');
  assert.equal(r.folded, 'Thanks,\nZara\n\nSent from my iPhone');
});

test('folds an agent signature', () => {
  const r = foldNoise('Hi Yash, we are checking this.\n\nThanks,\nFarhan Qadri | Customer Care');
  assert.equal(r.body, 'Hi Yash, we are checking this.');
  assert.equal(r.folded, 'Thanks,\nFarhan Qadri | Customer Care');
});

test('folds quoted replies, keeps an early thanks', () => {
  const r = foldNoise('Thanks for the quick reply. It still fails.\n\nOn 12 Oct, Care wrote:\n> We reset it.');
  assert.equal(r.body, 'Thanks for the quick reply. It still fails.');
  assert.match(r.folded, /^On 12 Oct/);
});

test('leaves plain text and all-noise text alone', () => {
  assert.deepEqual(foldNoise('Just one line.'), { body: 'Just one line.', folded: '' });
  assert.deepEqual(foldNoise('Thanks'), { body: 'Thanks', folded: '' });
  const many = ['Hi,', 'Thanks for the update.', 'a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
  assert.equal(foldNoise(many).folded, '');
});

test('gap words', () => {
  assert.equal(gapWords(20_000), null);
  assert.equal(gapWords(50 * 60_000), '50 min');
  assert.equal(gapWords(3 * 3_600_000), '3 h');
  assert.equal(gapWords(49 * 3_600_000), '2 days');
});
