// Concurrency while dreaming: N parallel briefing readers on a scratch copy (bench_concurrency, admin
// user, disclosed) while the dream and applyEvent write to it. Single-container behaviour, not a
// scalability claim.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Results } from '@mochi/contracts';
import { applyEvent, queries, runDreamNow } from '../deps.ts';
import { LIVE_PLANS, PER_USER_WRITE, TORN_BATCHES, UNINGEST } from '../cypher.ts';
import { remap, dreamUsage, ensureWorld } from '../arms/d.ts';
import type { Ctx } from '../arms/index.ts';
import { pct } from './main.ts';
import { connect } from '../db.ts';

export const NS = [1, 5, 10, 25];
const MIN_MS = 2000;
const PER_USER_N = 10;

/** GRAPH.COPY forks; it fails while another fork (a save, another copy) runs, so retry briefly. */
async function copy(ctx: Ctx, from: string, to: string) {
  for (let i = 0; ; i++) {
    try { return await ctx.db.selectGraph(from).copy(to); }
    catch (e) { if (i >= 40 || !/could not fork/.test(String(e))) throw e; await new Promise((r) => setTimeout(r, 250)); }
  }
}

/** Readers loop briefings (one connection each) until `stop` resolves and MIN_MS has passed. */
async function readers(ctx: Ctx, n: number, graph: string, stop: Promise<unknown>, check: boolean) {
  const conns = await Promise.all(Array.from({ length: n }, () => connect()));
  const ids = ctx.dataset.tickets.map((t) => t.id);
  const planIds = [...new Set(ctx.dataset.contradiction_events.flatMap((e) => (e.kind === 'plan_change' ? [e.customer_id] : [])))];
  let done = false;
  const t0 = performance.now();
  void Promise.allSettled([stop, new Promise((r) => setTimeout(r, MIN_MS))]).then(() => { done = true; });
  const lat: number[] = [];
  let torn = 0;
  await Promise.all(conns.map(async (c, i) => {
    const db = remap(c, graph), g = c.selectGraph(graph);
    for (let k = i; !done; k++) {
      const s = performance.now();
      await queries.briefing(db, { ticketId: ids[k % ids.length] }, Date.now());
      lat.push(performance.now() - s);
      if (check) {
        const a = (await g.roQuery<{ torn: number }>(TORN_BATCHES)).data?.[0]?.torn ?? 0;
        const b = (await g.roQuery<{ torn: number }>(LIVE_PLANS, { params: { ids: planIds, as_of: Date.now() } })).data?.[0]?.torn ?? 0;
        torn += a + b;
      }
    }
  }));
  const wall = (performance.now() - t0) / 1000;
  await Promise.all(conns.map((c) => c.close()));
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { n, p50_ms: r2(pct(lat, 50)), p95_ms: r2(pct(lat, 95)), throughput_per_s: r2(lat.length / wall), torn_reads: torn };
}

export async function runConcurrency(ctx: Ctx): Promise<Pick<Results, 'concurrency'>> {
  const n = ctx.names, d = ctx.dataset;
  const info: unknown[] = [];
  const sampler = setInterval(() => { ctx.db.info().then((x) => info.push({ t: Date.now(), info: x }), () => {}); }, 100);
  const runs: NonNullable<Results['concurrency']>['runs'] = [];
  try {
    await ensureWorld(ctx);
    for (const N of NS) {
      // Fresh scratch copy per N, every ticket un-ingested, so the dream has a real write phase.
      await ctx.db.selectGraph(n.conc).delete().catch(() => {});
      await copy(ctx, n.world, n.conc);
      await ctx.db.selectGraph(n.conc).query(UNINGEST);
      const writer = (async () => {
        const report = await runDreamNow({ db: ctx.db, model: ctx.llm.model(), graphs: { company: n.conc, prev: n.concPrev, scratch: n.concScratch } });
        ctx.llm.record('concurrency_dream', dreamUsage(ctx, report.usage));
        for (const e of d.contradiction_events) await applyEvent(e, ctx.db.selectGraph(n.conc), e.at);
      })();
      const [r] = await Promise.all([readers(ctx, N, n.conc, writer, true), writer]);
      runs.push(r);
    }
    // Second pass: PER_USER_N writers into the one graph vs spread across user_* graphs, readers on the one graph.
    const pass = async (target: (i: number) => string) => {
      let stop = false;
      const w = Promise.all(Array.from({ length: PER_USER_N }, async (_, i) => {
        for (let k = 0; !stop; k++) await ctx.db.selectGraph(target(i)).query(PER_USER_WRITE, { params: { id: `bench-${i}-${k}`, now: Date.now() } });
      }));
      const r = await readers(ctx, PER_USER_N, n.conc, new Promise((res) => setTimeout(res, MIN_MS)), false);
      stop = true;
      await w;
      return { p50_ms: r.p50_ms, p95_ms: r.p95_ms };
    };
    const isolation = { one_graph: await pass(() => n.conc), per_user: await pass(n.user) };
    return { concurrency: { runs, isolation } };
  } finally {
    clearInterval(sampler);
    writeFileSync(join(ctx.artifacts, 'graph_info.json'), JSON.stringify(info));
    for (const g of [n.conc, n.concPrev, n.concScratch, ...Array.from({ length: PER_USER_N }, (_, i) => n.user(i))])
      await ctx.db.selectGraph(g).delete().catch(() => {});
  }
}
