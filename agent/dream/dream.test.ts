import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStory } from '@mochi/contracts';
import { AS_OF, fauxModel, fixture, WORKAROUND } from './__test__/fixture.ts';

const { runDreamNow } = await import('./index.ts');
const { summarize } = await import('./report.ts');
const H = 3_600_000;
const live = 'e.valid_from <= $as_of AND e.valid_until > $as_of';

test('full fixture run: every step of the dream', async (t) => {
  const f = await fixture('full');
  t.after(f.cleanup);
  const model = fauxModel();
  const events = f.dataset.contradiction_events;
  // Doctrine candidate (as agent-core's teach writes it) and a duplicate of the same text.
  for (const session of ['S-1', 'S-2'])
    await f.rows(`MATCH (a:ProductArea {name:'funds'}) CREATE (d:DoctrineCandidate {text:'refunds over ₹10k need manager approval', source:'teach', taught_by:'A-1', source_session:$s, created_at:$at})-[:IN]->(a)`, { s: session, at: AS_OF - H }, f.graphs.teams![0]);

  const counts: { step: string; nodes: number; edges: number }[] = [];
  const onStep = async (step: string) => { if (!step.includes(':')) counts.push({ step, ...(await f.counts()) }); };
  const before = await f.counts();
  const r1 = await runDreamNow({ db: f.db, as_of: AS_OF, model, graphs: f.graphs, events, onStep });

  await t.test('6.4 no node or edge count decreases between steps', () => {
    let prev = before;
    for (const c of counts) {
      assert.ok(c.nodes >= prev.nodes && c.edges >= prev.edges, `${c.step}: ${JSON.stringify(prev)} → ${JSON.stringify(c)}`);
      prev = c;
    }
  });

  await t.test('3.1 one valid and one off-schema ticket: one ingested, dropped = 1', async () => {
    assert.equal(r1.ingested, 1);
    assert.equal(r1.dropped, 1);
    const rows = await f.rows(`MATCH (t:Ticket) WHERE t.id IN ['D-1','D-2'] OPTIONAL MATCH (t)-[:ABOUT]->(i:Issue)-[:IN]->(a:ProductArea)
      RETURN t.id AS id, t.ingested_at AS at, i.source AS src, a.name AS area ORDER BY id`);
    assert.deepEqual(rows, [{ id: 'D-1', at: AS_OF, src: 'dream', area: 'login' }, { id: 'D-2', at: null, src: null, area: null }]);
    assert.deepEqual(r1.batches, [{ id: `${r1.run_id}:0`, size: 1 }]);
  });

  await t.test('2.1 snapshot: prev still shows the retired plan as live', async () => {
    const q = `MATCH (:Customer {id:'C-1'})-[e:ON_PLAN]->(p:Plan) WHERE ${live} RETURN p.name AS plan`;
    assert.deepEqual(await f.rows(q, { as_of: AS_OF }, f.graphs.prev), [{ plan: 'basic' }]);
    assert.deepEqual(await f.rows(q, { as_of: AS_OF }), [{ plan: 'premium' }]);
  });

  await t.test('2.2 events: retired once, live filter returns the new plan', () => {
    assert.equal(r1.retired_by.events, 2); // plan_change + issue_fixed
  });

  await t.test('4.2 practice: expected pattern keys and support counts', async () => {
    const pats = await f.rows(`MATCH (p:ObservedPattern {run_id:$run}) OPTIONAL MATCH (p)-[s:SEEN_IN]->() RETURN p.key AS key, p.support_count AS support, p.measured_tat_hours AS measured, count(s) AS seen ORDER BY key`, { run: r1.run_id });
    assert.deepEqual(pats.map((p) => [p.key, p.support, p.seen]), [['kb:KB-1:I-1', 7, 7], [r1.mismatches.find((m) => m.type === 'UNDOCUMENTED')!.key, 5, 5]]);
    assert.equal(pats[0].measured, 71);
    assert.match(pats[1].key, /^wa:funds:[0-9a-f]{10}$/);
  });

  await t.test('5.1 planted 24h→71h gives delta 47; planted workaround gives UNDOCUMENTED', async () => {
    const c = await f.rows(`MATCH (p:ObservedPattern)-[e:CONTRADICTS]->(kb:KBArticle) WHERE ${live} RETURN p.run_id AS run, kb.id AS kb, e.delta AS delta`, { as_of: AS_OF });
    assert.deepEqual(c, [{ run: r1.run_id, kb: 'KB-1', delta: 47 }]);
    const u = await f.rows(`MATCH (p:ObservedPattern)-[e:UNDOCUMENTED]->(a:ProductArea) WHERE ${live} RETURN a.name AS area, p.summary AS s`, { as_of: AS_OF });
    assert.deepEqual(u, [{ area: 'funds', s: WORKAROUND }]);
  });

  await t.test('5.2 suggestions: FROM pattern, FOR the owning team, confidence and expiry', async () => {
    const s = await f.rows(`MATCH (s:Suggestion)-[:FROM]->(:ObservedPattern), (s)-[:FOR]->(t:Team) RETURN s.edge AS edge, t.name AS team, s.confidence AS c, s.expires_at AS exp, s.status AS status ORDER BY edge`);
    assert.deepEqual(s, [
      { edge: 'CONTRADICTS', team: 'trading', c: 7 / 20, exp: AS_OF + 14 * 24 * H, status: 'open' },
      { edge: 'UNDOCUMENTED', team: 'payments', c: 5 / 20, exp: AS_OF + 14 * 24 * H, status: 'open' },
    ]);
  });

  await t.test('5.3 doctrine: one Policy IN funds with provenance; candidates reviewed', async () => {
    const p = await f.rows(`MATCH (p:Policy)-[:IN]->(a:ProductArea) RETURN a.name AS area, p.taught_by AS by, p.source_session AS session, p.source AS source`);
    assert.deepEqual(p, [{ area: 'funds', by: 'A-1', session: 'S-1', source: 'teach' }]);
    const c = await f.rows(`MATCH (d:DoctrineCandidate) RETURN d.reviewed_at AS at`, {}, f.graphs.teams![0]);
    assert.deepEqual(c, [{ at: AS_OF }, { at: AS_OF }]);
  });

  await t.test('6.1 the story passes parseStory and its memdiff names the retired fact', () => {
    assert.deepEqual(r1.story_errors, []);
    const parsed = parseStory(r1.story);
    assert.ok(parsed.ok);
    const memdiff = r1.story!.queries.q_2.rows;
    assert.ok(memdiff.some((r) => r.change === 'retired' && r.fact === 'C-1 ON_PLAN basic'), JSON.stringify(memdiff));
    assert.ok(memdiff.some((r) => r.change === 'retired' && r.fact === '2.4.0 INTRODUCED I-1'));
    assert.ok(memdiff.some((r) => r.change === 'added' && r.fact === 'C-1 ON_PLAN premium'));
    assert.equal(parsed.ok && parsed.segments.filter((s) => s.type === 'suggestion').length, 2);
    assert.match(summarize(r1.story!), /Facts retired: 2/);
  });

  await t.test('6.3 usage totals equal the faux provider usage', () => {
    assert.equal(r1.usage.total.input, model.reported.input);
    assert.equal(r1.usage.total.output, model.reported.output);
    assert.equal(r1.usage.extract.calls, 1);
    assert.equal(r1.usage.suggest.calls, 2);
    assert.ok(r1.usage.total.input > 0);
  });

  // ── second run, an hour later, same data ─────────────────────────────────────────────────
  const clustersBefore = await f.rows(`MATCH (:Ticket)-[e:IN_CLUSTER]->(c:Cluster) WHERE ${live} RETURN c.id AS c, count(e) AS n ORDER BY c`, { as_of: AS_OF });
  const r2 = await runDreamNow({ db: f.db, as_of: AS_OF + H, model, graphs: f.graphs, events });

  await t.test('2.2 second run retires 0 for the same events', () => assert.equal(r2.retired_by.events, 0));

  await t.test('4.1 stable cluster ids, 0 retired IN_CLUSTER edges', async () => {
    assert.deepEqual(r2.clusters.ids, r1.clusters.ids);
    assert.equal(r2.clusters.retired, 0);
    const after = await f.rows(`MATCH (:Ticket)-[e:IN_CLUSTER]->(c:Cluster) WHERE ${live} RETURN c.id AS c, count(e) AS n ORDER BY c`, { as_of: AS_OF + H });
    assert.deepEqual(after, clustersBefore);
    assert.match(r1.clusters.receipts.algorithm, /algo\.labelPropagation/);
    assert.match(r1.clusters.receipts.projection, /UNWIND \$rows/);
  });

  await t.test('5.1 second run leaves exactly one live edge each, from the fresh pattern', async () => {
    const e = await f.rows(`MATCH (p:ObservedPattern)-[e:CONTRADICTS|UNDOCUMENTED]->() WHERE ${live} RETURN type(e) AS t, p.run_id AS run ORDER BY t`, { as_of: AS_OF + H });
    assert.deepEqual(e, [{ t: 'CONTRADICTS', run: r2.run_id }, { t: 'UNDOCUMENTED', run: r2.run_id }]);
    assert.equal(r2.retired_by.mismatches, 2);
  });

  await t.test('5.2 open suggestions block duplicates; 5.3 duplicate doctrine is not committed twice', async () => {
    assert.deepEqual(r2.suggestions, []);
    const [{ n }] = await f.rows('MATCH (p:Policy) RETURN count(p) AS n');
    assert.equal(n, 1);
  });
});

test('5.2 a FEEDBACK wrong edge suppresses a new Suggestion and sets status wrong', async (t) => {
  const f = await fixture('feedback');
  t.after(f.cleanup);
  const model = fauxModel();
  const r1 = await runDreamNow({ db: f.db, as_of: AS_OF, model, graphs: f.graphs, events: [] });
  assert.equal(r1.suggestions.length, 2);
  const [{ id: contradicts }] = await f.rows(`MATCH (s:Suggestion {edge:'CONTRADICTS'}) RETURN s.id AS id`);
  // agent-core's feedback tool writes the reference into the team graph.
  await f.rows(`MERGE (a:AgentUser {id:'A-1'}) MERGE (s:Suggestion {id:$id}) CREATE (a)-[:FEEDBACK {verdict:'wrong', at:$at}]->(s)`, { id: contradicts, at: AS_OF + H }, f.graphs.teams![0]);
  const r2 = await runDreamNow({ db: f.db, as_of: AS_OF + 2 * H, model, graphs: f.graphs, events: [] });
  assert.ok(r2.mismatches.some((m) => m.type === 'CONTRADICTS'), 'the mismatch is still seen');
  assert.deepEqual(r2.suggestions, []);
  const s = await f.rows(`MATCH (s:Suggestion {edge:'CONTRADICTS'}) RETURN s.id AS id, s.status AS status`);
  assert.deepEqual(s, [{ id: contradicts, status: 'wrong' }]);
  // Past expiry, the UNDOCUMENTED suggestion (no feedback) expires and a new one is created.
  const r3 = await runDreamNow({ db: f.db, as_of: AS_OF + 15 * 24 * H, model, graphs: f.graphs, events: [] });
  const [{ expired }] = await f.rows(`MATCH (s:Suggestion {status:'expired'}) RETURN count(s) AS expired`);
  assert.equal(expired, 1);
  assert.equal(r3.suggestions.length, 1, 'wrong feedback still suppresses within 30 days; the expired one is replaced');
});
