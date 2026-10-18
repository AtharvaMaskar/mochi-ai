import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyEval } from '@mochi/contracts';
import { fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { armA } from './arms/a.ts';
import { armB, K } from './arms/b.ts';
import { armC, parseFiles } from './arms/c.ts';
import { armD } from './arms/d.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { armE, applySql, eTools, load, NO_SQL_EQUIVALENT, querySql, SQL_TOOLS } from './arms/e.ts';
import { READ_TOOL_SPECS } from './deps.ts';
import { tinyDataset } from '@mochi/contracts';
import { chunks } from './arms/index.ts';
import { testCtx } from './testctx.ts';

const [q1, q2] = tinyEval().questions;

test('A truncates at a tiny limit and records it', async () => {
  const ctx = await testCtx('arm_a');
  try {
    const a = armA(ctx, { limitTokens: 4100 });
    await a.prepare();
    assert.equal((await a.answer(q1)).truncated, true);
    const big = armA(ctx);
    await big.prepare();
    assert.equal((await big.answer(q1)).truncated, false);
  } finally { await ctx.cleanup(); }
});

test('B returns 8 chunks from the FalkorDB vector index, nearest first', async () => {
  const ctx = await testCtx('arm_b');
  try {
    const b = armB(ctx);
    await b.prepare();
    const target = chunks(ctx.dataset).find((c) => c.id === 'KB-1')!;
    const hits = await b.retrieve(target.text);
    assert.equal(hits.length, K);
    assert.equal(hits[0], target.text, 'score is a distance: the exact text ranks first');
  } finally { await ctx.cleanup(); }
});

test('C sums the usage of the pick call and the answer call', async () => {
  const ctx = await testCtx('arm_c', (p) => (p.includes('Reply with the file names') ? 'area-orders.md' : '=== FILE: MEMORY.md ===\narea-orders.md: orders\n=== FILE: area-orders.md ===\nI-1 introduced by 2.4.0'));
  try {
    const c = armC(ctx);
    await c.prepare();
    const before = ctx.llm.byCaller;
    const a = await c.answer(q2);
    assert.equal(a.usage.input, before.arm_c_pick.input + before.arm_c.input);
    assert.equal(a.usage.output, before.arm_c_pick.output + before.arm_c.output);
    assert.deepEqual([...parseFiles('=== FILE: x/MEMORY.md ===\nhi').keys()], ['MEMORY.md']);
  } finally { await ctx.cleanup(); }
});

test('D prompt holds query rows and the path, not raw dataset text', async () => {
  let prompt = '';
  let calls = 0;
  // Round 1: the model asks for likely_cause; round 2: it answers from the tool result.
  const ctx = await testCtx('arm_d', (p, s) => {
    if (!s.includes('company graph')) return 'faux';
    if (calls++ === 0) return [fauxToolCall('likely_cause', { ticketId: 'T-2' })];
    prompt = p; return '2.4.0';
  });
  try {
    const d = armD(ctx, { ingest: false });
    await d.prepare();
    const a = await d.answer({ ...q2, question: 'Which release likely caused T-2?' });
    assert.equal(a.answer, '2.4.0');
    assert.equal(ctx.llm.byCaller.arm_d.input, a.usage.input, 'both rounds counted');
    assert.match(prompt, /path: \(Ticket /);
    assert.match(prompt, /"release":"2\.4\.0"/);
    assert.ok(!prompt.includes(ctx.dataset.tickets[0].body), 'no raw ticket body');
    assert.ok(!prompt.includes('Ticket {'), 'no corpus lines');
  } finally { await ctx.cleanup(); }
});

test('E answers through the same tool loop, from SQL rows; tokens and cost are counted', async () => {
  let prompt = '', calls = 0;
  const ctx = await testCtx('arm_e', (p, s) => {
    if (!s.includes('company database')) return 'faux';
    if (calls++ === 0) return [fauxToolCall('likely_cause', { ticketId: 'T-2' })];
    prompt = p; return '2.4.0';
  });
  try {
    const e = armE(ctx);
    await e.prepare();
    const a = await e.answer({ ...q2, question: 'Which release likely caused T-2?' });
    assert.equal(a.answer, '2.4.0');
    assert.equal(ctx.llm.byCaller.arm_e.input, a.usage.input, 'both rounds counted');
    assert.ok(a.usage.cost > 0);
    assert.match(prompt, /"release":"2\.4\.0"/);
    assert.ok(!prompt.includes(ctx.dataset.tickets[0].body), 'no raw ticket body');
  } finally { await ctx.cleanup(); }
});

test('E has SQL for every read tool D exposes, query_graph as query_sql, and no graph_algorithm', () => {
  const names = eTools().map((t) => t.name);
  assert.deepEqual(READ_TOOL_SPECS.map((s) => s.name as string).filter((n) => !SQL_TOOLS[n] && n !== 'query_graph' && !NO_SQL_EQUIVALENT.has(n)), []);
  assert.ok(names.includes('query_sql') && !names.includes('graph_algorithm') && !names.includes('query_graph'));
});

test('query_sql is read-only, capped at 200 rows and timed out', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'e-test-')), 'e.sqlite');
  load(tinyDataset() as any, new Map(), file).close();
  const r = await querySql(file, 'SELECT id FROM tickets WHERE created_at <= $as_of ORDER BY id', Date.now());
  assert.ok(r.rows.length >= 2 && !r.truncated);
  await assert.rejects(querySql(file, "UPDATE tickets SET subject = 'x'", 0), /readonly|read-only/i);
  const big = await querySql(file, 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n LIMIT 1000) SELECT i FROM n', 0);
  assert.deepEqual([big.rows.length, big.truncated], [200, true]);
  await assert.rejects(querySql(file, 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) FROM n', 0), /timeout/);
});

test('E serves customer_profile with the same four queries as the graph', async () => {
  const db = load(tinyDataset() as any, new Map());
  const r = await SQL_TOOLS.customer_profile(db, { customerId: 'C-1' }, Date.now());
  assert.deepEqual(Object.keys(r), ['q_1', 'q_2', 'q_3', 'q_4']);
  assert.equal(r.q_1[0].plan, 'premium');
  assert.equal(r.q_2.length + r.q_3.length + r.q_4.length >= 2, true);
});

test('E staleness: an event retires the live row and inserts the new fact, as applyEvent does', async () => {
  const d = tinyDataset() as any;
  const db = load(d, new Map());
  const now = Date.now();
  assert.equal((await SQL_TOOLS.likely_cause(db, { ticketId: 'T-2' }, now)).q_1.length, 1);
  applySql(db, d.contradiction_events.find((e: any) => e.kind === 'issue_fixed'));
  assert.equal((await SQL_TOOLS.likely_cause(db, { ticketId: 'T-2' }, now)).q_1.length, 0, 'INTRODUCED retired');
  const at = now - 1000;
  applySql(db, { id: 'E-x', at, kind: 'plan_change', customer_id: 'C-1', from: 'premium', to: 'basic' });
  assert.equal((await SQL_TOOLS.customer_profile(db, { customerId: 'C-1' }, now)).q_1[0].plan, 'basic');
  assert.equal((await SQL_TOOLS.customer_profile(db, { customerId: 'C-1' }, at - 1)).q_1[0].plan, 'premium', 'history kept');
});

test('lessons: picked ids, read-only SQL guard, cosine, merge fills D and traces from the summary', async () => {
  const { picked, isSelect, cosine } = await import('./arms/lessons.ts');
  const { withApproaches } = await import('./merge.ts');
  assert.deepEqual(picked('T-2\nT-9\nT-2', ['T-1', 'T-2']), ['T-2']);
  assert.ok(isSelect('SELECT * FROM lessons;') && isSelect('with x as (select 1) select * from x'));
  assert.ok(!isSelect('DELETE FROM lessons') && !isSelect('SELECT 1; DROP TABLE lessons'));
  assert.equal(cosine([1, 0], [1, 0]), 1);
  const m = { n: 1, accuracy: 1, cost_usd_mean: 0, input_tokens_mean: 0, output_tokens_mean: 0, tool_calls_mean: 1, p50_ms: 0 };
  const t = withApproaches({ summary: { D: m, warm_replay: { ...m, tool_calls_mean: 0 } }, staleness: { fresh: { D: 10, 'D+trace': 9, of: 10 }, traces_closed_by_retirement: 0 }, approaches: {} } as never);
  assert.equal(t.approaches!.D.llm_calls_mean, 2);
  assert.equal(t.approaches!.graph_traces_warm_replay.staleness!.fresh, 9);
});
