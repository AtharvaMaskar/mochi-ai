// node bench/merge.ts [--out <path>] <partials...>: merges run.ts shard files into one results file (default
// bench/results.json). Records concatenate; per_task and summary are recomputed from them; one shard per other
// section; the ledger is rebuilt from the merged data. It must validate, or nothing is written and it exits 1.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { validateResults, type Results } from '@mochi/contracts';
import { perTask, summarize } from './runs/main.ts';
import { buildLedger } from './ledger.ts';
import { JUDGE_PATH } from './score.ts';
import { PRICES } from './prices.ts';

type Part = Partial<Results> & { partial: true; only: string; run_at: number; seed: number; models: string[]; judge_model: string; dry: boolean; spent_usd: number };
const SINGLE = ['mismatch_ablation', 'clusters_ablation', 'concurrency', 'tier_isolation', 'server'] as const;

export function merge(parts: Part[], defaultModel = process.env.MOCHI_MODEL ?? 'claude-haiku-5-5'): { results: Results; spent: number } {
  if (!parts.length) throw new Error('no partials given');
  if (new Set(parts.map((p) => p.seed)).size > 1) throw new Error('partials come from different seeds');
  if (parts.some((p) => !p.partial)) throw new Error('every input must be a run.ts --only partial');
  const records = parts.flatMap((p) => p.records ?? []);
  const ingestion = [...new Map(parts.filter((p) => p.models[0] === defaultModel).flatMap((p) => p.ingestion ?? []).map((x) => [x.arch, x])).values()];
  const pick = <K extends (typeof SINGLE)[number]>(k: K): Results[K] | null => {
    const has = parts.filter((p) => p[k] !== undefined);
    if (has.length > 1) throw new Error(`${k} comes from ${has.length} partials (${has.map((p) => p.only).join(', ')}); give one`);
    return (has[0]?.[k] ?? null) as Results[K] | null;
  };
  const server = pick('server') ?? { thread_count: 0, max_queued_queries: 0, node_count: 0, edge_count: 0, memory_mb: 0, slowlog_top: [] };
  const p = PRICES[defaultModel];
  const head = {
    run_at: Math.max(...parts.map((x) => x.run_at)), seed: parts[0].seed,
    model: { id: defaultModel, provider: parts.every((x) => x.dry) ? 'faux' : 'anthropic', usd_per_1m_input: p.input, usd_per_1m_output: p.output },
    judge: { model_id: parts[0].judge_model, same_as_answer_model: parts.some((x) => x.models.includes(x.judge_model)), prompt_path: JUDGE_PATH },
  };
  const body = {
    records, per_task: perTask(records), summary: summarize(records.filter((r) => r.model_id === defaultModel)), ingestion,
    staleness: parts.flatMap((x) => x.staleness ?? []),
    mismatch_ablation: pick('mismatch_ablation'), clusters_ablation: pick('clusters_ablation'), concurrency: pick('concurrency'),
    tier_isolation: pick('tier_isolation'), server,
  };
  return { results: { ...head, ...body, ledger: buildLedger({ ...head, ...body }) }, spent: parts.reduce((s, x) => s + x.spent_usd, 0) };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' } } });
  const out = resolve(values.out ?? new URL('./results.json', import.meta.url).pathname);
  try {
    const { results, spent } = merge(positionals.map((f) => JSON.parse(readFileSync(f, 'utf8'))));
    const v = validateResults(results);
    if (!v.ok) throw new Error(`merged results do not validate:\n${v.errors.join('\n')}`);
    writeFileSync(`${out}.tmp`, JSON.stringify(v.value, null, 2) + '\n');
    renameSync(`${out}.tmp`, out);
    console.log(`merge: wrote ${out} from ${positionals.length} partials ($${spent.toFixed(4)} spent across shards)`);
  } catch (e) {
    console.error(`merge failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
