// The five load-bearing queries + similarity (SPEC §1). Each is a plain function -> { card, queries }: the card is
// built in code from query rows, so numbers never come from model tokens. Every query runs read-only (roQuery), takes
// $as_of through the contract fragments, binds the edges it counts, and breaks ties by id. CYPHER is README-verbatim.
import { num, suggestionBlock } from '../suggestion-block.ts';
import { EDGE_AS_OF, GRAPH, NODE_AS_OF, type PathReceipt, type StoredQuery, type ToolCard } from '@mochi/contracts';

type Row = Record<string, unknown>;
export type Db = { selectGraph(name: string): { roQuery<T>(q: string, o?: { params?: Record<string, unknown>; TIMEOUT?: number }): Promise<{ data?: T[] }> } };
export type Result = { card: ToolCard; queries: Record<string, StoredQuery> };
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

const E = EDGE_AS_OF, N = NODE_AS_OF;

export const CYPHER = {
  briefing: {
    profile: `/* mochi:briefing.profile@v1 */
MATCH (c:Customer)-[:RAISED]->(t:Ticket {id: $ticketId})
WHERE ${N('c')} AND ${N('t')}
OPTIONAL MATCH (c)-[op:ON_PLAN]->(p:Plan) WHERE ${E('op')}
OPTIONAL MATCH (t)-[:ABOUT]->(i:Issue) WHERE ${N('i')}
RETURN c.id AS customer_id, c.name AS name, c.segment AS segment, c.city AS city, p.name AS plan,
       t.subject AS ticket_subject, i.id AS issue_id`,
    recent: `/* mochi:briefing.recent@v1 */
MATCH (c:Customer)-[:RAISED]->(:Ticket {id: $ticketId}), (c)-[r:RAISED]->(t:Ticket)
WHERE t.id <> $ticketId AND ${N('t')}
RETURN t.id AS ticket, t.subject AS subject, t.status AS status, t.created_at AS created_at
ORDER BY t.created_at DESC, t.id LIMIT 3`,
    similar: `/* mochi:briefing.similar@v1 path: graph */
MATCH (t:Ticket {id: $ticketId})-[:ABOUT]->(i:Issue)<-[:ABOUT]-(s:Ticket)-[:RESOLVED_BY]->(r:Resolution)
WHERE s.id <> t.id AND ${N('t')} AND ${N('i')} AND ${N('s')} AND ${N('r')} AND s.resolved_at <= $as_of
OPTIONAL MATCH (r)-[:BASED_ON]->(k:KBArticle) WHERE ${N('k')}
RETURN s.id AS ticket, s.subject AS subject, i.id AS issue_id, i.name AS issue,
       r.id AS resolution_id, r.summary AS resolution, k.id AS kb_id, k.title AS kb
ORDER BY s.resolved_at DESC, s.id LIMIT 5`,
    // Vector search takes no filters (falkordb.md gotcha 7): over-fetch $k = 5 x 5, then filter and traverse.
    similarVector: `/* mochi:briefing.similar@v1 path: vector→graph */
MATCH (t:Ticket {id: $ticketId})
CALL db.idx.vector.queryNodes('Ticket', 'embedding', $k, t.embedding) YIELD node, score
WITH t, node AS s, score
WHERE s.id <> t.id AND ${N('s')} AND s.resolved_at <= $as_of
MATCH (s)-[:RESOLVED_BY]->(r:Resolution) WHERE ${N('r')}
OPTIONAL MATCH (s)-[:ABOUT]->(i:Issue)
OPTIONAL MATCH (r)-[:BASED_ON]->(k:KBArticle) WHERE ${N('k')}
RETURN s.id AS ticket, s.subject AS subject, i.id AS issue_id, i.name AS issue,
       r.id AS resolution_id, r.summary AS resolution, k.id AS kb_id, k.title AS kb, score
ORDER BY score, s.id LIMIT 5`,
    // Live doctrine-vs-practice mismatches in the ticket's ProductArea, from the dream's open Suggestions for its owner.
    suggestions: `/* mochi:briefing.suggestions@v1 */
MATCH (t:Ticket {id: $ticketId})-[:ABOUT]->(i:Issue)-[:IN]->(a:ProductArea)-[:OWNED_BY]->(tm:Team)<-[:FOR]-(s:Suggestion)-[:FROM]->(p:ObservedPattern)-[e:CONTRADICTS|UNDOCUMENTED]->(d)
WHERE s.area = a.name AND s.status = 'open' AND s.expires_at > $as_of AND ${N('t')} AND ${N('s')} AND ${E('e')}
RETURN DISTINCT s.id AS suggestion_id, type(e) AS edge, coalesce(d.id, d.name) AS target, a.name AS area, tm.name AS team,
       s.text AS text, s.support_count AS support, p.measured_tat_hours AS measured, e.promised AS promised, s.confidence AS confidence
ORDER BY confidence DESC, suggestion_id LIMIT 2`,
  },
  likelyCause: `/* mochi:likely_cause@v1 */
MATCH (t:Ticket {id: $ticketId})-[:ABOUT]->(i:Issue)<-[x:INTRODUCED]-(r:Release)
WHERE ${E('x')} AND ${N('t')} AND ${N('i')} AND ${N('r')}
RETURN t.id AS ticket, t.subject AS subject, i.id AS issue_id, i.name AS issue,
       r.version AS release, r.shipped_at AS shipped_at, x.valid_from AS introduced_at
ORDER BY r.shipped_at DESC, r.version LIMIT 3`,
  whoKnows: `/* mochi:who_knows@v1 */
MATCH (i:Issue) WHERE (i.id = $issueId OR toLower(i.name) = toLower($issueId)) AND ${N('i')}
MATCH (a:AgentUser)-[s:SOLVED]->(t:Ticket)-[:ABOUT]->(i)
WHERE ${N('a')} AND ${N('t')}
WITH a, i, count(s) AS solved, min(t.id) AS example_ticket
OPTIONAL MATCH (a)-[:MEMBER_OF]->(tm:Team)
RETURN a.id AS agent_id, a.name AS agent, tm.name AS team, solved, example_ticket, i.name AS issue
ORDER BY solved DESC, agent_id LIMIT 5`,
  // who_knows found nobody: is that because the issue is unsolved, or because the name matched no issue?
  whoKnowsIssues: `/* mochi:who_knows.issues@v1 */
MATCH (i:Issue) WHERE ${N('i')}
RETURN i.id AS issue_id, i.name AS issue
ORDER BY issue_id`,
  emergingClusters: `/* mochi:emerging_clusters@v1 */
MATCH (t:Ticket)-[m:IN_CLUSTER]->(c:Cluster)
WHERE ${E('m')} AND ${N('c')} AND ${N('t')}
WITH c, count(m) AS tickets, sum(CASE WHEN t.created_at > $as_of - $window_ms THEN 1 ELSE 0 END) AS growth
RETURN c.id AS cluster, tickets, growth
ORDER BY growth DESC, tickets DESC, cluster LIMIT 10`,
  blastRadius: {
    segments: `/* mochi:blast_radius.segments@v1 */
MATCH (r:Release {version: $version})-[x:INTRODUCED]->(i:Issue)<-[a:ABOUT]-(t:Ticket)<-[rz:RAISED]-(c:Customer)
WHERE ${E('x')} AND ${N('r')} AND ${N('i')} AND ${N('t')} AND ${N('c')}
RETURN c.segment AS segment, count(DISTINCT c) AS customers, count(DISTINCT t) AS tickets
ORDER BY customers DESC, segment`,
    totals: `/* mochi:blast_radius.totals@v1 */
MATCH (r:Release {version: $version})-[x:INTRODUCED]->(i:Issue)<-[a:ABOUT]-(t:Ticket)<-[rz:RAISED]-(c:Customer)
WHERE ${E('x')} AND ${N('r')} AND ${N('i')} AND ${N('t')} AND ${N('c')}
RETURN count(DISTINCT c) AS customers, count(DISTINCT t) AS tickets,
       count(DISTINCT CASE WHEN t.resolved_at IS NULL OR t.resolved_at > $as_of THEN t END) AS open_tickets`,
    affected: `/* mochi:blast_radius.affected@v1 */
MATCH (r:Release {version: $version})-[x:INTRODUCED]->(i:Issue)<-[a:ABOUT]-(t:Ticket)<-[rz:RAISED]-(c:Customer)
WHERE ${E('x')} AND ${N('r')} AND ${N('i')} AND ${N('t')} AND ${N('c')}
RETURN c.id AS customer_id, c.name AS customer, c.segment AS segment, t.id AS ticket, t.subject AS subject,
       i.id AS issue_id, i.name AS issue,
       CASE WHEN t.resolved_at IS NULL OR t.resolved_at > $as_of THEN 'open' ELSE 'resolved' END AS state
ORDER BY t.created_at DESC, t.id LIMIT 10`,
    // Who gets the incident note: the Team owning each introduced Issue's ProductArea.
    owner: `/* mochi:blast_radius.owner@v1 */
MATCH (r:Release {version: $version})-[x:INTRODUCED]->(i:Issue)-[:IN]->(a:ProductArea)-[:OWNED_BY]->(tm:Team)
WHERE ${E('x')} AND ${N('r')} AND ${N('i')}
RETURN tm.name AS team, a.name AS area, collect(DISTINCT i.name) AS issues
ORDER BY team, area LIMIT 3`,
  },
  searchSimilar: `/* mochi:search_similar@v1 */
CALL db.idx.vector.queryNodes('Ticket', 'embedding', $fetch, vecf32($vector)) YIELD node, score
WITH node AS t, score WHERE ${N('t')}
OPTIONAL MATCH (t)-[:ABOUT]->(i:Issue)
RETURN t.id AS ticket, t.subject AS subject, t.status AS status, i.name AS issue, score
ORDER BY score, ticket LIMIT $k`,
  customerProfile: {
    profile: `/* mochi:customer_profile.profile@v1 */
MATCH (c:Customer {id: $customerId}) WHERE ${N('c')}
OPTIONAL MATCH (c)-[op:ON_PLAN]->(p:Plan) WHERE ${E('op')}
RETURN c.id AS customer_id, c.name AS name, c.segment AS segment, p.name AS plan, c.city AS city`,
    history: `/* mochi:customer_profile.history@v1 */
MATCH (c:Customer {id: $customerId})-[:RAISED]->(t:Ticket)
WHERE ${N('t')} AND t.status IN ['resolved', 'closed'] AND NOT (t)-[:MERGED_INTO]->(:Ticket)
OPTIONAL MATCH (t)-[:RESOLVED_BY]->(r:Resolution) WHERE ${N('r')}
RETURN t.id AS ticket, t.subject AS subject, t.created_at AS created_at, t.status AS status,
       r.kind AS resolution_kind, coalesce(r.summary, 'Closed with no recorded fix') AS ended
ORDER BY t.created_at DESC, t.id LIMIT 10`,
    open: `/* mochi:customer_profile.open@v1 */
MATCH (c:Customer {id: $customerId})-[:RAISED]->(t:Ticket)
WHERE ${N('t')} AND NOT t.status IN ['resolved', 'closed']
RETURN t.id AS ticket, t.subject AS subject, t.created_at AS created_at, t.status AS status
ORDER BY t.created_at DESC, t.id LIMIT 10`,
    merged: `/* mochi:customer_profile.merged@v1 */
MATCH (c:Customer {id: $customerId})-[:RAISED]->(d:Ticket)-[:MERGED_INTO]->(p:Ticket)
WHERE ${N('d')} AND ${N('p')}
RETURN d.id AS ticket, d.subject AS subject, p.id AS merged_into
ORDER BY d.created_at DESC, d.id LIMIT 10`,
  },
  // Hover cards on IDs (ui EntityLink). The customer card also reuses customerProfile.profile.
  entity: {
    customerActivity: `/* mochi:entity.customer_activity@v1 */
MATCH (c:Customer {id: $customerId})-[:RAISED]->(t:Ticket) WHERE ${N('t')}
WITH t ORDER BY t.created_at DESC, t.id
RETURN sum(CASE WHEN t.status IN ['resolved', 'closed'] THEN 0 ELSE 1 END) AS open_tickets,
       max(t.created_at) AS last_contact, head(collect(t.id)) AS latest_ticket`,
    ticket: `/* mochi:entity.ticket@v1 */
MATCH (c:Customer)-[:RAISED]->(t:Ticket {id: $ticketId}) WHERE ${N('t')}
OPTIONAL MATCH (t)-[:RESOLVED_BY]->(r:Resolution) WHERE ${N('r')}
RETURN t.id AS ticket, t.subject AS subject, t.status AS status, t.created_at AS created_at,
       r.summary AS resolution, c.id AS customer_id, c.name AS customer`,
    kb: `/* mochi:entity.kb@v1 */
MATCH (k:KBArticle {id: $kbId}) WHERE ${N('k')}
OPTIONAL MATCH (a:ProductArea {name: k.area})-[:OWNED_BY]->(tm:Team)
RETURN k.id AS kb_id, k.title AS title, k.area AS area, tm.name AS team, k.promised_tat_hours AS promised_tat_hours`,
    // Chat @-mentions: tickets by id, customers by id or name, issues by name. $q is lowercased by the caller.
    search: `/* mochi:entity.search@v1 */
MATCH (t:Ticket) WHERE ${N('t')} AND toLower(t.id) CONTAINS $q
RETURN 'ticket' AS kind, t.id AS id, t.subject AS name ORDER BY t.created_at DESC, t.id LIMIT 8
UNION ALL
MATCH (c:Customer) WHERE ${N('c')} AND (toLower(c.id) CONTAINS $q OR toLower(c.name) CONTAINS $q)
RETURN 'customer' AS kind, c.id AS id, c.name AS name ORDER BY c.id LIMIT 8
UNION ALL
MATCH (i:Issue) WHERE ${N('i')} AND toLower(i.name) CONTAINS $q
RETURN 'issue' AS kind, i.id AS id, i.name AS name ORDER BY i.name, i.id LIMIT 8`,
  },
  // Mochi's guess on desk tickets. Confidence is evidence, never seeded: of the Issue's resolved tickets, the share
  // whose resolution is the top one (its support_count over all resolved support).
  deskGuess: `/* mochi:desk.guess@v1 */
UNWIND $ids AS tid
MATCH (t:Ticket {id: tid}) WHERE ${N('t')}
OPTIONAL MATCH (t)-[:ABOUT]->(i:Issue) WHERE ${N('i')}
OPTIONAL MATCH (i)<-[:ABOUT]-(s:Ticket)-[:RESOLVED_BY]->(r:Resolution)
WHERE s.id <> t.id AND ${N('s')} AND ${N('r')} AND s.resolved_at <= $as_of
WITH t, i, r, count(s) AS support
ORDER BY support DESC, r.id
WITH t, i, collect(CASE WHEN r IS NULL THEN null ELSE [r.id, r.summary, support] END) AS fixes, sum(support) AS resolved
RETURN t.id AS ticket, t.ingested_at IS NOT NULL AS ingested, i.id AS issue_id, i.name AS issue,
       fixes[0][0] AS resolution_id, fixes[0][1] AS resolution, coalesce(fixes[0][2], 0) AS support_count, resolved,
       CASE WHEN resolved > 0 THEN toFloat(fixes[0][2]) / resolved ELSE null END AS confidence
ORDER BY ticket, issue_id`,
  deskCounts: `/* mochi:desk.counts@v1 */
OPTIONAL MATCH (t:Ticket) WHERE t.ingested_at > $as_of - $window_ms AND t.ingested_at <= $as_of
WITH count(t) AS ingested
OPTIONAL MATCH (p:Ticket) WHERE ${N('p')} AND p.ingested_at IS NULL
WITH ingested, count(p) AS pending
OPTIONAL MATCH (:Ticket)-[m:IN_CLUSTER]->(c:Cluster) WHERE ${E('m')}
WITH ingested, pending, count(DISTINCT c) AS clustered
OPTIONAL MATCH ()-[x]->() WHERE x.valid_until > $as_of - $window_ms AND x.valid_until <= $as_of
WITH ingested, pending, clustered, count(x) AS retired
OPTIONAL MATCH (:ObservedPattern)-[y:CONTRADICTS|UNDOCUMENTED]->() WHERE ${E('y')}
RETURN ingested, pending, clustered, retired, count(y) AS mismatches`,
} as const;

/** Every Cypher string, flattened (README export, name checks). */
export const allCypher = (): [string, string][] => Object.entries(CYPHER).flatMap(([k, v]) =>
  typeof v === 'string' ? [[k, v] as [string, string]] : Object.entries(v).map(([s, c]) => [`${k}.${s}`, c] as [string, string]));

/** Column names of the final RETURN, in order (`expr AS name` or a bare variable), so empty results keep columns. */
export function returnColumns(cypher: string): string[] {
  const ret = cypher.slice(cypher.lastIndexOf('RETURN') + 6).split(/\b(?:ORDER BY|LIMIT|SKIP)\b/)[0];
  const items: string[] = [];
  let depth = 0, cur = '';
  for (const ch of ret) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { items.push(cur); cur = ''; } else cur += ch;
  }
  items.push(cur);
  return items.map((s) => s.trim()).filter(Boolean).map((s) => s.match(/\bAS\s+(\w+)$/i)?.[1] ?? s.replace(/^DISTINCT\s+/i, ''));
}

/** Run one stored query read-only with $as_of and keep its receipt. Re-renders reuse this with a new as_of. */
export async function runStored(db: Db, graph: string, cypher: string, params: Row, as_of: number): Promise<StoredQuery> {
  const r = await db.selectGraph(graph).roQuery<Row>(cypher, { params: { ...params, as_of } });
  return { cypher, graph, params, columns: returnColumns(cypher), rows: (r.data ?? []).map(plain), ran_at: Date.now() };
}
// Rows must be JSON (story docs, AG-UI): vectors and other client objects become plain values.
const plain = (row: Row): Row => JSON.parse(JSON.stringify(row));

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export async function briefing(db: Db, args: { ticketId: string }, as_of: number, graph: string = GRAPH.company): Promise<Result> {
  const p = { ticketId: args.ticketId };
  const q_1 = await runStored(db, graph, CYPHER.briefing.profile, p, as_of);
  const q_2 = await runStored(db, graph, CYPHER.briefing.recent, p, as_of);
  const profile = q_1.rows[0];
  const viaVector = !!profile && !profile.issue_id;
  const q_3 = viaVector
    ? await runStored(db, graph, CYPHER.briefing.similarVector, { ...p, k: 25 }, as_of)
    : await runStored(db, graph, CYPHER.briefing.similar, p, as_of);
  const q_4 = await runStored(db, graph, CYPHER.briefing.suggestions, p, as_of);
  const queries = { q_1, q_2, q_3, q_4 };
  const top = q_3.rows[0];
  let path: PathReceipt | null = null;
  if (profile && top) {
    const nodes = [{ id: args.ticketId, label: 'Ticket', name: str(profile.ticket_subject) }];
    const edges: PathReceipt['edges'] = [];
    if (!viaVector) {
      nodes.push({ id: str(top.issue_id), label: 'Issue', name: str(top.issue) });
      edges.push({ type: 'ABOUT', from: args.ticketId, to: str(top.issue_id) }, { type: 'ABOUT', from: str(top.ticket), to: str(top.issue_id) });
    }
    nodes.push({ id: str(top.ticket), label: 'Ticket', name: str(top.subject) }, { id: str(top.resolution_id), label: 'Resolution', name: str(top.resolution) });
    edges.push({ type: 'RESOLVED_BY', from: str(top.ticket), to: str(top.resolution_id) });
    if (top.kb_id) {
      nodes.push({ id: str(top.kb_id), label: 'KBArticle', name: str(top.kb) });
      edges.push({ type: 'BASED_ON', from: str(top.resolution_id), to: str(top.kb_id) });
    }
    path = { query_id: 'q_3', nodes, edges };
  }
  const card: ToolCard = {
    kind: 'briefing',
    title: profile ? `${str(profile.name)} · ${args.ticketId}${viaVector ? ' · path: vector→graph' : ''}` : `Ticket ${args.ticketId} not found`,
    queries, path,
    blocks: [
      { type: 'table', query_id: 'q_1', label: 'Customer', columns: ['name', 'segment', 'plan', 'city'] },
      { type: 'table', query_id: 'q_2', label: 'Last 3 tickets', columns: ['ticket', 'subject', 'status'] },
      { type: 'table', query_id: 'q_3', label: viaVector ? 'Similar resolved tickets (vector→graph)' : 'What fixed similar tickets', columns: ['ticket', 'resolution', 'kb'] },
      ...q_4.rows.map((r) => suggestionBlock('q_4', r)),
    ],
  };
  return { card, queries };
}

export async function likelyCause(db: Db, args: { ticketId: string }, as_of: number, graph: string = GRAPH.company): Promise<Result> {
  const q_1 = await runStored(db, graph, CYPHER.likelyCause, { ticketId: args.ticketId }, as_of);
  const top = q_1.rows[0];
  const queries = { q_1 };
  const card: ToolCard = {
    kind: 'likely_cause',
    title: top ? `${args.ticketId}: likely introduced in ${str(top.release)}` : `${args.ticketId}: no live cause`,
    queries,
    path: top ? {
      query_id: 'q_1',
      nodes: [
        { id: args.ticketId, label: 'Ticket', name: str(top.subject) },
        { id: str(top.issue_id), label: 'Issue', name: str(top.issue) },
        { id: str(top.release), label: 'Release', name: str(top.release) },
      ],
      edges: [{ type: 'ABOUT', from: args.ticketId, to: str(top.issue_id) }, { type: 'INTRODUCED', from: str(top.release), to: str(top.issue_id) }],
    } : null,
    blocks: [{ type: 'table', query_id: 'q_1', label: 'Live INTRODUCED edges', columns: ['issue', 'release', 'introduced_at'] }],
  };
  return { card, queries };
}

export async function whoKnows(db: Db, args: { issueId: string }, as_of: number, graph: string = GRAPH.company): Promise<Result> {
  const q_1 = await runStored(db, graph, CYPHER.whoKnows, { issueId: args.issueId }, as_of);
  const top = q_1.rows[0];
  if (!top) {
    // Nobody, or no such issue? Say which, and hand back the issue list so the next call can use a real id.
    const q_2 = await runStored(db, graph, CYPHER.whoKnowsIssues, {}, as_of);
    const want = args.issueId.toLowerCase();
    const known = q_2.rows.some((r) => String(r.issue_id).toLowerCase() === want || String(r.issue).toLowerCase() === want);
    const queries = { q_1, q_2 };
    const card: ToolCard = {
      kind: 'who_knows',
      title: known ? `Nobody has solved ${args.issueId} yet` : `I couldn't find an issue called "${args.issueId}". Use one of these ids.`,
      queries, path: null,
      blocks: known ? [] : [{ type: 'table', query_id: 'q_2', label: 'Known issues', columns: ['issue_id', 'issue'] }],
    };
    return { card, queries };
  }
  const queries = { q_1 };
  const card: ToolCard = {
    kind: 'who_knows',
    title: `Who knows ${str(top.issue)}`,
    queries,
    path: top ? {
      query_id: 'q_1',
      nodes: [
        { id: str(top.agent_id), label: 'AgentUser', name: str(top.agent) },
        { id: str(top.example_ticket), label: 'Ticket', name: str(top.example_ticket) },
        { id: args.issueId, label: 'Issue', name: str(top.issue) },
      ],
      edges: [{ type: 'SOLVED', from: str(top.agent_id), to: str(top.example_ticket) }, { type: 'ABOUT', from: str(top.example_ticket), to: args.issueId }],
    } : null,
    blocks: [{ type: 'bars', query_id: 'q_1', label: 'Tickets solved on this issue', x: 'agent', y: 'solved' }],
  };
  return { card, queries };
}

export async function emergingClusters(db: Db, args: { days: number }, as_of: number, graph: string = GRAPH.company): Promise<Result> {
  const q_1 = await runStored(db, graph, CYPHER.emergingClusters, { window_ms: Math.round(args.days * 86_400_000) }, as_of);
  const queries = { q_1 };
  const card: ToolCard = {
    kind: 'clusters',
    title: q_1.rows.length ? `Emerging clusters, last ${args.days} days` : 'No clusters yet: the dream has not written any',
    queries, path: null,
    blocks: [{ type: 'bars', query_id: 'q_1', label: `Cluster size, new in last ${args.days} days as trend`, x: 'cluster', y: 'tickets', trend: 'growth' }],
  };
  return { card, queries };
}

export async function blastRadius(db: Db, args: { version: string }, as_of: number, graph: string = GRAPH.company): Promise<Result> {
  const p = { version: args.version };
  const q_1 = await runStored(db, graph, CYPHER.blastRadius.segments, p, as_of);
  const q_2 = await runStored(db, graph, CYPHER.blastRadius.totals, p, as_of);
  const q_3 = await runStored(db, graph, CYPHER.blastRadius.affected, p, as_of);
  const q_4 = await runStored(db, graph, CYPHER.blastRadius.owner, p, as_of);
  const queries = { q_1, q_2, q_3, q_4 };
  const top = q_3.rows[0];
  const t = q_2.rows[0];
  // SPEC §1 Q5: the incident note for the owning Team, drafted in code so every figure is a <num> receipt.
  const notes = top && t ? q_4.rows.map((o) => {
    const text = `Release ${args.version} introduced ${(o.issues as string[]).join(', ')} in ${str(o.area)}. `
      + `${num('q_2', 'customers', t.customers)} customers are affected and ${num('q_2', 'open_tickets', t.open_tickets)} tickets are still open.`;
    return { type: 'suggestion' as const, query_id: 'q_4', tag: `Incident note for ${str(o.team)}`, edge: 'INTRODUCED',
      actions: [`send_to_team:${str(o.team)}`, 'dismiss'], text,
      nums: [{ query_id: 'q_2', column: 'customers', value: str(t.customers) }, { query_id: 'q_2', column: 'open_tickets', value: str(t.open_tickets) }] };
  }) : [];
  const card: ToolCard = {
    kind: 'blast_radius',
    title: top ? `Release ${args.version}: blast radius` : `Release ${args.version}: no live affected customers`,
    queries,
    path: top ? {
      query_id: 'q_3',
      nodes: [
        { id: args.version, label: 'Release', name: args.version },
        { id: str(top.issue_id), label: 'Issue', name: str(top.issue) },
        { id: str(top.ticket), label: 'Ticket', name: str(top.subject) },
        { id: str(top.customer_id), label: 'Customer', name: str(top.customer) },
      ],
      edges: [
        { type: 'INTRODUCED', from: args.version, to: str(top.issue_id) },
        { type: 'ABOUT', from: str(top.ticket), to: str(top.issue_id) },
        { type: 'RAISED', from: str(top.customer_id), to: str(top.ticket) },
      ],
    } : null,
    blocks: [
      { type: 'kpi', query_id: 'q_2', label: 'Affected customers', column: 'customers' },
      { type: 'kpi', query_id: 'q_2', label: 'Open tickets', column: 'open_tickets' },
      { type: 'bars', query_id: 'q_1', label: 'Affected customers by segment', x: 'segment', y: 'customers' },
      { type: 'table', query_id: 'q_3', label: 'Affected tickets', columns: ['customer', 'segment', 'ticket', 'state'] },
      ...notes,
    ],
  };
  return { card, queries };
}

/** Who the customer is (segment, live plan, city), how earlier tickets ended, what is open, and merged duplicates. */
export async function customerProfile(db: Db, args: { customerId: string }, as_of: number, graph: string = GRAPH.company): Promise<Result> {
  const p = { customerId: args.customerId };
  const C = CYPHER.customerProfile;
  const q_1 = await runStored(db, graph, C.profile, p, as_of);
  const q_2 = await runStored(db, graph, C.history, p, as_of);
  const q_3 = await runStored(db, graph, C.open, p, as_of);
  const q_4 = await runStored(db, graph, C.merged, p, as_of);
  const queries = { q_1, q_2, q_3, q_4 };
  const c = q_1.rows[0], last = q_2.rows[0] ?? q_3.rows[0];
  let path: PathReceipt | null = null;
  if (c) {
    const nodes = [{ id: args.customerId, label: 'Customer', name: str(c.name) }];
    const edges: PathReceipt['edges'] = [];
    if (c.plan) { nodes.push({ id: `plan:${str(c.plan)}`, label: 'Plan', name: str(c.plan) }); edges.push({ type: 'ON_PLAN', from: args.customerId, to: `plan:${str(c.plan)}` }); }
    if (last) { nodes.push({ id: str(last.ticket), label: 'Ticket', name: str(last.subject) }); edges.push({ type: 'RAISED', from: args.customerId, to: str(last.ticket) }); }
    path = { query_id: 'q_1', nodes, edges };
  }
  // ponytail: the contract has no 'customer' card kind yet; 'briefing' until contracts gain one.
  const card: ToolCard = {
    kind: 'briefing',
    title: c ? `${str(c.name)} · ${str(c.segment)} · ${str(c.plan) || 'no live plan'}` : `Customer ${args.customerId} not found`,
    queries, path,
    blocks: [
      { type: 'table', query_id: 'q_1', label: 'Customer', columns: ['name', 'segment', 'plan', 'city'] },
      { type: 'table', query_id: 'q_2', label: 'Earlier tickets and how they ended', columns: ['ticket', 'subject', 'ended'] },
      { type: 'table', query_id: 'q_3', label: 'Open tickets', columns: ['ticket', 'subject', 'status'] },
      { type: 'table', query_id: 'q_4', label: 'Merged duplicates', columns: ['ticket', 'merged_into'] },
    ],
  };
  return { card, queries };
}

// @mochi/gen's embed (384-dim MiniLM), loaded lazily so the agent builds before gen merges. Tests pass a stub.
const genSpec = '@mochi/gen';
const defaultEmbed: EmbedFn = async (texts) => ((await import(genSpec)) as { embed: EmbedFn }).embed(texts);

export async function searchSimilar(db: Db, args: { text: string; k?: number }, as_of: number, graph: string = GRAPH.company, embed: EmbedFn = defaultEmbed): Promise<Result> {
  const k = Math.min(Math.max(1, Math.round(args.k ?? 5)), 20);
  const [vector] = await embed([args.text]);
  const q_1 = await runStored(db, graph, CYPHER.searchSimilar, { vector, k, fetch: k * 5 }, as_of);
  const queries = { q_1 };
  const card: ToolCard = {
    kind: 'similar',
    title: `Tickets similar to "${args.text.slice(0, 60)}"`,
    queries, path: null,
    blocks: [{ type: 'table', query_id: 'q_1', label: 'Nearest tickets (vector index)', columns: ['ticket', 'subject', 'status', 'issue'] }],
  };
  return { card, queries };
}
