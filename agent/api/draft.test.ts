// The draft prompt's rules, not the model: Mochi may never tell a customer a fix is done when nobody did it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRAFT_RULES, draftPrompt } from './tickets.ts';

const ctx = {
  requester: 'Zara Iyer', customer: 'Yash Iyer', customerId: 'C-0588', likelyFix: 'Unlocked account and sent PIN reset link',
  kb: 'Unlocking an account after PIN lockout', thread: [{ kind: 'customer', author: 'Zara Iyer', text: 'My father is locked out after three wrong PINs.' }],
};

test('rules forbid past-tense "we did" claims and ask for future tense or a confirming question', () => {
  assert.match(DRAFT_RULES, /Never say an action is done/);
  for (const banned of ['"we did"', '"we have"', '"I have"', '"has been"']) assert.ok(DRAFT_RULES.includes(banned), banned);
  assert.match(DRAFT_RULES, /I’ll/);
  assert.match(DRAFT_RULES, /question that confirms/);
  assert.match(DRAFT_RULES, /has not been done on this ticket/);
});

test('the prompt labels the likely fix as not yet done and carries no template claim', () => {
  const { system, user } = draftPrompt(ctx);
  assert.equal(system, DRAFT_RULES);
  assert.match(user, /Likely fix \(what resolved similar tickets; not yet done here\): Unlocked account/);
  assert.match(user, /Writing for: Yash Iyer \(the account holder, C-0588\)/);
  assert.match(user, /KB article: Unlocking an account after PIN lockout/);
  assert.doesNotMatch(user, /what we did|we did for/i);
});

test('a hint adds its instruction and the previous draft', () => {
  const { user } = draftPrompt(ctx, 'shorter', 'Hi Zara, I’ll unlock the account.');
  assert.match(user, /Previous draft:\nHi Zara/);
  assert.match(user, /at most three sentences/);
});
