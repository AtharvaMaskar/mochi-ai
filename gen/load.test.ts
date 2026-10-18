// Against the running FalkorDB, on a throwaway test_gen_* graph (admin connection), deleted afterwards.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EDGE_AS_OF, VALID_FOREVER, type Eval } from '@mochi/contracts';
import { connect } from '../contracts/testdb.ts';
import { loadDataset, replayStart } from './load.ts';
import { validateDataset, type ValidDataset } from '@mochi/contracts';
import { applyEvent } from './events.ts';
import { embed } from './embed.ts';

// The bench slice: eval.json is computed over it, and 400 tickets keep the test fast.
const d = (validateDataset(JSON.parse(readFileSync(new URL('../data/bench/dataset.json', import.meta.url), 'utf8'))) as { value: ValidDataset }).value;
const start = replayStart(d);
const before = d.tickets.filter((t) => t.created_at < start);
const ev: Eval = JSON.parse(readFileSync(new URL('../data/eval.json', import.meta.url), 'utf8'));
const db = await connect();
const name = `test_gen_${process.pid}`;
const g = db.selectGraph(name);
after(async () => { await g.delete().catch(() => {}); await db.close(); });
const rows = async <T>(q: string, params: Record<string, any> = {}) => (await g.roQuery<T>(q, { params })).data ?? [];
const now = d.generated_at;

let first: Record<string, number>;
test('fresh load: node counts equal dataset record counts', async () => {
  first = await loadDataset(d, db, { graph: name, fresh: true, until: start }); // what `npm run load` does
  assert.deepEqual(
    [first.Customer, first.Ticket, first.Issue, first.ProductArea, first.Team, first.AgentUser, first.Resolution, first.KBArticle, first.Release, first.Plan],
    [d.customers.length, before.length, d.issues.length, d.product_areas.length, d.teams.length, d.agents.length, d.resolutions.length, d.kb_articles.length, d.releases.length, d.plans.length]);
  assert.equal(first.Policy, d.sla_policies.length);
  assert.equal(first.ON_PLAN, d.customers.flatMap((c) => c.plan_history).length);
  assert.equal(first.RAISED, before.length);
  const merged = before.filter((t) => t.merged_into);
  assert.ok(merged.length >= 1);
  assert.equal(first.MERGED_INTO, merged.length);
  const [{ f }] = await rows<{ f: number }>('MATCH (a:Ticket)-[:MERGED_INTO]->(b:Ticket) MATCH (a)-[x:FOLLOWS]-(b) RETURN count(x) AS f');
  assert.equal(f, 0, 'a merge is not a follow-up');
  const [p] = await rows<{ h: number }>('MATCH (p:Policy {id: $id}) RETURN p.promised_tat_hours AS h', { id: d.sla_policies[0].id });
  assert.equal(p.h, d.sla_policies[0].resolve_within_ms / 3_600_000);
  const [{ n }] = await rows<{ n: number }>("MATCH (n) WHERE coalesce(n.source, '') <> 'seed' OR n.created_at IS NULL RETURN count(n) AS n");
  assert.equal(n, 0, 'every node carries source and created_at');
});

test('second load leaves node and edge counts unchanged', async () => {
  assert.deepEqual(await loadDataset(d, db, { graph: name, until: start }), first);
});

test('every live temporal edge carries VALID_FOREVER', async () => {
  const live = d.customers.filter((c) => c.plan_history.some((p) => p.valid_until === null)).length + d.releases.flatMap((r) => r.introduces).length;
  const [{ n, missing }] = await rows<{ n: number; missing: number }>(
    `MATCH ()-[e]->() WHERE type(e) IN ['ON_PLAN','INTRODUCED'] RETURN sum(CASE WHEN e.valid_until = $f THEN 1 ELSE 0 END) AS n, sum(CASE WHEN e.valid_until IS NULL THEN 1 ELSE 0 END) AS missing`, { f: VALID_FOREVER });
  assert.equal(n, live);
  assert.equal(missing, 0);
});

test('vector query returns 5 tickets', async () => {
  const [q] = await embed(['order not placed']);
  const r = await rows<{ id: string }>("CALL db.idx.vector.queryNodes('Ticket','embedding',5, vecf32($q)) YIELD node RETURN node.id AS id", { q });
  assert.equal(r.length, 5);
});

test('demo window is held back; when it arrives it lacks ingested_at', async () => {
  const demo = d.tickets.filter((t) => t.created_at >= now - 86_400_000).map((t) => t.id).sort();
  assert.ok(demo.length >= 1);
  assert.equal((await rows('MATCH (t:Ticket) WHERE t.created_at >= $s RETURN t', { s: start })).length, 0, 'no demo-window ticket before the replay');
  await loadDataset(d, db, { graph: name, until: Infinity }); // stand-in for the live ingest of the replay window
  const r = await rows<{ id: string }>('MATCH (t:Ticket) WHERE t.ingested_at IS NULL RETURN t.id AS id ORDER BY id');
  assert.deepEqual(r.map((x) => x.id), demo);
  const [{ n }] = await rows<{ n: number }>('MATCH (t:Ticket)-[e:ABOUT|RESOLVED_BY]->() WHERE t.ingested_at IS NULL RETURN count(e) AS n');
  assert.equal(n, 0, 'demo-day tickets carry no extracted edges; the dream creates them');
  // Stand-in for a perfect dream extraction, so the eval checks below compare against the JSON ground truth.
  await g.query('UNWIND $rows AS r MATCH (t:Ticket {id: r.t}), (i:Issue {id: r.i}) MERGE (t)-[:ABOUT]->(i)',
    { params: { rows: d.tickets.filter((t) => t.created_at >= now - 86_400_000 && t.issue_id).map((t) => ({ t: t.id, i: t.issue_id })) } as any });
});

const plain = (bucket: string, re: RegExp) => ev.questions.filter((q) => q.bucket === bucket && !q.after_event && re.test(q.question));
test('multi-hop eval answers match Cypher (likely cause, who knows, blast radius)', async () => {
  const cause = plain('multi_hop', /likely caused/)[0];
  const t = cause.question.match(/T-\d+/)![0];
  const r1 = await rows<{ v: string }>(`MATCH (:Ticket {id:$t})-[:ABOUT]->(:Issue)<-[e:INTRODUCED]-(r:Release) WHERE ${EDGE_AS_OF('e')} RETURN r.version AS v`, { t, as_of: now });
  assert.equal(r1.map((x) => x.v).join(', '), cause.answer);

  const who = plain('multi_hop', /solved the most/)[0];
  const issue = who.question.match(/I-\d+/)![0];
  const [r2] = await rows<{ id: string; name: string; n: number }>(
    'MATCH (a:AgentUser)-[s:SOLVED]->(:Ticket)-[:ABOUT]->(:Issue {id:$issue}) RETURN a.id AS id, a.name AS name, count(s) AS n ORDER BY n DESC, id LIMIT 1', { issue });
  assert.equal(`${r2.name} (${r2.id}), ${r2.n} tickets`, who.answer);

  const blast = plain('multi_hop', /For release/)[1];
  const v = blast.question.match(/release (\S+),/)![1];
  const [r3] = await rows<{ c: number; o: number }>(
    `MATCH (:Release {version:$v})-[e:INTRODUCED]->(:Issue)<-[:ABOUT]-(t:Ticket)<-[:RAISED]-(c:Customer) WHERE ${EDGE_AS_OF('e')}
     RETURN count(DISTINCT c) AS c, sum(CASE WHEN t.status IN ['open','pending'] THEN 1 ELSE 0 END) AS o`, { v, as_of: now });
  assert.equal(`${r3.c} customers, ${r3.o} open tickets`, blast.answer);
});

const planAt = async (c: string, as_of: number) =>
  (await rows<{ p: string }>(`MATCH (:Customer {id:$c})-[e:ON_PLAN]->(p:Plan) WHERE ${EDGE_AS_OF('e')} RETURN p.name AS p`, { c, as_of })).map((x) => x.p);

test('applyEvent plan_change: new plan live, old plan as-of, idempotent', async () => {
  const e = d.contradiction_events.find((x) => x.kind === 'plan_change')!;
  if (e.kind !== 'plan_change') throw new Error('unreachable');
  assert.deepEqual(await planAt(e.customer_id, e.at + 1), [e.from], 'not pre-applied');
  assert.deepEqual(await applyEvent(e, g), { retired: 1 });
  assert.deepEqual(await planAt(e.customer_id, e.at + 1), [e.to]);
  assert.deepEqual(await planAt(e.customer_id, e.at - 1), [e.from]);
  assert.deepEqual(await applyEvent(e, g), { retired: 0 });
  assert.equal((await planAt(e.customer_id, e.at + 1)).length, 1);
  const q = ev.questions.find((x) => x.after_event === e.id)!;
  assert.equal((await planAt(e.customer_id, e.at + 1))[0], q.answer);
});

test('applyEvent issue_fixed retires INTRODUCED, deletes nothing, idempotent', async () => {
  const e = d.contradiction_events.find((x) => x.kind === 'issue_fixed')!;
  if (e.kind !== 'issue_fixed') throw new Error('unreachable');
  const before = (await rows<{ n: number }>('MATCH ()-[e:INTRODUCED]->() RETURN count(e) AS n'))[0].n;
  assert.deepEqual(await applyEvent(e, g), { retired: 1 });
  assert.deepEqual(await applyEvent(e, g), { retired: 0 });
  assert.equal((await rows<{ n: number }>('MATCH ()-[e:INTRODUCED]->() RETURN count(e) AS n'))[0].n, before);
  const q = ev.questions.find((x) => x.after_event === e.id)!;
  const t = q.question.match(/T-\d+/)![0];
  const live = await rows(`MATCH (:Ticket {id:$t})-[:ABOUT]->(:Issue)<-[e:INTRODUCED]-(:Release) WHERE ${EDGE_AS_OF('e')} RETURN 1`, { t, as_of: e.at + 1 });
  assert.equal(live.length, 0);
  assert.match(q.answer, /^none/);
});
