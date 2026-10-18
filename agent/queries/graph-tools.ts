// query_graph and graph_algorithm (change add-query-graph). The model writes Cypher, or picks a whitelisted algorithm;
// code checks names against the contract, runs it read-only with $as_of, and stores the result as a receipt.
// query_graph is DB-enforced read-only (GRAPH.RO_QUERY as mochi_reader); the write precheck only makes the error friendly.
import {
  E, EDGE_AS_OF, GRAPH, L, NODE_AS_OF, TEMPORAL_EDGES, VALID_FOREVER, checkCypherNames,
  type EdgeType, type Label, type PathReceipt, type StoredQuery, type ToolCard,
} from '@mochi/contracts';
import { returnColumns, type Db, type Result } from './index.ts';

type Row = Record<string, unknown>;
export type WriteDb = { selectGraph(name: string): { query<T>(q: string, o?: { params?: Record<string, unknown> }): Promise<{ data?: T[] }>; delete(): Promise<unknown> } };
export type ToolCtx = { write?: WriteDb; user?: Db; graphs?: (g: string) => 'read' | 'user' | null };

export const ROW_CAP = 200;
export const TIMEOUT_MS = 5000;
const plain = (row: Row): Row => JSON.parse(JSON.stringify(row));
const strip = (c: string) => c.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''").replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Friendly refusals before the database's own NOPERM. Returns the fix-it message, or null. */
export function precheck(cypher: string): string | null {
  const src = strip(cypher);
  const w = src.match(/\b(CREATE|MERGE|SET|DELETE|DETACH|REMOVE|DROP|FOREACH|LOAD\s+CSV)\b/i) ?? src.match(/CALL\s+db\.idx\.[\w.]*(create|drop)/i);
  if (w) return `query_graph is read-only: "${w[0]}" is a write. Rewrite it as MATCH … RETURN.`;
  if (!cypher.includes('$as_of')) return 'The query must reference $as_of. Filter every node with n.created_at <= $as_of and every temporal edge '
    + `(${TEMPORAL_EDGES.join(', ')}) with r.valid_from <= $as_of AND r.valid_until > $as_of, then retry.`;
  const bad = checkCypherNames(cypher);
  if (bad.length) return `Not in the graph contract: ${bad.join(', ')}. Use only the labels and edges in the graph schema section, then retry.`;
  return null;
}

/** Model-written Cypher, read-only, capped at ROW_CAP rows, stored as q_1 with its exact text. */
export async function queryGraph(db: Db, args: { cypher: string; purpose: string; graph?: string }, as_of: number, graph: string = GRAPH.company, ctx: ToolCtx = {}): Promise<Result> {
  const target = args.graph ?? graph;
  const tier = target === graph ? 'read' : ctx.graphs?.(target) ?? null;
  if (!tier) throw new Error(`graph ${target} is not readable here; use ${graph} or your team_/user_/cust_ graph`);
  const err = precheck(args.cypher);
  if (err) throw new Error(err);
  const on = tier === 'user' && ctx.user ? ctx.user : db;
  const r = await on.selectGraph(target).roQuery<Row>(args.cypher, { params: { as_of }, TIMEOUT: TIMEOUT_MS });
  const all = r.data ?? [];
  const rows = all.slice(0, ROW_CAP).map(plain);
  const columns = rows[0] ? Object.keys(rows[0]) : returnColumns(args.cypher);
  const truncated = all.length > ROW_CAP;
  const q_1: StoredQuery = { cypher: args.cypher, graph: target, params: {}, columns, rows, ran_at: Date.now() };
  const title = `${args.purpose.slice(0, 80)} · ${rows.length} row${rows.length === 1 ? '' : 's'}${truncated ? ` (truncated at ${ROW_CAP})` : ''}`;
  // ponytail: the contract has no 'query' card kind; 'briefing' until contracts gain one.
  const card: ToolCard = { kind: 'briefing', title, queries: { q_1 }, path: null,
    blocks: columns.length ? [{ type: 'table', query_id: 'q_1', label: args.purpose.slice(0, 80) || 'Query result', columns: columns.slice(0, 8) }] : [] };
  return { card, queries: { q_1 } };
}

// ── graph_algorithm ─────────────────────────────────────────────────────────────────────────

export const ALGORITHMS = ['shortest_path', 'pagerank', 'communities', 'components', 'betweenness', 'neighbourhood'] as const;
export type Algorithm = (typeof ALGORITHMS)[number];
export type AlgoParams = {
  source?: { label: string; id: string }; target?: { label: string; id: string };
  labels?: string[]; relTypes?: string[]; maxLen?: number; depth?: number; top?: number; area?: string;
};

const KEYPROP: Partial<Record<Label, string>> = { Release: 'version', Team: 'name', ProductArea: 'name', Plan: 'name' };
const KEY = (n: string) => `coalesce(${n}.id, ${n}.version, ${n}.name)`;
const NAME = (n: string) => `coalesce(${n}.name, ${n}.subject, ${n}.title, ${n}.version, ${n}.id)`;
const N = NODE_AS_OF;
const lit = (xs: readonly string[]) => `[${xs.map((x) => `'${x}'`).join(', ')}]`;
const isTemporal = (t: string) => (TEMPORAL_EDGES as readonly string[]).includes(t);
const PATH_TYPES: EdgeType[] = ['RAISED', 'ABOUT', 'INTRODUCED', 'SOLVED', 'MEMBER_OF', 'IN', 'OWNED_BY', 'RESOLVED_BY', 'BASED_ON', 'FOLLOWS', 'MERGED_INTO', 'ON_PLAN'];
const clampInt = (v: number | undefined, d: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v ?? d)));

/** One edge type copied from company into the scratch projection. rev flips it, both writes it twice. */
type Spec = { type: EdgeType; from?: Label; to?: Label; dir: 'fwd' | 'rev' | 'both'; area?: boolean };

// Defaults that give each algorithm structure worth ranking (not a restatement of the issue labels or of degree).
const DEFAULTS = {
  // Rank lands on the edge TARGET: SOLVED is projected reversed (Ticket→AgentUser), so a ticket central in the
  // similarity graph passes rank to whoever solved it. "Whose fixes sit at the centre."
  pagerank: [{ type: 'SIMILAR_TO', dir: 'both' }, { type: 'SOLVED', from: 'AgentUser', to: 'Ticket', dir: 'rev' }] as Spec[],
  communities: [{ type: 'SIMILAR_TO', dir: 'both' }] as Spec[],
  // Issues and areas bridge through ticket co-occurrence: tickets about two issues, and similar tickets across issues.
  betweenness: [{ type: 'ABOUT', from: 'Ticket', to: 'Issue', dir: 'both' }, { type: 'SIMILAR_TO', dir: 'both' }, { type: 'IN', from: 'Issue', to: 'ProductArea', dir: 'both' }] as Spec[],
};

function readSpec(s: Spec): string {
  const area = s.area ? ` AND (${s.from === 'AgentUser' ? 'b' : 'a'})-[:ABOUT]->(:Issue)-[:IN]->(:ProductArea {name: $area})` : '';
  return `MATCH (a${s.from ? `:${s.from}` : ''})-[r:${s.type}]->(b${s.to ? `:${s.to}` : ''})
WHERE ${N('a')} AND ${N('b')}${isTemporal(s.type) ? ` AND ${EDGE_AS_OF('r')}` : ''}${area}
RETURN labels(a)[0] AS la, ${KEY('a')} AS ka, ${NAME('a')} AS an, a.created_at AS ac, labels(b)[0] AS lb, ${KEY('b')} AS kb, ${NAME('b')} AS bn, b.created_at AS bc
ORDER BY ka, kb SKIP $skip LIMIT 5000`;
}
const ISSUE_OF = `MATCH (t:Ticket)-[:ABOUT]->(i:Issue) WHERE ${N('t')} AND ${N('i')} RETURN t.id AS id, min(i.name) AS issue ORDER BY id SKIP $skip LIMIT 5000`;

// ponytail: one in-process lock on the scratch graph; the dream's cluster step shares algo_scratch from its own
// code path, so a chat algorithm and a dream run at the same instant could interleave. Per-run scratch keys need an ACL change.
let lock: Promise<unknown> = Promise.resolve();
const serial = <T>(f: () => Promise<T>): Promise<T> => { const p = lock.then(f, f); lock = p.catch(() => {}); return p; };

async function paged(db: Db, graph: string, cypher: string, params: Row): Promise<Row[]> {
  const out: Row[] = [];
  for (let skip = 0; ; skip += 5000) {
    const page = (await db.selectGraph(graph).roQuery<Row>(cypher, { params: { ...params, skip }, TIMEOUT: 30_000 })).data ?? [];
    out.push(...page);
    if (page.length < 5000) return out;
  }
}

/** Copy the live edges of `specs` from company into scratch (mochi_dream). Returns the read queries, which are the receipt. */
async function project(db: Db, write: WriteDb, company: string, scratch: string, specs: Spec[], params: Row, issues: boolean): Promise<{ reads: string[]; edges: number }> {
  let edges = 0;
  const sg = write.selectGraph(scratch);
  await sg.delete().catch(() => {});
  const reads: string[] = [];
  const indexed = new Set<string>();
  const ensure = async (l: string) => {
    if (!(l in L)) throw new Error(`projection: unknown label ${l}`);
    if (indexed.has(l)) return;
    indexed.add(l);
    await sg.query(`CREATE INDEX FOR (n:${l}) ON (n.id)`).catch(() => {});
  };
  for (const s of specs) {
    const q = readSpec(s);
    reads.push(q);
    const rows = await paged(db, company, q, params);
    edges += rows.length;
    const groups = new Map<string, Row[]>();
    for (const r of rows) { const k = `${r.la}|${r.lb}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
    for (const [k, list] of groups) {
      const [la, lb] = k.split('|');
      await ensure(la); await ensure(lb);
      const edges = [s.dir !== 'rev' ? `MERGE (a)-[:${s.type}]->(b)` : '', s.dir !== 'fwd' ? `MERGE (b)-[:${s.type}]->(a)` : ''].filter(Boolean).join('\n');
      const w = `UNWIND $rows AS r
MERGE (a:${la} {id: r.ka}) ON CREATE SET a.name = r.an, a.created_at = r.ac
MERGE (b:${lb} {id: r.kb}) ON CREATE SET b.name = r.bn, b.created_at = r.bc
${edges}`;
      for (let i = 0; i < list.length; i += 2000) await sg.query(w, { params: { rows: list.slice(i, i + 2000) } });
    }
  }
  if (issues) {
    reads.push(ISSUE_OF);
    const rows = await paged(db, company, ISSUE_OF, params);
    for (let i = 0; i < rows.length; i += 2000) await sg.query(`UNWIND $rows AS r MATCH (t:Ticket {id: r.id}) SET t.issue = r.issue`, { params: { rows: rows.slice(i, i + 2000) } });
  }
  return { reads, edges };
}

function names(p: AlgoParams) {
  for (const l of p.labels ?? []) if (!(l in L)) throw new Error(`unknown label ${l}; labels: ${Object.keys(L).join(', ')}`);
  for (const t of p.relTypes ?? []) if (!(t in E)) throw new Error(`unknown edge ${t}; edges: ${Object.keys(E).join(', ')}`);
  for (const n of [p.source, p.target]) if (n && !(n.label in L)) throw new Error(`unknown label ${n.label}`);
}

type Plan = { call: (onScratch: boolean) => string; specs: Spec[] | null; issues?: boolean; params: Row; kind: ToolCard['kind']; title: (rows: Row[]) => string;
  blocks: ToolCard['blocks']; path?: (rows: Row[]) => PathReceipt | null };

function plan(algorithm: Algorithm, p: AlgoParams): Plan {
  names(p);
  const top = clampInt(p.top, 10, 1, 50);
  const both = p.labels?.length && p.relTypes?.length;
  const custom = (specsFor: string[]): Spec[] | null => (specsFor.some(isTemporal) ? specsFor.map((type) => ({ type: type as EdgeType, dir: 'fwd' as const })) : null);
  const node = (n: { label: string; id: string } | undefined, which: string, scratch: boolean) => {
    if (!n) throw new Error(`${algorithm} needs params.${which} = {label, id}`);
    return `(${which[0]}:${n.label} {${scratch ? 'id' : KEYPROP[n.label as Label] ?? 'id'}: $${which}})`;
  };
  switch (algorithm) {
    case 'shortest_path': {
      const rels = p.relTypes?.length ? p.relTypes : PATH_TYPES;
      const maxLen = clampInt(p.maxLen, 4, 1, 4);
      return {
        specs: custom(rels), params: { source: p.source?.id, target: p.target?.id }, kind: 'briefing', blocks: [{ type: 'table', query_id: 'q_1', label: 'Shortest path', columns: ['hops', 'route'] }],
        call: (sc) => `MATCH ${node(p.source, 'source', sc)}, ${node(p.target, 'target', sc)}
WHERE ${N('s')} AND ${N('t')}
CALL algo.SPpaths({sourceNode: s, targetNode: t, relTypes: ${lit(rels)}, relDirection: 'both', maxLen: ${maxLen}, pathCount: 1}) YIELD path
WITH path WHERE all(n IN nodes(path) WHERE n.created_at <= $as_of)
RETURN length(path) AS hops, [n IN nodes(path) | ${NAME('n')}] AS route,
       [n IN nodes(path) | [labels(n)[0], ${KEY('n')}, ${NAME('n')}]] AS node_list,
       [r IN relationships(path) | [type(r), ${KEY('startNode(r)')}, ${KEY('endNode(r)')}]] AS edge_list`,
        title: (rows) => rows.length ? `${p.source!.id} → ${p.target!.id}: ${rows[0].hops} hops` : `No path from ${p.source?.id} to ${p.target?.id} within ${maxLen} hops`,
        path: (rows) => {
          const r = rows[0];
          if (!r) return null;
          const nodes = (r.node_list as string[][]).map(([label, id, name]) => ({ label, id: String(id), name: String(name ?? id) }));
          const edges = (r.edge_list as string[][]).map(([type, from, to]) => ({ type, from: String(from), to: String(to) }));
          return { query_id: 'q_1', nodes, edges };
        },
      };
    }
    case 'pagerank': {
      if (p.labels?.length || p.relTypes?.length) {
        const [label, rel] = [p.labels?.[0], p.relTypes?.[0]];
        if (!label || !rel) throw new Error('pagerank takes exactly one label and one relType (rank goes to the edge target), or neither for the default');
        return { specs: custom([rel]), params: {}, kind: 'who_knows', blocks: [{ type: 'bars', query_id: 'q_1', label: `PageRank over ${label}·${rel} (rank flows to edge targets)`, x: 'name', y: 'score' }],
          call: () => `CALL algo.pageRank('${label}', '${rel}') YIELD node, score
WITH node, score WHERE ${N('node')}
RETURN ${KEY('node')} AS id, ${NAME('node')} AS name, score ORDER BY score DESC, id LIMIT ${top}`,
          title: () => `PageRank: ${label} by incoming ${rel}` };
      }
      const specs = DEFAULTS.pagerank.map((s) => ({ ...s, area: !!p.area }));
      return { specs, params: p.area ? { area: p.area } : {}, kind: 'who_knows',
        blocks: [{ type: 'bars', query_id: 'q_1', label: 'PageRank of solvers over the similarity graph', x: 'name', y: 'score' },
          { type: 'table', query_id: 'q_1', label: 'Rank vs tickets solved', columns: ['name', 'score', 'solved'] }],
        call: () => `CALL algo.pageRank(null, null) YIELD node, score
WITH node, score WHERE node:AgentUser AND ${N('node')}
OPTIONAL MATCH (:Ticket)-[s:SOLVED]->(node)
RETURN node.id AS id, node.name AS name, score, count(s) AS solved ORDER BY score DESC, id LIMIT ${top}`,
        title: () => `Whose fixes sit at the centre${p.area ? ` of ${p.area}` : ''}` };
    }
    case 'communities': case 'components': {
      const cdlp = algorithm === 'communities';
      const labels = both ? p.labels! : cdlp ? ['Ticket'] : ['Customer', 'Ticket'];
      const rels = both ? p.relTypes! : cdlp ? ['SIMILAR_TO'] : ['RAISED', 'FOLLOWS', 'MERGED_INTO'];
      const specs = both ? custom(rels) : cdlp ? DEFAULTS.communities : null;
      const issues = !both && cdlp;
      const fn = cdlp ? `algo.labelPropagation({nodeLabels: ${lit(labels)}, relationshipTypes: ${lit(rels)}, maxIterations: 10}) YIELD node, communityId AS cid`
        : `algo.wcc({nodeLabels: ${lit(labels)}, relationshipTypes: ${lit(rels)}}) YIELD node, componentId AS cid`;
      return { specs, issues, params: {}, kind: 'clusters',
        blocks: [{ type: 'table', query_id: 'q_1', label: cdlp ? 'Communities (keyed by smallest member id)' : 'Components of size 2+', columns: issues ? ['anchor', 'size', 'issues', 'members'] : ['anchor', 'size', 'members'] }],
        call: () => `CALL ${fn}
WITH node, cid WHERE ${N('node')}
WITH cid, count(node) AS size, min(${KEY('node')}) AS anchor, collect(${KEY('node')})[0..8] AS members${issues ? ', collect(DISTINCT node.issue)[0..3] AS issues' : ''}
WHERE size >= 2
RETURN anchor, size, ${issues ? 'issues, ' : ''}members ORDER BY size DESC, anchor LIMIT ${top}`,
        title: (rows) => `${rows.length} ${cdlp ? 'communities' : 'components'} over ${labels.join('/')}·${rels.join('/')}` };
    }
    case 'betweenness': {
      const labels = both ? p.labels! : ['Ticket', 'Issue', 'ProductArea'];
      const rels = both ? p.relTypes! : ['ABOUT', 'SIMILAR_TO', 'IN'];
      const keep = both ? N('node') : `(node:Issue OR node:ProductArea) AND ${N('node')}`;
      return { specs: both ? custom(rels) : DEFAULTS.betweenness, params: {}, kind: 'who_knows',
        blocks: [{ type: 'bars', query_id: 'q_1', label: 'Betweenness (sampled, seed 42)', x: 'name', y: 'score' }],
        call: () => `CALL algo.betweenness({nodeLabels: ${lit(labels)}, relationshipTypes: ${lit(rels)}, samplingSize: 128, samplingSeed: 42}) YIELD node, score
WITH node, score WHERE ${keep}
RETURN labels(node)[0] AS label, ${KEY('node')} AS id, ${NAME('node')} AS name, score ORDER BY score DESC, id LIMIT ${top}`,
        title: () => both ? `Betweenness over ${labels.join('/')}` : 'Issues and areas that bridge tickets' };
    }
    case 'neighbourhood': {
      const rel = p.relTypes?.[0];
      if (!rel) throw new Error('neighbourhood needs params.relTypes = [one edge type]');
      const depth = clampInt(p.depth, 1, 1, 2);
      return { specs: custom([rel]), params: { source: p.source?.id }, kind: 'briefing',
        blocks: [{ type: 'table', query_id: 'q_1', label: `Within ${depth} hop(s) over ${rel}`, columns: ['label', 'id', 'name'] }],
        call: (sc) => `MATCH ${node(p.source, 'source', sc)} WHERE ${N('s')}
CALL algo.bfs(s, ${depth}, '${rel}') YIELD nodes
UNWIND nodes AS n
WITH n WHERE ${N('n')}
RETURN labels(n)[0] AS label, ${KEY('n')} AS id, ${NAME('n')} AS name ORDER BY label, id LIMIT ${ROW_CAP}`,
        title: (rows) => `${rows.length} nodes within ${depth} hop(s) of ${p.source?.id}` };
    }
  }
}

/** Run a whitelisted algorithm. Non-temporal edges: directly on company (GRAPH.RO_QUERY accepts CALL algo.*). Any
 *  temporal edge, or a default built on SIMILAR_TO: on a live-edge projection in the scratch graph (algorithms ignore
 *  edge properties). The stored query is the exact CALL; on scratch it carries the projection as a leading comment. */
export async function graphAlgorithm(db: Db, args: { algorithm: Algorithm; params?: AlgoParams; purpose: string }, as_of: number, graph: string = GRAPH.company, ctx: ToolCtx = {}): Promise<Result> {
  if (!ALGORITHMS.includes(args.algorithm)) throw new Error(`unknown algorithm ${args.algorithm}; one of ${ALGORITHMS.join(', ')}`);
  const pl = plan(args.algorithm, args.params ?? {});
  const run = async (): Promise<StoredQuery> => {
    if (!pl.specs) {
      const cypher = pl.call(false);
      const r = await db.selectGraph(graph).roQuery<Row>(cypher, { params: { ...pl.params, as_of }, TIMEOUT: 30_000 });
      return { cypher, graph, params: pl.params, columns: returnColumns(cypher), rows: (r.data ?? []).slice(0, ROW_CAP).map(plain), ran_at: Date.now() };
    }
    if (!ctx.write) throw new Error(`${args.algorithm} on temporal edges needs a live-edge projection, which this caller cannot build`);
    const scratch = graph === GRAPH.company ? GRAPH.scratch : `${graph}_scratch`;
    const { reads, edges } = await project(db, ctx.write, graph, scratch, pl.specs, { ...pl.params, as_of }, !!pl.issues);
    const cypher = `/* projection: live edges (valid_until = ${VALID_FOREVER} rule, $as_of) copied from ${graph} into ${scratch}:\n${reads.join(';\n')} */\n${pl.call(true)}`;
    // An empty projection (e.g. no SIMILAR_TO before the first dream) has no labels for the algorithm to name.
    const r = edges ? await ctx.write.selectGraph(scratch).query<Row>(pl.call(true), { params: { ...pl.params, as_of } }) : { data: [] as Row[] };
    return { cypher, graph: scratch, params: pl.params, columns: returnColumns(cypher), rows: (r.data ?? []).slice(0, ROW_CAP).map(plain), ran_at: Date.now() };
  };
  const q_1 = pl.specs ? await serial(run) : await run();
  const card: ToolCard = { kind: pl.kind, title: pl.title(q_1.rows), queries: { q_1 }, path: pl.path?.(q_1.rows) ?? null, blocks: q_1.rows.length ? pl.blocks : [] };
  return { card, queries: { q_1 } };
}

// ── Schema context for the system prompt (nao's "context engineering"), generated from the contract ────────────────

const PROPS: Partial<Record<Label, string>> = {
  Customer: 'id, name, segment, city, language, joined_at', Ticket: 'id, subject, body, channel, status (open|pending|resolved|closed), priority, created_at, resolved_at, ingested_at',
  Issue: 'id, name, first_seen', ProductArea: 'name (login|kyc|funds|orders|charges|app)', Team: 'name', AgentUser: 'id, name',
  Resolution: 'id, kind, summary', KBArticle: 'id, title, area, promised_tat_hours, steps', Release: 'version, shipped_at, notes', Plan: 'name',
  Policy: 'id, segment, priority, promised_tat_hours', Cluster: 'id, name', Suggestion: 'id, status, text', ObservedPattern: 'id, summary, support_count',
};

export const SCHEMA_PROMPT = (() => {
  const nodes = Object.keys(L).map((l) => `${l}(${PROPS[l as Label] ?? 'id'})`).join('; ');
  const edges = Object.entries(E).map(([t, d]) => `(${d.from.join('|')})-[:${t}${isTemporal(t) ? '*' : ''}]->(${d.to.join('|')})`).join(', ');
  return `Graph schema (mochi_company; every node has created_at and source, times are epoch ms):
Nodes: ${nodes}.
Edges (* = temporal): ${edges}.
Temporal rule: a temporal edge r is live at $as_of when r.valid_from <= $as_of AND r.valid_until > $as_of (live facts end at ${VALID_FOREVER}); a node exists when n.created_at <= $as_of. Every query must use $as_of; it is always passed.
Tiers: mochi_company (company facts), team_<team> (doctrine candidates, feedback), user_<id> (your preferences), cust_<id> (customer episodes). Cypher cannot cross graphs.
Prefer the fixed tools when one fits; use query_graph for anything else. Return scalar properties (t.id AS ticket), never whole nodes.
query_graph examples:
- last 20 tickets today (days are IST, UTC+5:30 = 19800000 ms): MATCH (c:Customer)-[:RAISED]->(t:Ticket) WHERE ${N('t')} AND t.created_at >= $as_of - (($as_of + 19800000) % 86400000) RETURN t.id AS ticket, t.subject AS subject, t.status AS status, c.id AS customer, t.created_at AS created_at ORDER BY t.created_at DESC LIMIT 20
- tickets per area this week: MATCH (t:Ticket)-[:ABOUT]->(:Issue)-[:IN]->(a:ProductArea) WHERE ${N('t')} AND t.created_at > $as_of - 604800000 RETURN a.name AS area, count(DISTINCT t) AS tickets ORDER BY tickets DESC
- open tickets for a release: MATCH (r:Release {version: '3.2.0'})-[x:INTRODUCED]->(i:Issue)<-[:ABOUT]-(t:Ticket) WHERE ${EDGE_AS_OF('x')} AND ${N('t')} AND t.status IN ['open', 'pending'] RETURN t.id AS ticket, t.subject AS subject, i.name AS issue ORDER BY t.created_at DESC
- who solved most in an area: MATCH (a:AgentUser)-[s:SOLVED]->(t:Ticket)-[:ABOUT]->(:Issue)-[:IN]->(:ProductArea {name: 'kyc'}) WHERE ${N('t')} RETURN a.name AS agent, count(s) AS solved ORDER BY solved DESC, agent LIMIT 5
- tickets per day this week: MATCH (t:Ticket) WHERE ${N('t')} AND t.created_at > $as_of - 604800000 RETURN t.created_at - ((t.created_at + 19800000) % 86400000) AS day, count(t) AS tickets ORDER BY day
graph_algorithm (params: source/target {label, id}, labels, relTypes, maxLen, depth, top, area):
- shortest_path: how two things are connected (≤4 hops, path receipt). Release ids are versions.
- pagerank: whose fixes sit at the centre (solvers ranked over the ticket-similarity graph; area narrows it). With one label + relType, rank goes to the edge target.
- communities: groups of similar tickets (label propagation over SIMILAR_TO), across issue labels.
- components: connected groups (default Customer/Ticket over RAISED, FOLLOWS, MERGED_INTO: repeat-contact loops).
- betweenness: issues and areas that bridge otherwise separate tickets.
- neighbourhood: everything within 1–2 hops over one edge type.
- "how is customer C-0497 connected to release 3.2.0": graph_algorithm {algorithm: 'shortest_path', params: {source: {label: 'Customer', id: 'C-0497'}, target: {label: 'Release', id: '3.2.0'}}}
- "who's central for KYC": graph_algorithm {algorithm: 'pagerank', params: {area: 'kyc'}}`;
})();
