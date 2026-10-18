import { test } from 'node:test';
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

test('a dry run executes every section, validates, then --only merges one section', async () => {
  const r = await bench({ ...opts, maxUsd: 5 });
  assert.ok(validateResults(r).ok);
  assert.ok(r.records.length && r.staleness.length && r.mismatch_ablation && r.clusters_ablation && r.concurrency && r.tier_isolation);
  assert.ok(r.server.node_count > 0);
  const before = JSON.parse(readFileSync(opts.out, 'utf8'));
  const merged = await bench({ ...opts, maxUsd: 5, only: 'isolation' });
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
});

test('--dry refuses to target bench/results.json', async () => {
  await assert.rejects(bench({ dry: true, maxUsd: 5, out: new URL('./results.json', import.meta.url).pathname }), /never overwrites/);
});
