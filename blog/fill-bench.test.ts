import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEDGER_FEATURES } from '../contracts/results.ts';
import { fill } from './fill-bench.ts';

const page = readFileSync(new URL('../mochi-brain-blog.html', import.meta.url), 'utf8');
const valid = JSON.stringify({
  run_at: 1, seed: 42,
  model: { id: 'claude-haiku-5-5', provider: 'anthropic', usd_per_1m_input: 1, usd_per_1m_output: 5 },
  judge: { model_id: 'claude-opus-5-5', same_as_answer_model: false, prompt_path: 'bench/judge.md' },
  records: [], summary: {}, ingestion: [], staleness: [],
  mismatch_ablation: null, clusters_ablation: null, concurrency: null, tier_isolation: null,
  server: { thread_count: 4, max_queued_queries: 256, node_count: 10, edge_count: 12, memory_mb: 1, slowlog_top: ['</script>'] },
  ledger: LEDGER_FEATURES.map((feature) => ({ feature, mechanism: 'm', measured_against: 'x', result: 'not measured', status: 'not_measured' })),
});
const block = (html: string) => html.match(/id="bench">([\s\S]*?)<\/script>/)![1];

test('the shipped page holds the null skeleton until filled', () => {
  assert.equal(JSON.parse(block(page)).run_at, null);
});

test('valid results fill the real page, verbatim except the escaped "</"', () => {
  const r = fill(page, valid);
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'));
  assert.equal(block(r.html), valid.replaceAll('</', '<\\/'));
  assert.deepEqual(JSON.parse(block(r.html)), JSON.parse(valid));
});

test('invalid results are refused', () => {
  const r = fill(page, JSON.stringify({ run_at: null }));
  assert.equal(r.ok, false);
  assert.equal(fill(page, 'not json').ok, false);
});

test('a leftover TODO marker is refused and named', () => {
  const r = fill(page.replace('<h2>FAQ</h2>', '<h2>FAQ TODO</h2>'), valid);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.errors.join(), /marker "TODO"/);
});
