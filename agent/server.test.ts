import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { admin, loadFixture, testGraph, T0, DAY } from './__test__/load-fixture.ts';
import { openTestHarness } from './__test__/pi.ts';
import { CYPHER, runStored } from './queries/index.ts';
import { commitStory } from './stories.ts';
import { runtimeOptions, startServer } from './server.ts';
import { loadDream } from './dream-port.ts';
import { closeAll } from './db.ts';

const G = testGraph('server');
let db: Awaited<ReturnType<typeof admin>>;
let t: Awaited<ReturnType<typeof openTestHarness>>;
let s: Awaited<ReturnType<typeof startServer>>;
const base = () => `http://localhost:${s.port}`;

before(async () => {
  db = await admin();
  await db.selectGraph(G).delete().catch(() => {});
  await loadFixture(db, G);
  t = await openTestHarness(G, `test_agent_${process.pid}`);
  s = await startServer(t.pi, { dream: null });
});
after(async () => {
  await s.close();
  await t.close();
  await db.selectGraph(G).delete().catch(() => {});
  await db.close();
  await closeAll();
});

const draft = async (title: string, id?: string) => ({
  id, title, topic: 'cause', generated_at: Date.now(), generated_by: 'dream',
  queries: { q_1: await runStored(db, G, CYPHER.likelyCause, { ticketId: 'T-2' }, T0 + 45 * DAY) },
  body: 'Cause <num query_id="q_1" column="release">2.4.0</num>.',
});

test('runtime options never enable openGenerativeUI; no mcp-apps middleware dependency', () => {
  assert.ok(!('openGenerativeUI' in runtimeOptions(t.pi)));
  const pkg = readFileSync(new URL('./package.json', import.meta.url), 'utf8');
  assert.ok(!pkg.includes('@ag-ui/mcp-apps-middleware'));
});

test('POST /api/dream/run answers 503 without agent/dream/', async () => {
  const r = await fetch(`${base()}/api/dream/run`, { method: 'POST' });
  assert.equal(r.status, 503);
  assert.match(await r.text(), /dream not installed/);
});

test('POST /api/dream/run calls runDreamNow with the writer when the dream is present', async () => {
  const dream = (await loadDream('./__test__/dream-double.ts'))!;
  const s2 = await startServer(t.pi, { dream });
  try {
    const r = await fetch(`http://localhost:${s2.port}/api/dream/run?asOf=123`, { method: 'POST' });
    assert.equal(r.status, 200);
    const { calls } = (await import('./__test__/dream-double.ts')) as { calls: Record<string, unknown>[] };
    assert.equal(calls.at(-1)!.as_of, 123);
    assert.ok(calls.at(-1)!.db && typeof calls.at(-1)!.commitStory === 'function');
  } finally { await s2.close(); }
});

test('GET /api/stories/:id[@n]?asOf re-runs stored queries and returns as_of', async () => {
  const a = await commitStory(t.pi.harness, await draft('v1'));
  assert.ok(a.ok);
  await commitStory(t.pi.harness, await draft('v2', a.story.id));
  const v1 = await (await fetch(`${base()}/api/stories/${a.story.id}@1?asOf=${T0 + 45 * DAY}`)).json();
  assert.equal(v1.story.title, 'v1');
  assert.equal(v1.as_of, T0 + 45 * DAY);
  assert.equal(v1.story.queries.q_1.rows[0].release, '2.4.0');
  const latest = await (await fetch(`${base()}/api/stories/${a.story.id}?asOf=${T0 + 55 * DAY}`)).json();
  assert.equal(latest.story.version, 2);
  assert.deepEqual(latest.story.queries.q_1.rows, []);
  assert.equal((await fetch(`${base()}/api/stories/nope`)).status, 404);
});

test('two WebSocket clients get the current version on connect and the next one after a commit', async () => {
  const a = await commitStory(t.pi.harness, await draft('live v1'));
  assert.ok(a.ok);
  const open = () => new Promise<{ ws: WebSocket; next: () => Promise<any> }>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${s.port}/api/stories/${a.story.id}/live`);
    const queue: any[] = [], waiters: ((v: any) => void)[] = [];
    ws.on('message', (m) => { const v = JSON.parse(String(m)); const w = waiters.shift(); if (w) w(v); else queue.push(v); });
    ws.on('open', () => resolve({ ws, next: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r))) }));
    ws.on('error', reject);
  });
  const [c1, c2] = await Promise.all([open(), open()]);
  try {
    for (const c of [c1, c2]) assert.equal((await c.next()).story.version, 1);
    await commitStory(t.pi.harness, await draft('live v2', a.story.id));
    for (const c of [c1, c2]) {
      const m = await c.next();
      assert.deepEqual([m.story.version, m.story.title], [2, 'live v2']);
    }
  } finally { c1.ws.close(); c2.ws.close(); }
});
