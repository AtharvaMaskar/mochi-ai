import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateResults, LEDGER_FEATURES, type Results } from './results.ts';

const minimal = (): Results => ({
  run_at: 1, seed: 42,
  model: { id: 'claude-haiku-5-5', provider: 'anthropic', usd_per_1m_input: 1, usd_per_1m_output: 5 },
  judge: { model_id: 'claude-opus-5-5', same_as_answer_model: false, prompt_path: 'bench/judge.md' },
  records: [{ arch: 'D', question_id: 'Q-1', bucket: 'single_fact', input_tokens: 900, output_tokens: 40, retrieval_ms: 12, answer: 'premium', correct: true }],
  summary: { D: { single_fact: { accuracy: 1, mean_input_tokens: 900, p50_ms: 12, p95_ms: 12 } } },
  ingestion: [], staleness: [], mismatch_ablation: null, clusters_ablation: null, concurrency: null, tier_isolation: null,
  server: { thread_count: 4, max_queued_queries: 256, node_count: 10, edge_count: 12, memory_mb: 1, slowlog_top: [] },
  ledger: LEDGER_FEATURES.map((feature) => ({ feature, mechanism: 'm', measured_against: 'x', result: 'not measured', status: 'not_measured' as const })),
});

test('minimal results pass', () => {
  const r = validateResults(minimal());
  assert.ok(r.ok, !r.ok ? r.errors.join('\n') : '');
});

test('a missing ledger row fails, naming the feature', () => {
  const m = minimal();
  m.ledger = m.ledger.filter((l) => l.feature !== 'tier isolation');
  const r = validateResults(m);
  assert.ok(!r.ok);
  assert.deepEqual(r.errors, ['ledger: missing row for "tier isolation"']);
});

test('not_measured rows must say so in public', () => {
  const m = minimal();
  m.ledger[0].result = '92%';
  assert.ok(!validateResults(m).ok);
});
