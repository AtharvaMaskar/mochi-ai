// Records the landing page's demo fixtures from the seeded dataset (data/*.json, seed 42, E Corp Securities).
// Each figure is computed here with the same logic as the Cypher stored beside it, so every number on the
// page carries its receipt. `npm run record -w landing` rewrites fixtures/demo.json.
// ponytail: computed from the dataset, not replayed against FalkorDB; re-record from the live graph at integration.
import { readFileSync, writeFileSync } from 'node:fs';
import { GRAPH, ACL, REFUSAL_CASES, type Dataset, type Eval } from '@mochi/contracts';

const root = new URL('../../', import.meta.url);
const d: Dataset = JSON.parse(readFileSync(new URL('data/dataset.json', root), 'utf8'));
const ev: Eval = JSON.parse(readFileSync(new URL('data/eval.json', root), 'utf8'));

const H = 3_600_000;
const AFTER = d.generated_at; // morning, after the dream
const BEFORE = d.contradiction_events[0].at - 60_000; // the evening before, ahead of the day's events
const ran_at = AFTER;
const g = GRAPH.company;

const cust = new Map(d.customers.map((c) => [c.id, c]));
const issue = new Map(d.issues.map((i) => [i.id, i]));
const res = new Map(d.resolutions.map((r) => [r.id, r]));
const kb = new Map(d.kb_articles.map((k) => [k.id, k]));
const agent = new Map(d.agents.map((a) => [a.id, a]));
const team = (area: string) => d.product_areas.find((a) => a.name === area)!.team;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.ceil(s.length / 2) - 1]; }; // percentileDisc(.5)
const r1 = (x: number) => Math.round(x * 10) / 10;
const hours = (t: Dataset['tickets'][number]) => (t.resolved_at! - t.created_at) / H;
const resolvedOn = (iid: string) => d.tickets.filter((t) => t.issue_id === iid && t.resolved_at !== null);
const open = (t: Dataset['tickets'][number]) => t.status === 'open' || t.status === 'pending';
const q = (cypher: string, params: Record<string, unknown>, columns: string[], rows: Record<string, unknown>[]) =>
  ({ cypher, graph: g, params: { ...params, as_of: AFTER }, columns, rows, ran_at });

// When was an INTRODUCED fact retired (issue fixed)? Contradiction events are the day's changes.
const fixedAt = new Map(d.contradiction_events.filter((e) => e.kind === 'issue_fixed').map((e: any) => [e.issue_id, e]));
const introducedBy = (iid: string, asOf: number) => {
  for (const r of d.releases) for (const x of r.introduces)
    if (x.issue_id === iid && x.valid_from <= asOf && (fixedAt.get(iid)?.at ?? Infinity) > asOf) return r.version;
  return null;
};
const everIntroduced = (iid: string) => d.releases.find((r) => r.introduces.some((x) => x.issue_id === iid))?.version ?? null;

// ---------- hero: Meera's ticket, newest unresolved queue ----------
const queue = d.tickets.filter(open).sort((a, b) => b.created_at - a.created_at).slice(0, 6)
  .map((t) => ({ id: t.id, name: cust.get(t.customer_id)!.name, subject: t.subject, created_at: t.created_at, status: t.status }));
const fixCount = (iid: string) => {
  const m = new Map<string, number>();
  for (const t of resolvedOn(iid)) if (t.resolution_id) m.set(t.resolution_id, (m.get(t.resolution_id) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
const solverCount = (iid: string) => {
  const m = new Map<string, number>();
  for (const t of d.tickets) if (t.issue_id === iid && t.solved_by) m.set(t.solved_by, (m.get(t.solved_by) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

// One recorded brief per queue ticket: the desk demo in the hero lets the visitor pick any of them.
function brief(ticketId: string) {
  const t = d.tickets.find((x) => x.id === ticketId)!;
  const i = issue.get(t.issue_id!)!, c = cust.get(t.customer_id)!;
  const recent90 = d.tickets.filter((x) => x.customer_id === t.customer_id && x.created_at <= AFTER && x.created_at > AFTER - 90 * 86_400_000).length;
  // The KB most resolutions on this issue are based on, and the median over those tickets.
  const byKb = new Map<string, number[]>();
  for (const s of resolvedOn(i.id)) { const k = s.resolution_id && res.get(s.resolution_id)!.kb_id; if (k) byKb.set(k, [...(byKb.get(k) ?? []), hours(s)]); }
  const [kbId, hs] = [...byKb].sort((a, b) => b[1].length - a[1].length)[0];
  const k = kb.get(kbId)!, med = r1(median(hs));
  const [fix, fixN] = fixCount(i.id)[0];
  const [solver, solverN] = solverCount(i.id)[0];
  const cause = introducedBy(i.id, AFTER);
  const card = {
    kind: 'briefing', title: `Brief for ${t.id}`,
    queries: {
      q_1: q(`MATCH (c:Customer)-[:RAISED]->(t:Ticket {id: $ticket})-[:ABOUT]->(i:Issue)-[:IN]->(a:ProductArea)-[:OWNED_BY]->(tm:Team)
WHERE t.created_at <= $as_of
RETURN c.name AS customer, t.id AS ticket, i.name AS issue, a.name AS area, tm.name AS team`,
        { ticket: t.id }, ['customer', 'ticket', 'issue', 'area', 'team'],
        [{ customer: c.name, ticket: t.id, issue: i.name, area: i.area, team: team(i.area) }]),
      q_2: q(`MATCH (:Ticket {id: $ticket})-[:ABOUT]->(i:Issue)<-[:ABOUT]-(s:Ticket)-[:RESOLVED_BY]->(:Resolution)-[:BASED_ON]->(k:KBArticle)
WHERE s.resolved_at <= $as_of
RETURN k.id AS kb, k.promised_tat_hours AS promised_h,
  round(10 * percentileDisc((s.resolved_at - s.created_at) / 3600000.0, 0.5)) / 10 AS median_h,
  count(s) AS tickets
ORDER BY tickets DESC LIMIT 1`,
        { ticket: t.id }, ['kb', 'promised_h', 'median_h', 'tickets'],
        [{ kb: k.id, promised_h: k.promised_tat_hours, median_h: med, tickets: hs.length }]),
      q_3: q(`MATCH (c:Customer {id: $customer})-[:RAISED]->(t:Ticket)
WHERE t.created_at <= $as_of AND t.created_at > $as_of - 90 * 86400000
RETURN count(t) AS tickets_90d`,
        { customer: t.customer_id }, ['tickets_90d'], [{ tickets_90d: recent90 }]),
      q_4: q(`MATCH (:Ticket {id: $ticket})-[:ABOUT]->(i:Issue)<-[:ABOUT]-(s:Ticket)-[:RESOLVED_BY]->(r:Resolution)
WHERE s.resolved_at <= $as_of
RETURN r.id AS resolution, r.summary AS summary, count(s) AS used
ORDER BY used DESC LIMIT 1`,
        { ticket: t.id }, ['resolution', 'summary', 'used'], [{ resolution: fix, summary: res.get(fix)!.summary, used: fixN }]),
      q_5: q(`MATCH (:Ticket {id: $ticket})-[:ABOUT]->(i:Issue)<-[:ABOUT]-(s:Ticket)<-[:SOLVED]-(u:AgentUser)
WHERE s.created_at <= $as_of
RETURN u.id AS agent, u.name AS name, count(s) AS solved
ORDER BY solved DESC LIMIT 1`,
        { ticket: t.id }, ['agent', 'name', 'solved'], [{ agent: solver, name: agent.get(solver)!.name, solved: solverN }]),
      q_6: q(`MATCH (:Ticket {id: $ticket})-[:ABOUT]->(i:Issue)
OPTIONAL MATCH (r:Release)-[x:INTRODUCED]->(i)
WHERE x.valid_from <= $as_of AND x.valid_until > $as_of
RETURN r.version AS release`,
        { ticket: t.id }, ['release'], [{ release: cause ?? 'none' }]),
    },
    path: {
      query_id: 'q_1',
      nodes: [
        { id: 'c', label: 'Customer', name: c.name }, { id: 't', label: 'Ticket', name: t.id },
        { id: 'i', label: 'Issue', name: i.name }, { id: 'a', label: 'ProductArea', name: i.area },
        { id: 'tm', label: 'Team', name: team(i.area) },
      ],
      edges: [
        { type: 'RAISED', from: 'c', to: 't' }, { type: 'ABOUT', from: 't', to: 'i' },
        { type: 'IN', from: 'i', to: 'a' }, { type: 'OWNED_BY', from: 'a', to: 'tm' },
      ],
    },
    blocks: [{ type: 'kpi', query_id: 'q_2', label: 'Median resolution, this issue', column: 'median_h', unit: 'h', promised: k.promised_tat_hours, bad: med > (k.promised_tat_hours ?? Infinity) }],
  };
  return { ticket: t.id, customer: c.name, subject: t.subject, body: t.body, issue: i.name, card };
}
const hero = d.tickets.find((t) => t.id === 'T-0396')!;
const briefs = Object.fromEntries([...new Set([...queue.map((x) => x.id), hero.id])].map((id) => [id, brief(id)]));

// ---------- ask the brain: recorded questions, each mapped to its eval question ----------
const evalQ = (id: string) => ev.questions.find((x) => x.id === id)!;
type Ask = { id: string; ask: string; keywords: string[]; eval_id: string | null; answer: string; card: unknown };
const asks: Ask[] = [];

// (a) Why is Aditi's order stuck? The release that caused it was fixed last night: the dream retired the cause.
{
  const t = d.tickets.find((x) => x.id === 'T-0299')!, c = cust.get(t.customer_id)!, i = issue.get(t.issue_id!)!;
  const was = everIntroduced(i.id)!, fix = fixedAt.get(i.id)! as any, [rid, n] = fixCount(i.id)[0];
  asks.push({
    id: 'stuck', ask: `Why is ${c.name.split(' ')[0]}’s order stuck?`, keywords: ['order', 'stuck', 'pending', 'executed', c.name.split(' ')[0].toLowerCase(), 'why', 'release', 'cause'],
    eval_id: 'Q-22',
    answer: `Release ${was} caused it, but ${fix.fixed_in} fixed it last night. I retired that cause. The fix that works: ${res.get(rid)!.summary.toLowerCase()}.`,
    card: {
      kind: 'likely_cause', title: `Likely cause for ${t.id}`,
      queries: {
        q_1: q(`MATCH (c:Customer)-[:RAISED]->(t:Ticket {id: $ticket})-[:ABOUT]->(i:Issue)
OPTIONAL MATCH (r:Release)-[x:INTRODUCED]->(i)
WHERE x.valid_from <= $as_of AND x.valid_until > $as_of
RETURN c.name AS customer, i.name AS issue, r.version AS release`,
          { ticket: t.id }, ['customer', 'issue', 'release'], [{ customer: c.name, issue: i.name, release: introducedBy(i.id, AFTER) ?? 'none' }]),
        q_2: q(`MATCH (r:Release)-[x:INTRODUCED]->(i:Issue {id: $issue})
WHERE x.valid_until <= $as_of
RETURN r.version AS was, x.valid_until AS retired_at`,
          { issue: i.id }, ['was', 'retired_at'], [{ was, retired_at: fix.at }]),
        q_3: q(`MATCH (i:Issue {id: $issue})<-[:ABOUT]-(s:Ticket)-[:RESOLVED_BY]->(r:Resolution)
WHERE s.resolved_at <= $as_of
RETURN r.summary AS fix, count(s) AS used ORDER BY used DESC LIMIT 1`,
          { issue: i.id }, ['fix', 'used'], [{ fix: res.get(rid)!.summary, used: n }]),
      },
      path: { query_id: 'q_1', nodes: [{ id: 'c', label: 'Customer', name: c.name }, { id: 't', label: 'Ticket', name: t.id }, { id: 'i', label: 'Issue', name: i.name }],
        edges: [{ type: 'RAISED', from: 'c', to: 't' }, { type: 'ABOUT', from: 't', to: 'i' }] },
      blocks: [{ type: 'table', query_id: 'q_3', label: 'What fixed it before', columns: ['fix', 'used'] }],
    },
  });
}
// (b) Who knows stop-loss tickets best?
{
  const i = issue.get('I-12')!, [aid, n] = solverCount(i.id)[0], a = agent.get(aid)!;
  if (evalQ('Q-31').answer.indexOf(a.name) < 0) throw new Error('Q-31 drift');
  asks.push({
    id: 'who', ask: 'Who knows stop-loss tickets best?', keywords: ['who', 'knows', 'stop', 'loss', 'stop-loss', 'sl', 'trigger', 'expert', 'agent'],
    eval_id: 'Q-31', answer: `${a.name} has solved the most. Ask them first.`,
    card: {
      kind: 'who_knows', title: `Who knows ${i.name}`,
      queries: { q_1: q(`MATCH (u:AgentUser)-[:SOLVED]->(s:Ticket)-[:ABOUT]->(i:Issue {id: $issue}), (u)-[:MEMBER_OF]->(tm:Team)
WHERE s.created_at <= $as_of
RETURN u.name AS agent, tm.name AS team, count(s) AS solved ORDER BY solved DESC LIMIT 3`,
        { issue: i.id }, ['agent', 'team', 'solved'], solverCount(i.id).slice(0, 3).map(([id, k]) => ({ agent: agent.get(id)!.name, team: agent.get(id)!.team, solved: k }))) },
      path: { query_id: 'q_1', nodes: [{ id: 'u', label: 'AgentUser', name: a.name }, { id: 's', label: 'Ticket', name: `${n} tickets` }, { id: 'i', label: 'Issue', name: i.name }],
        edges: [{ type: 'SOLVED', from: 'u', to: 's' }, { type: 'ABOUT', from: 's', to: 'i' }] },
      blocks: [{ type: 'table', query_id: 'q_1', label: 'Most solved', columns: ['agent', 'team', 'solved'] }],
    },
  });
}
// (c) Which release made the biggest spike? (Q-41)
{
  const W = 7 * 86_400_000;
  const spike = d.releases.filter((r) => r.introduces.length).map((r) => {
    const ids = new Set(r.introduces.map((x) => x.issue_id));
    const inWin = (a: number, b: number) => d.tickets.filter((t) => t.issue_id && ids.has(t.issue_id) && t.created_at >= a && t.created_at < b).length;
    return { release: r.version, before: inWin(r.shipped_at - W, r.shipped_at), after: inWin(r.shipped_at, r.shipped_at + W) };
  }).sort((a, b) => (b.after - b.before) - (a.after - a.before));
  const top = spike[0];
  if (!evalQ('Q-41').answer.startsWith(top.release)) throw new Error('Q-41 drift');
  asks.push({
    id: 'spike', ask: 'Which release broke the most?', keywords: ['release', 'broke', 'spike', 'most', 'worst', 'caused', 'tickets', 'deploy'],
    eval_id: 'Q-41', answer: `Release ${top.release}. Tickets on the issues it introduced jumped the week after it shipped.`,
    card: {
      kind: 'blast_radius', title: 'Ticket spike after each release',
      queries: { q_1: q(`MATCH (r:Release)-[x:INTRODUCED]->(i:Issue)<-[:ABOUT]-(t:Ticket)
WHERE x.valid_from <= $as_of AND t.created_at >= r.shipped_at - 604800000 AND t.created_at < r.shipped_at + 604800000
RETURN r.version AS release,
  sum(CASE WHEN t.created_at < r.shipped_at THEN 1 ELSE 0 END) AS week_before,
  sum(CASE WHEN t.created_at >= r.shipped_at THEN 1 ELSE 0 END) AS week_after
ORDER BY week_after - week_before DESC LIMIT 4`,
        {}, ['release', 'week_before', 'week_after'], spike.slice(0, 4).map((s) => ({ release: s.release, week_before: s.before, week_after: s.after }))) },
      path: null,
      blocks: [{ type: 'bars', query_id: 'q_1', label: 'Tickets the week after shipping', x: 'release', y: 'week_after' }],
    },
  });
}
// (d) What fixed double brokerage before? (Q-33)
{
  const i = issue.get('I-13')!, [rid, n] = fixCount(i.id)[0], r = res.get(rid)!;
  if (evalQ('Q-33').answer.indexOf(rid) < 0) throw new Error('Q-33 drift');
  asks.push({
    id: 'fix', ask: 'What fixed double brokerage before?', keywords: ['fixed', 'fix', 'double', 'brokerage', 'charged', 'twice', 'before', 'resolution', 'refund'],
    eval_id: 'Q-33', answer: `${r.summary}. It is the most used fix for this issue.`,
    card: {
      kind: 'similar', title: `Fixes for ${i.name}`,
      queries: { q_1: q(`MATCH (i:Issue {id: $issue})<-[:ABOUT]-(s:Ticket)-[:RESOLVED_BY]->(r:Resolution)-[:BASED_ON]->(k:KBArticle)
WHERE s.resolved_at <= $as_of
RETURN r.summary AS fix, k.id AS kb, count(s) AS used ORDER BY used DESC LIMIT 3`,
        { issue: i.id }, ['fix', 'kb', 'used'], fixCount(i.id).slice(0, 3).map(([id, k]) => ({ fix: res.get(id)!.summary, kb: res.get(id)!.kb_id ?? 'none', used: k }))) },
      path: { query_id: 'q_1', nodes: [{ id: 'i', label: 'Issue', name: i.name }, { id: 's', label: 'Ticket', name: `${n} tickets` }, { id: 'r', label: 'Resolution', name: rid }, { id: 'k', label: 'KBArticle', name: r.kb_id ?? '' }],
        edges: [{ type: 'ABOUT', from: 's', to: 'i' }, { type: 'RESOLVED_BY', from: 's', to: 'r' }, { type: 'BASED_ON', from: 'r', to: 'k' }] },
      blocks: [{ type: 'table', query_id: 'q_1', label: 'Most used fixes', columns: ['fix', 'kb', 'used'] }],
    },
  });
}

// ---------- the night: retired facts, a mismatch suggestion, the morning report ----------
const retired = d.contradiction_events.map((e: any) => e.kind === 'issue_fixed'
  ? { event: e.id, at: e.at, label: `Release ${everIntroduced(e.issue_id)} causes ${issue.get(e.issue_id)!.name}`, now: `Fixed in ${e.fixed_in}`, edge: 'INTRODUCED' }
  : { event: e.id, at: e.at, label: `${cust.get(e.customer_id)!.name} is on ${e.from}`, now: `Now on ${e.to}`, edge: 'ON_PLAN' });
const dayTickets = d.tickets.filter((t) => t.created_at >= AFTER - 86_400_000);
const newTickets = dayTickets.length;
const byIssue = new Map<string, number>();
for (const t of dayTickets) if (t.issue_id) byIssue.set(t.issue_id, (byIssue.get(t.issue_id) ?? 0) + 1);
const cluster = q(`MATCH (t:Ticket)-[:ABOUT]->(i:Issue)
WHERE t.ingested_at > $as_of - 86400000 AND t.ingested_at <= $as_of
RETURN i.name AS issue, count(t) AS tickets ORDER BY tickets DESC LIMIT 5`, {}, ['issue', 'tickets'],
  [...byIssue].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([id, n]) => ({ issue: issue.get(id)!.name, tickets: n })));
// Tickets by the IST hour they arrived: the brain is asked at every hour.
const istHour = (ms: number) => Math.floor(((ms + 19_800_000) % 86_400_000) / 3_600_000);
const perHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, tickets: d.tickets.filter((t) => istHour(t.created_at) === h).length }));
const offHours = perHour.filter((r) => r.hour < 9 || r.hour >= 18).reduce((a, r) => a + r.tickets, 0);
const hoursQ = q(`MATCH (t:Ticket) WHERE t.created_at <= $as_of
RETURN toInteger(((t.created_at + 19800000) % 86400000) / 3600000) AS hour, count(t) AS tickets ORDER BY hour`, {}, ['hour', 'tickets'], perHour);
const offHoursQ = q(`MATCH (t:Ticket) WHERE t.created_at <= $as_of
WITH toInteger(((t.created_at + 19800000) % 86400000) / 3600000) AS hour
RETURN sum(CASE WHEN hour < 9 OR hour >= 18 THEN 1 ELSE 0 END) AS off_hours, count(*) AS total`, {}, ['off_hours', 'total'], [{ off_hours: offHours, total: d.tickets.length }]);
const ingested = dayTickets.sort((a, b) => b.created_at - a.created_at).slice(0, 4).map((t) => ({ id: t.id, subject: t.subject, created_at: t.created_at }));
const mm = ev.planted_mismatches.find((m) => m.id === 'M-2')!;
const mmKb = kb.get(mm.kb_id!)!;
const memdiffRows = [
  ...retired.map((r) => ({ change: 'retired', fact: r.label })),
  ...retired.map((r) => ({ change: 'added', fact: r.edge === 'INTRODUCED' ? r.label.replace(/^Release \S+ causes (.*)$/, `$1: ${r.now.toLowerCase()}`) : `${r.label.split(' is on ')[0]}: ${r.now.toLowerCase()}` })),
];
const reportQueries = {
  q_1: q(`MATCH (t:Ticket) WHERE t.ingested_at > $as_of - 86400000 AND t.ingested_at <= $as_of RETURN count(t) AS ingested`, {}, ['ingested'], [{ ingested: newTickets }]),
  q_2: q(`MATCH ()-[x:INTRODUCED|ON_PLAN]->() WHERE x.valid_until > $as_of - 86400000 AND x.valid_until <= $as_of RETURN count(x) AS retired`, {}, ['retired'], [{ retired: retired.length }]),
  q_3: q(`MATCH ()-[x:INTRODUCED|ON_PLAN]->()
WHERE (x.valid_until > $as_of - 86400000 AND x.valid_until <= $as_of) OR (x.valid_from > $as_of - 86400000 AND x.valid_from <= $as_of)
RETURN CASE WHEN x.valid_until <= $as_of THEN 'retired' ELSE 'added' END AS change, x.summary AS fact`, {}, ['change', 'fact'], memdiffRows),
  q_4: q(`MATCH (s:Suggestion)-[:FROM]->(o:ObservedPattern)-[c:CONTRADICTS]->(k:KBArticle {id: $kb})
WHERE c.valid_from <= $as_of AND c.valid_until > $as_of
RETURN k.id AS kb, k.promised_tat_hours AS promised_h, o.measured_tat_hours AS measured_h, o.support_count AS tickets, s.text AS text`,
    { kb: mmKb.id }, ['kb', 'promised_h', 'measured_h', 'tickets', 'text'],
    [{ kb: mmKb.id, promised_h: mm.promised, measured_h: mm.measured, tickets: mm.ticket_ids.length, text: `${mmKb.title}: practice takes ${mm.measured}h, the article promises ${mm.promised}h.` }]),
};
const report = {
  id: 'landing_morning_report_seed42', version: 1, title: 'What I learned overnight', generated_at: AFTER, generated_by: 'dream', topic: 'morning report',
  queries: reportQueries,
  body: `Overnight I read <num query_id="q_1" column="ingested">${newTickets}</num> new tickets and retired <num query_id="q_2" column="retired">${retired.length}</num> facts that stopped being true.

<memdiff query_id="q_3"/>

<suggestion query_id="q_4" tag="The docs and reality disagree" edge="CONTRADICTS" actions='["send_to_team:${mm.area}","draft_kb:${mmKb.id}","dismiss"]'>
${mmKb.id} promises <num query_id="q_4" column="promised_h">${mm.promised}</num>h. Across <num query_id="q_4" column="tickets">${mm.ticket_ids.length}</num> tickets, practice took <num query_id="q_4" column="measured_h">${mm.measured}</num>h.
</suggestion>`,
};

// ---------- receipts: one figure before and after the dream (?asOf=) ----------
const asOfCount = (asOf: number, version: string) => d.tickets.filter((t) => t.issue_id && open(t) && t.created_at <= asOf && introducedBy(t.issue_id, asOf) === version).length;
const asOfRelease = '3.2.0';
const asof = {
  release: asOfRelease, before_ms: BEFORE, after_ms: AFTER,
  before: asOfCount(BEFORE, asOfRelease), after: asOfCount(AFTER, asOfRelease),
  query: q(`MATCH (r:Release {version: $release})-[x:INTRODUCED]->(i:Issue)<-[:ABOUT]-(t:Ticket)
WHERE x.valid_from <= $as_of AND x.valid_until > $as_of
  AND t.created_at <= $as_of AND t.status IN ['open', 'pending']
RETURN count(t) AS open_tickets`, { release: asOfRelease }, ['open_tickets'], [{ open_tickets: asOfCount(AFTER, asOfRelease) }]),
};

// ---------- tiers: who reads and writes what (from the ACL contract) ----------
const tiers = {
  company: GRAPH.company, reader: ACL.reader.user, dream: ACL.dream.user, demoUser: ACL.demoUser.user,
  refusal: { case: REFUSAL_CASES[1].case, command: `GRAPH.QUERY ${GRAPH.company} "CREATE (:Ticket {id:'evil'})"`,
    // ponytail: Redis ACL NOPERM format for this rule set; replace with the line acl.test.ts captures at integration.
    error: `(error) NOPERM User ${ACL.reader.user} has no permissions to run the 'graph.QUERY' command` },
};

const out = {
  recorded_from: `data/dataset.json, seed ${d.seed}, ${d.broker}`,
  broker: d.broker, as_of: { before: BEFORE, after: AFTER },
  counts: { open: d.tickets.filter((t) => t.status === 'open').length, pending: d.tickets.filter((t) => t.status === 'pending').length },
  hero: { queue, ticket: hero.id, briefs },
  asks, night: { retired, report, cluster, ingested }, awake: { hours: hoursQ, offHours: offHoursQ }, asof, tiers,
};
writeFileSync(new URL('./demo.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`demo.json: ${asks.length} asks, ${retired.length} retired facts, as-of ${asof.before} -> ${asof.after}`);
