// npm run bench [-- --only <run>] [--dry] [--max-usd <n>]
// Runs every section from the seed, validates, and writes bench/results.json (dry: artifacts/results.dry.json).
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { validateResults, type Results } from '@mochi/contracts';
import { readData } from './deps.ts';
import { createLlm, CostCapError, catalogModel } from './llm.ts';
import { connect } from './db.ts';
import { names, type Ctx } from './arms/index.ts';
import { armA } from './arms/a.ts';
import { armB } from './arms/b.ts';
import { armC } from './arms/c.ts';
import { armD, ensureWorld } from './arms/d.ts';
import { JUDGE_PATH, type Vote } from './score.ts';
import { runMain } from './runs/main.ts';
import { runStaleness } from './runs/staleness.ts';
import { runAblation } from './runs/ablation.ts';
import { runClusters } from './runs/clusters.ts';
import { runConcurrency } from './runs/concurrency.ts';
import { runIsolation } from './runs/isolation.ts';
import { resetSlowlog, runServer } from './runs/server.ts';
import { buildLedger } from './ledger.ts';

export const SECTIONS = ['main', 'staleness', 'ablation', 'clusters', 'concurrency', 'isolation', 'server'] as const;
type Section = (typeof SECTIONS)[number];
type Body = Omit<Results, 'run_at' | 'seed' | 'model' | 'judge' | 'ledger'>;

const EMPTY: Body = {
  records: [], summary: {}, ingestion: [], staleness: [], mismatch_ablation: null, concurrency: null, clusters_ablation: null,
  tier_isolation: null, server: { thread_count: 0, max_queued_queries: 0, node_count: 0, edge_count: 0, memory_mb: 0, slowlog_top: [] },
};
const FIELDS: Record<Section, (keyof Body)[]> = {
  main: ['records', 'summary', 'ingestion'], staleness: ['staleness'], ablation: ['mismatch_ablation'], clusters: ['clusters_ablation'],
  concurrency: ['concurrency'], isolation: ['tier_isolation'], server: ['server'],
};

const HERE = new URL('.', import.meta.url).pathname;

export type BenchOpts = { only?: Section; dry: boolean; maxUsd: number; prefix?: string; out?: string; artifacts?: string; reply?: (p: string, s: string) => string };

export async function bench(o: BenchOpts): Promise<Results> {
  const out = o.out ?? (o.dry ? join(HERE, 'artifacts/results.dry.json') : join(HERE, 'results.json'));
  if (o.dry && out === join(HERE, 'results.json')) throw new Error('--dry never overwrites bench/results.json');
  const artifacts = o.artifacts ?? join(HERE, o.dry ? 'artifacts/dry' : 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  const prefix = o.prefix ?? 'bench';

  const base: Body = { ...EMPTY };
  if (o.only) {
    if (!existsSync(out)) throw new Error(`--only ${o.only}: no existing ${out} to merge into; run the full bench first`);
    const prev = JSON.parse(readFileSync(out, 'utf8'));
    for (const k of Object.keys(EMPTY) as (keyof Body)[]) (base as any)[k] = prev[k] ?? EMPTY[k];
  }

  const llm = createLlm({ dry: o.dry, maxUsd: o.maxUsd, reply: o.reply });
  const { dataset, eval: ev } = await readData();
  const db = await connect();
  const ctx: Ctx = { llm, db, dataset, names: names(prefix), artifacts };
  const n = ctx.names, votes: Vote[] = [];

  const run: Record<Section, () => Promise<Partial<Body>>> = {
    main: async () => {
      await resetSlowlog(db, n.world);
      return runMain({ llm, arms: [armA(ctx), armB(ctx), armC(ctx), armD(ctx)], eval: ev, events: dataset.contradiction_events, votes });
    },
    staleness: () => runStaleness({ llm, arms: [armC(ctx), armD(ctx, { ingest: false, graph: n.stale })], dataset, eval: ev, votes, artifacts }),
    ablation: () => runAblation(ctx, ev),
    clusters: () => runClusters(ctx),
    concurrency: () => runConcurrency(ctx),
    isolation: () => runIsolation(),
    server: async () => { await ensureWorld(ctx); return runServer(db, n.world); },
  };

  try {
    for (const s of o.only ? [o.only] : SECTIONS) {
      try {
        Object.assign(base, await run[s]());
        console.log(`bench: ${s} done ($${llm.spent().toFixed(4)} so far)`);
      } catch (e) {
        if (e instanceof CostCapError) throw e;
        // A failed section is written as not measured, never as a guess.
        console.error(`bench: ${s} failed, recorded as not measured: ${(e as Error).stack ?? e}`);
        for (const k of FIELDS[s]) (base as any)[k] = EMPTY[k];
      }
    }
  } finally {
    for (const g of await db.list()) if (g.startsWith(`${prefix}_`) || g.startsWith(`user_${prefix}_`)) await db.selectGraph(g).delete().catch(() => {});
    await db.close();
  }

  const m = catalogModel(llm.answerModel);
  const results: Results = {
    run_at: Date.now(), seed: dataset.seed,
    model: { id: llm.answerModel, provider: o.dry ? 'faux' : m.provider, usd_per_1m_input: m.cost.input, usd_per_1m_output: m.cost.output },
    judge: { model_id: llm.judgeModel, same_as_answer_model: llm.judgeModel === llm.answerModel, prompt_path: JUDGE_PATH },
    ...base, ledger: buildLedger(base as Omit<Results, 'ledger'>),
  };
  const v = validateResults(results);
  if (!v.ok) throw new Error(`results do not validate:\n${v.errors.join('\n')}`);
  if (votes.length || !o.only) writeFileSync(join(artifacts, 'votes.json'), JSON.stringify(votes, null, 2));
  writeFileSync(join(artifacts, 'usage.json'), JSON.stringify({ spent_usd: llm.spent(), by_caller: llm.byCaller }, null, 2));
  writeFileSync(`${out}.tmp`, JSON.stringify(v.value, null, 2) + '\n');
  renameSync(`${out}.tmp`, out);
  console.log(`bench: wrote ${out} ($${llm.spent().toFixed(4)} spent)`);
  return v.value;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { only: { type: 'string' }, dry: { type: 'boolean' }, 'max-usd': { type: 'string' } } });
  // From the repo root, `npm run bench -- --dry` reaches the inner `npm run -w bench` as npm's own
  // flags (--dry becomes --dry-run), so read them back from npm's environment.
  const npm = (k: string) => process.env[`npm_config_${k}`];
  values.dry ??= npm('dry_run') === 'true';
  values['max-usd'] ??= npm('max_usd') ?? '5';
  const only = (values.only ?? npm('only')) as Section | undefined;
  if (only && !SECTIONS.includes(only)) { console.error(`--only must be one of ${SECTIONS.join(', ')}`); process.exit(2); }
  const maxUsd = Number(values['max-usd']);
  if (!(maxUsd >= 0)) { console.error('--max-usd must be a number >= 0'); process.exit(2); }
  bench({ only, dry: values.dry!, maxUsd }).then(() => process.exit(0), (e) => {
    console.error(e instanceof CostCapError ? `bench aborted: ${e.message}; results unchanged` : `bench failed: ${(e as Error).message}`);
    process.exit(1);
  });
}
