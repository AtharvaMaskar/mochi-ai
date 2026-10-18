// Loads data/dataset.json into FalkorDB under the graph contract (SPEC §1/§2).
// `npm run load [-- --fresh]` connects as mochi_dream. Idempotent: MERGE on id keys and temporal keys.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { FalkorDB, ConstraintType, EntityType } from 'falkordb';
import { GRAPH, ACL, TEMPORAL_INDEXES, untilOrForever, validateDataset, type Dataset, type Label } from '@mochi/contracts';
import { embed, EMBED_DIM } from './embed.ts';

const BATCH = 500, EMBED_BATCH = 64;
type Db = Awaited<ReturnType<typeof FalkorDB.connect>>;
type Row = Record<string, unknown>;

// Drop nulls: FalkorDB cannot store them (docs/falkordb.md gotcha 1).
const clean = (o: Row) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

function nodes(d: Dataset): { label: Label; key: string; rows: Row[] }[] {
  const t0 = d.generated_at - 90 * 86_400_000, demo = d.generated_at - 86_400_000;
  const resolvedAt = new Map<string, number>();
  for (const t of d.tickets) if (t.resolution_id && t.resolved_at !== null) resolvedAt.set(t.resolution_id, Math.min(resolvedAt.get(t.resolution_id) ?? Infinity, t.resolved_at));
  const seed = (created_at: number, p: Row) => clean({ ...p, created_at, source: 'seed' });
  return [
    { label: 'Team', key: 'name', rows: d.teams.map((x) => seed(t0, { name: x.name })) },
    { label: 'ProductArea', key: 'name', rows: d.product_areas.map((x) => seed(t0, { name: x.name })) },
    { label: 'Plan', key: 'name', rows: d.plans.map((x) => seed(t0, { name: x.name })) },
    { label: 'AgentUser', key: 'id', rows: d.agents.map((x) => seed(t0, { id: x.id, name: x.name })) },
    { label: 'Customer', key: 'id', rows: d.customers.map(({ plan_history, ...c }) => seed(c.joined_at, c)) },
    { label: 'Issue', key: 'id', rows: d.issues.map(({ area, ...i }) => seed(i.first_seen, i)) },
    { label: 'Release', key: 'version', rows: d.releases.map(({ introduces, ...r }) => seed(r.shipped_at, r)) },
    { label: 'KBArticle', key: 'id', rows: d.kb_articles.map((k) => seed(k.updated_at, k)) },
    { label: 'Resolution', key: 'id', rows: d.resolutions.map(({ kb_id, ...r }) => seed(resolvedAt.get(r.id) ?? t0, r)) },
    { label: 'Ticket', key: 'id', rows: d.tickets.map(({ customer_id, issue_id, resolution_id, solved_by, follows_ticket_id, ...t }) =>
      seed(t.created_at, { ...t, ingested_at: t.created_at >= demo ? null : t.created_at })) },
  ];
}

type EdgeSpec = { type: string; from: [Label, string]; to: [Label, string]; temporal?: boolean; rows: Row[] };
function edges(d: Dataset): EdgeSpec[] {
  const ab = (a: unknown, b: unknown) => ({ a, b });
  return [
    { type: 'OWNED_BY', from: ['ProductArea', 'name'], to: ['Team', 'name'], rows: d.product_areas.map((a) => ab(a.name, a.team)) },
    { type: 'MEMBER_OF', from: ['AgentUser', 'id'], to: ['Team', 'name'], rows: d.agents.map((a) => ab(a.id, a.team)) },
    { type: 'IN', from: ['Issue', 'id'], to: ['ProductArea', 'name'], rows: d.issues.map((i) => ab(i.id, i.area)) },
    { type: 'BASED_ON', from: ['Resolution', 'id'], to: ['KBArticle', 'id'], rows: d.resolutions.filter((r) => r.kb_id).map((r) => ab(r.id, r.kb_id)) },
    { type: 'RAISED', from: ['Customer', 'id'], to: ['Ticket', 'id'], rows: d.tickets.map((t) => ab(t.customer_id, t.id)) },
    { type: 'ABOUT', from: ['Ticket', 'id'], to: ['Issue', 'id'], rows: d.tickets.filter((t) => t.issue_id).map((t) => ab(t.id, t.issue_id)) },
    { type: 'SOLVED', from: ['AgentUser', 'id'], to: ['Ticket', 'id'], rows: d.tickets.filter((t) => t.solved_by).map((t) => ab(t.solved_by, t.id)) },
    { type: 'RESOLVED_BY', from: ['Ticket', 'id'], to: ['Resolution', 'id'], rows: d.tickets.filter((t) => t.resolution_id).map((t) => ab(t.id, t.resolution_id)) },
    { type: 'FOLLOWS', from: ['Ticket', 'id'], to: ['Ticket', 'id'], rows: d.tickets.filter((t) => t.follows_ticket_id).map((t) => ab(t.id, t.follows_ticket_id)) },
    { type: 'ON_PLAN', from: ['Customer', 'id'], to: ['Plan', 'name'], temporal: true,
      rows: d.customers.flatMap((c) => c.plan_history.map((p) => ({ ...ab(c.id, p.plan), from: p.valid_from, until: untilOrForever(p.valid_until) }))) },
    { type: 'INTRODUCED', from: ['Release', 'version'], to: ['Issue', 'id'], temporal: true,
      rows: d.releases.flatMap((r) => r.introduces.map((x) => ({ ...ab(r.version, x.issue_id), from: x.valid_from, until: untilOrForever(x.valid_until) }))) },
  ];
}

async function batched(rows: Row[], size: number, run: (rows: Row[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await run(rows.slice(i, i + size));
}

// Index / constraint creation is not idempotent in FalkorDB; "already indexed/exists" is fine on reload.
async function ignoreExists(p: Promise<unknown>) {
  try { await p; } catch (e) { if (!/already/i.test((e as Error).message)) throw e; }
}

export async function loadDataset(dataset: Dataset, db: Db, { graph = GRAPH.company as string, fresh = false } = {}): Promise<Record<string, number>> {
  const v = validateDataset(dataset);
  if (!v.ok) throw new Error(`dataset invalid:\n${v.errors.join('\n')}`);
  const g = db.selectGraph(graph);
  if (fresh) await g.delete().catch(() => {}); // a missing graph is already fresh
  const ns = nodes(dataset);

  for (const { label, key } of ns) await ignoreExists(g.query(`CREATE INDEX FOR (n:${label}) ON (n.${key})`));
  for (const q of TEMPORAL_INDEXES) await ignoreExists(g.query(q));
  for (const label of ['Ticket', 'KBArticle'])
    await ignoreExists(g.query(`CREATE VECTOR INDEX FOR (n:${label}) ON (n.embedding) OPTIONS {dimension:${EMBED_DIM}, similarityFunction:'cosine'}`));
  for (const { label, key } of ns) await ignoreExists(g.constraintCreate(ConstraintType.UNIQUE, EntityType.NODE, label, key));
  for (let tries = 0; ; tries++) { // constraints build asynchronously (gotcha 8)
    const r = await g.query<{ label: string; status: string }>('CALL db.constraints() YIELD label, status RETURN label, status');
    const failed = r.data?.filter((c) => c.status === 'FAILED') ?? [];
    if (failed.length) throw new Error(`unique constraint FAILED on ${failed.map((c) => c.label).join(', ')}`);
    if (r.data?.every((c) => c.status === 'OPERATIONAL')) break;
    if (tries > 100) throw new Error('constraints not OPERATIONAL after 10s');
    await new Promise((res) => setTimeout(res, 100));
  }

  for (const { label, key, rows } of ns)
    await batched(rows.map((p) => ({ k: p[key], p })), BATCH, (rows) => g.query(`UNWIND $rows AS r MERGE (n:${label} {${key}: r.k}) SET n += r.p`, { params: { rows } as any }));
  for (const e of edges(dataset)) {
    const match = `UNWIND $rows AS r MATCH (a:${e.from[0]} {${e.from[1]}: r.a}), (b:${e.to[0]} {${e.to[1]}: r.b})`;
    // ON CREATE only: a reload must never revive a fact the dream has since retired.
    const q = e.temporal ? `${match} MERGE (a)-[x:${e.type} {valid_from: r.from}]->(b) ON CREATE SET x.valid_until = r.until` : `${match} MERGE (a)-[:${e.type}]->(b)`;
    await batched(e.rows, BATCH, (rows) => g.query(q, { params: { rows } as any }));
  }

  const texts: { label: string; id: string; text: string }[] = [
    ...dataset.tickets.map((t) => ({ label: 'Ticket', id: t.id, text: `${t.subject}\n${t.body}` })),
    ...dataset.kb_articles.map((k) => ({ label: 'KBArticle', id: k.id, text: `${k.title}\n${k.steps.join('\n')}` })),
  ];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const chunk = texts.slice(i, i + EMBED_BATCH);
    const vs = await embed(chunk.map((x) => x.text));
    for (const label of ['Ticket', 'KBArticle']) {
      const rows = chunk.flatMap((x, j) => (x.label === label ? [{ id: x.id, v: vs[j] }] : []));
      if (rows.length) await g.query(`UNWIND $rows AS r MATCH (n:${label} {id: r.id}) SET n.embedding = vecf32(r.v)`, { params: { rows } });
    }
  }

  const counts: Record<string, number> = {};
  for (const { label } of ns) counts[label] = (await g.roQuery<{ n: number }>(`MATCH (n:${label}) RETURN count(n) AS n`)).data![0].n;
  for (const e of edges(dataset)) counts[e.type] = (await g.roQuery<{ n: number }>(`MATCH ()-[x:${e.type}]->() RETURN count(x) AS n`)).data![0].n;
  return counts;
}

export function readDataset(): Dataset {
  return JSON.parse(readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8'));
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { fresh: { type: 'boolean', default: false } } });
  try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* rely on the real environment */ }
  const password = process.env[ACL.dream.passwordEnv];
  if (!password) throw new Error(`missing ${ACL.dream.passwordEnv} (see .env.example)`);
  const db = await FalkorDB.connect({
    socket: { host: process.env.FALKORDB_HOST ?? 'localhost', port: Number(process.env.FALKORDB_PORT ?? 6379) },
    username: ACL.dream.user, password,
  });
  try {
    const fresh = values.fresh || process.env.npm_config_fresh === 'true'; // root `npm run load -- --fresh` arrives as npm config
    const counts = await loadDataset(readDataset(), db, { fresh });
    console.log(`loaded ${GRAPH.company}${fresh ? ' (fresh)' : ''}:`);
    for (const [k, n] of Object.entries(counts)) console.log(`  ${k.padEnd(12)} ${n}`);
  } finally { await db.close(); }
}
