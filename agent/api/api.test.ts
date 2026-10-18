import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateCard, type Dataset } from '@mochi/contracts';
import { admin, loadFixture, richFixture, testGraph } from '../__test__/load-fixture.ts';
import { openTestHarness } from '../__test__/pi.ts';
import { startSimStub } from '../__test__/sim-stub.ts';
import { startServer } from '../server.ts';
import { loadDream } from '../dream-port.ts';
import { closeAll } from '../db.ts';
import { Threads } from '../agui.ts';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';

// The sim names graph tickets T-<fd id> (4-digit padded in the seed), so the fixture uses T-0001.. ids here.
function padded(): Dataset {
  const d = richFixture();
  const p = (id: string | null) => (id ? id.replace(/^T-(\d+)$/, (_, n) => `T-${n.padStart(4, '0')}`) : id);
  d.tickets = d.tickets.map((t) => ({ ...t, id: p(t.id)!, follows_ticket_id: p(t.follows_ticket_id), merged_into: p(t.merged_into ?? null) }));
  return d;
}

const G = testGraph('api');
let db: Awaited<ReturnType<typeof admin>>;
let t: Awaited<ReturnType<typeof openTestHarness>>;
let s: Awaited<ReturnType<typeof startServer>>;
let stub: Awaited<ReturnType<typeof startSimStub>>;
const api = (path: string, init?: RequestInit) => fetch(`http://localhost:${s.port}${path}`, init);

before(async () => {
  db = await admin();
  await db.selectGraph(G).delete().catch(() => {});
  const d = padded();
  await loadFixture(db, G, d);
  stub = await startSimStub({ dataset: d });
  process.env.SIM_URL = stub.url;
  t = await openTestHarness(G, `test_agent_${process.pid}`);
  s = await startServer(t.pi, { dream: null, auth: false });
});
after(async () => {
  await s.close();
  await stub.close();
  await t.close();
  for (const x of ['', '_prev', '_scratch']) await db.selectGraph(G + x).delete().catch(() => {});
  await db.close();
  await closeAll();
});

test('ready view: un-answered tickets newest first, guesses with computed confidence and receipts', async () => {
  const r = await (await api('/api/tickets?view=ready')).json();
  assert.deepEqual(r.rows.map((x: { id: string }) => x.id), ['T-0003', 'T-0002']);
  assert.deepEqual(r.counts, { ready: 2, done: 0, all: 3 });
  assert.deepEqual(r.queries.q_0.rows, [r.counts]); // the counts' receipt
  const [t3, t2] = r.rows;
  // T-0002 links to I-1 by ABOUT; the one other resolved ticket on I-1 used R-1, so the evidence is 1 of 1.
  assert.deepEqual(t2.guess, { issue: 'payment debited, order not placed', p: 1, basis: 'graph', query_id: 'q_1' });
  assert.match(r.queries.q_1.cypher, /mochi:desk\.guess/);
  // T-0003 has no ABOUT edge: cosine similarity of its top vector match.
  assert.equal(t3.guess.basis, 'vector');
  assert.ok(t3.guess.p > 0 && t3.guess.p <= 1);
  assert.match(r.queries[t3.guess.query_id].cypher, /vector→graph/);
  const all = await (await api('/api/tickets?view=all&order=oldest')).json();
  assert.deepEqual(all.rows.map((x: { id: string }) => x.id), ['T-0001', 'T-0002', 'T-0003']);
  assert.equal((await api('/api/tickets?view=nope')).status, 400);
});

test('detail: thread from the sim, customer profile from the graph; unknown ticket is 404', async () => {
  const r = await (await api('/api/tickets/T-0002')).json();
  assert.equal(r.thread[0].kind, 'customer');
  assert.equal(r.customer_id, 'C-1');
  assert.ok(validateCard(r.customer).ok);
  assert.deepEqual(r.customer.queries.q_1.rows[0], { customer_id: 'C-1', name: 'Meera Iyer', segment: 'premium', plan: 'premium', city: 'Pune' });
  assert.deepEqual(r.customer.queries.q_2.rows.map((x: { ticket: string; ended: string }) => [x.ticket, x.ended]), [['T-0001', 'Re-sync order callback']]);
  const miss = await api('/api/tickets/T-9999');
  assert.equal(miss.status, 404);
  assert.ok((await miss.json()).error);
});

test('entity cards: customer, ticket and KB fields come from their stored queries; bad id 400, unknown 404', async () => {
  const c = await (await api('/api/entity/C-1')).json();
  assert.equal(c.kind, 'customer');
  assert.deepEqual([c.name, c.segment, c.plan, c.city, c.open_tickets, c.latest_ticket], ['Meera Iyer', 'premium', 'premium', 'Pune', 2, 'T-0003']);
  assert.equal(c.last_contact, c.queries.q_2.rows[0].last_contact);
  assert.match(c.queries.q_1.cypher, /mochi:customer_profile\.profile/);
  const t1 = await (await api('/api/entity/T-0001')).json();
  assert.deepEqual([t1.kind, t1.subject, t1.status, t1.resolution, t1.customer_id, t1.customer], ['ticket', 'Order not placed', 'resolved', 'Re-sync order callback', 'C-1', 'Meera Iyer']);
  const kb = await (await api('/api/entity/KB-1')).json();
  assert.deepEqual([kb.kind, kb.title, kb.team, kb.promised_tat_hours], ['kb', 'Orders stuck after payment', 'trading', 24]);
  for (const r of [c, t1, kb]) for (const q of Object.values(r.queries) as { cypher: string }[]) assert.match(q.cypher, /\$as_of/);
  assert.equal((await api('/api/entity/DROP')).status, 400);
  const miss = await api('/api/entity/T-9999');
  assert.equal(miss.status, 404);
  assert.ok((await miss.json()).error);
});

test('entity search: tickets by id, customers by id or name, issues by name; read-only stored query with $as_of', async () => {
  const s1 = await (await api('/api/entity/search?q=meera')).json();
  assert.deepEqual(s1.results, [{ kind: 'customer', id: 'C-1', name: 'Meera Iyer' }]);
  assert.match(s1.query.cypher, /mochi:entity\.search/);
  assert.match(s1.query.cypher, /\$as_of/);
  const s2 = await (await api('/api/entity/search?q=T-000')).json();
  assert.ok(s2.results.length > 0 && s2.results.length <= 8 && s2.results.every((r: { kind: string }) => r.kind === 'ticket'));
  const s3 = await (await api('/api/entity/search?q=ORDER%20NOT')).json();
  assert.deepEqual(s3.results.map((r: { kind: string; id: string }) => [r.kind, r.id]), [['issue', 'I-1']]);
  assert.ok((await (await api('/api/entity/search?q=')).json()).results.length <= 8);
});

test('brief: a validateCard card with a path receipt, every stored query takes $as_of', async () => {
  const card = await (await api('/api/tickets/T-0002/brief', { method: 'POST' })).json();
  assert.ok(validateCard(card).ok);
  assert.ok(card.path);
  for (const q of Object.values(card.queries) as { cypher: string }[]) assert.match(q.cypher, /\$as_of/);
});

test('answer posts once per request id and moves the ticket out of Ready', async () => {
  const post = () => api('/api/tickets/T-0002/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'req-1' }) }).then((r) => r.json());
  const [a, b] = [await post(), await post()];
  assert.equal(a.status, 'resolved');
  assert.equal(a.reply_id, b.reply_id);
  const detail = await (await api('/api/tickets/T-0002')).json();
  assert.equal(detail.thread.filter((m: { kind: string }) => m.kind === 'reply').length, 1);
  const ready = await (await api('/api/tickets?view=ready')).json();
  assert.deepEqual(ready.rows.map((x: { id: string }) => x.id), ['T-0003']);
  assert.equal(ready.counts.done, 1);
});

test('overview and story list answer 200', async () => {
  const o = await (await api('/api/overview')).json();
  assert.deepEqual(Object.keys(o.queries.q_1.rows[0]).sort(), ['clustered', 'ingested', 'mismatches', 'pending', 'retired']);
  assert.equal(typeof o.desk.ready, 'number');
  assert.ok(Array.isArray(await (await api('/api/stories')).json()));
});

test('dream SSE: five steps in order, each running then done, ending with the report', { timeout: 60_000 }, async () => {
  const dream = (await loadDream())!;
  const s2 = await startServer(t.pi, { dream, auth: false });
  try {
    process.env.MOCHI_ADMIN_TOKEN = 'secret';
    const r = await fetch(`http://localhost:${s2.port}/api/dream/run?asOf=${Date.UTC(2026, 6, 20) + 45 * 86_400_000}`, { method: 'POST', headers: { accept: 'text/event-stream', 'x-mochi-admin': 'secret' } });
    assert.match(r.headers.get('content-type') ?? '', /event-stream/);
    const events = (await r.text()).split('\n\n').filter(Boolean).map((e) => JSON.parse(e.replace(/^data: /, '')));
    const done = events.filter((e) => e.state === 'done').map((e) => e.step);
    assert.deepEqual(done, ['ingest', 'cluster', 'retire', 'mismatch', 'report']);
    assert.deepEqual(events.filter((e) => e.state === 'running').map((e) => e.step), ['ingest', 'cluster', 'retire', 'mismatch', 'report']);
    const last = events.at(-1);
    assert.ok(last.done?.story_id);
  } finally { await s2.close(); }
});

test('chat threads are scoped to the visitor cookie; runs are capped per IP; the dream needs the admin token', { timeout: 60_000 }, async () => {
  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
  const body = (msg?: string) => JSON.stringify({ threadId: 'shared', runId: `r-${Math.random()}`, tools: [], context: [], state: {}, forwardedProps: {},
    messages: msg ? [{ id: `m-${Math.random()}`, role: 'user', content: msg }] : [] });
  const copilot = (path: string, vid: string, msg?: string) => api(`/api/copilotkit/agent/mochi/${path}`,
    { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream', cookie: `mochi_vid=${vid}` }, body: body(msg) });
  t.faux.setResponses([fauxAssistantMessage('hello A')]);
  const ran = await copilot('run', A, 'hi');
  assert.equal(ran.status, 200);
  await ran.text();
  const keys = Object.keys((await t.pi.harness.snapshot(Threads, ctx))?.map ?? {});
  assert.ok(keys.includes(`${A}:shared`), keys.join());
  assert.doesNotMatch(await (await copilot('connect', B)).text(), /hello A/);
  assert.match(await (await copilot('connect', A)).text(), /hello A/);
  const fresh = await copilot('connect', 'not-a-uuid'); // no valid cookie: one is minted
  assert.match(fresh.headers.get('set-cookie') ?? '', /mochi_vid=/);
  await fresh.text();

  process.env.MOCHI_CHAT_LIMIT = '1';
  try {
    const capped = await copilot('run', A, 'again');
    assert.equal(capped.status, 429);
    assert.match((await capped.json()).error, /Try again/);
  } finally { delete process.env.MOCHI_CHAT_LIMIT; }

  const s2 = await startServer(t.pi, { dream: (await loadDream())!, auth: false });
  try {
    const url = `http://localhost:${s2.port}/api/dream/run`;
    delete process.env.MOCHI_ADMIN_TOKEN;
    assert.equal((await fetch(url, { method: 'POST', headers: { 'x-mochi-admin': '' } })).status, 403); // unset token: disabled
    process.env.MOCHI_ADMIN_TOKEN = 'secret';
    const no = await fetch(url, { method: 'POST' });
    assert.equal(no.status, 403);
    assert.equal(no.headers.get('access-control-allow-origin'), null);
  } finally { await s2.close(); }
});
