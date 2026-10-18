// bench/results.json contract (SPEC §3). The only source of published figures: blog BENCH,
// README Feature Ledger and the report all read this shape.
import { z } from 'zod';

export const Arch = z.enum(['A', 'B', 'C', 'D']);
const Bucket = z.enum(['single_fact', 'multi_hop', 'structural']);
const n = z.number().nonnegative();

// SPEC §1 Feature Ledger — every feature needs a row, "not measured" allowed, missing is not.
export const LEDGER_FEATURES = [
  'briefing retrieval', 'mismatch detection', 'emerging clusters',
  'crash resume', 'tier isolation', 'multi-agent concurrency',
] as const;

const Score = z.object({ found: n, missed: n, hallucinated: n, tokens: n });

export const Results = z.object({
  run_at: z.number().int(),
  seed: z.number().int(),
  model: z.object({ id: z.string(), provider: z.string(), usd_per_1m_input: n, usd_per_1m_output: n }),
  judge: z.object({ model_id: z.string(), same_as_answer_model: z.boolean(), prompt_path: z.string() }),
  records: z.array(z.object({
    arch: Arch, question_id: z.string(), bucket: Bucket,
    input_tokens: n, output_tokens: n, retrieval_ms: n,
    answer: z.string(), correct: z.boolean(), truncated: z.boolean().optional(),
  })),
  summary: z.partialRecord(Arch, z.partialRecord(Bucket, z.object({ accuracy: n, mean_input_tokens: n, p50_ms: n, p95_ms: n }))),
  ingestion: z.array(z.object({ arch: Arch, tokens: n })),
  staleness: z.array(z.object({ event_id: z.string(), arch: Arch, maintenance_tokens: n, answer_fresh: z.boolean() })),
  mismatch_ablation: z.object({ graph: Score, llm: Score }).nullable(),
  concurrency: z.object({
    runs: z.array(z.object({ n: n, p50_ms: n, p95_ms: n, throughput_per_s: n, torn_reads: n })),
    isolation: z.object({ one_graph: z.object({ p50_ms: n, p95_ms: n }), per_user: z.object({ p50_ms: n, p95_ms: n }) }).nullable(),
  }).nullable(),
  tier_isolation: z.object({ cases: z.array(z.object({ case: z.string(), refused: z.boolean(), error: z.string() })) }).nullable(),
  server: z.object({
    thread_count: n, max_queued_queries: n, node_count: n, edge_count: n, memory_mb: n, slowlog_top: z.array(z.string()),
  }),
  ledger: z.array(z.object({
    feature: z.string(), mechanism: z.string(), measured_against: z.string(), result: z.string(),
    status: z.enum(['measured', 'demonstrated', 'not_measured']),
  })),
});
export type Results = z.infer<typeof Results>;

export function validateResults(input: unknown): { ok: true; value: Results } | { ok: false; errors: string[] } {
  const r = Results.safeParse(input);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const have = new Set(r.data.ledger.map((l) => l.feature));
  const errors = LEDGER_FEATURES.filter((f) => !have.has(f)).map((f) => `ledger: missing row for "${f}"`);
  for (const l of r.data.ledger)
    if (l.status === 'not_measured' && l.result !== 'not measured') errors.push(`ledger "${l.feature}": not_measured rows must say "not measured"`);
  return errors.length ? { ok: false, errors } : { ok: true, value: r.data };
}
