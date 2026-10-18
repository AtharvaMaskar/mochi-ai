import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { admin, loadFixture, testGraph, T0, DAY } from './__test__/load-fixture.ts';
import { ctx, openTestHarness, toolResults } from './__test__/pi.ts';
import { CYPHER, runStored } from './queries/index.ts';
import { commitStory, getStory, parseStoryRef, rerender, type Draft } from './stories.ts';
import { StoryDoc } from './story-doc.ts';
import { closeAll } from './db.ts';

const G = testGraph('stories');
const BEFORE_FIX = T0 + 45 * DAY, AFTER_FIX = T0 + 55 * DAY;
let db: Awaited<ReturnType<typeof admin>>;
let t: Awaited<ReturnType<typeof openTestHarness>>;

before(async () => {
  db = await admin();
  await db.selectGraph(G).delete().catch(() => {});
  await loadFixture(db, G);
  t = await openTestHarness(G, `test_agent_${process.pid}`);
});
after(async () => {
  await t.close();
  await db.selectGraph(G).delete().catch(() => {});
  await db.close();
  await closeAll();
});

async function causeStory(title: string): Promise<Draft> {
  return {
    title, topic: 'release 2.4.0', generated_at: Date.now(), generated_by: 'dream',
    queries: { q_1: await runStored(db, G, CYPHER.likelyCause, { ticketId: 'T-2' }, BEFORE_FIX) },
    body: `T-2 traces to <num query_id="q_1" column="release">2.4.0</num>.\n<table query_id="q_1" label="Live causes" columns='["issue","release"]'/>\n<suggestion query_id="q_1" tag="Check the callback" edge="CONTRADICTS">Re-sync orders.</suggestion>`,
  };
}

test('two commits keep both versions; @1 pins the first', async () => {
  const a = await commitStory(t.pi.harness, await causeStory('Morning report v1'));
  assert.ok(a.ok);
  const b = await commitStory(t.pi.harness, { ...(await causeStory('Morning report v2')), id: a.story.id });
  assert.ok(b.ok);
  assert.equal(b.story.version, 2);
  assert.equal((await getStory(t.pi.harness, a.story.id, 1))!.title, 'Morning report v1');
  assert.equal((await getStory(t.pi.harness, a.story.id))!.title, 'Morning report v2');
  assert.deepEqual(parseStoryRef(`${a.story.id}@1`), { id: a.story.id, version: 1 });
});

test('as-of re-render: the retired INTRODUCED edge shows before the fix and is gone after', async () => {
  const r = await commitStory(t.pi.harness, await causeStory('Cause'));
  assert.ok(r.ok);
  const early = await rerender(db, r.story, BEFORE_FIX);
  const late = await rerender(db, r.story, AFTER_FIX);
  assert.equal(early.as_of, BEFORE_FIX);
  assert.deepEqual(early.story.queries.q_1.rows.map((x) => x.release), ['2.4.0']);
  assert.deepEqual(late.story.queries.q_1.rows, []);
});

test('a failing story is never committed', async () => {
  const d = await causeStory('Bad');
  const r = await commitStory(t.pi.harness, { ...d, body: '<kpi query_id="q_9" label="x" column="y"/>' });
  assert.ok(!r.ok);
  assert.match(r.errors.join(), /q_9/);
});

test('build_story: unknown q_9 is returned to the model and nothing is committed; a valid body saves', async () => {
  const conv = await t.pi.createUserConversation();
  const count = async () => Object.keys((await t.pi.harness.snapshot(StoryDoc, ctx))?.stories ?? {}).length;
  const n0 = await count();
  t.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('briefing', { ticketId: 'T-2' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('build_story', { topic: 'T-2', title: 'T-2 brief', body: 'Plan: <kpi query_id="q_9" label="Plan" column="plan"/>' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('build_story', { topic: 'T-2', title: 'T-2 brief', body: 'Customer on <num query_id="q_1" column="plan">premium</num>.\n<table query_id="q_3" label="Fixes" columns=\'["ticket","resolution","kb"]\'/>' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('saved'),
  ]);
  assert.equal((await (await conv.submit({ type: 'input', content: 'story on T-2', requestId: 's-1' }, ctx)).wait(ctx)).status, 'done');
  const [, bad, good] = await toolResults(conv);
  assert.equal(bad.isError, true);
  assert.match(bad.content.map((c) => c.text).join(), /q_9/);
  assert.equal(good.isError, false, good.content.map((c) => c.text).join());
  assert.equal(await count(), n0 + 1);
  const saved = await getStory(t.pi.harness, (good.details as { id: string }).id);
  assert.equal(saved!.generated_by, 'user:A-1');
  assert.deepEqual(Object.keys(saved!.queries).sort(), ['q_1', 'q_3']);
});

test('a new conversation wakes up with the morning report in its system prompt', async () => {
  const r = await commitStory(t.pi.harness, { ...(await causeStory('Brain report: 2.4.0 retired')), generated_at: Date.now() + 1000 });
  assert.ok(r.ok);
  let prompt = '';
  t.faux.setResponses([(context) => { prompt = JSON.stringify(context.messages); return fauxAssistantMessage('ok'); }]);
  const conv = await t.pi.createUserConversation();
  await (await conv.submit({ type: 'input', content: 'hi', requestId: 's-2' }, ctx)).wait(ctx);
  assert.match(prompt, /<morning_report>/);
  assert.match(prompt, /Brain report: 2\.4\.0 retired/);
  assert.match(prompt, /suggestion \[CONTRADICTS\] Check the callback: Re-sync orders\./);
  assert.match(prompt, /<viz_grammar>/);
});
