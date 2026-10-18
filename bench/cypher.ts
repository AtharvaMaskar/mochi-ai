// Every Cypher string bench sends, in one place so checkCypherNames can audit them (task 4.3).
import { EDGE_AS_OF } from '@mochi/contracts';

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

// Clusters ablation: drop the seeded issue links so the graph side clusters only what the dream's extraction derives.
export const STRIP_ABOUT = `MATCH (t:Ticket) OPTIONAL MATCH (t)-[a:ABOUT]->() DELETE a REMOVE t.ingested_at, t.batch_id, t.batch_size`;
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

export const ALL_CYPHER: string[] = [
  ...VECTOR_LABELS.flatMap((l) => [vectorIndex(l, 384), vectorInsert(l)]), VECTOR_QUERY, UNINGEST, STRIP_ABOUT, WINDOW_ABOUT, PROJECT_ABOUT, CDLP,
  TORN_BATCHES, LIVE_PLANS, PER_USER_WRITE, META_STATS,
];
