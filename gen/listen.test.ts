// Replays the sim's demo window at speed 8640 into a throwaway graph through the real webhook → fetch path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { connect } from '../contracts/testdb.ts';
import { createSim, readInbox } from '../sim/server.ts';
import { createListener } from './listen.ts';

const inbox = await readInbox();
const truth = JSON.parse(readFileSync(new URL('../sim/data/truth.json', import.meta.url), 'utf8'));
const db = await connect();
const name = `test_listen_${process.pid}`;
const g = db.selectGraph(name);
await g.query('CREATE INDEX FOR (n:Ticket) ON (n.id)');

const opts = { simUrl: '', apiKey: 'sim-key', graph: g, sweepMs: 1_000_000 };
const listener = createListener(opts);
await new Promise<void>((r) => listener.server.listen(0, r));
const hookUrl = `http://localhost:${(listener.server.address() as AddressInfo).port}/webhook`;
const sim = createSim(inbox, { speed: 8640, start: inbox.replay_start, webhookUrl: hookUrl, tickMs: 50 });
await new Promise<void>((r) => sim.server.listen(0, r));
const simUrl = `http://localhost:${(sim.server.address() as AddressInfo).port}`;
opts.simUrl = simUrl; // the listener reads its base URL per request; point it at the sim we just started
// Always drop the test graph, even when a test fails (it carries a vector index).
after(async () => { await sim.close().catch(() => {}); await listener.close().catch(() => {}); await g.delete().catch(() => {}); await db.close(); });

test('replay of the demo window: every non-noise ticket lands pending, noise is dropped', { timeout: 120_000 }, async () => {
  while (sim.clock().sim_now_ms < inbox.generated_at) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 300));
  await listener.drain();
  await listener.sweep();
  const window = Object.entries(truth.tickets as Record<string, any>).filter(([id]) => inbox.tickets.find((t) => `T-${t.id}` === id)!.created_at >= inbox.replay_start);
  const want = window.filter(([, f]) => f.kind === 'customer' || f.kind === 'duplicate').map(([id]) => id).sort();
  const noise = window.filter(([, f]) => !(f.kind === 'customer' || f.kind === 'duplicate')).map(([id]) => id);
  const rows = (await g.roQuery<{ id: string; ing: number | null; c: string }>('MATCH (c:Customer)-[:RAISED]->(t:Ticket) RETURN t.id AS id, t.ingested_at AS ing, c.id AS c ORDER BY id')).data!;
  const got = rows.map((r) => r.id).filter((id) => want.includes(id) || noise.includes(id));
  assert.deepEqual(got, want);
  assert.ok(rows.every((r) => r.ing === null), 'no ingested_at: the dream extracts');
  for (const r of rows.filter((r) => want.includes(r.id))) assert.equal(r.c, truth.tickets[r.id].true_customer_id, r.id);
  const dups = want.filter((id) => truth.tickets[id].duplicate_of);
  const [{ m }] = (await g.roQuery<{ m: number }>('MATCH (:Ticket)-[x:MERGED_INTO]->(:Ticket) RETURN count(x) AS m')).data!;
  assert.ok(m >= dups.filter((id) => inbox.conversations.some((c) => `T-${c.ticket_id}` === id && /^Merged into/.test(c.body_text) && c.created_at <= inbox.generated_at)).length);
  console.log(`listen stats: ${JSON.stringify(listener.stats)}; window ${want.length} tickets + ${noise.length} noise`);
});

test('a duplicate webhook writes once', async () => {
  // Pause the replay so nothing else writes while we count; the sim keeps serving the listener's ticket fetch.
  await fetch(`${simUrl}/sim/clock`, { method: 'POST', headers: { authorization: `Basic ${btoa('sim-key:X')}` }, body: JSON.stringify({ pause: true }) });
  await new Promise((r) => setTimeout(r, 300)); // let webhooks fired by the pause's final tick arrive
  await listener.drain();
  const id = inbox.tickets.find((t) => t.created_at >= inbox.replay_start && !t.spam && !t.headers)!.id;
  const before = listener.stats.written;
  const post = () => fetch(hookUrl, { method: 'POST', body: JSON.stringify({ event: 'status_changed', ticket_id: id, sim_time: 'x', conversation_id: 999999 }) });
  await post(); await post();
  await listener.drain();
  assert.equal(listener.stats.written - before, 1);
});
