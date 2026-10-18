import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateResults } from '@mochi/contracts';
import { bench } from './run.ts';
import { CostCapError } from './llm.ts';
import { connect } from './db.ts';

const dir = mkdtempSync(join(tmpdir(), 'bench-run-'));
const opts = { dry: true, prefix: 'test_bench_run', out: join(dir, 'results.json'), artifacts: dir };

// Drop every graph these runs create, even when a test fails mid-run (vector-index graphs are heavy on reload).
after(async () => {
  const db = await connect();
  for (const g of await db.list()) if (g.startsWith('test_bench_run_')) await db.selectGraph(g).delete().catch(() => {});
  await db.close();
});

test('a dry run executes every section, validates, then --only merges one section', async () => {
  const models = ['claude-haiku-5-5', 'claude-sonnet-5-5'];
  const r = await bench({ ...opts, maxUsd: 100, models });
  assert.ok(validateResults(r).ok);
  assert.deepEqual(r.per_task!.map((p) => `${p.model_id}/${p.arch}`).sort(), models.flatMap((m) => ['A', 'B', 'C', 'D', 'E'].map((a) => `${m}/${a}`)).sort());
  assert.ok(r.records.every((x) => x.model_id && x.cost_usd !== undefined && x.total_ms !== undefined));
  assert.ok(r.records.length && r.staleness.length && r.mismatch_ablation && r.clusters_ablation && r.concurrency && r.tier_isolation);
  assert.ok(r.server.node_count > 0);
  const before = JSON.parse(readFileSync(opts.out, 'utf8'));
  const merged = await bench({ ...opts, maxUsd: 100, only: 'isolation' });
  assert.deepEqual(merged.records, before.records, 'other sections kept');
  const db = await connect();
  assert.deepEqual((await db.list()).filter((g) => g.includes('test_bench_run')), [], 'graphs cleaned up');
  await db.close();
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
