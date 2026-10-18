import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { GRAPH, validateCard } from '@mochi/contracts';
import { admin, loadFixture, testGraph } from './__test__/load-fixture.ts';
import { ctx, openTestHarness, toolResults, tmpStore } from './__test__/pi.ts';
import { loadDream } from './dream-port.ts';
import { reader, closeAll } from './db.ts';
import { DreamTaskDoc, READ_TOOLS } from './harness.ts';

const G = testGraph('harness');
const TEAM = `test_agent_${process.pid}`;
let db: Awaited<ReturnType<typeof admin>>;

before(async () => {
  db = await admin();
  await db.selectGraph(G).delete().catch(() => {});
  await loadFixture(db, G);
});
after(async () => {
  await db.selectGraph(G).delete().catch(() => {});
  await db.selectGraph(GRAPH.team(TEAM)).delete().catch(() => {});
  await db.close();
  await closeAll();
});

const companyCount = async () => (await db.selectGraph(GRAPH.company).roQuery<{ n: number }>('MATCH (n) RETURN count(n) AS n')).data?.[0]?.n ?? 0;

test('root conversation: every read tool returns a contract-valid card', async () => {
  const t = await openTestHarness(G, TEAM);
  try {
    t.faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall('briefing', { ticketId: 'T-2' }), fauxToolCall('likely_cause', { ticketId: 'T-2' }),
        fauxToolCall('who_knows', { issueId: 'I-1' }), fauxToolCall('emerging_clusters', { days: 7 }),
        fauxToolCall('blast_radius', { version: '2.4.0' }), fauxToolCall('search_similar', { text: 'order not placed', k: 2 }),
        fauxToolCall('customer_profile', { customerId: 'C-1' }),
        fauxToolCall('query_graph', { cypher: 'MATCH (t:Ticket) WHERE t.created_at <= $as_of RETURN t.id AS ticket ORDER BY ticket LIMIT 5', purpose: 'tickets' }),
        fauxToolCall('graph_algorithm', { algorithm: 'components', purpose: 'repeat contacts' }),
        fauxToolCall('trace_story', { id: 'no-such-story' }),
      ], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    ]);
    const s = await (await t.pi.root.submit({ type: 'input', content: 'brief me on T-2', requestId: 'h-1' }, ctx)).wait(ctx);
    assert.equal(s.status, 'done');
    const results = await toolResults(t.pi.root);
    assert.deepEqual(results.map((r) => r.toolName).sort(), [...READ_TOOLS].sort());
    for (const r of results) {
      assert.equal(r.isError, false, `${r.toolName}: ${r.content.map((c) => c.text).join()}`);
      const v = validateCard(r.details);
      assert.ok(v.ok, `${r.toolName}: ${v.ok ? '' : v.errors.join('; ')}`);
    }
    // ids are conversation-wide: seven tools, fourteen stored queries, no collisions
    const ids = results.flatMap((r) => Object.keys((r.details as { queries: object }).queries));
    assert.equal(new Set(ids).size, ids.length);
  } finally { await t.close(); }
});

test('user conversation: no record_resolution; teach writes a candidate to the team graph only', async () => {
  const t = await openTestHarness(G, TEAM);
  try {
    const conv = await t.pi.createUserConversation();
    const names = (await conv.agent(ctx)).tools.map((x) => x.name);
    assert.ok(!names.includes('record_resolution'));
    for (const n of [...READ_TOOLS, 'teach', 'feedback', 'build_story', 'render_html']) assert.ok(names.includes(n), n);
    assert.ok((await t.pi.root.agent(ctx)).tools.some((x) => x.name === 'record_resolution'));

    const before = await companyCount();
    t.faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall('teach', { text: 'refunds over ₹10k need manager approval', area: 'funds' }),
        fauxToolCall('feedback', { suggestionId: 'S-1', verdict: 'wrong' }),
      ], { stopReason: 'toolUse' }),
      fauxAssistantMessage('noted'),
    ]);
    assert.equal((await (await conv.submit({ type: 'input', content: 'remember: refunds over ₹10k need manager approval', requestId: 'h-2' }, ctx)).wait(ctx)).status, 'done');
    for (const r of await toolResults(conv)) assert.equal(r.isError, false, r.content.map((c) => c.text).join());

    const team = db.selectGraph(GRAPH.team(TEAM));
    const dc = (await team.roQuery<Record<string, unknown>>(`MATCH (d:DoctrineCandidate)-[:IN]->(a:ProductArea)
      RETURN d.text AS text, d.source AS source, d.taught_by AS taught_by, d.source_session AS session, d.created_at AS at, a.name AS area`)).data!;
    assert.equal(dc.length, 1);
    assert.equal(dc[0].text, 'refunds over ₹10k need manager approval');
    assert.deepEqual([dc[0].source, dc[0].taught_by, dc[0].area, dc[0].session], ['teach', 'A-1', 'funds', String(conv.id)]);
    assert.ok(Number(dc[0].at) > 0);
    const fb = (await team.roQuery<{ v: string }>(`MATCH (:AgentUser {id: 'A-1'})-[f:FEEDBACK]->(:Suggestion {id: 'S-1'}) RETURN f.verdict AS v`)).data!;
    assert.deepEqual(fb.map((r) => r.v), ['wrong']);
    assert.equal(await companyCount(), before);
  } finally { await t.close(); }
});

test('reader connection refuses writes, independent of the tool list', async () => {
  const r = await reader();
  await r.selectGraph(GRAPH.company).roQuery('RETURN 1');
  await assert.rejects(r.selectGraph(GRAPH.company).query('MATCH (n) RETURN count(n)'));
});

test('dream port returns null without agent/dream/', async () => {
  assert.equal(await loadDream('./__test__/no-such-dream.ts'), null);
});

test('with a dream module, two boots leave exactly one DreamTask', async () => {
  const dream = await loadDream();
  assert.ok(dream?.DreamTask);
  const storage = tmpStore();
  const ids: unknown[] = [];
  for (let i = 0; i < 2; i++) {
    const t = await openTestHarness(G, TEAM, { storage, dream });
    try {
      const live = (await t.pi.harness.inspect(ctx)).tasks.filter((x) => x.record.kind === 'mochi.dream');
      assert.equal(live.length, 1);
      ids.push((await t.pi.harness.snapshot(DreamTaskDoc, ctx))?.taskId);
    } finally { await t.close(); }
  }
  assert.equal(ids[0], ids[1]);
});
