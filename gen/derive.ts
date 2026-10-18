// The sim→graph data path (add-sim). `npm run gen -- --seed 42` runs the sim generator, then derives
// data/dataset.json (the sim's truth), data/bench/dataset.json (a fixed 400-ticket slice) and
// data/eval.json (computed over the slice) from sim/data/truth.json. Same seed + warm cache → same bytes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { validateDataset, validateEval, MISMATCH, type Dataset, type ValidDataset, type Eval } from '@mochi/contracts';
import { rng } from './rng.ts';
import { buildEval, plantedMismatches } from './eval.ts';
import { PLANT, DAY, HOUR } from './generate.ts';

export const SLICE_TICKETS = 400;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** FOLLOWS chains as id lists, head first. */
export function chains(d: Dataset): string[][] {
  const next = new Map(d.tickets.filter((t) => t.follows_ticket_id).map((t) => [t.follows_ticket_id!, t.id]));
  return d.tickets.filter((t) => !t.follows_ticket_id && next.has(t.id)).map((h) => { const c = [h.id]; while (next.has(c.at(-1)!)) c.push(next.get(c.at(-1)!)!); return c; });
}

/** Planted-structure checks (the same rules gen's tests assert on the world). Returns the failures. */
export function plantFailures(d: Dataset, { minChains = 0, minMerged = 0 } = {}): string[] {
  const bad: string[] = [];
  for (const k of Object.keys(PLANT.bad).map(Number)) {
    const rel = d.releases[k], ids = new Set(rel.introduces.map((x) => x.issue_id));
    const count = (from: number) => d.tickets.filter((t) => ids.has(t.issue_id!) && t.created_at >= from && t.created_at < from + 7 * DAY).length;
    const before = count(rel.shipped_at - 7 * DAY), after = count(rel.shipped_at);
    if (!(after >= 3 * before && after >= 10)) bad.push(`spike ${rel.version}: ${before} -> ${after}`);
  }
  const mm = plantedMismatches(d);
  const kbOf = new Map(d.resolutions.map((r) => [r.id, r.kb_id]));
  const stale = PLANT.stale.map((i) => d.resolutions[i].kb_id!);
  if (mm.filter((m) => m.kind === 'contradicts').map((m) => m.kb_id).join() !== stale.join()) bad.push(`contradicts ${mm.filter((m) => m.kind === 'contradicts').map((m) => m.kb_id)} != ${stale}`);
  for (const id of stale) {
    const kb = d.kb_articles.find((k) => k.id === id)!;
    const ts = d.tickets.filter((t) => t.resolution_id && t.resolved_at !== null && kbOf.get(t.resolution_id) === id);
    if (ts.length < 2 * MISMATCH.MIN_SUPPORT) bad.push(`${id} support ${ts.length}`);
    else if (median(ts.map((t) => (t.resolved_at! - t.created_at) / HOUR)) < 2 * kb.promised_tat_hours!) bad.push(`${id} not 2x late`);
  }
  for (const r of d.resolutions.filter((r) => r.kind === 'workaround')) {
    const n = d.tickets.filter((t) => t.resolution_id === r.id).length;
    if (n < 2 * MISMATCH.MIN_SUPPORT) bad.push(`${r.id} workaround support ${n}`);
  }
  if (mm.filter((m) => m.kind === 'undocumented').length !== 2) bad.push('undocumented != 2');
  if (chains(d).length < minChains) bad.push(`chains ${chains(d).length} < ${minChains}`);
  const merged = d.tickets.filter((t) => t.merged_into).length;
  if (merged < minMerged) bad.push(`merged ${merged} < ${minMerged}`);
  if (d.contradiction_events.length !== 10) bad.push('events != 10');
  return bad;
}

/** A fixed, seeded 400-ticket subset that validates alone and keeps every plant (design decision 8). */
export function benchSlice(d: ValidDataset, seed: number): Dataset {
  const cs = chains(d), inChain = new Set(cs.flat());
  for (let attempt = 0; attempt < 50; attempt++) {
    const r = rng((seed ^ 0xbe7c) + attempt);
    const keep = new Set<string>();
    for (const c of r.shuffle(cs).slice(0, 22)) c.forEach((id) => keep.add(id));
    for (const t of r.shuffle(d.tickets.filter((t) => t.merged_into && !inChain.has(t.merged_into))).slice(0, 6)) { keep.add(t.id); keep.add(t.merged_into!); }
    for (const t of r.shuffle(d.tickets.filter((t) => !inChain.has(t.id) && !t.merged_into && !keep.has(t.id)))) { if (keep.size >= SLICE_TICKETS) break; keep.add(t.id); }
    const tickets = d.tickets.filter((t) => keep.has(t.id));
    const custIds = new Set([...tickets.flatMap((t) => [t.customer_id, t.on_behalf_of ?? t.customer_id]),
      ...d.contradiction_events.flatMap((e) => (e.kind === 'plan_change' ? [e.customer_id] : []))]);
    const slice: Dataset = {
      ...d, customers: d.customers.filter((c) => custIds.has(c.id)), tickets,
      conversations: d.conversations.filter((c) => keep.has(c.ticket_id)),
    };
    if (!plantFailures(slice, { minChains: 20, minMerged: 5 }).length && validateDataset(slice).ok) return slice;
  }
  throw new Error('no seeded slice kept every plant in 50 attempts');
}

export function derive(truth: { dataset: Dataset; seed: number }): { dataset: ValidDataset; bench: Dataset; eval: Eval } {
  const v = validateDataset(truth.dataset);
  if (!v.ok) throw new Error(`sim truth invalid:\n${v.errors.slice(0, 10).join('\n')}`);
  const fails = plantFailures(v.value, { minChains: 20, minMerged: 5 });
  if (fails.length) throw new Error(`full dataset lost a plant: ${fails.join('; ')}`);
  const bench = benchSlice(v.value, truth.seed);
  const vb = validateDataset(bench);
  if (!vb.ok) throw new Error('slice invalid');
  const ev = buildEval(vb.value, truth.seed);
  const evv = validateEval(ev, vb.value);
  if (!evv.ok) throw new Error(`eval invalid:\n${evv.errors.join('\n')}`);
  for (const m of ev.planted_mismatches) {
    if (m.ticket_ids.length < 2 * MISMATCH.MIN_SUPPORT) throw new Error(`${m.id}: support ${m.ticket_ids.length} < ${2 * MISMATCH.MIN_SUPPORT}`);
    if (m.kind === 'contradicts' && m.measured! < 2 * m.promised!) throw new Error(`${m.id}: measured ${m.measured} < 2x promised ${m.promised}`);
  }
  return { dataset: v.value, bench, eval: ev };
}

// One record per line: the full dataset is ~3,000 tickets and ~10,000 messages.
export const compact = (d: Dataset) => '{\n' + Object.entries(d).map(([k, v]) =>
  `"${k}": ${Array.isArray(v) ? `[\n${v.map((x) => JSON.stringify(x)).join(',\n')}\n]` : JSON.stringify(v)}`).join(',\n') + '\n}\n';
export const stable = (x: unknown) => JSON.stringify(x, null, 2) + '\n';

export function writeDerived(truthFile = new URL('../sim/data/truth.json', import.meta.url)) {
  const out = derive(JSON.parse(readFileSync(truthFile, 'utf8')));
  const dir = new URL('../data/', import.meta.url);
  mkdirSync(new URL('bench/', dir), { recursive: true });
  writeFileSync(new URL('dataset.json', dir), compact(out.dataset));
  writeFileSync(new URL('bench/dataset.json', dir), compact(out.bench));
  writeFileSync(new URL('eval.json', dir), stable(out.eval));
  return out;
}

if (import.meta.main) {
  // Root `npm run gen -- --seed n` reaches us as a bare positional (npm eats --seed).
  const { values, positionals } = parseArgs({ options: { seed: { type: 'string' } }, allowPositionals: true });
  const seed = Number(values.seed ?? positionals[0] ?? 42);
  const { writeSim } = await import('../sim/generate.ts');
  await writeSim(seed);
  const { dataset: d, bench, eval: ev } = writeDerived();
  console.log(`derived: ${d.customers.length} customers, ${d.tickets.length} tickets, ${d.conversations.length} conversations, ${d.agents.length} agents, ${d.sla_policies.length} SLA policies, ${d.contradiction_events.length} events; bench slice ${bench.tickets.length} tickets; eval ${ev.questions.length} questions, ${ev.planted_mismatches.length} mismatches`);
}
