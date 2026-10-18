import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCypherNames, validateDataset, validateEval } from '@mochi/contracts';
import * as deps from './deps.ts';
import { ALL_CYPHER } from './cypher.ts';
import { remap } from './arms/d.ts';
import { testCtx } from './testctx.ts';

test('every Cypher string in bench uses contract names only', () => {
  for (const q of ALL_CYPHER) assert.deepEqual(checkCypherNames(q), [], q);
});

test('every stub runs', async () => {
  const ctx = await testCtx('deps');
  try {
    const { dataset, eval: ev } = await deps.readData();
    assert.ok(validateDataset(dataset).ok && validateEval(ev, dataset).ok);

    const [v] = await deps.embed(['order not placed']);
    assert.equal(v.length, deps.EMBED_DIM);
    assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9);

    const graph = ctx.names.world;
    await deps.loadDataset(dataset, ctx.db, { graph, fresh: true });
    const g = ctx.db.selectGraph(graph);
    const fixed = dataset.contradiction_events.find((e) => e.kind === 'issue_fixed')!;
    assert.deepEqual(await deps.applyEvent(fixed, g), { retired: 1 });
    assert.deepEqual(await deps.applyEvent(fixed, g), { retired: 0 }, 'idempotent');
    const plan = { id: 'E-x', at: dataset.generated_at, kind: 'plan_change' as const, customer_id: 'C-1', from: 'premium' as const, to: 'basic' as const };
    assert.deepEqual(await deps.applyEvent(plan, g), { retired: 1 });
    assert.deepEqual(await deps.applyEvent(plan, g), { retired: 0 });

    const db = remap(ctx.db, graph), t = dataset.generated_at + 1;
    const b = await deps.queries.briefing(db, { ticketId: 'T-2' }, t);
    assert.equal(b.card.queries.q_1.rows[0].plan, 'basic');
    assert.equal(b.card.queries.q_1.rows[0].similar_ticket, 'T-1');
    assert.equal((await deps.queries.whoKnows(db, { issueId: 'I-1' }, t)).card.queries.q_1.rows[0].agent, 'A-1');
    assert.equal((await deps.queries.likelyCause(db, { ticketId: 'T-2' }, t)).card.queries.q_1.rows.length, 0, 'fixed issue has no live cause');
    assert.ok(await deps.queries.blastRadius(db, { version: '2.4.0' }, t));
    assert.ok(await deps.queries.emergingClusters(db, { days: 7 }, t));
    assert.ok(await deps.queries.searchSimilar(db, { text: 'order', k: 5 }, t));
    assert.deepEqual(await deps.runMismatchRules(ctx.db), []);

    await g.query('MATCH (t:Ticket) REMOVE t.ingested_at');
    const report = await deps.runDreamNow({ db: ctx.db, model: ctx.llm.model(), graphs: { company: graph, prev: `${graph}_prev`, scratch: `${graph}_scratch` } });
    assert.deepEqual(report.batches.map((x) => x.size), [2]);
    assert.deepEqual(report.usage, []);
  } finally { await ctx.cleanup(); }
});
