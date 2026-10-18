import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { lastValueFrom, toArray } from 'rxjs';
import { EventType, type RunAgentInput } from '@ag-ui/core';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { ACTIVITY, validateCard } from '@mochi/contracts';
import { admin, loadFixture, testGraph } from './__test__/load-fixture.ts';
import { ctx, entries, openTestHarness } from './__test__/pi.ts';
import { PiDurableAgent, conversationFor, history } from './agui.ts';
import { closeAll } from './db.ts';

const G = testGraph('agui');
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

const input = (threadId: string, msgId: string, content: string): RunAgentInput => ({
  threadId, runId: `run-${msgId}-${Math.random()}`, messages: [{ id: msgId, role: 'user', content }], tools: [], context: [], state: {}, forwardedProps: {},
});
const run = (agent: PiDurableAgent, i: RunAgentInput) => lastValueFrom(agent.run(i).pipe(toArray())) as Promise<Array<Record<string, any>>>;

test('a run streams RUN_STARTED … one ACTIVITY.card … RUN_FINISHED; a retried run is one submission', async () => {
  const agent = new PiDurableAgent(t.pi);
  t.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('briefing', { ticketId: 'T-2' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('T-2 is a repeat contact; see the card.'),
  ]);
  const first = await run(agent, input('th-1', 'm-1', 'brief me on T-2'));
  assert.equal(first[0].type, EventType.RUN_STARTED);
  assert.equal(first.at(-1)!.type, EventType.RUN_FINISHED);
  const cards = first.filter((e) => e.type === EventType.ACTIVITY_SNAPSHOT);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].activityType, ACTIVITY.card);
  assert.ok(validateCard(cards[0].content).ok);
  assert.ok(first.some((e) => e.type === EventType.TEXT_MESSAGE_CONTENT));

  // Same thread + message id: the faux provider has no responses left, so a second model call would fail the run.
  const again = await run(agent, input('th-1', 'm-1', 'brief me on T-2'));
  assert.equal(again.at(-1)!.type, EventType.RUN_FINISHED);
  const conv = await conversationFor(t.pi, 'th-1');
  assert.equal((await entries(conv)).filter((e) => e.kind === 'pi.user').length, 1);
  assert.ok(!(await conv.agent(ctx)).tools.some((x) => x.name === 'record_resolution'));

  const replay = await history(t.pi, 'th-1');
  assert.ok(replay.some((m) => m.role === 'activity'));
});

test('render_html: a literal number is refused with no ACTIVITY.html; placeholders pass', async () => {
  const agent = new PiDurableAgent(t.pi);
  t.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('render_html', { html: '<p>Median 71h</p>', css: '', query_ids: ['q_1'] }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('render_html', { html: '<p><span data-q="q_1" data-col="name"></span></p>', css: 'p { color: var(--ink); }', query_ids: ['q_1'] }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('done'),
  ]);
  const ev = await run(agent, input('th-1', 'm-2', 'lay it out'));
  assert.equal(ev.at(-1)!.type, EventType.RUN_FINISHED);
  const results = ev.filter((e) => e.type === EventType.TOOL_CALL_RESULT);
  assert.match(results[0].content, /literal numbers/);
  const html = ev.filter((e) => e.type === EventType.ACTIVITY_SNAPSHOT);
  assert.equal(html.length, 1);
  assert.equal(html[0].activityType, ACTIVITY.html);
  assert.deepEqual(Object.keys(html[0].content.queries), ['q_1']);
});
