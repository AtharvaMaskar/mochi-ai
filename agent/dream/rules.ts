// Practice (ObservedPatterns) and the deterministic mismatch rules (SPEC §1 decision 08).
// Pure arithmetic + Cypher, no LLM. Bench's mismatch ablation calls runMismatchRules directly.
import { createHash } from 'node:crypto';
import { GRAPH, MISMATCH } from '@mochi/contracts';
import { Q } from './cypher.ts';
import type { Db, DreamGraphs } from './types.ts';

export const CONFIDENCE_FULL = 20;
const H = 3_600_000;

export type MismatchEdge = {
  type: 'CONTRADICTS' | 'UNDOCUMENTED';
  pattern_id: string; key: string; area: string; target: string; // KB/Policy id, or ProductArea name
  support_count: number; ticket_ids: string[];
  promised?: number; measured?: number; delta?: number; summary?: string;
};
export type Pattern = {
  id: string; key: string; kind: 'tat' | 'workaround'; area: string; summary: string;
  measured: number | null; support: number; last_seen: number; tickets: string[];
  target?: string; target_label?: 'KBArticle' | 'Policy'; promised?: number;
};

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 10);
export const runIdOf = (as_of: number) => as_of.toString(36);

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const round = (x: number) => Math.round(x * 100) / 100;

export async function rows<T = Record<string, any>>(db: Db, graph: string, cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
  return ((await db.selectGraph(graph).query<T>(cypher, { params: params as any })).data ?? []) as T[];
}

type TatRow = { target: string; issue?: string; area: string; promised: number | null; tid: string; created: number; resolved: number };

function tatPatterns(list: TatRow[], prefix: 'kb' | 'pol', label: 'KBArticle' | 'Policy', run: string): Pattern[] {
  const groups = new Map<string, TatRow[]>();
  for (const r of list) {
    const key = prefix === 'kb' ? `kb:${r.target}:${r.issue}` : `pol:${r.target}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups].filter(([, g]) => g.length >= 2).map(([key, g]) => ({
    id: `${key}@${run}`, key, kind: 'tat', area: g[0].area, summary: `${label} ${g[0].target}`,
    measured: round(median(g.map((r) => (r.resolved - r.created) / H))), support: g.length,
    last_seen: Math.max(...g.map((r) => r.created)), tickets: g.map((r) => r.tid).sort(),
    target: g[0].target, target_label: label, ...(g[0].promised != null ? { promised: g[0].promised } : {}),
  }));
}

/** Promote this run's practice into fresh ObservedPatterns (one node per key per run, with SEEN_IN evidence). */
export async function promotePatterns(db: Db, graph: string, as_of: number): Promise<Pattern[]> {
  const run = runIdOf(as_of);
  const kb = await rows<TatRow>(db, graph, Q.kbResolved, { as_of });
  const pol = await rows<TatRow>(db, graph, Q.policyResolved, { as_of });
  const wa = await rows<{ area: string; summary: string; tid: string; created: number }>(db, graph, Q.workarounds, { as_of });

  const groups = new Map<string, typeof wa>();
  for (const r of wa) {
    const key = `wa:${r.area}:${hash(norm(r.summary))}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const workarounds: Pattern[] = [...groups].filter(([, g]) => g.length >= 2).map(([key, g]) => ({
    id: `${key}@${run}`, key, kind: 'workaround', area: g[0].area, summary: g[0].summary, measured: null,
    support: new Set(g.map((r) => r.tid)).size, last_seen: Math.max(...g.map((r) => r.created)),
    tickets: [...new Set(g.map((r) => r.tid))].sort(),
  }));
  const patterns = [...tatPatterns(kb, 'kb', 'KBArticle', run), ...tatPatterns(pol, 'pol', 'Policy', run), ...workarounds];
  for (let i = 0; i < patterns.length; i += 200) {
    const batch = patterns.slice(i, i + 200).map(({ id, key, kind, area, summary, measured, support, last_seen, tickets }) =>
      ({ id, key, kind, area, summary, measured, support, last_seen, tickets }));
    await rows(db, graph, Q.writePatterns, { rows: batch, run, as_of });
  }
  return patterns;
}

/** The rules: CONTRADICTS {delta} when measured TAT beats the promise by the tolerance, UNDOCUMENTED for repeated KB-less workarounds. */
export function mismatchesOf(patterns: Pattern[]): MismatchEdge[] {
  const out: MismatchEdge[] = [];
  for (const p of patterns) {
    if (p.support < MISMATCH.MIN_SUPPORT) continue;
    const base = { pattern_id: p.id, key: p.key, area: p.area, support_count: p.support, ticket_ids: p.tickets };
    if (p.kind === 'tat' && p.promised != null && p.promised > 0 && p.measured! > p.promised * (1 + MISMATCH.TAT_TOLERANCE))
      out.push({ ...base, type: 'CONTRADICTS', target: p.target!, promised: p.promised, measured: p.measured!, delta: round(p.measured! - p.promised) });
    if (p.kind === 'workaround') out.push({ ...base, type: 'UNDOCUMENTED', target: p.area, summary: p.summary });
  }
  return out;
}

export type RulesResult = { patterns: Pattern[]; edges: MismatchEdge[]; retired: number; written: number };

/** Promote patterns, retire older runs' mismatch edges, write this run's. Returns the edges written. */
export async function runMismatchRules(db: Db, graphs?: Partial<DreamGraphs>, opts: { as_of?: number } = {}): Promise<RulesResult> {
  const graph = graphs?.company ?? GRAPH.company;
  const as_of = opts.as_of ?? Date.now();
  const run = runIdOf(as_of);
  const patterns = await promotePatterns(db, graph, as_of);
  const edges = mismatchesOf(patterns);
  const [{ retired }] = await rows<{ retired: number }>(db, graph, Q.retireMismatches, { run, as_of });
  const row = (e: MismatchEdge) => ({ pid: e.pattern_id, target: e.target, area: e.area, support: e.support_count, delta: e.delta ?? null, promised: e.promised ?? null, measured: e.measured ?? null });
  const kbPol = (label: string) => edges.filter((e) => e.type === 'CONTRADICTS' && patterns.find((p) => p.id === e.pattern_id)?.target_label === label).map(row);
  let written = 0;
  for (const [cypher, list] of [[Q.contradictsKB, kbPol('KBArticle')], [Q.contradictsPolicy, kbPol('Policy')], [Q.undocumented, edges.filter((e) => e.type === 'UNDOCUMENTED').map(row)]] as const)
    if (list.length) written += (await rows<{ n: number }>(db, graph, cypher, { rows: list, as_of }))[0].n;
  return { patterns, edges, retired, written };
}

// ── Suggestions ──────────────────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
export type SuggestionOut = { id: string; key: string; edge: MismatchEdge['type']; area: string; text: string; prose: 'model' | 'template' };
export type Prose = (e: MismatchEdge) => Promise<string | null>;

export function templateProse(e: MismatchEdge): string {
  return e.type === 'CONTRADICTS'
    ? `Resolved tickets take far longer than ${e.target} promises. Update the promise or fix the process behind it.`
    : `Agents keep using the same workaround in ${e.area} that no document describes. Write it down or fix the cause.`;
}

/** Feedback → status, expiry, then one Suggestion per new mismatch without an open one or a recent "wrong". */
export async function writeSuggestions(db: Db, graphs: DreamGraphs, teams: string[], edges: MismatchEdge[], as_of: number, prose: Prose): Promise<SuggestionOut[]> {
  const graph = graphs.company, run = runIdOf(as_of);
  // Latest feedback per suggestion, from the company graph and every team graph (teach/feedback write there).
  const latest = new Map<string, { verdict: string; at: number }>();
  for (const g of [graph, ...teams]) for (const f of await rows<{ id: string; verdict: string; at: number }>(db, g, Q.feedback))
    if ((f.verdict === 'right' || f.verdict === 'wrong') && f.at <= as_of && !(f.at < (latest.get(f.id)?.at ?? -1))) latest.set(f.id, f);

  const existing = await rows<{ id: string; key: string; status: string; expires_at: number; created_at: number }>(db, graph, Q.suggestions, { as_of });
  const updates: { id: string; status: string }[] = [];
  for (const s of existing) {
    const f = latest.get(s.id);
    const status = f ? f.verdict : s.status === 'open' && s.expires_at <= as_of ? 'expired' : s.status;
    if (status !== s.status) { updates.push({ id: s.id, status }); s.status = status; }
  }
  if (updates.length) await rows(db, graph, Q.setSuggestionStatus, { rows: updates });

  const lastByKey = new Map<string, (typeof existing)[number]>();
  for (const s of existing) lastByKey.set(s.key, s); // ordered by created_at
  const fresh = edges.filter((e) => {
    const open = existing.some((s) => s.key === e.key && s.status === 'open');
    const last = lastByKey.get(e.key), f = last && latest.get(last.id);
    const suppressed = f?.verdict === 'wrong' && f.at > as_of - 30 * DAY;
    return !open && !suppressed;
  });
  const out: SuggestionOut[] = [];
  const list = [];
  let calls = 0;
  for (const e of fresh) {
    const model = calls++ < 3 ? await prose(e).catch(() => null) : null; // max 3 model calls per run
    const text = model ?? templateProse(e);
    const id = `SUG-${hash(e.key)}-${run}`;
    out.push({ id, key: e.key, edge: e.type, area: e.area, text, prose: model ? 'model' : 'template' });
    list.push({ id, pid: e.pattern_id, key: e.key, edge: e.type, area: e.area, text, tickets: e.ticket_ids, support: e.support_count,
      confidence: Math.min(1, e.support_count / CONFIDENCE_FULL), expires_at: as_of + 14 * DAY });
  }
  if (list.length) await rows(db, graph, Q.createSuggestions, { rows: list, as_of });
  return out;
}
