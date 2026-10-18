// Arm D: the graph. The answer model calls agent-core's read tools; the prompt holds only query rows and the path.
import type { AssistantMessage, Message, Tool, ToolCall } from '@earendil-works/pi-ai';
import { GRAPH, type EvalQuestion } from '@mochi/contracts';
import { applyEvent, loadDataset, READ_TOOL_SPECS, runDreamNow, type Db, type QueryResult } from '../deps.ts';
import { UNINGEST } from '../cypher.ts';
import { add, ZERO, type Usage } from '../llm.ts';
import { ANSWER_SYSTEM, timed, type Arm, type Ctx } from './index.ts';

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

/**
 * The world as the product has it: the seed load, then one dream pass that LLM-ingests the demo day (the loader
 * leaves those tickets without ABOUT). Events are withheld; main and staleness replay them. Skipped if it exists.
 */
export async function ensureWorld(ctx: Ctx, graph = ctx.names.world, fresh = false) {
  if (!fresh && (await ctx.db.list()).includes(graph)) return;
  await loadDataset(ctx.dataset, ctx.db, { graph, fresh: true });
  const graphs = { company: graph, prev: `${graph}_prev`, scratch: `${graph}_scratch` };
  await runDreamNow({ db: ctx.db, llm: ctx.llm, caller: 'world_dream', graphs });
  for (const g of [graphs.prev, graphs.scratch]) await ctx.db.selectGraph(g).delete().catch(() => {});
}

const TOOL_SYSTEM = `${ANSWER_SYSTEM} Look the answer up in the company graph with the tools first; ids in the question name what to look up.`;
const ROUNDS = 3;

const textOf = (m: AssistantMessage) => m.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('').trim();

/** The one tool-calling loop arms D and E share: up to ROUNDS tool rounds, then an answer; every round's tokens count. */
export async function toolLoop(ctx: Ctx, caller: string, system: string, tools: Tool[], q: EvalQuestion, run: (name: string, args: any) => Promise<string>) {
  const messages: Message[] = [{ role: 'user', content: q.question, timestamp: Date.now() }];
  let usage = ZERO, retrieval_ms = 0;
  const calls: string[] = [];
  for (let round = 0; ; round++) {
    const last = round === ROUNDS; // the final round offers no tools, so the model must answer
    const r = await ctx.llm.turn(caller, { systemPrompt: system, messages, ...(last ? {} : { tools }) });
    usage = add(usage, r.usage);
    messages.push(r.msg);
    const wanted = r.msg.content.filter((c): c is ToolCall => c.type === 'toolCall');
    if (!wanted.length || last) return { answer: textOf(r.msg), usage, retrieval_ms, calls };
    for (const c of wanted) {
      calls.push(`${c.name}(${JSON.stringify(c.arguments)})`);
      let isError = false;
      const [out, ms] = await timed(async () => {
        try { return await run(c.name, c.arguments); } catch (e) { isError = true; return `error: ${(e as Error).message}`; }
      });
      retrieval_ms += ms;
      messages.push({ role: 'toolResult', toolCallId: c.id, toolName: c.name, content: [{ type: 'text', text: out }], isError, timestamp: Date.now() } as Message);
    }
  }
}

export function armD(ctx: Ctx, o: { ingest?: boolean; graph?: string } = {}): Arm & { tools(q: EvalQuestion): Promise<{ answer: string; usage: Usage; retrieval_ms: number; calls: string[] }> } {
  const n = ctx.names, d = ctx.dataset, world = o.graph ?? n.world;
  const db = remap(ctx.db, world);
  const asOf = () => Math.max(Date.now(), d.generated_at);
  const specs = new Map<string, (typeof READ_TOOL_SPECS)[number]>(READ_TOOL_SPECS.map((s) => [s.name, s]));
  const tools: Tool[] = READ_TOOL_SPECS.map(({ name, description, parameters }) => ({ name, description, parameters }));

  // pi-ai tool calling over the same read tools agent-core exposes.
  const loop = (q: EvalQuestion) => toolLoop(ctx, 'arm_d', TOOL_SYSTEM, tools, q, async (name, args) => {
    const spec = specs.get(name);
    return spec ? render([await spec.run(db, args, asOf(), GRAPH.company)]) : `unknown tool ${name}`;
  });

  return {
    arch: 'D',
    tools: loop,
    async prepare() {
      await ensureWorld(ctx, world, true);
      if (o.ingest === false) return ZERO;
      // Ingestion cost (SPEC §3): the dream's LLM extraction over every ticket, on a throwaway copy.
      await loadDataset(d, ctx.db, { graph: n.ingest, fresh: true });
      await ctx.db.selectGraph(n.ingest).query(UNINGEST);
      const before = ctx.llm.byCaller.arm_d_dream ?? ZERO;
      await runDreamNow({ db: ctx.db, llm: ctx.llm, caller: 'arm_d_dream', graphs: { company: n.ingest, prev: n.ingestPrev, scratch: n.ingestScratch } });
      for (const g of [n.ingest, n.ingestPrev, n.ingestScratch]) await ctx.db.selectGraph(g).delete().catch(() => {});
      const after = ctx.llm.byCaller.arm_d_dream ?? ZERO;
      return { input: after.input - before.input, output: after.output - before.output, cost: after.cost - before.cost, uncached: (after.uncached ?? after.cost) - (before.uncached ?? before.cost) };
    },
    async answer(q) {
      const r = await loop(q);
      return { answer: r.answer, usage: r.usage, retrieval_ms: r.retrieval_ms };
    },
    async apply(e) {
      const [, ms] = await timed(() => applyEvent(e, ctx.db.selectGraph(world), e.at));
      return { usage: ZERO, ms };
    },
  };
}
