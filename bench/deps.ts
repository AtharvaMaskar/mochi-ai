// The one seam to other slices (design decision 2): real gen, agent/queries and agent/dream, re-exported with
// bench's view of their signatures. The dream's model goes through bench's LLM wrapper (dreamModel), so its
// tokens count against --max-usd and --dry stays on the faux provider.
import { readFileSync } from 'node:fs';
import type { FalkorDB } from 'falkordb';
import { validateDataset, validateEval, type Dataset, type Eval } from '@mochi/contracts';
import * as Q from '../agent/queries/index.ts';
import { runDreamNow as dreamNow, runMismatchRules as rules, type DreamGraphs as Graphs, type DreamModel, type DreamReport } from '../agent/dream/index.ts';
import { CostCapError, type Llm } from './llm.ts';

export { loadDataset, applyEvent, embed, EMBED_DIM } from '@mochi/gen';
export { READ_TOOL_SPECS } from '../agent/queries/tools.ts';
export type { DreamReport } from '../agent/dream/index.ts';

export type Db = Pick<FalkorDB, 'selectGraph'>;
export type DreamGraphs = Partial<Graphs>;
export type QueryResult = Q.Result;
export type MismatchEdge = { type: 'CONTRADICTS' | 'UNDOCUMENTED'; kb_id: string | null; area: string };

const read = (f: string) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));

export async function readData(): Promise<{ dataset: Dataset; eval: Eval }> {
  const d = validateDataset(read('dataset.json'));
  if (!d.ok) throw new Error(`data/dataset.json invalid: ${d.errors.slice(0, 3).join('; ')}`);
  const e = validateEval(read('eval.json'), d.value);
  if (!e.ok) throw new Error(`data/eval.json invalid: ${e.errors.slice(0, 3).join('; ')}`);
  return { dataset: d.value, eval: e.value };
}

export const queries = {
  briefing: (db: Db, a: { ticketId: string }, t: number) => Q.briefing(db, a, t),
  likelyCause: (db: Db, a: { ticketId: string }, t: number) => Q.likelyCause(db, a, t),
  whoKnows: (db: Db, a: { issueId: string }, t: number) => Q.whoKnows(db, a, t),
  emergingClusters: (db: Db, a: { days: number }, t: number) => Q.emergingClusters(db, a, t),
  blastRadius: (db: Db, a: { version: string }, t: number) => Q.blastRadius(db, a, t),
  searchSimilar: (db: Db, a: { text: string; k: number }, t: number) => Q.searchSimilar(db, a, t),
};

/** The dream's {models, model}, with every call routed through bench's wrapper under `caller`. */
export function dreamModel(llm: Llm, caller: string): DreamModel {
  const complete = async (_m: unknown, ctx: { systemPrompt?: string; messages: { content: unknown }[] }, o?: { maxTokens?: number }) => {
    const last = ctx.messages.at(-1)?.content;
    const prompt = typeof last === 'string' ? last : JSON.stringify(last);
    try {
      const r = await llm.complete(caller, prompt, { system: ctx.systemPrompt, maxTokens: o?.maxTokens });
      return { content: [{ type: 'text', text: r.text }], usage: { input: r.usage.input, output: r.usage.output }, stopReason: 'stop' };
    } catch (e) {
      if (e instanceof CostCapError) throw e;
      // A failed call is the dream's "error" stop: extraction drops the batch, prose falls back to the template.
      return { content: [], usage: { input: 0, output: 0 }, stopReason: 'error', errorMessage: String(e) };
    }
  };
  return { models: { complete } as unknown as DreamModel['models'], model: llm.model() };
}

/** One dream pass on bench graphs: no team graphs are read, and events are applied only when given. */
export function runDreamNow(o: { db: FalkorDB; llm: Llm; caller: string; graphs: DreamGraphs; as_of?: number; events?: Parameters<typeof dreamNow>[0]['events'] }): Promise<DreamReport> {
  return dreamNow({ db: o.db, as_of: o.as_of, model: dreamModel(o.llm, o.caller), graphs: { ...o.graphs, teams: [] }, events: o.events ?? [] });
}

/** The graph's mismatch rules, as ablation findings (KB id for CONTRADICTS, area for UNDOCUMENTED). */
export async function runMismatchRules(db: FalkorDB, graphs: DreamGraphs, as_of?: number): Promise<MismatchEdge[]> {
  const r = await rules(db, graphs, { as_of });
  return r.edges.map((e) => ({ type: e.type, kb_id: e.type === 'CONTRADICTS' ? e.target : null, area: e.area }));
}
