// Every Cypher string the dream runs. Labels, edge types and properties are the contract's
// (cypher.test.ts runs checkCypherNames over each). $as_of is the dream's clock for every write.
import { EDGE_AS_OF, NODE_AS_OF, VALID_FOREVER } from '@mochi/contracts';

const DAY = 86_400_000;

export const Q = {
  // ── 2 · ingest ───────────────────────────────────────────────────────────────────────────
  pendingTickets: `MATCH (t:Ticket) WHERE t.ingested_at IS NULL AND t.created_at <= $as_of
OPTIONAL MATCH (t)-[:ABOUT]->(i:Issue)
OPTIONAL MATCH (t)-[:RESOLVED_BY]->(res:Resolution)
RETURN t.id AS id, t.subject AS subject, t.body AS body, t.status AS status, i.id AS issue_id, res.id AS res_id
ORDER BY t.id`,
  areas: `MATCH (a:ProductArea) RETURN a.name AS name`,
  issues: `MATCH (i:Issue)-[:IN]->(a:ProductArea) RETURN i.id AS id, i.name AS name, a.name AS area, i.created_at AS created_at ORDER BY i.created_at DESC, i.id`,
  // One atomic query per batch: extraction, ingested_at and the batch marker land together.
  ingestBatch: `UNWIND $rows AS r
MATCH (t:Ticket {id: r.ticket_id}) WHERE t.ingested_at IS NULL
MATCH (a:ProductArea {name: r.area})
MERGE (i:Issue {id: r.issue_id})
ON CREATE SET i.name = r.issue_name, i.first_seen = t.created_at, i.created_at = $as_of, i.source = 'dream', i.source_ticket = r.ticket_id
MERGE (i)-[:IN]->(a)
MERGE (t)-[:ABOUT]->(i)
SET t.ingested_at = $as_of, t.batch_id = $batch_id, t.batch_size = $batch_size
WITH t, r
FOREACH (_ IN CASE WHEN r.res_kind <> '' THEN [1] ELSE [] END |
  MERGE (res:Resolution {id: r.res_id})
  ON CREATE SET res.kind = r.res_kind, res.summary = r.res_summary, res.created_at = $as_of, res.source = 'dream', res.source_ticket = r.ticket_id
  MERGE (t)-[:RESOLVED_BY]->(res))
WITH t, r
FOREACH (_ IN CASE WHEN r.issue2_id <> '' THEN [1] ELSE [] END |
  MERGE (a2:ProductArea {name: r.area2})
  MERGE (i2:Issue {id: r.issue2_id})
  ON CREATE SET i2.name = r.issue2_name, i2.first_seen = t.created_at, i2.created_at = $as_of, i2.source = 'dream', i2.source_ticket = r.ticket_id
  MERGE (i2)-[:IN]->(a2)
  MERGE (t)-[x:ABOUT]->(i2)
  ON CREATE SET x.source = 'dream', x.created_at = $as_of, x.batch_id = $batch_id, x.second_issue = true)
RETURN count(t) AS written`,

  // ── 2b · SIMILAR_TO: nightly kNN over ticket embeddings (score is a distance; smaller = closer) ─────
  knn: `UNWIND $ids AS id
MATCH (t:Ticket {id: id}) WHERE t.embedding IS NOT NULL AND ${NODE_AS_OF('t')}
CALL db.idx.vector.queryNodes('Ticket', 'embedding', 7, t.embedding) YIELD node, score
WITH t, node, score WHERE node <> t AND ${NODE_AS_OF('node')}
RETURN t.id AS a, node.id AS b, score ORDER BY a, score, b`,
  ticketIds: `MATCH (t:Ticket) WHERE ${NODE_AS_OF('t')} RETURN t.id AS id ORDER BY id`,
  liveSimilar: `MATCH (a:Ticket)-[s:SIMILAR_TO]->(b:Ticket) WHERE ${EDGE_AS_OF('s')} RETURN a.id AS a, b.id AS b`,
  retireSimilar: `UNWIND $rows AS r
MATCH (:Ticket {id: r.a})-[s:SIMILAR_TO]->(:Ticket {id: r.b}) WHERE ${EDGE_AS_OF('s')}
SET s.valid_until = $as_of
RETURN count(s) AS retired`,
  createSimilar: `UNWIND $rows AS r
MATCH (a:Ticket {id: r.a}), (b:Ticket {id: r.b})
CREATE (a)-[s:SIMILAR_TO {score: r.score, valid_from: $as_of, valid_until: ${VALID_FOREVER}, source: 'dream', created_at: $as_of}]->(b)
RETURN count(s) AS created`,

  // ── 4 · clusters ─────────────────────────────────────────────────────────────────────────
  windowPairs: `MATCH (t:Ticket)-[:ABOUT]->(i:Issue)
WHERE t.created_at > $as_of - ${7 * DAY} AND ${NODE_AS_OF('t')} AND ${NODE_AS_OF('i')}
RETURN t.id AS t, i.id AS i, i.name AS name ORDER BY t.id, i.id`,
  projectPairs: `UNWIND $rows AS r MERGE (t:Ticket {id: r.t}) MERGE (i:Issue {id: r.i}) MERGE (t)-[:ABOUT]->(i)`,
  labelPropagation: `CALL algo.labelPropagation({nodeLabels: ['Ticket', 'Issue'], relationshipTypes: ['ABOUT'], maxIterations: 10}) YIELD node, communityId
WITH node, communityId WHERE node:Ticket
RETURN communityId, node.id AS id ORDER BY id`,
  retireClusterEdges: `UNWIND $rows AS r
MATCH (t:Ticket {id: r.t})-[old:IN_CLUSTER]->(oc:Cluster)
WHERE ${EDGE_AS_OF('old')} AND oc.id <> r.c
SET old.valid_until = $as_of
RETURN count(old) AS retired`,
  createClusterEdges: `UNWIND $rows AS r
MATCH (t:Ticket {id: r.t})
MERGE (c:Cluster {id: r.c})
ON CREATE SET c.name = r.name, c.created_at = $as_of, c.source = 'dream', c.source_ticket_ids = r.members
WITH t, c
OPTIONAL MATCH (t)-[cur:IN_CLUSTER]->(c) WHERE ${EDGE_AS_OF('cur')}
WITH t, c, count(cur) AS live WHERE live = 0
CREATE (t)-[e:IN_CLUSTER {valid_from: $as_of, valid_until: ${VALID_FOREVER}, source: 'dream', created_at: $as_of}]->(c)
RETURN count(e) AS created`,

  // ── 5 · practice ─────────────────────────────────────────────────────────────────────────
  kbResolved: `MATCH (t:Ticket)-[:RESOLVED_BY]->(:Resolution)-[:BASED_ON]->(kb:KBArticle), (t)-[:ABOUT]->(i:Issue)-[:IN]->(a:ProductArea)
WHERE t.resolved_at IS NOT NULL AND t.resolved_at <= $as_of AND ${NODE_AS_OF('t')}
RETURN kb.id AS target, i.id AS issue, a.name AS area, kb.promised_tat_hours AS promised, t.id AS tid, t.created_at AS created, t.resolved_at AS resolved
ORDER BY tid`,
  policyResolved: `MATCH (p:Policy)-[:IN]->(a:ProductArea)<-[:IN]-(:Issue)<-[:ABOUT]-(t:Ticket)<-[:RAISED]-(c:Customer)
WHERE p.promised_tat_hours IS NOT NULL AND ${NODE_AS_OF('p')} AND t.resolved_at IS NOT NULL AND t.resolved_at <= $as_of
  AND (p.priority IS NULL OR t.priority = p.priority) AND (p.segment IS NULL OR c.segment = p.segment)
RETURN p.id AS target, a.name AS area, p.promised_tat_hours AS promised, t.id AS tid, t.created_at AS created, t.resolved_at AS resolved
ORDER BY tid`,
  workarounds: `MATCH (t:Ticket)-[:RESOLVED_BY]->(res:Resolution), (t)-[:ABOUT]->(:Issue)-[:IN]->(a:ProductArea)
WHERE res.kind = 'workaround' AND NOT (res)-[:BASED_ON]->(:KBArticle) AND ${NODE_AS_OF('t')}
RETURN a.name AS area, res.summary AS summary, t.id AS tid, t.created_at AS created
ORDER BY tid`,
  writePatterns: `UNWIND $rows AS r
MERGE (p:ObservedPattern {id: r.id})
ON CREATE SET p.key = r.key, p.kind = r.kind, p.run_id = $run, p.area = r.area, p.summary = r.summary,
  p.measured_tat_hours = r.measured, p.support_count = r.support, p.last_seen = r.last_seen,
  p.source = 'dream', p.created_at = $as_of, p.source_ticket_ids = r.tickets
WITH p, r
UNWIND r.tickets AS tid
MATCH (t:Ticket {id: tid})
MERGE (p)-[:SEEN_IN]->(t)`,

  // ── 6 · mismatch rules ───────────────────────────────────────────────────────────────────
  retireMismatches: `MATCH (o:ObservedPattern)-[e:CONTRADICTS|UNDOCUMENTED]->()
WHERE o.run_id <> $run AND ${EDGE_AS_OF('e')}
SET e.valid_until = $as_of
RETURN count(e) AS retired`,
  contradictsKB: `UNWIND $rows AS r
MATCH (p:ObservedPattern {id: r.pid}), (d:KBArticle {id: r.target})
MERGE (p)-[c:CONTRADICTS]->(d)
ON CREATE SET c.delta = r.delta, c.promised = r.promised, c.measured = r.measured, c.valid_from = $as_of, c.valid_until = ${VALID_FOREVER}, c.source = 'dream', c.created_at = $as_of
RETURN count(c) AS n`,
  contradictsPolicy: `UNWIND $rows AS r
MATCH (p:ObservedPattern {id: r.pid}), (d:Policy {id: r.target})
MERGE (p)-[c:CONTRADICTS]->(d)
ON CREATE SET c.delta = r.delta, c.promised = r.promised, c.measured = r.measured, c.valid_from = $as_of, c.valid_until = ${VALID_FOREVER}, c.source = 'dream', c.created_at = $as_of
RETURN count(c) AS n`,
  undocumented: `UNWIND $rows AS r
MATCH (p:ObservedPattern {id: r.pid}), (a:ProductArea {name: r.area})
MERGE (p)-[u:UNDOCUMENTED]->(a)
ON CREATE SET u.support_count = r.support, u.valid_from = $as_of, u.valid_until = ${VALID_FOREVER}, u.source = 'dream', u.created_at = $as_of
RETURN count(u) AS n`,

  // ── 6b · suggestions ─────────────────────────────────────────────────────────────────────
  feedback: `MATCH (:AgentUser)-[f:FEEDBACK]->(s:Suggestion) RETURN s.id AS id, f.verdict AS verdict, f.at AS at`,
  suggestions: `MATCH (s:Suggestion) WHERE ${NODE_AS_OF('s')} RETURN s.id AS id, s.key AS key, s.status AS status, s.expires_at AS expires_at, s.created_at AS created_at ORDER BY s.created_at, s.id`,
  // The morning report always shows what is still open, not only what tonight created.
  openSuggestions: `MATCH (s:Suggestion) WHERE s.status = 'open' AND s.created_at <= $as_of
RETURN s.id AS id, s.key AS key, s.edge AS edge, s.area AS area, s.text AS text ORDER BY s.created_at DESC, s.id LIMIT 3`,
  setSuggestionStatus: `UNWIND $rows AS r MATCH (s:Suggestion {id: r.id}) WHERE s.status <> r.status SET s.status = r.status`,
  owner: `MATCH (:ProductArea {name: $area})-[:OWNED_BY]->(team:Team) RETURN team.name AS team`,
  createSuggestions: `UNWIND $rows AS r
MATCH (p:ObservedPattern {id: r.pid})
MATCH (:ProductArea {name: r.area})-[:OWNED_BY]->(team:Team)
MERGE (s:Suggestion {id: r.id})
ON CREATE SET s.key = r.key, s.edge = r.edge, s.text = r.text, s.area = r.area, s.evidence_ticket_ids = r.tickets,
  s.source_ticket_ids = r.tickets, s.support_count = r.support, s.confidence = r.confidence, s.expires_at = r.expires_at,
  s.status = 'open', s.source = 'dream', s.created_at = $as_of
MERGE (s)-[:FROM]->(p)
MERGE (s)-[:FOR]->(team)
RETURN count(DISTINCT s) AS n`,

  // ── 7 · doctrine ─────────────────────────────────────────────────────────────────────────
  candidates: `MATCH (d:DoctrineCandidate)-[:IN]->(a:ProductArea)
WHERE d.reviewed_at IS NULL AND d.text IS NOT NULL
RETURN id(d) AS nid, d.text AS text, a.name AS area, d.promised_tat_hours AS promised, d.steps AS steps,
  d.taught_by AS taught_by, d.source_session AS source_session, d.created_at AS created_at, coalesce(d.reviewed, false) AS reviewed
ORDER BY d.created_at, nid`,
  commitPolicies: `UNWIND $rows AS r
MATCH (a:ProductArea {name: r.area})
MERGE (p:Policy {id: r.id})
ON CREATE SET p.text = r.text, p.promised_tat_hours = r.promised, p.steps = r.steps, p.source = 'teach',
  p.taught_by = r.taught_by, p.source_session = r.source_session, p.created_at = $as_of
MERGE (p)-[:IN]->(a)
RETURN count(p) AS n`,
  markReviewed: `MATCH (d:DoctrineCandidate) WHERE id(d) IN $ids SET d.reviewed_at = $as_of`,

  // ── counts (tests, bench) ────────────────────────────────────────────────────────────────
  counts: `MATCH (n) WITH count(n) AS nodes OPTIONAL MATCH ()-[e]->() RETURN nodes, count(e) AS edges`,
} as const;

// ── 8 · morning report stored queries (each takes $as_of; re-render replays them) ───────────
export const R = {
  memdiff: `MATCH (a)-[e:ON_PLAN|INTRODUCED]->(b)
WHERE e.valid_until > $as_of - ${DAY} AND e.valid_until <= $as_of
RETURN 'retired' AS change, coalesce(a.id, a.version, a.name) + ' ' + type(e) + ' ' + coalesce(b.id, b.version, b.name) AS fact
UNION ALL
MATCH (a)-[e:ON_PLAN|INTRODUCED]->(b)
WHERE e.valid_from > $as_of - ${DAY} AND ${EDGE_AS_OF('e')}
RETURN 'added' AS change, coalesce(a.id, a.version, a.name) + ' ' + type(e) + ' ' + coalesce(b.id, b.version, b.name) AS fact`,
  clusters: `MATCH (:Ticket)-[e:IN_CLUSTER]->(c:Cluster)
WHERE ${EDGE_AS_OF('e')} AND ${NODE_AS_OF('c')}
WITH c, count(e) AS tickets, sum(CASE WHEN e.valid_from <= $as_of - ${DAY} THEN 1 ELSE 0 END) AS before
RETURN c.name + ' (' + c.id + ')' AS cluster, tickets, tickets - before AS trend
ORDER BY trend DESC, tickets DESC, cluster LIMIT 8`,
  ingested: `MATCH (t:Ticket) WHERE t.batch_id IS NOT NULL AND t.ingested_at > $as_of - ${DAY} AND t.ingested_at <= $as_of
RETURN count(t) AS ingested`,
  suggestion: `MATCH (s:Suggestion {id: $id})-[:FROM]->(p:ObservedPattern)-[e:CONTRADICTS|UNDOCUMENTED]->(d)
WHERE ${NODE_AS_OF('s')} AND e.valid_from <= $as_of
MATCH (s)-[:FOR]->(team:Team)
RETURN s.id AS id, type(e) AS edge, coalesce(d.id, d.name) AS target, team.name AS team, s.support_count AS support,
  s.confidence AS confidence, p.measured_tat_hours AS measured, e.promised AS promised, e.delta AS delta, s.status AS status`,
} as const;
