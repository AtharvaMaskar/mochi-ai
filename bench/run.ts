// npm run bench [-- --dry] [--max-usd <n>] [--limit <n>] [--models a,b] [--data <dataset.json>]
// Runs every section from the seed, validates, and writes bench/results.json (dry: artifacts/results.dry.json).
// --models sweeps the main run (every arm, every question) over each model; the other sections and `summary` use the
// first. A cost-cap abort leaves results.json unchanged and writes the partial run to artifacts/results.aborted.json.
//
// Parallel shards: --only <A|B|C|D|E|staleness|mismatch|clusters|isolation|server|concurrency> --run-id <id> --out <path>
// runs one arm or section and writes a PARTIAL file (not validated). Every graph it creates is bench_<id>_*, deleted at
// the end, so shards never collide; --max-usd applies per shard. Then `node bench/merge.ts <partials...>` writes
// bench/results.json and must validate. Concurrency runs alone, after the others. From the repo root, for example:
//   for x in A B C D E; do for m in haiku sonnet; do
//     node bench/run.ts --only $x --models claude-$m-5-5 --run-id $x$m --max-usd 1.7 --out bench/artifacts/parts/$x-$m.json &
//   done; done
//   for s in staleness mismatch clusters isolation server; do
//     node bench/run.ts --only $s --run-id $s --max-usd 1.7 --out bench/artifacts/parts/$s.json &
//   done; wait
//   node bench/run.ts --only concurrency --run-id conc --max-usd 1.7 --out bench/artifacts/parts/concurrency.json
//   node bench/merge.ts bench/artifacts/parts/*.json
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { validateResults, type Results } from '@mochi/contracts';
import { readData } from './deps.ts';
import { createLlm, CostCapError, catalogModel, type Reply } from './llm.ts';
import { connect } from './db.ts';
import { names, type Ctx } from './arms/index.ts';
import { armA } from './arms/a.ts';
import { armB } from './arms/b.ts';
import { armC } from './arms/c.ts';
import { armD, ensureWorld } from './arms/d.ts';
import { armE } from './arms/e.ts';
import { JUDGE_PATH, type Vote } from './score.ts';
import { perTask, runMain, type CostRow } from './runs/main.ts';
import { runStaleness } from './runs/staleness.ts';
import { runAblation } from './runs/ablation.ts';
import { runClusters } from './runs/clusters.ts';
import { runConcurrency } from './runs/concurrency.ts';
import { runIsolation } from './runs/isolation.ts';
import { resetSlowlog, runServer } from './runs/server.ts';
import { buildLedger } from './ledger.ts';
import { PRICES } from './prices.ts';

export const SECTIONS = ['main', 'staleness', 'ablation', 'clusters', 'concurrency', 'isolation', 'server'] as const;
type Section = (typeof SECTIONS)[number];
const ARMS = { A: armA, B: armB, C: armC, D: (c: Ctx) => armD(c), E: armE } as const;
type ArmId = keyof typeof ARMS;
/** --only values: one arm (a main-run shard) or one section; 'mismatch' is the ablation section. */
export const ONLY = ['A', 'B', 'C', 'D', 'E', 'staleness', 'mismatch', 'clusters', 'concurrency', 'isolation', 'server'] as const;
export const sectionOf = (only: string): Section => (only in ARMS ? 'main' : only === 'mismatch' ? 'ablation' : only as Section);
export const FIELDS_OF = (only: string) => FIELDS[sectionOf(only)];
type Body = Omit<Results, 'run_at' | 'seed' | 'model' | 'judge' | 'ledger'>;

const EMPTY: Body = {
  records: [], per_task: [], summary: {}, ingestion: [], staleness: [], mismatch_ablation: null, concurrency: null, clusters_ablation: null,
  tier_isolation: null, server: { thread_count: 0, max_queued_queries: 0, node_count: 0, edge_count: 0, memory_mb: 0, slowlog_top: [] },
};
const FIELDS: Record<Section, (keyof Body)[]> = {
  main: ['records', 'per_task', 'summary', 'ingestion'], staleness: ['staleness'], ablation: ['mismatch_ablation'], clusters: ['clusters_ablation'],
  concurrency: ['concurrency'], isolation: ['tier_isolation'], server: ['server'],
};

const HERE = new URL('.', import.meta.url).pathname;

/** --limit n: at most n questions per arm, round-robin over buckets; staleness replays only their events. */
export function limited(d: Awaited<ReturnType<typeof readData>>, n: number): Awaited<ReturnType<typeof readData>> {
  const buckets = ['single_fact', 'multi_hop', 'structural'].map((b) => d.eval.questions.filter((q) => q.bucket === b));
  const questions = [];
  for (let i = 0; questions.length < n && buckets.some((b) => i < b.length); i++)
    for (const b of buckets) if (b[i] && questions.length < n) questions.push(b[i]);
  const events = new Set(questions.flatMap((q) => (q.after_event ? [q.after_event] : [])));
  return {
    dataset: { ...d.dataset, contradiction_events: d.dataset.contradiction_events.filter((e) => events.has(e.id)) },
    eval: { ...d.eval, questions },
  };
}

export type BenchOpts = {
  only?: (typeof ONLY)[number]; runId?: string; dry: boolean; maxUsd: number; limit?: number; prefix?: string; out?: string; artifacts?: string; reply?: Reply;
  models?: string[]; data?: string; /** tests: an in-memory dataset + eval instead of --data */ input?: Awaited<ReturnType<typeof readData>>;
};

export async function bench(o: BenchOpts): Promise<Results> {
  // A --limit run is a cheap end-to-end check: its figures are never published.
  const out = o.out ?? (o.only ? join(HERE, 'artifacts/parts', `${o.only}-${o.runId ?? 'x'}.json`) : o.limit ? join(HERE, 'artifacts/results.limited.json') : o.dry ? join(HERE, 'artifacts/results.dry.json') : join(HERE, 'results.json'));
  if ((o.dry || o.limit) && out === join(HERE, 'results.json')) throw new Error('--dry / --limit never overwrites bench/results.json');
  const artifacts = o.artifacts ?? join(HERE, o.limit ? 'artifacts/limited' : o.dry ? 'artifacts/dry' : 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  mkdirSync(dirname(out), { recursive: true });
  if (o.only && !o.runId && !o.prefix) throw new Error('--only needs --run-id, so its graphs cannot collide with another shard');
  const prefix = o.prefix ?? (o.runId ? `bench_${o.runId}` : 'bench');
  const base: Body = { ...EMPTY };
  const arms = (o.only && o.only in ARMS ? [o.only as ArmId] : Object.keys(ARMS) as ArmId[]);

  const llm = createLlm({ dry: o.dry, maxUsd: o.maxUsd, reply: o.reply, models: o.models });
  const models = o.models?.length ? o.models : [llm.defaultModel];
  for (const m of [...models, llm.judgeModel]) if (!PRICES[m]) throw new Error(`no published price for ${m} in bench/prices.ts`);
  llm.use(models[0]);
  const data = o.input ?? await readData(o.data);
  const { dataset, eval: ev } = o.limit ? limited(data, o.limit) : data;
  const db = await connect();
  const ctx: Ctx = { llm, db, dataset, names: names(prefix), artifacts };
  const n = ctx.names, votes: Vote[] = [], costs: CostRow[] = [], sink: Body['records'] = [];

  const run: Record<Section, () => Promise<Partial<Body>>> = {
    main: async () => {
      await resetSlowlog(db, n.world);
      return runMain({ llm, arms: arms.map((a) => ARMS[a](ctx)), eval: ev, events: dataset.contradiction_events, votes, models, costs, sink });
    },
    staleness: () => runStaleness({ llm, arms: [armC(ctx), armD(ctx, { ingest: false, graph: n.stale }), armE(ctx)], dataset, eval: ev, votes, artifacts }),
    ablation: () => runAblation(ctx, ev),
    clusters: () => runClusters(ctx),
    concurrency: () => runConcurrency(ctx),
    isolation: () => runIsolation(),
    server: async () => { await ensureWorld(ctx); return runServer(db, n.world); },
  };

  try {
    for (const s of o.only ? [sectionOf(o.only)] : SECTIONS) {
      try {
        Object.assign(base, await run[s]());
        console.log(`bench: ${s} done ($${llm.spent().toFixed(4)} so far)`);
      } catch (e) {
        if (e instanceof CostCapError) {
          // The abort marker: partial figures go to an artifact that never validates (no ledger), not to results.json.
          const partial = { aborted: true, reason: e.message, section: s, spent_usd: llm.spent(), ...base, records: [...base.records, ...sink.filter((r) => !base.records.includes(r))] };
          writeFileSync(join(artifacts, 'results.aborted.json'), JSON.stringify({ ...partial, per_task: perTask(partial.records) }, null, 2));
          throw e;
        }
        // A failed section is written as not measured, never as a guess.
        console.error(`bench: ${s} failed, recorded as not measured: ${(e as Error).stack ?? e}`);
        for (const k of FIELDS[s]) (base as any)[k] = EMPTY[k];
      }
    }
  } finally {
    for (const g of await db.list()) if (g.startsWith(`${prefix}_`) || g.startsWith(`user_${prefix}_`)) await db.selectGraph(g).delete().catch(() => {});
    await db.close();
  }

  // pi_cost_usd is pi-ai's own catalog pricing, kept only as a cross-check of spent_usd (bench/prices.ts).
  writeFileSync(join(artifacts, 'usage.json'), JSON.stringify({ spent_usd: llm.spent(), pi_cost_usd: llm.piCost(), models, by_caller: llm.byCaller, cache_tokens_by_caller: llm.cacheByCaller }, null, 2));
  if (votes.length) writeFileSync(join(artifacts, 'votes.json'), JSON.stringify(votes, null, 2));
  if (costs.length) writeFileSync(join(artifacts, 'costs.json'), JSON.stringify(costs, null, 2));
  if (o.only) {
    // A shard: only its section's fields, for merge.ts. Not validated on its own.
    const part = { partial: true, only: o.only, run_id: o.runId, run_at: Date.now(), seed: dataset.seed, models, judge_model: llm.judgeModel, dry: o.dry,
      spent_usd: llm.spent(), ...Object.fromEntries(FIELDS_OF(o.only).map((k) => [k, base[k]])) };
    writeFileSync(out, JSON.stringify(part, null, 2) + '\n');
    console.log(`bench: wrote partial ${out} ($${llm.spent().toFixed(4)} spent)`);
    return part as unknown as Results;
  }

  const m = catalogModel(models[0]);
  const head = {
    run_at: Date.now(), seed: dataset.seed,
    model: { id: models[0], provider: o.dry ? 'faux' : m.provider, usd_per_1m_input: PRICES[models[0]].input, usd_per_1m_output: PRICES[models[0]].output },
    judge: { model_id: llm.judgeModel, same_as_answer_model: models.includes(llm.judgeModel), prompt_path: JUDGE_PATH },
  };
  const results: Results = { ...head, ...base, ledger: buildLedger({ ...head, ...base }) };
  const v = validateResults(results);
  if (!v.ok) throw new Error(`results do not validate:\n${v.errors.join('\n')}`);
  writeFileSync(`${out}.tmp`, JSON.stringify(v.value, null, 2) + '\n');
  renameSync(`${out}.tmp`, out);
  console.log(`bench: wrote ${out} ($${llm.spent().toFixed(4)} spent)`);
  return v.value;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: {
    only: { type: 'string' }, 'run-id': { type: 'string' }, out: { type: 'string' }, dry: { type: 'boolean' }, 'max-usd': { type: 'string' }, limit: { type: 'string' }, models: { type: 'string' }, data: { type: 'string' },
  } });
  // From the repo root, `npm run bench -- --dry` reaches the inner `npm run -w bench` as npm's own
  // flags (--dry becomes --dry-run), so read them back from npm's environment.
  const npm = (k: string) => process.env[`npm_config_${k}`];
  values.dry ??= npm('dry_run') === 'true';
  values['max-usd'] ??= npm('max_usd') ?? '25';
  const only = (values.only ?? npm('only')) as BenchOpts['only'];
  if (only && !(ONLY as readonly string[]).includes(only)) { console.error(`--only must be one of ${ONLY.join(', ')}`); process.exit(2); }
  const runId = values['run-id'] ?? npm('run_id'), outArg = values.out ?? npm('out');
  if (runId && !/^[a-z0-9]+$/i.test(runId)) { console.error('--run-id must be alphanumeric'); process.exit(2); }
  const maxUsd = Number(values['max-usd']);
  if (!(maxUsd >= 0)) { console.error('--max-usd must be a number >= 0'); process.exit(2); }
  const limit = values.limit ?? npm('limit');
  if (limit !== undefined && !(Number(limit) >= 1)) { console.error('--limit must be a number >= 1'); process.exit(2); }
  const models = (values.models ?? npm('models'))?.split(',').map((x) => x.trim()).filter(Boolean);
  const data = values.data ?? npm('data');
  const cwd = process.env.INIT_CWD ?? process.cwd();
  // Each shard keeps its own artifacts dir, so parallel shards never overwrite each other's usage/votes.
  const shard = runId ? { runId, artifacts: join(HERE, 'artifacts/shards', runId) } : {};
  bench({ only, ...shard, ...(outArg ? { out: resolve(cwd, outArg) } : {}), dry: values.dry!, maxUsd, limit: limit === undefined ? undefined : Number(limit), models, data: data && resolve(cwd, data) }).then(() => process.exit(0), (e) => {
    console.error(e instanceof CostCapError ? `bench aborted: ${e.message}; results unchanged, partial run in artifacts/results.aborted.json` : `bench failed: ${(e as Error).message}`);
    process.exit(1);
  });
}
