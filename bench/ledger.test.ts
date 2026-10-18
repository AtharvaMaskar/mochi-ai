import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER_FEATURES, validateResults, type Results } from '@mochi/contracts';
import { buildLedger } from './ledger.ts';

const body: Omit<Results, 'ledger'> = {
  run_at: 1, seed: 42,
  model: { id: 'm', provider: 'faux', usd_per_1m_input: 0, usd_per_1m_output: 0 },
  judge: { model_id: 'j', same_as_answer_model: false, prompt_path: 'bench/judge.md' },
  records: [
    { arch: 'D', question_id: 'Q-1', bucket: 'single_fact', input_tokens: 1, output_tokens: 1, retrieval_ms: 1, answer: 'a', correct: true },
    { arch: 'A', question_id: 'Q-1', bucket: 'single_fact', input_tokens: 1, output_tokens: 1, retrieval_ms: 1, answer: 'b', correct: false },
  ],
  summary: {}, ingestion: [], staleness: [],
  mismatch_ablation: { graph: { found: 3, missed: 2, hallucinated: 0, tokens: 0 }, llm: { found: 4, missed: 1, hallucinated: 2, tokens: 9 } },
  concurrency: null, clusters_ablation: null, tier_isolation: null,
  server: { thread_count: 4, max_queued_queries: 256, node_count: 1, edge_count: 1, memory_mb: 0, slowlog_top: [] },
};

test('null sections give honest "not measured" rows and the results validate', () => {
  const ledger = buildLedger(body);
  assert.deepEqual(ledger.map((l) => l.feature), [...LEDGER_FEATURES]);
  const row = (f: string) => ledger.find((l) => l.feature === f)!;
  assert.deepEqual([row('multi-agent concurrency').status, row('multi-agent concurrency').result], ['not_measured', 'not measured']);
  assert.equal(row('crash resume').status, 'demonstrated');
  assert.equal(row('briefing retrieval').result, 'D 1/1 vs A 0/1');
  assert.match(row('mismatch detection').result, /graph lost/);
  const v = validateResults({ ...body, ledger });
  assert.ok(v.ok, JSON.stringify(v));
});
