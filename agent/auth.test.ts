// The sign-in gate: login ok / wrong / rate-limited, 401 on a gated route, and shared story links that still open
// without a session (published only). PRIVATE FalkorDB (AUTH_TEST_PORT, default 6400); never the shared :6379.
// Skipped, loudly, without that container: docker run -d -p 127.0.0.1:6400:6379 -e REDIS_ARGS="--requirepass $FALKORDB_PASSWORD" falkordb/falkordb:v4.22.1
import { test as nodeTest, before as nodeBefore, after as nodeAfter } from 'node:test';
import assert from 'node:assert/strict';
import { connect as connectTcp } from 'node:net';

const PORT = Number(process.env.AUTH_TEST_PORT ?? 6400);
process.env.FALKORDB_PORT = String(PORT);
const up = await new Promise<boolean>((r) => { const s = connectTcp(PORT, 'localhost').once('connect', () => { s.destroy(); r(true); }).once('error', () => r(false)); });
if (!up) console.warn(`auth.test.ts: no private FalkorDB on :${PORT}; SKIPPED`);
const test = up ? nodeTest : nodeTest.skip, before = up ? nodeBefore : () => {}, after = up ? nodeAfter : () => {};
const { admin, loadFixture, testGraph, T0, DAY } = await import('./__test__/load-fixture.ts');
const { openTestHarness } = await import('./__test__/pi.ts');
const { CYPHER, runStored } = await import('./queries/index.ts');
const { commitStory } = await import('./stories.ts');
const { startServer } = await import('./server.ts');
const { closeAll } = await import('./db.ts');

const G = testGraph('auth');
let db: Awaited<ReturnType<typeof admin>>;
let t: Awaited<ReturnType<typeof openTestHarness>>;
let s: Awaited<ReturnType<typeof startServer>>;
const api = (path: string, init?: RequestInit & { ip?: string }) =>
  fetch(`http://localhost:${s.port}${path}`, { ...init, headers: { 'x-real-ip': init?.ip ?? '10.0.0.1', ...init?.headers } });
const login = (password: string, ip?: string) =>
  api('/api/login', { method: 'POST', ip, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password }) });

before(async () => {
  db = await admin();
  await db.selectGraph(G).delete().catch(() => {});
  await loadFixture(db, G);
  t = await openTestHarness(G, `test_agent_${process.pid}`);
  s = await startServer(t.pi, { dream: null }); // gate on
});
after(async () => {
  await s.close();
  await t.close();
  await db.selectGraph(G).delete().catch(() => {});
  await db.close();
  await closeAll();
});

test('login: right credentials set a signed HttpOnly session that opens gated routes; wrong ones are 401', async () => {
  assert.equal((await api('/api/overview')).status, 401);
  assert.equal((await api('/api/stories')).status, 401);
  assert.equal((await api('/api/copilotkit/info')).status, 401);
  assert.equal((await api('/api/entity/C-1')).status, 401);
  assert.equal((await api('/api/entity/search?q=order')).status, 401);
  assert.equal((await api('/api/health')).status, 200);

  const bad = await login('nope');
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get('set-cookie'), null);

  const ok = await login('admin@1234');
  assert.equal(ok.status, 200);
  const set = ok.headers.get('set-cookie') ?? '';
  assert.match(set, /^mochi_session=\d+\.[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200$/); // no Secure over http
  const cookie = set.split(';')[0];
  assert.equal((await api('/api/stories', { headers: { cookie } })).status, 200);
  assert.equal((await api('/api/stories', { headers: { cookie: cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) } })).status, 401); // forged
  assert.match((await login('admin@1234', '10.0.0.9')).headers.get('set-cookie') ?? '', /mochi_session=/);
  assert.match((await api('/api/logout', { method: 'POST' })).headers.get('set-cookie') ?? '', /Max-Age=0/);
});

test('login is rate-limited per IP: 10 per 10 min, then 429', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await login('wrong', '10.0.0.2')).status, 401);
  const capped = await login('admin@1234', '10.0.0.2');
  assert.equal(capped.status, 429);
  assert.ok(Number(capped.headers.get('retry-after')) > 0);
  assert.equal((await login('admin@1234', '10.0.0.3')).status, 200); // another IP is unaffected
});

test('sharing: signed-in people read every draft; anyone with the link reads published only; publishing needs the session', async () => {
  const VID = '11111111-2222-3333-4444-555555555555';
  const body = async (title: string) => ({
    title, topic: 'cause', generated_at: Date.now(), generated_by: 'user:demo',
    queries: { q_1: await runStored(db, G, CYPHER.likelyCause, { ticketId: 'T-2' }, T0 + 45 * DAY) },
    body: 'Cause <num query_id="q_1" column="release">2.4.0</num>.',
  });
  const pub = await commitStory(t.pi.harness, await body('shared'), { kind: 'story', status: 'published', owner: VID, published: [1] });
  const draft = await commitStory(t.pi.harness, await body('private'), { kind: 'dashboard', status: 'draft', owner: VID, published: [] });
  assert.ok(pub.ok && draft.ok);
  assert.equal((await api(`/api/stories/${pub.story.id}`)).status, 200);
  assert.equal((await api(`/api/stories/${draft.story.id}`)).status, 404);
  assert.equal((await api(`/api/stories/${draft.story.id}/publish`, { method: 'POST', headers: { cookie: `mochi_vid=${VID}` } })).status, 401);

  // Signed in, with no visitor cookie of the owner: the draft is readable, listed, and publishable.
  const cookie = ((await login('admin@1234', '10.0.0.4')).headers.get('set-cookie') ?? '').split(';')[0];
  const mine = await api(`/api/stories/${draft.story.id}`, { headers: { cookie } });
  assert.equal(mine.status, 200);
  const { meta } = await mine.json();
  assert.deepEqual([meta.status, meta.owner], ['draft', true]);
  const list = await (await api('/api/stories', { headers: { cookie } })).json() as { id: string }[];
  assert.ok(list.some((x) => x.id === draft.story.id) && list.some((x) => x.id === pub.story.id));
  assert.equal((await api(`/api/stories/${draft.story.id}/publish`, { method: 'POST', headers: { cookie } })).status, 200);
  assert.equal((await api(`/api/stories/${draft.story.id}`)).status, 200); // now anyone with the link
  assert.equal((await api(`/api/stories/${draft.story.id}/unpublish`, { method: 'POST', headers: { cookie } })).status, 200);
  assert.equal((await api(`/api/stories/${draft.story.id}`)).status, 404); // logged out again: a draft is 404
});
