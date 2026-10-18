// Arm E: the same dataset as SQLite tables (node:sqlite), queried by hand-written SQL that mirrors arm D's read tools
// one for one: same tool names, descriptions and arguments (generated from READ_TOOL_SPECS), same columns, same
// temporal filter. Only the store and its query language change. Like A/B/C, E reads the JSON directly, so it has
// every ticket's issue link without the dream's extraction. D's query_graph is mirrored by query_sql (model-written
// read-only SQL, same row cap and timeout). D's graph_algorithm has no mirror: SQLite has no PageRank/CDLP, and paths
// exist only as recursive CTEs written through query_sql (bench/artifacts/arm-e.md).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { Type, type Tool } from '@earendil-works/pi-ai';
import { untilOrForever, type ContradictionEvent, type Dataset } from '@mochi/contracts';
import { embed, READ_TOOL_SPECS, ROW_CAP, TIMEOUT_MS } from '../deps.ts';
import { ZERO } from '../llm.ts';
import { toolLoop } from './d.ts';
import { ANSWER_SYSTEM, timed, type Arm, type Ctx } from './index.ts';

type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, segment TEXT, city TEXT, language TEXT, joined_at INTEGER);
CREATE TABLE on_plan (customer_id TEXT, plan TEXT, valid_from INTEGER, valid_until INTEGER);
CREATE TABLE tickets (id TEXT PRIMARY KEY, customer_id TEXT, subject TEXT, body TEXT, status TEXT, created_at INTEGER,
  resolved_at INTEGER, issue_id TEXT, resolution_id TEXT, solved_by TEXT, follows_ticket_id TEXT, merged_into TEXT, embedding TEXT);
CREATE TABLE issues (id TEXT PRIMARY KEY, name TEXT, area TEXT, first_seen INTEGER);
CREATE TABLE releases (version TEXT PRIMARY KEY, shipped_at INTEGER, notes TEXT);
CREATE TABLE introduced (version TEXT, issue_id TEXT, valid_from INTEGER, valid_until INTEGER);
CREATE TABLE resolutions (id TEXT PRIMARY KEY, kind TEXT, summary TEXT, kb_id TEXT);
CREATE TABLE kb_articles (id TEXT PRIMARY KEY, title TEXT, area TEXT, updated_at INTEGER);
CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT, team TEXT);
CREATE INDEX tickets_customer ON tickets (customer_id);
CREATE INDEX tickets_issue ON tickets (issue_id);
CREATE INDEX on_plan_customer ON on_plan (customer_id, valid_until);
CREATE INDEX introduced_issue ON introduced (issue_id, valid_until);`;

// The temporal rule of contracts EDGE_AS_OF, in SQL: valid_until is VALID_FOREVER while live, never NULL.
const LIVE = (t: string) => `${t}.valid_from <= $as_of AND ${t}.valid_until > $as_of`;

export const SQL = {
  profile: `SELECT c.id AS customer_id, c.name AS name, c.segment AS segment, c.city AS city, p.plan AS plan,
  t.subject AS ticket_subject, t.issue_id AS issue_id
FROM tickets t JOIN customers c ON c.id = t.customer_id
LEFT JOIN on_plan p ON p.customer_id = c.id AND ${LIVE('p')}
WHERE t.id = $ticketId AND t.created_at <= $as_of`,
  recent: `SELECT t.id AS ticket, t.subject AS subject, t.status AS status, t.created_at AS created_at
FROM tickets t WHERE t.customer_id = (SELECT customer_id FROM tickets WHERE id = $ticketId)
  AND t.id <> $ticketId AND t.created_at <= $as_of
ORDER BY t.created_at DESC, t.id LIMIT 3`,
  similar: `SELECT s.id AS ticket, s.subject AS subject, i.id AS issue_id, i.name AS issue,
  r.id AS resolution_id, r.summary AS resolution, k.id AS kb_id, k.title AS kb
FROM tickets t JOIN issues i ON i.id = t.issue_id
JOIN tickets s ON s.issue_id = i.id AND s.id <> t.id
JOIN resolutions r ON r.id = s.resolution_id
LEFT JOIN kb_articles k ON k.id = r.kb_id
WHERE t.id = $ticketId AND s.created_at <= $as_of AND s.resolved_at <= $as_of
ORDER BY s.resolved_at DESC, s.id LIMIT 5`,
  resolvedTickets: `SELECT s.id AS ticket, s.subject AS subject, i.id AS issue_id, i.name AS issue,
  r.id AS resolution_id, r.summary AS resolution, k.id AS kb_id, k.title AS kb, s.embedding AS embedding
FROM tickets s JOIN resolutions r ON r.id = s.resolution_id
LEFT JOIN issues i ON i.id = s.issue_id LEFT JOIN kb_articles k ON k.id = r.kb_id
WHERE s.id <> $ticketId AND s.created_at <= $as_of AND s.resolved_at <= $as_of`,
  likelyCause: `SELECT t.id AS ticket, t.subject AS subject, i.id AS issue_id, i.name AS issue,
  r.version AS release, r.shipped_at AS shipped_at, x.valid_from AS introduced_at
FROM tickets t JOIN issues i ON i.id = t.issue_id
JOIN introduced x ON x.issue_id = i.id AND ${LIVE('x')}
JOIN releases r ON r.version = x.version
WHERE t.id = $ticketId AND t.created_at <= $as_of
ORDER BY r.shipped_at DESC, r.version LIMIT 3`,
  whoKnows: `SELECT a.id AS agent_id, a.name AS agent, a.team AS team, count(*) AS solved, min(t.id) AS example_ticket, i.name AS issue
FROM tickets t JOIN agents a ON a.id = t.solved_by JOIN issues i ON i.id = t.issue_id
WHERE i.id = $issueId AND t.created_at <= $as_of
GROUP BY a.id ORDER BY solved DESC, agent_id LIMIT 5`,
  // No community detection in SQL: a cluster is the tickets sharing an issue, which is what CDLP over Ticket-Issue finds.
  emergingClusters: `SELECT issue_id AS cluster, count(*) AS tickets, sum(created_at > $as_of - $window_ms) AS growth
FROM tickets WHERE issue_id IS NOT NULL AND created_at <= $as_of
GROUP BY issue_id ORDER BY growth DESC, tickets DESC, cluster LIMIT 10`,
  blastSegments: `SELECT c.segment AS segment, count(DISTINCT c.id) AS customers, count(DISTINCT t.id) AS tickets
FROM introduced x JOIN tickets t ON t.issue_id = x.issue_id JOIN customers c ON c.id = t.customer_id
WHERE x.version = $version AND ${LIVE('x')} AND t.created_at <= $as_of
GROUP BY c.segment ORDER BY customers DESC, segment`,
  blastTotals: `SELECT count(DISTINCT c.id) AS customers, count(DISTINCT t.id) AS tickets,
  count(DISTINCT CASE WHEN t.resolved_at IS NULL OR t.resolved_at > $as_of THEN t.id END) AS open_tickets
FROM introduced x JOIN tickets t ON t.issue_id = x.issue_id JOIN customers c ON c.id = t.customer_id
WHERE x.version = $version AND ${LIVE('x')} AND t.created_at <= $as_of`,
  blastAffected: `SELECT c.id AS customer_id, c.name AS customer, c.segment AS segment, t.id AS ticket, t.subject AS subject,
  i.id AS issue_id, i.name AS issue, CASE WHEN t.resolved_at IS NULL OR t.resolved_at > $as_of THEN 'open' ELSE 'resolved' END AS state
FROM introduced x JOIN issues i ON i.id = x.issue_id JOIN tickets t ON t.issue_id = i.id JOIN customers c ON c.id = t.customer_id
WHERE x.version = $version AND ${LIVE('x')} AND t.created_at <= $as_of
ORDER BY t.created_at DESC, t.id LIMIT 10`,
  allTickets: `SELECT t.id AS ticket, t.subject AS subject, t.status AS status, i.name AS issue, t.embedding AS embedding
FROM tickets t LEFT JOIN issues i ON i.id = t.issue_id WHERE t.created_at <= $as_of`,
  customer: `SELECT c.id AS customer_id, c.name AS name, c.segment AS segment, p.plan AS plan, c.city AS city
FROM customers c LEFT JOIN on_plan p ON p.customer_id = c.id AND ${LIVE('p')} WHERE c.id = $customerId`,
  customerHistory: `SELECT t.id AS ticket, t.subject AS subject, t.created_at AS created_at, t.status AS status,
  r.kind AS resolution_kind, coalesce(r.summary, 'Closed with no recorded fix') AS ended
FROM tickets t LEFT JOIN resolutions r ON r.id = t.resolution_id
WHERE t.customer_id = $customerId AND t.created_at <= $as_of AND t.status IN ('resolved', 'closed') AND t.merged_into IS NULL
ORDER BY t.created_at DESC, t.id LIMIT 10`,
  customerOpen: `SELECT t.id AS ticket, t.subject AS subject, t.created_at AS created_at, t.status AS status
FROM tickets t WHERE t.customer_id = $customerId AND t.created_at <= $as_of AND t.status NOT IN ('resolved', 'closed')
ORDER BY t.created_at DESC, t.id LIMIT 10`,
  customerMerged: `SELECT d.id AS ticket, d.subject AS subject, d.merged_into AS merged_into
FROM tickets d JOIN tickets p ON p.id = d.merged_into
WHERE d.customer_id = $customerId AND d.created_at <= $as_of AND p.created_at <= $as_of
ORDER BY d.created_at DESC, d.id LIMIT 10`,
  retirePlan: `UPDATE on_plan SET valid_until = $as_of WHERE customer_id = $id AND plan <> $to AND ${LIVE('on_plan')}`,
  insertPlan: `INSERT INTO on_plan VALUES ($id, $to, $as_of, $forever)`,
  retireIntroduced: `UPDATE introduced SET valid_until = $as_of WHERE issue_id = $id AND ${LIVE('introduced')}`,
} as const;

type Sql = DatabaseSync;
const all = (db: Sql, sql: string, p: Row): Row[] => {
  const s = db.prepare(sql);
  s.setAllowUnknownNamedParameters(true);
  return s.all(p as Record<string, string | number | null>) as Row[];
};

/** Brute-force cosine (vectors are normalized, so 1 - dot is the distance FalkorDB's index returns). Drops `embedding`. */
function nearest(rows: Row[], v: number[], k: number): Row[] {
  return rows.map(({ embedding, ...r }) => {
    const e = JSON.parse(String(embedding)) as number[];
    return { ...r, score: 1 - e.reduce((s, x, i) => s + x * v[i], 0) } as Row & { score: number };
  }).sort((a, b) => a.score - b.score || String(a.ticket).localeCompare(String(b.ticket))).slice(0, k);
}

/** One SQL implementation per READ_TOOL_SPECS name; each returns query id -> rows, the shape arm D renders. */
export const SQL_TOOLS: Record<string, (db: Sql, a: any, as_of: number) => Promise<Record<string, Row[]>>> = {
  async briefing(db, a, as_of) {
    const p = { ticketId: a.ticketId, as_of };
    const q_1 = all(db, SQL.profile, p);
    const q_2 = all(db, SQL.recent, p);
    const self = all(db, 'SELECT embedding FROM tickets WHERE id = $ticketId', p)[0];
    // D's vector fallback when the ticket has no issue link yet, here as a scan over stored embeddings.
    const q_3 = q_1[0] && !q_1[0].issue_id && self
      ? nearest(all(db, SQL.resolvedTickets, p), JSON.parse(String(self.embedding)), 5)
      : all(db, SQL.similar, p);
    return { q_1, q_2, q_3 };
  },
  async likely_cause(db, a, as_of) { return { q_1: all(db, SQL.likelyCause, { ticketId: a.ticketId, as_of }) }; },
  async who_knows(db, a, as_of) { return { q_1: all(db, SQL.whoKnows, { issueId: a.issueId, as_of }) }; },
  async emerging_clusters(db, a, as_of) {
    return { q_1: all(db, SQL.emergingClusters, { window_ms: Math.round((a.days ?? 7) * 86_400_000), as_of }) };
  },
  async blast_radius(db, a, as_of) {
    const p = { version: a.version, as_of };
    return { q_1: all(db, SQL.blastSegments, p), q_2: all(db, SQL.blastTotals, p), q_3: all(db, SQL.blastAffected, p) };
  },
  async search_similar(db, a, as_of) {
    const k = Math.min(Math.max(1, Math.round(a.k ?? 5)), 20);
    const [v] = await embed([String(a.text)]);
    return { q_1: nearest(all(db, SQL.allTickets, { as_of }), v, k) };
  },
  async customer_profile(db, a, as_of) {
    const p = { customerId: a.customerId, as_of };
    return { q_1: all(db, SQL.customer, p), q_2: all(db, SQL.customerHistory, p), q_3: all(db, SQL.customerOpen, p), q_4: all(db, SQL.customerMerged, p) };
  },
};

export function load(d: Dataset, vectors: Map<string, number[]>, file = ':memory:'): Sql {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const ins = (table: string, n: number) => db.prepare(`INSERT INTO ${table} VALUES (${Array(n).fill('?').join(', ')})`);
  db.exec('BEGIN');
  const c = ins('customers', 6), p = ins('on_plan', 4), t = ins('tickets', 13), i = ins('issues', 4), r = ins('releases', 3);
  const x = ins('introduced', 4), rs = ins('resolutions', 4), k = ins('kb_articles', 4), a = ins('agents', 3);
  for (const v of d.customers) {
    c.run(v.id, v.name, v.segment, v.city, v.language, v.joined_at);
    for (const h of v.plan_history) p.run(v.id, h.plan, h.valid_from, untilOrForever(h.valid_until));
  }
  for (const v of d.tickets) t.run(v.id, v.customer_id, v.subject, v.body, v.status, v.created_at, v.resolved_at, v.issue_id,
    v.resolution_id, v.solved_by, v.follows_ticket_id, v.merged_into ?? null, JSON.stringify(vectors.get(v.id) ?? []));
  for (const v of d.issues) i.run(v.id, v.name, v.area, v.first_seen);
  for (const v of d.releases) {
    r.run(v.version, v.shipped_at, v.notes);
    for (const y of v.introduces) x.run(v.version, y.issue_id, y.valid_from, untilOrForever(y.valid_until));
  }
  for (const v of d.resolutions) rs.run(v.id, v.kind, v.summary, v.kb_id);
  for (const v of d.kb_articles) k.run(v.id, v.title, v.area, v.updated_at);
  for (const v of d.agents) a.run(v.id, v.name, v.team);
  db.exec('COMMIT');
  return db;
}

/** applyEvent's retire-and-insert, in SQL: close the live row at the event time, then insert the new fact. */
export function applySql(db: Sql, e: ContradictionEvent, at = e.at) {
  const s = (sql: string) => { const st = db.prepare(sql); st.setAllowUnknownNamedParameters(true); return st; };
  if (e.kind === 'plan_change') {
    const p = { id: e.customer_id, to: e.to, as_of: at, forever: untilOrForever(null) };
    if (Number(s(SQL.retirePlan).run(p).changes) > 0) s(SQL.insertPlan).run(p);
  } else s(SQL.retireIntroduced).run({ id: e.issue_id, as_of: at });
}

// query_sql runs in a child process on a read-only connection: SIGKILL is the only way to stop a statement stuck in
// SQLite's native loop (a worker's terminate() cannot interrupt it), so a runaway statement dies at TIMEOUT_MS.
const CHILD = `const w = JSON.parse(process.argv[1]);
const db = new (require('node:sqlite').DatabaseSync)(w.file, { readOnly: true });
const st = db.prepare(w.sql); st.setAllowUnknownNamedParameters(true);
const rows = [];
for (const r of st.iterate({ as_of: w.as_of })) { rows.push(r); if (rows.length > w.cap) break; }
process.stdout.write(JSON.stringify(rows));`;

export function querySql(file: string, sql: string, as_of: number): Promise<{ rows: Row[]; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['--no-warnings', '-e', CHILD, JSON.stringify({ file, sql, as_of, cap: ROW_CAP })],
      { timeout: TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 32 << 20 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(err.killed ? `statement timeout after ${TIMEOUT_MS} ms` : (stderr.match(/Error: .*/)?.[0] ?? err.message)));
        const rows = JSON.parse(stdout) as Row[];
        resolve({ rows: rows.slice(0, ROW_CAP), truncated: rows.length > ROW_CAP });
      });
  });
}

export const QUERY_SQL: Tool = {
  name: 'query_sql',
  description: `Your own read-only SQLite SELECT over the database schema, for anything the fixed tools do not cover. May use $as_of (epoch ms, always bound): filter rows with created_at <= $as_of, temporal rows with valid_from <= $as_of AND valid_until > $as_of. Up to ${ROW_CAP} rows, ${TIMEOUT_MS / 1000} s timeout.`,
  parameters: Type.Object({ sql: Type.String(), purpose: Type.String() }),
};

// The compact schema section, mirroring D's SCHEMA_PROMPT (same examples, in SQL).
const SQL_SCHEMA = `Database schema (SQLite; times are epoch ms; a live temporal row has valid_until = ${untilOrForever(null)}):
${SCHEMA.split('\n').filter((l) => l.startsWith('CREATE TABLE') || l.startsWith('  ')).join('\n')}
Temporal tables: on_plan (customer plans), introduced (release introduced issue); a row is live at $as_of when valid_from <= $as_of AND valid_until > $as_of.
Prefer the fixed tools when one fits; use query_sql for anything else. Paths are joins or WITH RECURSIVE.
query_sql examples:
- tickets per area this week: SELECT i.area, count(DISTINCT t.id) AS tickets FROM tickets t JOIN issues i ON i.id = t.issue_id WHERE t.created_at <= $as_of AND t.created_at > $as_of - 604800000 GROUP BY i.area ORDER BY tickets DESC
- open tickets for a release: SELECT t.id AS ticket, t.subject, i.name AS issue FROM introduced x JOIN issues i ON i.id = x.issue_id JOIN tickets t ON t.issue_id = i.id WHERE x.version = '3.2.0' AND x.valid_from <= $as_of AND x.valid_until > $as_of AND t.status IN ('open', 'pending') ORDER BY t.created_at DESC
- who solved most in an area: SELECT a.name AS agent, count(*) AS solved FROM tickets t JOIN agents a ON a.id = t.solved_by JOIN issues i ON i.id = t.issue_id WHERE i.area = 'kyc' AND t.created_at <= $as_of GROUP BY a.id ORDER BY solved DESC, agent LIMIT 5`;

const TOOL_SYSTEM = `${ANSWER_SYSTEM} Look the answer up in the company database with the tools first; ids in the question name what to look up.\n\n${SQL_SCHEMA}`;

export const renderRows = (name: string, qs: Record<string, Row[]>) =>
  `## ${name}\n${Object.entries(qs).map(([id, rows]) => `${id} rows: ${JSON.stringify(rows)}`).join('\n')}`;

/** Read tools with no SQL equivalent; a real capability gap between the stores, so E does not get a fake one. */
export const NO_SQL_EQUIVALENT = new Set(['graph_algorithm']);

/** D's tools as E sees them: the same specs, query_graph mirrored as query_sql, graph_algorithm dropped. */
export function eTools(): Tool[] {
  const fixed = READ_TOOL_SPECS.filter((s) => !NO_SQL_EQUIVALENT.has(s.name) && s.name !== 'query_graph')
    .map(({ name, description, parameters }) => ({ name, description, parameters }));
  return [...fixed, QUERY_SQL];
}

export function armE(ctx: Ctx): Arm {
  const tools = eTools();
  const missing = tools.filter((t) => t.name !== 'query_sql' && !SQL_TOOLS[t.name]).map((t) => t.name);
  if (missing.length) throw new Error(`arm E has no SQL for read tool(s) ${missing.join(', ')}: add them to SQL_TOOLS`);
  const asOf = () => Math.max(Date.now(), ctx.dataset.generated_at);
  let db: Sql | undefined, file = '';

  return {
    arch: 'E',
    async prepare() {
      db?.close();
      const ts = ctx.dataset.tickets;
      const vs = await embed(ts.map((t) => `${t.subject}\n${t.body}`)); // the loader's ticket embedding text and provider
      file = join(mkdtempSync(join(tmpdir(), 'bench-e-')), 'e.sqlite'); // a file, so query_sql can open it read-only
      db = load(ctx.dataset, new Map(ts.map((t, j) => [t.id, vs[j]])), file);
      return ZERO;
    },
    async answer(q) {
      const r = await toolLoop(ctx, 'arm_e', TOOL_SYSTEM, tools, q, async (name, args) => {
        if (name === 'query_sql') {
          const { rows, truncated } = await querySql(file, String(args.sql), asOf());
          return renderRows(`query_sql: ${String(args.purpose ?? '').slice(0, 80)}${truncated ? ` (truncated at ${ROW_CAP})` : ''}`, { q_1: rows });
        }
        return SQL_TOOLS[name] ? renderRows(name, await SQL_TOOLS[name](db!, args, asOf())) : `unknown tool ${name}`;
      });
      return { answer: r.answer, usage: r.usage, retrieval_ms: r.retrieval_ms };
    },
    async apply(e) {
      const [, ms] = await timed(async () => applySql(db!, e));
      return { usage: ZERO, ms };
    },
  };
}
