import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSim, readInbox, type SimOpts } from './server.ts';

const inbox = await readInbox();
const auth = { authorization: `Basic ${Buffer.from('sim-key:X').toString('base64')}` };
const sims: ReturnType<typeof createSim>[] = [];
after(async () => { for (const s of sims) await s.close(); await new Promise((r) => hook.close(r)); });

async function start(o: SimOpts) {
  const s = createSim(inbox, { tickMs: 20, retryMs: 50, ...o });
  sims.push(s);
  await new Promise<void>((r) => s.server.listen(0, r));
  const base = `http://localhost:${(s.server.address() as AddressInfo).port}`;
  const get = (p: string, h: Record<string, string> = auth) => fetch(base + p, { headers: h });
  return { s, base, get };
}

// Webhook receiver: fails the very first delivery to exercise the retry.
const got: any[] = [];
let failOnce = true;
const hook = createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  if (failOnce) { failOnce = false; res.writeHead(500).end(); return; }
  got.push(JSON.parse(b)); res.writeHead(200).end();
});
await new Promise<void>((r) => hook.listen(0, r));
const hookUrl = `http://localhost:${(hook.address() as AddressInfo).port}/webhook`;

const { get } = await start({ paused: true });

test('auth, truth hidden, unknown route', async () => {
  assert.equal((await get('/api/v2/tickets', {})).status, 401);
  for (const p of ['/api/v2/truth', '/truth.json', '/sim/data/truth.json', '/api/v2/tickets/truth']) assert.equal((await get(p)).status, 404, p);
});

test('ticket with conversations: Freshdesk names, integer codes, time order', async () => {
  const id = inbox.conversations.find((c) => c.created_at < inbox.replay_start - 86_400_000)!.ticket_id;
  const r = await get(`/api/v2/tickets/${id}?include=conversations,requester,stats`);
  assert.equal(r.status, 200);
  assert.ok(r.headers.get('x-ratelimit-remaining'));
  const t = await r.json();
  assert.equal(typeof t.status, 'number');
  assert.equal(typeof t.priority, 'number');
  assert.ok(t.requester.email && t.stats && 'first_responded_at' in t.stats && 'fr_escalated' in t);
  assert.ok(t.conversations.length >= 1);
  const times = t.conversations.map((c: any) => Date.parse(c.created_at));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  // A ticket from the demo window does not exist yet at replay start.
  const future = inbox.tickets.find((x) => x.created_at > inbox.replay_start)!;
  assert.equal((await get(`/api/v2/tickets/${future.id}`)).status, 404);
});

test('list: updated_since, pagination Link header, per_page cap', async () => {
  const since = new Date(inbox.replay_start - 2 * 86_400_000).toISOString();
  const r = await get(`/api/v2/tickets?updated_since=${since}&per_page=100&order_by=updated_at&order_type=asc`);
  const rows = await r.json();
  assert.equal(rows.length, 100);
  assert.match(r.headers.get('link')!, /page=2>; rel="next"/);
  assert.ok(rows.every((t: any) => Date.parse(t.updated_at) >= Date.parse(since) && !t.spam && !('description' in t)));
  assert.equal((await get('/api/v2/tickets?per_page=101')).status, 400);
  const f = await (await get('/api/v2/ticket_fields')).json();
  assert.deepEqual(Object.keys(f[0].choices), ['2', '3', '4', '5', '6', '7']);
});

test('rate limit: 429 with Retry-After', async () => {
  const x = await start({ paused: true, rateLimit: 2 });
  await x.get('/api/v2/groups'); await x.get('/api/v2/groups');
  const r = await x.get('/api/v2/groups');
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
});

test('paused clock fires nothing and shows nothing new', async () => {
  const t = inbox.tickets.find((x) => x.created_at > inbox.replay_start)!;
  const x = await start({ paused: true, start: t.created_at - 1000, webhookUrl: hookUrl });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(x.s.delivered.length, 0);
  assert.equal((await x.get(`/api/v2/tickets/${t.id}`)).status, 404);
});

test('speed 8640: a ticket appears and its webhook fires once (after one retry)', async () => {
  const t = inbox.tickets.find((x) => x.created_at > inbox.replay_start)!;
  const x = await start({ speed: 8640, start: t.created_at - 1000, webhookUrl: hookUrl });
  const seen = () => got.filter((e) => e.event === 'ticket_created' && e.ticket_id === t.id);
  for (let i = 0; i < 100 && !seen().length; i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(seen().length, 1);
  assert.match(seen()[0].sim_time, /Z$/);
  assert.equal((await x.get(`/api/v2/tickets/${t.id}`)).status, 200);
  const c = await (await x.get('/sim/clock')).json();
  assert.ok(c.sim_now_ms > t.created_at && c.speed === 8640);
  await fetch(`${x.base}/sim/clock`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ pause: true }) });
  assert.equal((await (await x.get('/sim/clock')).json()).paused, true);
});

test('day_closed fires at IST midnight in virtual time', () => {
  const days = sims[0].log.filter((e) => e.event === 'day_closed');
  assert.ok(days.length >= 90);
  assert.ok(days.every((e) => new Date(e.at + 5.5 * 3_600_000).getUTCHours() === 0));
});

test('write paths: note, status, merge', async () => {
  const x = await start({ paused: true });
  const id = inbox.tickets.find((t) => !t.spam && t.created_at < inbox.replay_start - 86_400_000)!.id;
  const post = (p: string, m: string, b: unknown) => fetch(x.base + p, { method: m, headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const n = await post(`/api/v2/tickets/${id}/notes`, 'POST', { body: 'Mochi briefing: likely cause 3.2.0' });
  assert.equal(n.status, 201);
  assert.equal((await n.json()).private, true);
  assert.equal((await (await post(`/api/v2/tickets/${id}`, 'PUT', { status: 6 })).json()).status, 6);
  assert.equal((await post('/api/v2/tickets/merge', 'PUT', { primary_id: id, ticket_ids: [id, id + 1] })).status, 204);
  assert.equal((await (await x.get(`/api/v2/tickets/${id + 1}`)).json()).status, 5);
});
