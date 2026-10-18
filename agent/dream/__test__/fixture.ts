// Test helper: tinyDataset() in its pre-event state plus planted mismatch rows, loaded into a
// throwaway test_dream_* graph over the admin connection; and a faux-provider model.
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { tinyDataset, untilOrForever, type Dataset } from '@mochi/contracts';
import { connect } from '../../../contracts/testdb.ts';
import type { DreamGraphs, DreamModel } from '../types.ts';

const H = 3_600_000, DAY = 24 * H;
const base = tinyDataset();
export const AS_OF = base.generated_at;
const T0 = base.customers[0].joined_at;

export const KB_TAT = [60, 70, 71, 71, 80, 90]; // with T-1's 24h, the median is 71 → delta 47 against KB-1's 24
export const WORKAROUND = 'Ask the customer to retry the withdrawal after two hours';

/** tinyDataset before its events, with planted rows: 6 slow KB-1 tickets, 5 KB-less workarounds, 2 demo-day tickets. */
export function fixtureDataset(): { dataset: Dataset; pending: string[] } {
  const d = structuredClone(base);
  d.customers[0].plan_history = [{ plan: 'basic', valid_from: T0, valid_until: null }];
  d.contradiction_events = [
    { id: 'E-1', at: AS_OF - 2 * H, kind: 'plan_change', customer_id: 'C-1', from: 'basic', to: 'premium' },
    { id: 'E-2', at: AS_OF - 1 * H, kind: 'issue_fixed', issue_id: 'I-1', fixed_in: '2.4.0' },
  ];
  d.teams.push({ name: 'payments' });
  d.product_areas.push({ name: 'funds', team: 'payments' }, { name: 'login', team: 'trading' });
  d.issues.push({ id: 'I-2', name: 'withdrawal stuck in processing', area: 'funds', first_seen: AS_OF - 6 * DAY });
  const ticket = (id: string, created: number, hours: number | null, issue: string, res: string | null) => ({
    id, customer_id: 'C-1', subject: `Ticket ${id}`, body: 'Synthetic body', channel: 'app' as const,
    status: hours === null ? 'open' as const : 'resolved' as const, priority: 'medium' as const,
    created_at: created, resolved_at: hours === null ? null : created + hours * H,
    issue_id: issue, resolution_id: res, solved_by: hours === null ? null : 'A-1', follows_ticket_id: null,
  });
  KB_TAT.forEach((h, k) => d.tickets.push(ticket(`K-${k + 1}`, AS_OF - 6 * DAY + k * H, h, 'I-1', 'R-1')));
  for (let k = 1; k <= 5; k++) {
    d.resolutions.push({ id: `R-W${k}`, kind: 'workaround', summary: WORKAROUND, kb_id: null });
    d.tickets.push(ticket(`W-${k}`, AS_OF - 5 * DAY + k * H, 5, 'I-2', `R-W${k}`));
  }
  // Demo day: no issue yet, not ingested; the dream's extraction fills them in.
  d.tickets.push({ ...ticket('D-1', AS_OF - 3 * H, null, 'I-1', null), issue_id: null, subject: 'Cannot log in after OTP', body: 'OTP accepted but app loops to login' });
  d.tickets.push({ ...ticket('D-2', AS_OF - 2 * H, null, 'I-1', null), issue_id: null, subject: 'Billing question', body: 'Why was I charged twice' });
  return { dataset: d, pending: ['D-1', 'D-2'] };
}

const prim = (v: unknown) => v !== null && v !== undefined && typeof v !== 'object';
const props = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => prim(v) || (Array.isArray(v) && v.every(prim))));

/** Minimal stand-in for gen's loadDataset: contract labels, source 'seed', VALID_FOREVER for live facts. */
export async function loadFixture(db: Awaited<ReturnType<typeof connect>>, graph: string, d: Dataset, pending: string[]) {
  const g = db.selectGraph(graph);
  const q = (cypher: string, rows: unknown[]) => rows.length ? g.query(`UNWIND $rows AS r ${cypher}`, { params: { rows } as any }) : null;
  const seed = { source: 'seed' };
  const resolvedAt = new Map(d.tickets.filter((t) => t.resolution_id).map((t) => [t.resolution_id!, t.resolved_at ?? T0]));
  await q('MERGE (n:Team {name: r.name}) SET n += r.p', d.teams.map((t) => ({ name: t.name, p: { ...seed, created_at: T0 } })));
  await q('MERGE (n:Plan {name: r.name}) SET n += r.p', d.plans.map((t) => ({ name: t.name, p: { ...seed, created_at: T0 } })));
  await q('MATCH (t:Team {name: r.team}) MERGE (n:ProductArea {name: r.name}) SET n += r.p MERGE (n)-[:OWNED_BY]->(t)', d.product_areas.map((a) => ({ ...a, p: { ...seed, created_at: T0 } })));
  await q('MERGE (n:Customer {id: r.p.id}) SET n += r.p', d.customers.map((c) => ({ p: props({ ...c, ...seed, created_at: c.joined_at }) })));
  await q('MATCH (t:Team {name: r.team}) MERGE (n:AgentUser {id: r.p.id}) SET n += r.p MERGE (n)-[:MEMBER_OF]->(t)', d.agents.map((a) => ({ team: a.team, p: props({ ...a, ...seed, created_at: T0 }) })));
  await q('MATCH (a:ProductArea {name: r.area}) MERGE (n:Issue {id: r.p.id}) SET n += r.p MERGE (n)-[:IN]->(a)', d.issues.map((i) => ({ area: i.area, p: props({ ...i, ...seed, created_at: i.first_seen }) })));
  await q('MERGE (n:KBArticle {id: r.p.id}) SET n += r.p', d.kb_articles.map((k) => ({ p: props({ ...k, ...seed, created_at: k.updated_at }) })));
  await q('MERGE (n:Resolution {id: r.p.id}) SET n += r.p', d.resolutions.map((x) => ({ p: props({ ...x, ...seed, created_at: resolvedAt.get(x.id) ?? T0 }) })));
  await q('MATCH (n:Resolution {id: r.id}), (k:KBArticle {id: r.kb}) MERGE (n)-[:BASED_ON]->(k)', d.resolutions.filter((x) => x.kb_id).map((x) => ({ id: x.id, kb: x.kb_id })));
  await q('MERGE (n:Release {version: r.p.version}) SET n += r.p', d.releases.map((x) => ({ p: props({ ...x, ...seed, created_at: x.shipped_at }) })));
  await q(`MATCH (n:Release {version: r.v}), (i:Issue {id: r.i}) CREATE (n)-[:INTRODUCED {valid_from: r.from, valid_until: r.until}]->(i)`,
    d.releases.flatMap((x) => x.introduces.map((i) => ({ v: x.version, i: i.issue_id, from: i.valid_from, until: untilOrForever(i.valid_until) }))));
  await q(`MATCH (c:Customer {id: r.c}), (p:Plan {name: r.plan}) CREATE (c)-[:ON_PLAN {valid_from: r.from, valid_until: r.until}]->(p)`,
    d.customers.flatMap((c) => c.plan_history.map((p) => ({ c: c.id, plan: p.plan, from: p.valid_from, until: untilOrForever(p.valid_until) }))));
  const tickets = d.tickets.map((t) => ({ ...t, p: props({ ...t, ...seed, ...(pending.includes(t.id) ? {} : { ingested_at: t.created_at }) }) }));
  for (let i = 0; i < tickets.length; i += 500) {
    const b = tickets.slice(i, i + 500);
    await q('MATCH (c:Customer {id: r.customer_id}) MERGE (n:Ticket {id: r.p.id}) SET n += r.p MERGE (c)-[:RAISED]->(n)', b);
    await q('MATCH (n:Ticket {id: r.id}), (i:Issue {id: r.issue_id}) MERGE (n)-[:ABOUT]->(i)', b.filter((t) => t.issue_id && !pending.includes(t.id)));
    await q('MATCH (n:Ticket {id: r.id}), (x:Resolution {id: r.resolution_id}) MERGE (n)-[:RESOLVED_BY]->(x)', b.filter((t) => t.resolution_id));
    await q('MATCH (n:Ticket {id: r.id}), (a:AgentUser {id: r.solved_by}) MERGE (a)-[:SOLVED]->(n)', b.filter((t) => t.solved_by));
    await q('MATCH (n:Ticket {id: r.id}), (p:Ticket {id: r.follows_ticket_id}) MERGE (n)-[:FOLLOWS]->(p)', b.filter((t) => t.follows_ticket_id));
  }
}

export type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Fresh throwaway graphs (test_dream_<name>_*), loaded with the fixture. cleanup() deletes them all. */
export async function fixture(name: string, d = fixtureDataset()) {
  const db = await connect();
  const p = `test_dream_${name}_${process.pid}`;
  const graphs: DreamGraphs = { company: `${p}_company`, prev: `${p}_prev`, scratch: `${p}_scratch`, teams: [`${p}_team_funds`] };
  for (const g of [graphs.company, graphs.prev, graphs.scratch, ...graphs.teams!]) await db.selectGraph(g).delete().catch(() => {});
  await loadFixture(db, graphs.company, d.dataset, d.pending);
  // The team graph exists (it holds the area node teach links candidates to).
  await db.selectGraph(graphs.teams![0]).query(`MERGE (:ProductArea {name: 'funds'})`);
  const counts = async (graph = graphs.company) => {
    const r = await db.selectGraph(graph).query<{ nodes: number; edges: number }>('MATCH (n) WITH count(n) AS nodes OPTIONAL MATCH ()-[e]->() RETURN nodes, count(e) AS edges');
    return r.data![0];
  };
  const rows = async <T = any>(cypher: string, params: Record<string, unknown> = {}, graph = graphs.company) =>
    ((await db.selectGraph(graph).query<T>(cypher, { params: params as any })).data ?? []) as T[];
  const cleanup = async () => {
    for (const g of [graphs.company, graphs.prev, graphs.scratch, ...graphs.teams!]) await db.selectGraph(g).delete().catch(() => {});
    await db.close();
  };
  return { db, graphs, dataset: d.dataset, counts, rows, cleanup };
}

/** Faux model: extracts each ticket deterministically; "Billing" subjects get the off-schema area "billing". */
export function fauxModel(): DreamModel & { faux: ReturnType<typeof fauxProvider>; reported: { input: number; output: number } } {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const reported = { input: 0, output: 0 };
  const respond = (ctx: any) => {
    const last = ctx.messages.at(-1);
    const text = typeof last.content === 'string' ? last.content : last.content.map((c: any) => c.text ?? '').join('');
    let out: string;
    try {
      const tickets = JSON.parse(text);
      if (!Array.isArray(tickets) || !tickets[0]?.subject) throw 0;
      out = JSON.stringify({ items: tickets.map((t: any) => /billing/i.test(t.subject)
        ? { ticket_id: t.id, issue: 'double charge', area: 'billing' }
        : { ticket_id: t.id, issue: /log in/i.test(t.subject) ? 'login loop after otp' : 'payment debited, order not placed', area: /log in/i.test(t.subject) ? 'login' : 'orders' }) });
    } catch {
      out = 'This process takes longer than the document says. The owning team should update it.';
    }
    return fauxAssistantMessage(out);
  };
  // The faux provider pops one scripted response per call; queue plenty of factories.
  faux.setResponses(Array.from({ length: 500 }, () => respond));
  const complete = models.complete.bind(models);
  (models as any).complete = async (...args: any[]) => {
    const msg = await (complete as any)(...args);
    reported.input += msg.usage.input; reported.output += msg.usage.output;
    return msg;
  };
  return { models, model: faux.getModel(), faux, reported };
}
