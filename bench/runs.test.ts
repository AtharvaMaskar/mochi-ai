import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDataset, tinyEval, type PlantedMismatch } from '@mochi/contracts';
import { armA } from './arms/a.ts';
import { armB } from './arms/b.ts';
import { armC } from './arms/c.ts';
import { armD } from './arms/d.ts';
import { runMain } from './runs/main.ts';
import { runStaleness } from './runs/staleness.ts';
import { scoreFindings } from './runs/ablation.ts';
import { scoreClusters } from './runs/clusters.ts';
import { runConcurrency } from './runs/concurrency.ts';
import { isRefusal, runIsolation } from './runs/isolation.ts';
import { runServer } from './runs/server.ts';
import { testCtx } from './testctx.ts';

test('main: one record per arm x question', async () => {
  const ctx = await testCtx('main');
  try {
    const ev = tinyEval();
    const r = await runMain({ llm: ctx.llm, arms: [armA(ctx), armB(ctx), armC(ctx), armD(ctx)], eval: ev, events: ctx.dataset.contradiction_events, votes: [] });
    assert.equal(r.records.length, 4 * ev.questions.length);
    for (const a of ['A', 'B', 'C', 'D'] as const) assert.ok(r.summary[a]?.single_fact);
    assert.deepEqual(r.ingestion.map((x) => x.arch), ['A', 'B', 'C', 'D']);
  } finally { await ctx.cleanup(); }
});

test('staleness: a row per event x arm, D rows cost 0 tokens', async () => {
  const ctx = await testCtx('stale');
  try {
    const r = await runStaleness({ llm: ctx.llm, arms: [armC(ctx), armD(ctx, { ingest: false, graph: ctx.names.stale })], dataset: ctx.dataset, eval: tinyEval(), votes: [], artifacts: ctx.artifacts });
    assert.equal(r.staleness.length, 2 * ctx.dataset.contradiction_events.length);
    const d = r.staleness.filter((x) => x.arch === 'D');
    assert.ok(d.length && d.every((x) => x.maintenance_tokens === 0));
    assert.ok(r.staleness.filter((x) => x.arch === 'C').every((x) => x.maintenance_tokens > 0));
  } finally { await ctx.cleanup(); }
});

test('ablation scoring: found, missed, hallucinated on a hand-made case', () => {
  const planted: PlantedMismatch[] = [
    { id: 'M-1', kind: 'contradicts', kb_id: 'KB-1', area: 'orders', promised: 24, measured: 71, ticket_ids: [] },
    { id: 'M-2', kind: 'undocumented', kb_id: null, area: 'kyc', promised: null, measured: null, ticket_ids: [] },
    { id: 'M-3', kind: 'contradicts', kb_id: 'KB-3', area: 'funds', promised: 2, measured: 9, ticket_ids: [] },
  ];
  assert.deepEqual(scoreFindings(planted, [
    { kind: 'contradicts', kb_id: 'KB-1', area: 'x' }, { kind: 'undocumented', kb_id: null, area: 'kyc' },
    { kind: 'contradicts', kb_id: 'KB-9', area: 'funds' },
  ]), { found: 2, missed: 1, hallucinated: 1 });
});

test('cluster scoring: matched, missed, spurious on a hand-made case', () => {
  const d = tinyDataset();
  const mk = (n: number, issue: string) => Array.from({ length: n }, (_, i) => ({ ...d.tickets[0], id: `X-${issue}-${i}`, issue_id: issue }));
  d.tickets = [...mk(6, 'I-1'), ...mk(5, 'I-2'), ...mk(3, 'I-3')];
  const ids = (issue: string) => d.tickets.filter((t) => t.issue_id === issue).map((t) => t.id);
  const spikes = [{ version: '2.4.0', issue_id: 'I-1' }, { version: '2.4.0', issue_id: 'I-3' }];
  // I-1 cluster matches, I-2 cluster is spurious, I-3 is below MIN_SUPPORT so its spike is missed.
  assert.deepEqual(scoreClusters(d, spikes, [ids('I-1'), ids('I-2'), ids('I-3')], 7), { matched_spikes: 1, missed_spikes: 1, spurious: 1, tokens: 7 });
});

test('concurrency: 4 runs, no torn reads, no bench graphs left', async () => {
  const ctx = await testCtx('conc');
  try {
    const r = await runConcurrency(ctx);
    assert.deepEqual(r.concurrency!.runs.map((x) => x.n), [1, 5, 10, 25]);
    assert.ok(r.concurrency!.runs.every((x) => x.torn_reads === 0 && x.throughput_per_s > 0));
    assert.ok(r.concurrency!.isolation!.per_user.p95_ms > 0);
    const left = (await ctx.db.list()).filter((g) => g.startsWith('test_bench_conc_') && g !== ctx.names.world);
    assert.deepEqual(left, []);
  } finally { await ctx.cleanup(); }
});

test('isolation: every refusal case is refused for mochi_reader', async () => {
  const r = await runIsolation();
  assert.equal(r.tier_isolation!.cases.length, 4);
  for (const c of r.tier_isolation!.cases) assert.equal(c.refused, true, `${c.case}: ${c.error}`);
  assert.equal(isRefusal('Socket closed unexpectedly'), false, 'only ACL and read-only errors count as refusals');
  assert.equal(isRefusal('NOPERM User mochi_reader has no permissions to run the \'graph.QUERY\' command'), true);
});

test('server: config and graph counts are non-zero', async () => {
  const ctx = await testCtx('server');
  try {
    await armD(ctx, { ingest: false }).prepare();
    const s = (await runServer(ctx.db, ctx.names.world)).server;
    for (const k of ['thread_count', 'max_queued_queries', 'node_count', 'edge_count'] as const) assert.ok(s[k] > 0, k);
    assert.ok(s.memory_mb >= 0); // GRAPH.MEMORY USAGE rounds a 12-node graph to 0 MB
  } finally { await ctx.cleanup(); }
});
