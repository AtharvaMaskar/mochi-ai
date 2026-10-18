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

type Part = Partial<Results> & { decision_traces?: Traces; partial: true; only: string; run_at: number; seed: number; models: string[]; judge_model: string; dry: boolean; spent_usd: number };
// Arm D+trace (bench/arms/trace.ts) lives outside the frozen Results schema: carried through under its own key.
type Mode = { n: number; accuracy: number; cost_usd_mean: number; input_tokens_mean: number; output_tokens_mean: number; tool_calls_mean: number; p50_ms: number };
type Approach = Omit<Mode, 'tool_calls_mean'> & { llm_calls_mean: number; reads_mean?: number; setup_usd?: number; source?: string; staleness?: { fresh: number; stale_resurfaced?: number; of: number } };
type Traces = { summary: Record<string, Mode>; chat?: { summary: Record<string, Mode>; tasks: number }; staleness: { fresh: { D: number; 'D+trace': number; of: number }; traces_closed_by_retirement: number };
  approaches?: Record<string, Approach> };

// Learning-from-past-tickets comparison (bench/arms/lessons.ts): D and graph traces come from this run's summary, so
// the two never drift. LLM calls = tool calls + 1 for the tool loop; 2 (pick or retrieve, then answer) for the rest.
const LABEL: Record<string, string> = { D: 'D', graph_traces_warm_replay: 'graph traces (warm replay)', C: 'file memory C', C_lessons: 'C + LESSONS.md',
  devin_knowledge: 'Devin-style Knowledge (modelled on Devin\'s documented Knowledge feature, not Devin itself)', vector_lessons: 'vector lessons top-3', sql_lessons: 'SQL lessons' };
export function withApproaches(t: Traces): Traces {
  if (!t.approaches || !t.summary) return t;
  const from = (k: string, fresh: number, source: string): Approach => {
    const { tool_calls_mean, ...m } = t.summary[k];
    return { ...m, llm_calls_mean: tool_calls_mean + 1, source, staleness: { fresh, of: t.staleness.fresh.of } };
  };
  return { ...t, approaches: { D: from('D', t.staleness.fresh.D, 'decision_traces.summary.D'), graph_traces_warm_replay: from('warm_replay', t.staleness.fresh['D+trace'], 'decision_traces.summary.warm_replay'), ...t.approaches } };
}

export function traceLedgerRow(t: Traces): Results['ledger'][number] {
  if (!t.summary) return { feature: 'decision traces', mechanism: 'mochi_traces Trace/Step/Query graph', measured_against: 'arm D', result: 'not measured', status: 'not_measured' };
  const m = (k: string) => { const x = t.summary[k]; return x ? `${k} ${Math.round(x.accuracy * x.n)}/${x.n}, $${x.cost_usd_mean.toFixed(6)}/task, ${Math.round(x.input_tokens_mean)} in tok, ${x.tool_calls_mean} calls, p50 ${Math.round(x.p50_ms)}ms` : `${k} not run`; };
  const f = t.staleness.fresh;
  if (t.approaches) {
    const a = Object.entries(t.approaches).map(([k, x]) => `${LABEL[k] ?? k} ${Math.round(x.accuracy * x.n)}/${x.n}, $${x.cost_usd_mean.toFixed(6)}/task${x.setup_usd ? ` + $${x.setup_usd.toFixed(3)} dream once` : ''}, ${Math.round(x.input_tokens_mean)}/${Math.round(x.output_tokens_mean)} tok, ${x.llm_calls_mean} LLM calls, p50 ${Math.round(x.p50_ms)}ms${x.staleness ? `, fresh ${x.staleness.fresh}/${x.staleness.of}${x.staleness.stale_resurfaced !== undefined ? ` (stale resurfaced ${x.staleness.stale_resurfaced})` : ''}` : ''}`);
    return { feature: 'decision traces', mechanism: 'mochi_traces Trace/Step/Query graph, Trace.embedding vector index, SIMILAR_TO-first ticket lookup, receipts re-checked at as_of',
      measured_against: 'learning-from-past-tickets approaches on the same 40 later tickets, lessons from the same 40 earlier resolved tickets (bench/arms/lessons.ts); staleness after 10 retirements',
      result: a.join('; '), status: 'measured' };
  }
  const chat = t.chat ? `; chat on ${t.chat.tasks} paraphrased eval questions: ${['D', 'warm_replay'].map((k) => { const x = t.chat!.summary[k]; return x ? `${k} ${Math.round(x.accuracy * x.n)}/${x.n}, $${x.cost_usd_mean.toFixed(6)}/task` : `${k} not run`; }).join(' vs ')}` : '';
  return { feature: 'decision traces', mechanism: 'mochi_traces Trace/Step/Query graph, Trace.embedding vector index, SIMILAR_TO-first ticket lookup, receipts re-checked at as_of',
    measured_against: 'arm D on later unseen tickets (likely cause, what fixed similar); journal warmed on earlier resolved tickets; staleness harness after retirements',
    result: `${['D', 'cold', 'warm_hint', 'warm_replay'].map(m).join('; ')}; staleness fresh D ${f.D}/${f.of} vs D+trace ${f['D+trace']}/${f.of}, ${t.staleness.traces_closed_by_retirement} traces closed by retirement${chat}`, status: 'measured' };
}

const SINGLE = ['mismatch_ablation', 'clusters_ablation', 'concurrency', 'tier_isolation', 'server'] as const;

export function merge(parts: Part[], defaultModel = process.env.MOCHI_MODEL ?? 'claude-haiku-5-5'): { results: Results & { decision_traces?: Traces }; spent: number } {
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
  // A trace partial never moves the headline run time.
  const head = {
    run_at: Math.max(...parts.filter((x) => !x.decision_traces || parts.every((y) => y.decision_traces)).map((x) => x.run_at)), seed: parts[0].seed,
    model: { id: defaultModel, provider: parts.every((x) => x.dry) ? 'faux' : 'anthropic', usd_per_1m_input: p.input, usd_per_1m_output: p.output },
    judge: { model_id: parts[0].judge_model, same_as_answer_model: parts.some((x) => x.models.includes(x.judge_model)), prompt_path: JUDGE_PATH },
  };
  const body = {
    records, per_task: perTask(records), summary: summarize(records.filter((r) => r.model_id === defaultModel)), ingestion,
    staleness: parts.flatMap((x) => x.staleness ?? []),
    mismatch_ablation: pick('mismatch_ablation'), clusters_ablation: pick('clusters_ablation'), concurrency: pick('concurrency'),
    tier_isolation: pick('tier_isolation'), server,
  };
  // The ticket run and the optional chat run (key `chat`) are separate partials; their keys must not overlap.
  const traces = parts.flatMap((x) => (x.decision_traces ? [x.decision_traces] : []));
  if (new Set(traces.flatMap(Object.keys)).size < traces.reduce((s, t) => s + Object.keys(t).length, 0)) throw new Error('decision_traces partials overlap; give one of each');
  const dt = traces.length ? withApproaches(Object.assign({}, ...traces) as Traces) : undefined;
  const ledger = [...buildLedger({ ...head, ...body }), ...(dt ? [traceLedgerRow(dt)] : [])];
  return { results: { ...head, ...body, ledger, ...(dt ? { decision_traces: dt } : {}) }, spent: parts.reduce((s, x) => s + x.spent_usd, 0) };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' } } });
  const out = resolve(values.out ?? new URL('./results.json', import.meta.url).pathname);
  try {
    const { results, spent } = merge(positionals.map((f) => JSON.parse(readFileSync(f, 'utf8'))));
    const v = validateResults(results);
    if (!v.ok) throw new Error(`merged results do not validate:\n${v.errors.join('\n')}`);
    const extra = results.decision_traces ? { decision_traces: results.decision_traces } : {}; // the schema strips unknown keys
    writeFileSync(`${out}.tmp`, JSON.stringify({ ...v.value, ...extra }, null, 2) + '\n');
    renameSync(`${out}.tmp`, out);
    console.log(`merge: wrote ${out} from ${positionals.length} partials ($${spent.toFixed(4)} spent across shards)`);
  } catch (e) {
    console.error(`merge failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
