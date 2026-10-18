// Every Cypher string bench sends, in one place so checkCypherNames can audit them (task 4.3).
import { EDGE_AS_OF, VALID_FOREVER } from '@mochi/contracts';

// Arm B: one vector index per record label; the label is a parameter at query time.
export const VECTOR_LABELS = ['Customer', 'Ticket', 'Issue', 'ProductArea', 'Team', 'AgentUser', 'Resolution', 'KBArticle', 'Release', 'Plan'] as const;
export const vectorIndex = (label: string, dim: number) =>
  `CREATE VECTOR INDEX FOR (n:${label}) ON (n.embedding) OPTIONS {dimension:${dim}, similarityFunction:'cosine'}`;
export const vectorInsert = (label: string) =>
  `UNWIND $rows AS r CREATE (n:${label} {id: r.id, text: r.text, embedding: vecf32(r.v)})`;
// score is a cosine distance here (pinned by arms.test.ts): lower is closer.
export const VECTOR_QUERY = `CALL db.idx.vector.queryNodes($label, 'embedding', $k, vecf32($v)) YIELD node, score RETURN node.text AS text, score`;

// Strip ingestion marks so the dream re-ingests every ticket (D ingestion cost, concurrency writer).
export const UNINGEST = `MATCH (t:Ticket) REMOVE t.ingested_at, t.batch_id, t.batch_size`;

// Clusters ablation: copy one window of live Ticket-ABOUT-Issue pairs into a scratch graph, then CDLP.
export const WINDOW_ABOUT = `MATCH (t:Ticket)-[a:ABOUT]->(i:Issue) WHERE t.created_at >= $from AND t.created_at < $to RETURN t.id AS t, i.id AS i`;
export const PROJECT_ABOUT = `UNWIND $rows AS r MERGE (t:Ticket {id: r.t}) MERGE (i:Issue {id: r.i}) MERGE (t)-[:ABOUT]->(i)`;
export const CDLP = `CALL algo.labelPropagation({nodeLabels:['Ticket','Issue'], relationshipTypes:['ABOUT'], maxIterations:10}) YIELD node, communityId WHERE 'Ticket' IN labels(node) RETURN node.id AS id, communityId`;

// Concurrency torn-read invariants (design decision 5).
export const TORN_BATCHES = `MATCH (t:Ticket) WHERE t.batch_id IS NOT NULL WITH t.batch_id AS b, t.batch_size AS s, count(t) AS c WHERE c <> s RETURN count(b) AS torn`;
export const LIVE_PLANS = `UNWIND $ids AS id MATCH (c:Customer {id: id})-[r:ON_PLAN]->(:Plan) WHERE ${EDGE_AS_OF('r')} WITH c.id AS id, count(r) AS n WHERE n <> 1 RETURN count(id) AS torn`;
export const PER_USER_WRITE = `CREATE (:DoctrineCandidate {id: $id, text: 'bench write', source: 'session', created_at: $now})`;

// Server artifacts.
export const META_STATS = `CALL db.meta.stats()`;

// ---- Stubs only (deps.ts); deleted when deps.ts switches to the real imports. ----
export const STUB_LOAD = [
  `UNWIND $d.teams AS x MERGE (:Team {name: x.name, source: 'seed', created_at: $now})`,
  `UNWIND $d.plans AS x MERGE (:Plan {name: x.name, source: 'seed', created_at: $now})`,
  `UNWIND $d.product_areas AS x MATCH (t:Team {name: x.team}) MERGE (a:ProductArea {name: x.name, source: 'seed', created_at: $now}) MERGE (a)-[:OWNED_BY]->(t)`,
  `UNWIND $d.agents AS x MATCH (t:Team {name: x.team}) MERGE (a:AgentUser {id: x.id, name: x.name, source: 'seed', created_at: $now}) MERGE (a)-[:MEMBER_OF]->(t)`,
  `UNWIND $d.customers AS x MERGE (c:Customer {id: x.id, name: x.name, segment: x.segment, source: 'seed', created_at: x.joined_at})
     WITH c, x UNWIND x.plan_history AS h MATCH (p:Plan {name: h.plan})
     CREATE (c)-[:ON_PLAN {valid_from: h.valid_from, valid_until: coalesce(h.valid_until, ${VALID_FOREVER})}]->(p)`,
  `UNWIND $d.issues AS x MATCH (a:ProductArea {name: x.area}) MERGE (i:Issue {id: x.id, name: x.name, source: 'seed', created_at: x.first_seen}) MERGE (i)-[:IN]->(a)`,
  `UNWIND $d.kb_articles AS x MERGE (:KBArticle {id: x.id, title: x.title, area: x.area, promised_tat_hours: coalesce(x.promised_tat_hours, -1), source: 'seed', created_at: x.updated_at})`,
  `UNWIND $d.resolutions AS x MERGE (r:Resolution {id: x.id, kind: x.kind, summary: x.summary, source: 'seed', created_at: $now})
     WITH r, x MATCH (k:KBArticle {id: x.kb_id}) MERGE (r)-[:BASED_ON]->(k)`,
  `UNWIND $d.releases AS x MERGE (r:Release {version: x.version, source: 'seed', created_at: x.shipped_at})
     WITH r, x UNWIND x.introduces AS y MATCH (i:Issue {id: y.issue_id})
     CREATE (r)-[:INTRODUCED {valid_from: y.valid_from, valid_until: coalesce(y.valid_until, ${VALID_FOREVER})}]->(i)`,
  `UNWIND $d.tickets AS x MATCH (c:Customer {id: x.customer_id})
     MERGE (t:Ticket {id: x.id, subject: x.subject, status: x.status, created_at: x.created_at, source: 'seed'})
     MERGE (c)-[:RAISED]->(t)
     FOREACH (_ IN CASE WHEN x.created_at < $demo_day THEN [1] ELSE [] END | SET t.ingested_at = $now)`,
  `UNWIND $d.tickets AS x MATCH (t:Ticket {id: x.id}), (i:Issue {id: x.issue_id}) MERGE (t)-[:ABOUT]->(i)`,
  `UNWIND $d.tickets AS x MATCH (t:Ticket {id: x.id}), (r:Resolution {id: x.resolution_id}) MERGE (t)-[:RESOLVED_BY]->(r)`,
  `UNWIND $d.tickets AS x MATCH (t:Ticket {id: x.id}), (a:AgentUser {id: x.solved_by}) MERGE (a)-[:SOLVED]->(t)`,
];
export const STUB_PLAN_CHANGE = `MATCH (c:Customer {id: $id})-[r:ON_PLAN]->(p:Plan) WHERE ${EDGE_AS_OF('r')} AND p.name <> $to
  SET r.valid_until = $as_of WITH c, count(r) AS retired MATCH (np:Plan {name: $to})
  FOREACH (_ IN CASE WHEN retired > 0 THEN [1] ELSE [] END | CREATE (c)-[:ON_PLAN {valid_from: $as_of, valid_until: ${VALID_FOREVER}}]->(np))
  RETURN retired`;
export const STUB_ISSUE_FIXED = `MATCH (:Release)-[r:INTRODUCED]->(:Issue {id: $id}) WHERE ${EDGE_AS_OF('r')} SET r.valid_until = $as_of RETURN count(r) AS retired`;
export const STUB_UNINGESTED = `MATCH (t:Ticket) WHERE t.ingested_at IS NULL RETURN t.id AS id ORDER BY id`;
export const STUB_INGEST_BATCH = `UNWIND $ids AS id MATCH (t:Ticket {id: id}) SET t.ingested_at = $now, t.batch_id = $batch, t.batch_size = $size`;
export const STUB_BRIEFING = `MATCH (c:Customer)-[:RAISED]->(t:Ticket {id: $id})
  OPTIONAL MATCH (c)-[p:ON_PLAN]->(pl:Plan) WHERE ${EDGE_AS_OF('p')}
  OPTIONAL MATCH (t)-[:ABOUT]->(i:Issue)<-[:ABOUT]-(o:Ticket)-[:RESOLVED_BY]->(r:Resolution)
  OPTIONAL MATCH (r)-[:BASED_ON]->(k:KBArticle)
  RETURN c.id AS customer, c.segment AS segment, pl.name AS plan, t.subject AS subject, i.id AS issue, i.name AS issue_name,
         o.id AS similar_ticket, r.summary AS resolution, k.id AS kb ORDER BY similar_ticket`;
export const STUB_LIKELY_CAUSE = `MATCH (t:Ticket {id: $id})-[:ABOUT]->(i:Issue)<-[r:INTRODUCED]-(rel:Release) WHERE ${EDGE_AS_OF('r')}
  RETURN i.id AS issue, rel.version AS release ORDER BY release`;
export const STUB_WHO_KNOWS = `MATCH (a:AgentUser)-[s:SOLVED]->(:Ticket)-[:ABOUT]->(i:Issue {id: $id}) RETURN a.id AS agent, a.name AS name, count(s) AS solved ORDER BY solved DESC, agent`;
export const STUB_BLAST = `MATCH (rel:Release {version: $id})-[r:INTRODUCED]->(i:Issue)<-[:ABOUT]-(t:Ticket)<-[:RAISED]-(c:Customer) WHERE ${EDGE_AS_OF('r')}
  RETURN c.id AS customer, c.segment AS segment, count(t) AS tickets ORDER BY customer`;
export const STUB_CLUSTERS = `MATCH (t:Ticket)-[a:ABOUT]->(i:Issue) WHERE t.created_at >= $since RETURN i.id AS issue, count(a) AS tickets ORDER BY tickets DESC, issue`;

export const ALL_CYPHER: string[] = [
  ...VECTOR_LABELS.flatMap((l) => [vectorIndex(l, 384), vectorInsert(l)]), VECTOR_QUERY, UNINGEST, WINDOW_ABOUT, PROJECT_ABOUT, CDLP,
  TORN_BATCHES, LIVE_PLANS, PER_USER_WRITE, META_STATS, ...STUB_LOAD, STUB_PLAN_CHANGE, STUB_ISSUE_FIXED, STUB_UNINGESTED,
  STUB_INGEST_BATCH, STUB_BRIEFING, STUB_LIKELY_CAUSE, STUB_WHO_KNOWS, STUB_BLAST, STUB_CLUSTERS,
];
