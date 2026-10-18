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

test('the real gen, agent/queries and dream run through deps on the seed dataset', { timeout: 300_000 }, async () => {
  const { dataset, eval: ev } = await deps.readData();
  const issue = new Map(dataset.issues.map((i) => [i.id, i]));
  // Faux extraction that answers with each ticket's true issue, so the dream's ABOUT writes are checkable.
  const reply = (prompt: string, system: string) => {
    if (!system.includes('extract entities')) return 'Two plain sentences.';
    const tickets = JSON.parse(prompt) as { id: string }[];
    return JSON.stringify({ items: tickets.map((t) => {
      const i = issue.get(dataset.tickets.find((x) => x.id === t.id)!.issue_id!)!;
      return { ticket_id: t.id, issue: i.name, area: i.area };
    }) });
  };
  const ctx = await testCtx('deps', reply);
  try {
    assert.ok(validateDataset(dataset).ok && validateEval(ev, dataset).ok);
    const [v] = await deps.embed(['order not placed']);
    assert.equal(v.length, deps.EMBED_DIM);

    const graph = ctx.names.world;
    await deps.loadDataset(dataset, ctx.db, { graph, fresh: true });
    const g = ctx.db.selectGraph(graph);
    const demo = dataset.tickets.filter((t) => t.created_at >= dataset.generated_at - 86_400_000);
    const about = async () => (await g.roQuery<{ n: number }>('MATCH (t:Ticket)-[:ABOUT]->() WHERE t.id IN $ids RETURN count(t) AS n', { params: { ids: demo.map((t) => t.id) } })).data![0].n;
    assert.equal(await about(), 0, 'the loader leaves demo-day ABOUT to the dream');

    await deps.runDreamNow({ db: ctx.db, llm: ctx.llm, caller: 'test_dream', graphs: { company: graph, prev: `${graph}_prev`, scratch: `${graph}_scratch` } });
    assert.equal(await about(), demo.length, 'the dream extraction linked every demo-day ticket');
    const same = await g.roQuery<{ n: number }>('UNWIND $rows AS r MATCH (:Ticket {id: r.t})-[:ABOUT]->(:Issue {id: r.i}) RETURN count(*) AS n',
      { params: { rows: demo.map((t) => ({ t: t.id, i: t.issue_id })) } });
    assert.equal(same.data![0].n, demo.length, 'name reuse maps onto the seeded Issue ids');
    assert.ok(ctx.llm.byCaller.test_dream, 'dream calls went through the bench wrapper');

    const fixed = dataset.contradiction_events.find((e) => e.kind === 'issue_fixed')!;
    assert.deepEqual(await deps.applyEvent(fixed, g), { retired: 1 });
    assert.deepEqual(await deps.applyEvent(fixed, g), { retired: 0 }, 'idempotent');

    const db = remap(ctx.db, graph), t = dataset.generated_at + 1;
    const b = await deps.queries.briefing(db, { ticketId: dataset.tickets[0].id }, t);
    assert.equal(b.card.kind, 'briefing');
    assert.equal((await deps.queries.searchSimilar(db, { text: 'order not placed', k: 5 }, t)).card.queries.q_1.rows.length, 5);

    const found = await deps.runMismatchRules(ctx.db, { company: graph });
    for (const p of ev.planted_mismatches)
      assert.ok(found.some((f) => (p.kind === 'contradicts' ? f.type === 'CONTRADICTS' && f.kb_id === p.kb_id : f.type === 'UNDOCUMENTED' && f.area === p.area)), JSON.stringify(p));
  } finally { await ctx.cleanup(); }
});
