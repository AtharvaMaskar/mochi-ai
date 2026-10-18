// Arm D: the graph. Each question is routed to agent/queries; the prompt holds only query rows and the path.
import { GRAPH, type EvalQuestion } from '@mochi/contracts';
import { applyEvent, loadDataset, queries, runDreamNow, type Db, type QueryResult } from '../deps.ts';
import { UNINGEST } from '../cypher.ts';
import { ZERO, type Usage } from '../llm.ts';
import { ANSWER_SYSTEM, ask, timed, type Arm, type Ctx } from './index.ts';

/** A db whose selectGraph(mochi_company) lands on bench's own graph, so the brain is never touched. */
export const remap = (db: Db, to: string): Db => ({ selectGraph: (name: string) => db.selectGraph(name === GRAPH.company ? to : name) });

export function render(results: QueryResult[]): string {
  return results.map(({ card }) => {
    const path = card.path
      ? `path: ${card.path.nodes.map((n) => `(${n.label} ${n.id})`).join(' ')} ${card.path.edges.map((e) => `${e.from}-[${e.type}]->${e.to}`).join(' ')}`
      : 'path: none';
    const rows = Object.entries(card.queries).map(([id, q]) => `${id} rows: ${JSON.stringify(q.rows)}`).join('\n');
    return `## ${card.title}\n${path}\n${rows}`;
  }).join('\n\n');
}

/** Dream token usage carries no cost field; price it from the catalog so the --max-usd guard sees it. */
export function dreamUsage(ctx: Ctx, steps: { input: number; output: number }[]): Usage {
  const p = ctx.llm.model().cost;
  return steps.reduce<Usage>((u, s) => ({ input: u.input + s.input, output: u.output + s.output, cost: u.cost + (s.input * p.input + s.output * p.output) / 1e6 }), ZERO);
}

/** Loads the seed world graph unless it already exists (events only touch temporal edges). */
export async function ensureWorld(ctx: Ctx) {
  if (!(await ctx.db.list()).includes(ctx.names.world)) await loadDataset(ctx.dataset, ctx.db, { graph: ctx.names.world, fresh: true });
}

export function armD(ctx: Ctx, o: { ingest?: boolean; graph?: string } = {}): Arm & { route(q: EvalQuestion): Promise<QueryResult[]> } {
  const n = ctx.names, d = ctx.dataset, world = o.graph ?? n.world;
  const db = remap(ctx.db, world);
  const asOf = () => Math.max(Date.now(), d.generated_at);
  const ids = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));
  const tickets = ids(d.tickets), issues = ids(d.issues), customers = ids(d.customers);
  const versions = new Set(d.releases.map((r) => r.version));

  // ponytail: deterministic id routing, no LLM tool-picking. Upgrade to an LLM router if eval
  // questions stop naming the entity they ask about.
  async function route(q: EvalQuestion): Promise<QueryResult[]> {
    const found = q.question.match(/\b[A-Z]{1,4}-\d+\b|\b\d+\.\d+\.\d+\b/g) ?? [];
    const t = asOf(), calls: Promise<QueryResult>[] = [];
    for (const id of new Set(found)) {
      if (tickets.has(id)) calls.push(queries.briefing(db, { ticketId: id }, t), queries.likelyCause(db, { ticketId: id }, t));
      else if (issues.has(id)) calls.push(queries.whoKnows(db, { issueId: id }, t));
      else if (versions.has(id)) calls.push(queries.blastRadius(db, { version: id }, t));
      else if (customers.has(id)) {
        // A customer has no query of its own; brief their latest ticket (routing only, nothing enters the prompt).
        const last = d.tickets.filter((x) => x.customer_id === id).sort((a, b) => b.created_at - a.created_at)[0];
        if (last) calls.push(queries.briefing(db, { ticketId: last.id }, t));
      }
    }
    if (!calls.length) calls.push(queries.emergingClusters(db, { days: 7 }, t), queries.searchSimilar(db, { text: q.question, k: 5 }, t));
    return Promise.all(calls);
  }

  return {
    arch: 'D',
    route,
    async prepare() {
      await loadDataset(d, ctx.db, { graph: world, fresh: true });
      if (o.ingest === false) return ZERO;
      // Ingestion cost: the dream's LLM extraction over every ticket, on a throwaway copy.
      await loadDataset(d, ctx.db, { graph: n.ingest, fresh: true });
      await ctx.db.selectGraph(n.ingest).query(UNINGEST);
      const report = await runDreamNow({ db: ctx.db, model: ctx.llm.model(), graphs: { company: n.ingest, prev: n.ingestPrev, scratch: n.ingestScratch } });
      for (const g of [n.ingest, n.ingestPrev, n.ingestScratch]) await ctx.db.selectGraph(g).delete().catch(() => {});
      const u = dreamUsage(ctx, report.usage);
      ctx.llm.record('arm_d_dream', u);
      return u;
    },
    async answer(q) {
      const [results, retrieval_ms] = await timed(() => route(q));
      const r = await ctx.llm.complete('arm_d', ask(render(results), q), { system: ANSWER_SYSTEM });
      return { answer: r.text, usage: r.usage, retrieval_ms };
    },
    async apply(e) {
      const [, ms] = await timed(() => applyEvent(e, ctx.db.selectGraph(world), e.at));
      return { usage: ZERO, ms };
    },
  };
}
