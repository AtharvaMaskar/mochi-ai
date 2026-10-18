// Synthetic dataset contract (SPEC §2). The generator writes data/dataset.json + data/eval.json;
// the loader, agent and every bench arm read them. All times are epoch ms (UTC).
import { z } from 'zod';

const ms = z.number().int().nonnegative();
const id = z.string().min(1);

export const CustomerSegment = z.enum(['retail', 'premium', 'hni']);
export const Channel = z.enum(['app', 'email', 'chat']);
export const TicketStatus = z.enum(['open', 'pending', 'resolved', 'closed']);
export const Priority = z.enum(['low', 'medium', 'high', 'urgent']);
export const AreaName = z.enum(['login', 'kyc', 'funds', 'orders', 'charges', 'app']);
export const PlanName = z.enum(['basic', 'premium']);
export const ResolutionKind = z.enum(['workaround', 'fix', 'escalation', 'info']);

export const Customer = z.object({
  id, name: z.string(), segment: CustomerSegment, city: z.string(), language: z.string(), joined_at: ms,
  plan_history: z.array(z.object({ plan: PlanName, valid_from: ms, valid_until: ms.nullable() })).min(1),
});
export const Ticket = z.object({
  id, customer_id: id, subject: z.string(), body: z.string(), channel: Channel,
  status: TicketStatus, priority: Priority, created_at: ms, resolved_at: ms.nullable(),
  issue_id: id.nullable(), resolution_id: id.nullable(), solved_by: id.nullable(), follows_ticket_id: id.nullable(),
});
export const Issue = z.object({ id, name: z.string(), area: AreaName, first_seen: ms });
export const ProductArea = z.object({ name: AreaName, team: z.string() });
export const Team = z.object({ name: z.string() });
export const AgentUser = z.object({ id, name: z.string(), team: z.string() });
export const Resolution = z.object({ id, kind: ResolutionKind, summary: z.string(), kb_id: id.nullable() });
export const KBArticle = z.object({
  id, title: z.string(), area: AreaName, updated_at: ms,
  promised_tat_hours: z.number().nonnegative().nullable(), steps: z.array(z.string()),
});
export const Release = z.object({
  version: z.string(), shipped_at: ms, notes: z.string(),
  introduces: z.array(z.object({ issue_id: id, valid_from: ms, valid_until: ms.nullable() })),
});
export const Plan = z.object({ name: PlanName });

export const ContradictionEvent = z.discriminatedUnion('kind', [
  z.object({ id, at: ms, kind: z.literal('plan_change'), customer_id: id, from: PlanName, to: PlanName }),
  z.object({ id, at: ms, kind: z.literal('issue_fixed'), issue_id: id, fixed_in: z.string() }),
]);

export const Dataset = z.object({
  seed: z.number().int(), generated_at: ms, broker: z.string(),
  customers: z.array(Customer), tickets: z.array(Ticket), issues: z.array(Issue),
  product_areas: z.array(ProductArea), teams: z.array(Team), agents: z.array(AgentUser),
  resolutions: z.array(Resolution), kb_articles: z.array(KBArticle), releases: z.array(Release),
  plans: z.array(Plan), contradiction_events: z.array(ContradictionEvent),
});

export const Bucket = z.enum(['single_fact', 'multi_hop', 'structural']);
export const EvalQuestion = z.object({
  id, bucket: Bucket, question: z.string(), answer: z.string(),
  scoring: z.enum(['exact', 'judge']), after_event: id.optional(),
});
export const PlantedMismatch = z.object({
  id, kind: z.enum(['contradicts', 'undocumented']), kb_id: id.nullable(), area: AreaName,
  promised: z.number().nullable(), measured: z.number().nullable(), ticket_ids: z.array(id),
});
export const Eval = z.object({
  seed: z.number().int(), questions: z.array(EvalQuestion), planted_mismatches: z.array(PlantedMismatch),
});

export type Dataset = z.infer<typeof Dataset>;
export type Eval = z.infer<typeof Eval>;
export type Customer = z.infer<typeof Customer>;
export type Ticket = z.infer<typeof Ticket>;
export type Issue = z.infer<typeof Issue>;
export type KBArticle = z.infer<typeof KBArticle>;
export type Release = z.infer<typeof Release>;
export type ContradictionEvent = z.infer<typeof ContradictionEvent>;
export type EvalQuestion = z.infer<typeof EvalQuestion>;
export type PlantedMismatch = z.infer<typeof PlantedMismatch>;

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

// Zod paths are array indexes; name the record by its id/version/name so errors are actionable.
function describe(root: unknown, path: PropertyKey[]): string {
  let node: any = root;
  const parts: string[] = [];
  for (const key of path) {
    node = node?.[key as any];
    const label = typeof key === 'number' ? (node?.id ?? node?.version ?? node?.name ?? key) : String(key);
    parts.push(typeof key === 'number' ? `[${label}]` : `.${label}`);
  }
  return parts.join('').replace(/^\./, '');
}

function parse<T>(schema: z.ZodType<T>, input: unknown): Result<T> {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${describe(input, i.path)}: ${i.message}`) };
}

export function validateDataset(input: unknown): Result<Dataset> {
  const r = parse(Dataset, input);
  if (!r.ok) return r;
  const d = r.value;
  const errors: string[] = [];
  const has = (xs: { [k: string]: any }[], key: string) => new Set(xs.map((x) => x[key]));
  const customers = has(d.customers, 'id'), tickets = has(d.tickets, 'id'), issues = has(d.issues, 'id');
  const teams = has(d.teams, 'name'), agents = has(d.agents, 'id'), resolutions = has(d.resolutions, 'id');
  const kbs = has(d.kb_articles, 'id'), releases = has(d.releases, 'version'), plans = has(d.plans, 'name');
  const areas = has(d.product_areas, 'name');
  const ref = (ok: boolean, where: string) => { if (!ok) errors.push(`dangling reference: ${where}`); };
  const opt = (v: string | null, set: Set<unknown>, where: string) => ref(v === null || set.has(v), where);

  for (const c of d.customers) for (const p of c.plan_history) ref(plans.has(p.plan), `customers[${c.id}].plan_history.plan=${p.plan}`);
  for (const t of d.tickets) {
    ref(customers.has(t.customer_id), `tickets[${t.id}].customer_id=${t.customer_id}`);
    opt(t.issue_id, issues, `tickets[${t.id}].issue_id=${t.issue_id}`);
    opt(t.resolution_id, resolutions, `tickets[${t.id}].resolution_id=${t.resolution_id}`);
    opt(t.solved_by, agents, `tickets[${t.id}].solved_by=${t.solved_by}`);
    opt(t.follows_ticket_id, tickets, `tickets[${t.id}].follows_ticket_id=${t.follows_ticket_id}`);
  }
  for (const i of d.issues) ref(areas.has(i.area), `issues[${i.id}].area=${i.area}`);
  for (const a of d.product_areas) ref(teams.has(a.team), `product_areas[${a.name}].team=${a.team}`);
  for (const a of d.agents) ref(teams.has(a.team), `agents[${a.id}].team=${a.team}`);
  for (const r of d.resolutions) opt(r.kb_id, kbs, `resolutions[${r.id}].kb_id=${r.kb_id}`);
  for (const k of d.kb_articles) ref(areas.has(k.area), `kb_articles[${k.id}].area=${k.area}`);
  for (const rel of d.releases) for (const x of rel.introduces) ref(issues.has(x.issue_id), `releases[${rel.version}].introduces.issue_id=${x.issue_id}`);
  for (const e of d.contradiction_events) {
    if (e.kind === 'plan_change') ref(customers.has(e.customer_id), `contradiction_events[${e.id}].customer_id=${e.customer_id}`);
    else {
      ref(issues.has(e.issue_id), `contradiction_events[${e.id}].issue_id=${e.issue_id}`);
      ref(releases.has(e.fixed_in), `contradiction_events[${e.id}].fixed_in=${e.fixed_in}`);
    }
  }
  return errors.length ? { ok: false, errors } : r;
}

export function validateEval(input: unknown, dataset: Dataset): Result<Eval> {
  const r = parse(Eval, input);
  if (!r.ok) return r;
  const errors: string[] = [];
  const events = new Set(dataset.contradiction_events.map((e) => e.id));
  const kbs = new Set(dataset.kb_articles.map((k) => k.id));
  const tickets = new Set(dataset.tickets.map((t) => t.id));
  for (const q of r.value.questions) if (q.after_event && !events.has(q.after_event)) errors.push(`dangling reference: questions[${q.id}].after_event=${q.after_event}`);
  for (const m of r.value.planted_mismatches) {
    if (m.kb_id && !kbs.has(m.kb_id)) errors.push(`dangling reference: planted_mismatches[${m.id}].kb_id=${m.kb_id}`);
    for (const t of m.ticket_ids) if (!tickets.has(t)) errors.push(`dangling reference: planted_mismatches[${m.id}].ticket_ids=${t}`);
  }
  return errors.length ? { ok: false, errors } : r;
}
