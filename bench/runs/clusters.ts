// Clusters ablation: graph community detection (CDLP over live Ticket-ABOUT-Issue edges, on a scratch
// projection) vs LLM clustering of the same week's raw ticket text, scored against the bad-release spikes.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MISMATCH, type Dataset, type Results } from '@mochi/contracts';
import { CDLP, PROJECT_ABOUT, WINDOW_ABOUT } from '../cypher.ts';
import { ensureWorld } from '../arms/d.ts';
import type { Ctx } from '../arms/index.ts';
import { jsonArray } from './ablation.ts';

const WEEK = 7 * 86_400_000;
type Spike = { version: string; issue_id: string };
type Score = { matched_spikes: number; missed_spikes: number; spurious: number; tokens: number };

/** A cluster is "emerging" with at least MIN_SUPPORT tickets; it matches a spike when its majority issue is the spike's. */
export function scoreClusters(d: Dataset, spikes: Spike[], clusters: string[][], tokens: number): Score {
  const issueOf = new Map(d.tickets.map((t) => [t.id, t.issue_id]));
  const majority = (ids: string[]) => {
    const c = new Map<string, number>();
    for (const id of ids) { const i = issueOf.get(id); if (i) c.set(i, (c.get(i) ?? 0) + 1); }
    return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  };
  const emerging = clusters.filter((c) => c.length >= MISMATCH.MIN_SUPPORT).map(majority);
  const matched = spikes.filter((s) => emerging.includes(s.issue_id)).length;
  return { matched_spikes: matched, missed_spikes: spikes.length - matched, spurious: emerging.filter((i) => !spikes.some((s) => s.issue_id === i)).length, tokens };
}

const PROMPT = 'Below are one week of support tickets from a fictional broker, the week after a release. Group the tickets that share '
  + 'the same underlying problem. Reply with only a JSON array of {"label":"<short name>","ticket_ids":["..."]}, one entry per group.';

export async function runClusters(ctx: Ctx): Promise<Pick<Results, 'clusters_ablation'>> {
  const d = ctx.dataset, n = ctx.names;
  await ensureWorld(ctx);
  const world = ctx.db.selectGraph(n.world), scratch = ctx.db.selectGraph(n.clusters);
  const g: Score = { matched_spikes: 0, missed_spikes: 0, spurious: 0, tokens: 0 }, l = { ...g };
  const detail: unknown[] = [];
  // One window per release: bad releases carry spikes, good ones are the chance to be spurious.
  for (const rel of d.releases) {
    const from = rel.shipped_at, to = from + WEEK;
    const spikes = rel.introduces.map((x) => ({ version: rel.version, issue_id: x.issue_id }));
    const pairs = (await world.roQuery<{ t: string; i: string }>(WINDOW_ABOUT, { params: { from, to } })).data ?? [];
    await scratch.delete().catch(() => {});
    if (pairs.length) await scratch.query(PROJECT_ABOUT, { params: { rows: pairs } });
    const comm = new Map<number, string[]>();
    if (pairs.length) for (const r of (await scratch.roQuery<{ id: string; communityId: number }>(CDLP)).data ?? []) comm.set(r.communityId, [...(comm.get(r.communityId) ?? []), r.id]);
    const graphClusters = [...comm.values()];

    const week = d.tickets.filter((t) => t.created_at >= from && t.created_at < to);
    let llmClusters: string[][] = [], tokens = 0;
    if (week.length) {
      const text = week.map((t) => `${t.id} | ${t.subject} | ${t.body}`).join('\n');
      const r = await ctx.llm.complete('clusters_llm', `${PROMPT}\n\n${text}`, { maxTokens: 4096 });
      tokens = r.usage.input + r.usage.output;
      llmClusters = jsonArray(r.text).flatMap((x: any) => (Array.isArray(x?.ticket_ids) ? [x.ticket_ids.map(String)] : []));
    }
    const gs = scoreClusters(d, spikes, graphClusters, 0), ls = scoreClusters(d, spikes, llmClusters, tokens);
    for (const k of Object.keys(g) as (keyof Score)[]) { g[k] += gs[k]; l[k] += ls[k]; }
    detail.push({ release: rel.version, spikes, graph: { clusters: graphClusters, score: gs }, llm: { clusters: llmClusters, score: ls } });
  }
  await scratch.delete().catch(() => {});
  writeFileSync(join(ctx.artifacts, 'clusters.json'), JSON.stringify(detail, null, 2));
  return { clusters_ablation: { graph: g, llm: l } };
}
