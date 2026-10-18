import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tinyDataset, tinyEval, validateResults } from '@mochi/contracts';
import { bench } from './run.ts';
import { merge } from './merge.ts';
import { CostCapError } from './llm.ts';
import { connect } from './db.ts';

const dir = mkdtempSync(join(tmpdir(), 'bench-run-'));
// The contract fixture, not the 400-ticket slice: local embedding of the full corpus takes minutes.
const opts = { dry: true, prefix: 'test_bench_run', out: join(dir, 'results.json'), artifacts: dir, input: { dataset: tinyDataset() as any, eval: tinyEval() } };

// Drop every graph these runs create, even when a test fails mid-run (vector-index graphs are heavy on reload).
after(async () => {
  const db = await connect();
  for (const g of await db.list()) if (g.startsWith('test_bench_run_')) await db.selectGraph(g).delete().catch(() => {});
  await db.close();
});

test('a dry run executes every section and validates', async () => {
  const models = ['claude-haiku-5-5', 'claude-sonnet-5-5'];
  const r = await bench({ ...opts, maxUsd: 100, models });
  assert.ok(validateResults(r).ok);
  assert.deepEqual(r.per_task!.map((p) => `${p.model_id}/${p.arch}`).sort(), models.flatMap((m) => ['A', 'B', 'C', 'D', 'E'].map((a) => `${m}/${a}`)).sort());
  assert.ok(r.records.every((x) => x.model_id && x.cost_usd !== undefined && x.total_ms !== undefined));
  assert.ok(r.records.length && r.staleness.length && r.mismatch_ablation && r.clusters_ablation && r.concurrency && r.tier_isolation);
  assert.ok(r.server.node_count > 0);
  const db = await connect();
  assert.deepEqual((await db.list()).filter((g) => g.includes('test_bench_run')), [], 'graphs cleaned up');
  await db.close();
});

test('two shards with their own run ids merge into results that validate', async () => {
  const a = join(dir, 'part-a.json'), i = join(dir, 'part-i.json');
  await Promise.all([
    bench({ ...opts, prefix: undefined, runId: 'testrunA', only: 'A', limit: 1, maxUsd: 5, out: a, artifacts: join(dir, 'sa') }),
    bench({ ...opts, prefix: undefined, runId: 'testrunI', only: 'isolation', maxUsd: 5, out: i, artifacts: join(dir, 'si') }),
  ]);
  const { results } = merge([a, i].map((f) => JSON.parse(readFileSync(f, 'utf8'))));
  const v = validateResults(results);
  assert.ok(v.ok, JSON.stringify(v));
  assert.deepEqual(results.per_task!.map((p) => p.arch), ['A']);
  assert.ok(results.tier_isolation);
  assert.throws(() => merge([a, a].map((f) => ({ ...JSON.parse(readFileSync(f, 'utf8')), server: {} }))), /2 partials/);
});

test('a forced cap aborts and leaves results.json unchanged', async () => {
  const out = join(dir, 'capped.json');
  writeFileSync(out, 'previous');
  await assert.rejects(bench({ ...opts, out, maxUsd: -1 }), CostCapError);
  assert.equal(readFileSync(out, 'utf8'), 'previous');
  const partial = JSON.parse(readFileSync(join(dir, 'results.aborted.json'), 'utf8'));
  assert.equal(partial.aborted, true);
  assert.ok(!validateResults(partial).ok, 'the partial run never validates for publication');
});

test('--dry refuses to target bench/results.json', async () => {
  await assert.rejects(bench({ dry: true, maxUsd: 5, out: new URL('./results.json', import.meta.url).pathname }), /never overwrites/);
});
