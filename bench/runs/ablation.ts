// Mismatch ablation: the graph's deterministic rules vs an LLM given every doc and ticket as text,
// scored against the planted mismatches (match on kb_id, or on area for undocumented ones).
import type { Eval, PlantedMismatch, Results } from '@mochi/contracts';
import { loadDataset, runDreamNow, runMismatchRules, type MismatchEdge } from '../deps.ts';
import { corpus, type Ctx } from '../arms/index.ts';
import { dreamUsage } from '../arms/d.ts';

type Finding = { kind: 'contradicts' | 'undocumented'; kb_id: string | null; area: string };

export function scoreFindings(planted: PlantedMismatch[], found: Finding[]) {
  const hit = (p: PlantedMismatch, f: Finding) =>
    p.kind === f.kind && (p.kind === 'contradicts' ? p.kb_id === f.kb_id : p.area === f.area);
  const matched = planted.filter((p) => found.some((f) => hit(p, f))).length;
  return { found: matched, missed: planted.length - matched, hallucinated: found.filter((f) => !planted.some((p) => hit(p, f))).length };
}

/** First JSON array in a model reply; [] when there is none. */
export function jsonArray(text: string): unknown[] {
  const m = text.match(/\[[\s\S]*\]/);
  try { const v = m ? JSON.parse(m[0]) : []; return Array.isArray(v) ? v : []; } catch { return []; }
}

const PROMPT = 'Below are the KB articles (doctrine) and the support tickets (practice) of a fictional broker. Find every place '
  + 'where practice contradicts doctrine (for example, measured resolution time far above the promised TAT, or steps that differ), '
  + 'and every repeated workaround that no KB article documents. Reply with only a JSON array of '
  + '{"kind":"contradicts"|"undocumented","kb_id":"<KB id or null>","area":"<product area>"}.';

export async function runAblation(ctx: Ctx, ev: Eval): Promise<Pick<Results, 'mismatch_ablation'>> {
  const n = ctx.names, graphs = { company: n.ablation, prev: n.ablationPrev, scratch: n.ablationScratch };
  // The rules read ObservedPatterns, which the dream's practice step writes: one dream pass on a fresh load first.
  await loadDataset(ctx.dataset, ctx.db, { graph: n.ablation, fresh: true });
  const report = await runDreamNow({ db: ctx.db, model: ctx.llm.model(), graphs });
  const spent = dreamUsage(ctx, report.usage);
  ctx.llm.record('ablation_dream', spent);
  const edges: MismatchEdge[] = await runMismatchRules(ctx.db, graphs);
  for (const g of Object.values(graphs)) await ctx.db.selectGraph(g).delete().catch(() => {});
  // Rules use no LLM; the tokens are that dream pass's, so the graph side is not shown as free.
  const graph = { ...scoreFindings(ev.planted_mismatches, edges.map((e) => ({ kind: e.type === 'CONTRADICTS' ? 'contradicts' as const : 'undocumented' as const, kb_id: e.kb_id, area: e.area }))), tokens: spent.input + spent.output };
  const r = await ctx.llm.complete('ablation_llm', `${PROMPT}\n\n${corpus(ctx.dataset)}`, { maxTokens: 4096 });
  const found = jsonArray(r.text).flatMap((x: any) =>
    x && (x.kind === 'contradicts' || x.kind === 'undocumented') ? [{ kind: x.kind, kb_id: typeof x.kb_id === 'string' ? x.kb_id : null, area: String(x.area ?? '') }] : []);
  const llm = { ...scoreFindings(ev.planted_mismatches, found), tokens: r.usage.input + r.usage.output };
  return { mismatch_ablation: { graph, llm } };
}
