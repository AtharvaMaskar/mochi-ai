// Minimal loader for the contract fixture into a throwaway graph (admin connection). Follows the graph contract:
// created_at + source on every node, VALID_FOREVER for live temporal edges, TEMPORAL_INDEXES, a 4-dim vector index.
// ponytail: swap for @mochi/gen's loadDataset at the integration sweep; this stays as the 4-dim test variant.
import { tinyDataset, untilOrForever, TEMPORAL_INDEXES, type Dataset } from '@mochi/contracts';
import { FalkorDB } from 'falkordb';
import { embedStub, STUB_DIM } from './embed-stub.ts';

export const DAY = 86_400_000;
export const T0 = Date.UTC(2026, 6, 20);

/** tinyDataset plus T-3, a ticket with no ABOUT edge whose text matches T-1 (the vector-fallback case). */
export function richFixture(): Dataset {
  const d = tinyDataset();
  d.tickets.push({
    id: 'T-3', customer_id: 'C-1', subject: 'Order not placed', body: 'Paisa kat gaya, order nahi laga', channel: 'chat',
    status: 'open', priority: 'high', created_at: T0 + 43 * DAY, resolved_at: null,
    issue_id: null, resolution_id: null, solved_by: null, follows_ticket_id: null,
  });
  return d;
}

/** Cluster nodes as the dream would write them (SPEC query 4 reads them). */
export const FIXTURE_CLUSTERS = [{ id: 'CL-T-1', created_at: T0 + 44 * DAY, members: [['T-1', T0 + 44 * DAY], ['T-2', T0 + 44 * DAY]] as const }];

export async function admin() {
  process.loadEnvFile?.(new URL('../../.env', import.meta.url).pathname);
  return FalkorDB.connect({
    socket: { host: process.env.FALKORDB_HOST ?? 'localhost', port: Number(process.env.FALKORDB_PORT ?? 6379) },
    password: process.env.FALKORDB_PASSWORD,
  });
}

export const testGraph = (tag: string) => `test_agent_${tag}_${process.pid}`;

export async function loadFixture(db: FalkorDB, graph: string, d: Dataset = richFixture()) {
  const g = db.selectGraph(graph);
  const q = (cypher: string, params: Record<string, unknown> = {}) => g.query(cypher, { params: params as never });
  const vecs = await embedStub(d.tickets.map((t) => `${t.subject} ${t.body}`));
  const ticketCreated = new Map(d.tickets.map((t) => [t.id, t]));

  await q(`UNWIND $rows AS r CREATE (:Plan {name: r.name, created_at: 0, source: 'seed'})`, { rows: d.plans });
  await q(`UNWIND $rows AS r CREATE (:Team {name: r.name, created_at: 0, source: 'seed'})`, { rows: d.teams });
  await q(`UNWIND $rows AS r MATCH (tm:Team {name: r.team}) CREATE (a:ProductArea {name: r.name, created_at: 0, source: 'seed'})-[:OWNED_BY]->(tm)`, { rows: d.product_areas });
  await q(`UNWIND $rows AS r MATCH (tm:Team {name: r.team}) CREATE (:AgentUser {id: r.id, name: r.name, created_at: 0, source: 'seed'})-[:MEMBER_OF]->(tm)`, { rows: d.agents });
  await q(`UNWIND $rows AS r MATCH (a:ProductArea {name: r.area})
    CREATE (:Issue {id: r.id, name: r.name, first_seen: r.first_seen, created_at: r.first_seen, source: 'seed'})-[:IN]->(a)`, { rows: d.issues });
  await q(`UNWIND $rows AS r CREATE (:KBArticle {id: r.id, title: r.title, area: r.area, updated_at: r.updated_at, promised_tat_hours: r.promised_tat_hours, steps: r.steps, created_at: r.updated_at, source: 'seed'})`, { rows: d.kb_articles });
  await q(`UNWIND $rows AS r CREATE (res:Resolution {id: r.id, kind: r.kind, summary: r.summary, created_at: r.created_at, source: 'seed'})
    WITH res, r MATCH (k:KBArticle {id: r.kb_id}) CREATE (res)-[:BASED_ON]->(k)`,
  { rows: d.resolutions.map((r) => ({ ...r, created_at: d.tickets.find((t) => t.resolution_id === r.id)?.resolved_at ?? 0 })) });
  await q(`UNWIND $rows AS r CREATE (c:Customer {id: r.id, name: r.name, segment: r.segment, city: r.city, language: r.language, joined_at: r.joined_at, created_at: r.joined_at, source: 'seed'})
    WITH c, r UNWIND r.plans AS p MATCH (pl:Plan {name: p.plan}) CREATE (c)-[:ON_PLAN {valid_from: p.valid_from, valid_until: p.valid_until}]->(pl)`,
  { rows: d.customers.map((c) => ({ ...c, plans: c.plan_history.map((p) => ({ ...p, valid_until: untilOrForever(p.valid_until) })) })) });
  await q(`UNWIND $rows AS r MATCH (c:Customer {id: r.customer_id})
    CREATE (c)-[:RAISED]->(t:Ticket {id: r.id, subject: r.subject, body: r.body, channel: r.channel, status: r.status, priority: r.priority,
      created_at: r.created_at, source: 'seed', embedding: vecf32(r.vec)})
    SET t.resolved_at = r.resolved_at`,
  { rows: d.tickets.map((t, i) => ({ ...t, vec: vecs[i] })) });
  await q(`UNWIND $rows AS r MATCH (t:Ticket {id: r.id}), (i:Issue {id: r.issue_id}) CREATE (t)-[:ABOUT]->(i)`, { rows: d.tickets.filter((t) => t.issue_id) });
  await q(`UNWIND $rows AS r MATCH (t:Ticket {id: r.id}), (x:Resolution {id: r.resolution_id}) CREATE (t)-[:RESOLVED_BY]->(x)`, { rows: d.tickets.filter((t) => t.resolution_id) });
  await q(`UNWIND $rows AS r MATCH (t:Ticket {id: r.id}), (a:AgentUser {id: r.solved_by}) CREATE (a)-[:SOLVED]->(t)`, { rows: d.tickets.filter((t) => t.solved_by) });
  await q(`UNWIND $rows AS r MATCH (t:Ticket {id: r.id}), (p:Ticket {id: r.follows_ticket_id}) CREATE (t)-[:FOLLOWS]->(p)`, { rows: d.tickets.filter((t) => t.follows_ticket_id) });
  await q(`UNWIND $rows AS r CREATE (rel:Release {version: r.version, shipped_at: r.shipped_at, notes: r.notes, created_at: r.shipped_at, source: 'seed'})
    WITH rel, r UNWIND r.introduces AS x MATCH (i:Issue {id: x.issue_id}) CREATE (rel)-[:INTRODUCED {valid_from: x.valid_from, valid_until: x.valid_until}]->(i)`,
  { rows: d.releases.map((r) => ({ ...r, introduces: r.introduces.map((x) => ({ ...x, valid_until: untilOrForever(x.valid_until) })) })) });
  // Fixed issues retire their INTRODUCED edge at the event time (the temporal rule; gen's applyEvent in production).
  for (const e of d.contradiction_events) if (e.kind === 'issue_fixed')
    await q(`MATCH (:Release)-[x:INTRODUCED]->(:Issue {id: $issue}) WHERE x.valid_until > $at SET x.valid_until = $at`, { issue: e.issue_id, at: e.at });
  for (const c of FIXTURE_CLUSTERS) if (c.members.every(([t]) => ticketCreated.has(t)))
    await q(`CREATE (cl:Cluster {id: $id, created_at: $at, source: 'dream'}) WITH cl UNWIND $members AS m
      MATCH (t:Ticket {id: m[0]}) CREATE (t)-[:IN_CLUSTER {valid_from: m[1], valid_until: $forever}]->(cl)`,
    { id: c.id, at: c.created_at, members: c.members, forever: untilOrForever(null) });
  for (const idx of TEMPORAL_INDEXES) await q(idx);
  await q(`CREATE VECTOR INDEX FOR (t:Ticket) ON (t.embedding) OPTIONS {dimension: ${STUB_DIM}, similarityFunction: 'cosine'}`);
}

/** Expected counts for `d` as loaded above (verifies the loader against the fixture). */
export function expectedCounts(d: Dataset) {
  const has = new Set(d.tickets.map((t) => t.id));
  const clusters = FIXTURE_CLUSTERS.filter((c) => c.members.every(([t]) => has.has(t)));
  return {
    nodes: d.customers.length + d.tickets.length + d.issues.length + d.product_areas.length + d.teams.length + d.agents.length
      + d.resolutions.length + d.kb_articles.length + d.releases.length + d.plans.length + clusters.length,
    edges: d.tickets.length /* RAISED */ + d.customers.reduce((n, c) => n + c.plan_history.length, 0)
      + d.tickets.filter((t) => t.issue_id).length + d.issues.length /* IN */ + d.product_areas.length + d.agents.length
      + d.tickets.filter((t) => t.resolution_id).length + d.tickets.filter((t) => t.solved_by).length
      + d.tickets.filter((t) => t.follows_ticket_id).length + d.resolutions.filter((r) => r.kb_id).length
      + d.releases.reduce((n, r) => n + r.introduces.length, 0) + clusters.reduce((n, c) => n + c.members.length, 0),
  };
}
