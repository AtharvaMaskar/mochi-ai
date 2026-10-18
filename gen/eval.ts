// Eval emitter (SPEC §2): 50 questions + planted mismatches, every answer computed from the JSON, never the graph.
import { MISMATCH, type Dataset, type Eval, type EvalQuestion, type Ticket, type PlantedMismatch, type ContradictionEvent } from '@mochi/contracts';
import { rng } from './rng.ts';

const DAY = 86_400_000, HOUR = 3_600_000;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round1 = (x: number) => Math.round(x * 10) / 10;
const isOpen = (t: Ticket) => t.status === 'open' || t.status === 'pending';

// All keys tied at the max count, sorted for determinism.
function top<K extends string>(counts: Map<K, number>): { keys: K[]; n: number } {
  const n = Math.max(...counts.values());
  return { keys: [...counts].filter(([, v]) => v === n).map(([k]) => k).sort(), n };
}
function countBy<T, K extends string>(xs: T[], key: (x: T) => K | null): Map<K, number> {
  const m = new Map<K, number>();
  for (const x of xs) { const k = key(x); if (k !== null) m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

// Live INTRODUCED versions for an issue as of `asOf`, with `applied` events replayed in the JSON model.
export function liveIntroducers(ds: Dataset, issueId: string, asOf: number, applied: ContradictionEvent[] = []): string[] {
  const fixedAt = applied.find((e) => e.kind === 'issue_fixed' && e.issue_id === issueId)?.at ?? Infinity;
  return ds.releases.filter((r) => r.introduces.some((x) => x.issue_id === issueId && x.valid_from <= asOf
    && Math.min(x.valid_until ?? Infinity, fixedAt) > asOf)).map((r) => r.version);
}

export function livePlan(ds: Dataset, customerId: string, asOf: number, applied: ContradictionEvent[] = []): string {
  const ev = applied.find((e) => e.kind === 'plan_change' && e.customer_id === customerId && e.at <= asOf);
  if (ev && ev.kind === 'plan_change') return ev.to;
  return ds.customers.find((c) => c.id === customerId)!.plan_history.find((p) => p.valid_from <= asOf && (p.valid_until ?? Infinity) > asOf)!.plan;
}

// The mismatch rules, applied to tickets alone: what the dream must rediscover.
export function plantedMismatches(ds: Dataset): PlantedMismatch[] {
  const res = new Map(ds.resolutions.map((r) => [r.id, r]));
  const area = new Map(ds.issues.map((i) => [i.id, i.area]));
  const out: PlantedMismatch[] = [];
  for (const kb of ds.kb_articles) {
    if (kb.promised_tat_hours === null) continue;
    const ts = ds.tickets.filter((t) => t.resolved_at !== null && t.resolution_id && res.get(t.resolution_id)!.kb_id === kb.id);
    if (ts.length < MISMATCH.MIN_SUPPORT) continue;
    const measured = round1(median(ts.map((t) => (t.resolved_at! - t.created_at) / HOUR)));
    if (measured > kb.promised_tat_hours * (1 + MISMATCH.TAT_TOLERANCE))
      out.push({ id: '', kind: 'contradicts', kb_id: kb.id, area: kb.area, promised: kb.promised_tat_hours, measured, ticket_ids: ts.map((t) => t.id) });
  }
  for (const r of ds.resolutions) {
    if (r.kind !== 'workaround' || r.kb_id !== null) continue;
    const ts = ds.tickets.filter((t) => t.resolution_id === r.id);
    if (ts.length < MISMATCH.MIN_SUPPORT) continue;
    const a = top(countBy(ts, (t) => (t.issue_id ? area.get(t.issue_id)! : null))).keys[0];
    out.push({ id: '', kind: 'undocumented', kb_id: null, area: a, promised: null, measured: null, ticket_ids: ts.map((t) => t.id) });
  }
  return out.map((m, k) => ({ ...m, id: `M-${k + 1}` }));
}

export function buildEval(ds: Dataset, seed: number): Eval {
  const r = rng(seed ^ 0x5eed);
  const now = ds.generated_at;
  const cust = new Map(ds.customers.map((c) => [c.id, c]));
  const issue = new Map(ds.issues.map((i) => [i.id, i]));
  const teamOf = new Map(ds.product_areas.map((a) => [a.name, a.team]));
  const agent = new Map(ds.agents.map((a) => [a.id, a]));
  const res = new Map(ds.resolutions.map((x) => [x.id, x]));
  const byIssue = (id: string) => ds.tickets.filter((t) => t.issue_id === id);
  const events = ds.contradiction_events;
  const planEvents = events.filter((e) => e.kind === 'plan_change');
  const fixEvents = events.filter((e) => e.kind === 'issue_fixed');
  const fixedIssues = new Set(fixEvents.map((e) => e.issue_id));
  const evCustomers = new Set(planEvents.map((e) => e.customer_id));
  const qs: Omit<EvalQuestion, 'id'>[] = [];
  const single = (question: string, answer: string, after_event?: string) => qs.push({ bucket: 'single_fact', question, answer, scoring: 'exact', ...(after_event ? { after_event } : {}) });
  const multi = (question: string, answer: string, after_event?: string) => qs.push({ bucket: 'multi_hop', question, answer, scoring: 'judge', ...(after_event ? { after_event } : {}) });
  const structural = (question: string, answer: string) => qs.push({ bucket: 'structural', question, answer, scoring: 'judge' });

  // Single fact (20): plan ×8 (6 after events), segment ×4, owning team ×4, KB TAT ×4.
  for (const e of planEvents) single(`What plan is customer ${e.customer_id} (${cust.get(e.customer_id)!.name}) on?`, livePlan(ds, e.customer_id, e.at + 1, [e]), e.id);
  const others = r.shuffle(ds.customers.filter((c) => !evCustomers.has(c.id)));
  for (const c of others.slice(0, 2)) single(`What plan is customer ${c.id} (${c.name}) on?`, livePlan(ds, c.id, now));
  for (const c of others.slice(2, 6)) single(`Which segment is customer ${c.id} (${c.name}) in?`, c.segment);
  for (const i of r.shuffle(ds.issues).slice(0, 4)) single(`Which team owns issue ${i.id} (${i.name})?`, teamOf.get(i.area)!);
  for (const kb of r.shuffle(ds.kb_articles).slice(0, 4)) single(`How many hours does ${kb.id} ("${kb.title}") promise for resolution?`, String(kb.promised_tat_hours));

  // Multi-hop (20): likely cause ×7 (4 after fixes), who knows ×4, fix for similar ×4, blast radius ×5.
  const latest = (id: string) => byIssue(id).at(-1)!;
  for (const e of fixEvents) {
    const t = latest(e.issue_id);
    const live = liveIntroducers(ds, e.issue_id, e.at + 1, [e]);
    multi(`Which release likely caused ticket ${t.id}?`, live.length ? live.join(', ') : `none: ${e.issue_id} was fixed in ${e.fixed_in}, so its INTRODUCED fact from ${liveIntroducers(ds, e.issue_id, now).join(', ')} is retired`, e.id);
  }
  const causal = r.shuffle(ds.tickets.filter((t) => t.issue_id && !fixedIssues.has(t.issue_id) && liveIntroducers(ds, t.issue_id, now).length));
  for (const t of causal.slice(0, 3)) multi(`Which release likely caused ticket ${t.id}?`, liveIntroducers(ds, t.issue_id!, now).join(', '));
  const solvers = (id: string) => top(countBy(byIssue(id), (t) => t.solved_by));
  for (const i of r.shuffle(ds.issues).filter((i) => solvers(i.id).keys.length === 1).slice(0, 4)) {
    const s = solvers(i.id);
    multi(`Which agent has solved the most tickets about issue ${i.id} (${i.name})?`, `${agent.get(s.keys[0])!.name} (${s.keys[0]}), ${s.n} tickets`);
  }
  const fixes = (id: string) => top(countBy(byIssue(id), (t) => t.resolution_id));
  for (const t of r.shuffle(ds.tickets.filter((t) => t.issue_id && fixes(t.issue_id).keys.length === 1)).filter((t, k, xs) => xs.findIndex((u) => u.issue_id === t.issue_id) === k).slice(0, 4)) {
    const f = fixes(t.issue_id!);
    multi(`What resolution most often fixed tickets about the same issue as ticket ${t.id}?`, `${res.get(f.keys[0])!.summary} (${f.keys[0]}), used on ${f.n} tickets`);
  }
  for (const rel of ds.releases.filter((x) => x.introduces.length)) {
    const ts = ds.tickets.filter((t) => t.issue_id && liveIntroducers(ds, t.issue_id, now).includes(rel.version));
    multi(`For release ${rel.version}, how many distinct customers raised tickets about the issues it introduced, and how many of those tickets are still open?`,
      `${new Set(ts.map((t) => t.customer_id)).size} customers, ${ts.filter(isOpen).length} open tickets`);
  }

  // Structural (10).
  const week = (rel: Dataset['releases'][number], from: number) => ds.tickets.filter((t) => rel.introduces.some((x) => x.issue_id === t.issue_id) && t.created_at >= from && t.created_at < from + 7 * DAY).length;
  const spikes = ds.releases.filter((x) => x.introduces.length).map((rel) => ({ v: rel.version, before: week(rel, rel.shipped_at - 7 * DAY), after: week(rel, rel.shipped_at) }));
  const biggest = [...spikes].sort((a, b) => (b.after - b.before) - (a.after - a.before) || a.v.localeCompare(b.v))[0];
  structural('Which release was followed by the biggest ticket spike on the issues it introduced (week after vs week before shipping)?', `${biggest.v}: ${biggest.before} → ${biggest.after} tickets`);
  structural('Which releases introduced issues whose tickets at least tripled, to 10 or more, in the week after shipping?',
    spikes.filter((s) => s.after >= 10 && s.after >= 3 * s.before).map((s) => s.v).join(', '));
  const next = new Map(ds.tickets.filter((t) => t.follows_ticket_id).map((t) => [t.follows_ticket_id!, t.id]));
  const chains = ds.tickets.filter((t) => !t.follows_ticket_id && next.has(t.id)).map((h) => { const c = [h.id]; while (next.has(c.at(-1)!)) c.push(next.get(c.at(-1)!)!); return { h, c }; });
  const longest = Math.max(...chains.map((x) => x.c.length));
  structural('Which repeat-contact (FOLLOWS) chain is the longest?', chains.filter((x) => x.c.length === longest)
    .map(({ h, c }) => `${c.join(' → ')} (customer ${h.customer_id}, issue ${h.issue_id}, ${c.length} tickets)`).join('; '));
  const mm = plantedMismatches(ds);
  structural('Which KB articles promise a turnaround that resolved tickets do not meet?', mm.filter((m) => m.kind === 'contradicts')
    .map((m) => `${m.kb_id} (promised ${m.promised}h, measured median ${m.measured}h)`).join(', '));
  structural('Which product areas rely on a widely used workaround that appears in no KB article?', mm.filter((m) => m.kind === 'undocumented')
    .map((m) => `${m.area} (${m.ticket_ids.length} tickets)`).join(', '));
  const name = (id: string) => issue.get(id)!.name;
  const ti = top(countBy(ds.tickets, (t) => t.issue_id));
  structural('Which issue has the most tickets overall?', `${ti.keys.map((k) => `${k} (${name(k)})`).join(', ')}, ${ti.n} tickets`);
  const ta = top(countBy(ds.tickets.filter((t) => t.created_at >= now - 7 * DAY), (t) => issue.get(t.issue_id!)!.area));
  structural('Which product area had the most tickets in the last 7 days?', `${ta.keys.join(', ')}, ${ta.n} tickets`);
  const tg = top(countBy(ds.tickets, (t) => t.solved_by));
  structural('Which agent has solved the most tickets overall?', `${tg.keys.map((k) => `${agent.get(k)!.name} (${k})`).join(', ')}, ${tg.n} tickets`);
  const tt = top(countBy(ds.tickets.filter(isOpen), (t) => teamOf.get(issue.get(t.issue_id!)!.area)!));
  structural('Which team owns the most open tickets?', `${tt.keys.join(', ')}, ${tt.n} open tickets`);
  const tc = top(countBy(ds.tickets, (t) => t.customer_id));
  structural('Which customer has raised the most tickets?', `${tc.keys.map((k) => `${k} (${cust.get(k)!.name})`).join(', ')}, ${tc.n} tickets`);

  return { seed, questions: qs.map((q, k) => ({ id: `Q-${String(k + 1).padStart(2, '0')}`, ...q })), planted_mismatches: mm };
}
