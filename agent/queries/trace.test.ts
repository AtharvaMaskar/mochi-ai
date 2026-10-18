// trace_story end to end on the FalkorDB journal: briefing → build_story, then trace_story names the build_story call
// and the briefing call whose stored queries the story cites. PRIVATE FalkorDB only (JOURNAL_TEST_PORT, default 6392):
// the test drops mochi_journal there. Skipped, loudly, without that container or MOCHI_JOURNAL_PASSWORD.
import { test as nodeTest, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect as connectTcp } from 'node:net';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { JOURNAL_GRAPH, validateCard } from '@mochi/contracts';

process.loadEnvFile?.(new URL('../../.env', import.meta.url));
const PORT = Number(process.env.JOURNAL_TEST_PORT ?? 6392);
process.env.FALKORDB_PORT = String(PORT); // fixture, reader and journal all on the private container
process.env.MOCHI_STORAGE = 'falkordb';
const up = !!process.env.MOCHI_JOURNAL_PASSWORD && await new Promise<boolean>((r) => {
  const s = connectTcp(PORT, 'localhost').once('connect', () => { s.destroy(); r(true); }).once('error', () => r(false));
});
if (!up) console.warn(`trace.test.ts: no private FalkorDB on :${PORT} or no MOCHI_JOURNAL_PASSWORD; SKIPPED`);
const test = up ? nodeTest : nodeTest.skip;

const { admin, loadFixture, testGraph } = await import('../__test__/load-fixture.ts');
const { ctx, openTestHarness, toolResults } = await import('../__test__/pi.ts');
const { closeAll } = await import('../db.ts');
const G = testGraph('trace');

after(async () => {
  if (!up) return;
  const db = await admin();
  await db.selectGraph(G).delete().catch(() => {});
  await db.close();
  await closeAll();
});

test('trace_story names the build_story call and the briefing call behind its stored queries', async () => {
  const db = await admin();
  await db.selectGraph(JOURNAL_GRAPH).delete().catch(() => {});
  await db.selectGraph(G).delete().catch(() => {});
  await loadFixture(db, G);
  await db.close();
  const t = await openTestHarness(G, `trace_${process.pid}`);
  try {
    const conv = await t.pi.createUserConversation();
    t.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('briefing', { ticketId: 'T-2' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage(fauxToolCall('build_story', { topic: 'T-2', title: 'T-2 brief', body: 'Customer on <num query_id="q_1" column="plan">premium</num>.\n<table query_id="q_3" label="Fixes" columns=\'["ticket","resolution","kb"]\'/>' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('saved'),
    ]);
    assert.equal((await (await conv.submit({ type: 'input', content: 'story on T-2', requestId: 'tr-1' }, ctx)).wait(ctx)).status, 'done');
    const id = ((await toolResults(conv)).find((r) => r.toolName === 'build_story')!.details as { id: string }).id;
    t.faux.setResponses([fauxAssistantMessage(fauxToolCall('trace_story', { id }), { stopReason: 'toolUse' }), fauxAssistantMessage('traced')]);
    assert.equal((await (await conv.submit({ type: 'input', content: `how was ${id} made?`, requestId: 'tr-2' }, ctx)).wait(ctx)).status, 'done');
    const trace = (await toolResults(conv)).find((r) => r.toolName === 'trace_story')!;
    assert.equal(trace.isError, false, trace.content.map((c) => c.text).join());
    const v = validateCard(trace.details);
    assert.ok(v.ok, v.ok ? '' : v.errors.join('; '));
    const queries = Object.values(v.value.queries);
    const [made] = queries[0].rows, sources = queries[1].rows;
    assert.equal(made.tool, 'build_story');
    assert.ok(Number(made.revision_seq) > 0, 'the story revision is linked to the tool result that wrote it');
    assert.deepEqual(sources.map((r) => [r.tool, r.queries]), [['briefing', ['q_1', 'q_3']]]);
    assert.match(v.value.title, /build_story .* from 2 stored queries of briefing/);
  } finally { await t.close(); }
});
