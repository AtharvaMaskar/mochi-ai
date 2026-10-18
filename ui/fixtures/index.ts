// Fixtures for the ui (add-ui-components). E Corp Securities is a fictional broker; every name,
// ticket and figure here is invented. Stories, cards and sandbox HTML use the contract shapes and
// are checked by fixtures.test.ts with the contract validators.
import { GRAPH, type Story, type StoredQuery, type ToolCard, type SandboxHtml } from '@mochi/contracts';

export const DREAM_AT = 1792269000000; // the night's dream, 02:00 IST
const q = (cypher: string, columns: string[], rows: Record<string, unknown>[], params: Record<string, unknown> = {}): StoredQuery =>
  ({ cypher, graph: GRAPH.company, params, columns, rows, ran_at: DREAM_AT });

// ---------- Morning report (the dream's story) ----------

const reportQueries: Story['queries'] = {
  q_1: q(`MATCH (t:Ticket)-[:RESOLVED_BY]->(r:Resolution)
WHERE t.created_at <= $as_of AND t.created_at > $as_of - 86400000
RETURN percentileCont(r.hours, 0.5) AS median_h`, ['median_h'], [{ median_h: 7.2 }]),
  q_2: q(`MATCH (t:Ticket)-[m:IN_CLUSTER]->(c:Cluster)
WHERE m.valid_from <= $as_of AND m.valid_until > $as_of
RETURN c.name AS cluster, count(t) AS tickets, c.trend AS trend, c.hot AS hot
ORDER BY tickets DESC LIMIT 5`, ['cluster', 'tickets', 'trend', 'hot'], [
    { cluster: 'OTP not delivered', tickets: 41, trend: 'up', hot: true },
    { cluster: 'Payin not credited', tickets: 23, trend: 'flat', hot: false },
    { cluster: 'Contract note missing', tickets: 12, trend: 'down', hot: false },
    { cluster: 'Margin alert wrong', tickets: 9, trend: 'up', hot: false },
  ]),
  q_3: q(`MATCH (t:Ticket) WHERE t.created_at <= $as_of AND t.created_at > $as_of - 7 * 86400000
RETURN date(t.created_at) AS day, count(t) AS opened,
       count(CASE WHEN t.status = 'resolved' THEN 1 END) AS resolved ORDER BY day`, ['day', 'opened', 'resolved'], [
    { day: '12 Oct', opened: 58, resolved: 55 },
    { day: '13 Oct', opened: 61, resolved: 57 },
    { day: '14 Oct', opened: 66, resolved: 52 },
    { day: '15 Oct', opened: 92, resolved: 60 },
    { day: '16 Oct', opened: 104, resolved: 71 },
    { day: '17 Oct', opened: 97, resolved: 83 },
  ]),
  q_4: q(`MATCH (c:Customer)-[:RAISED]->(t:Ticket)-[:ABOUT]->(i:Issue)
WHERE t.created_at <= $as_of AND t.created_at > $as_of - 7 * 86400000
WITH c, i, count(t) AS contacts WHERE contacts > 2
RETURN c.name AS customer, contacts, i.name AS issue ORDER BY contacts DESC LIMIT 10`, ['customer', 'contacts', 'issue'], [
    { customer: 'Priya Raman', contacts: 4, issue: 'OTP not delivered' },
    { customer: 'Kabir Shah', contacts: 3, issue: 'Payin not credited' },
    { customer: 'Meera Iyer', contacts: 3, issue: 'OTP not delivered' },
  ]),
  q_5: q(`MATCH (a)-[r]->(b) WHERE r.valid_until > $as_of - 86400000 AND r.valid_until <= $as_of
   OR (r.valid_from > $as_of - 86400000 AND r.valid_from <= $as_of)
RETURN CASE WHEN r.valid_until <= $as_of THEN 'retired' ELSE 'added' END AS change, r.summary AS fact`, ['change', 'fact'], [
    { change: 'retired', fact: 'OTP delays come from the SMS gateway' },
    { change: 'added', fact: 'OTP delays started with app release 2.4' },
    { change: 'added', fact: 'Payins after 15:30 credit the next working day' },
  ]),
  q_6: q(`MATCH (o:ObservedPattern)-[c:CONTRADICTS]->(k:KBArticle {id: $kb})
WHERE c.valid_from <= $as_of AND c.valid_until > $as_of
RETURN k.promised_tat_hours AS promised_h, o.measured_tat_hours AS measured_h, o.support_count AS tickets`,
  ['promised_h', 'measured_h', 'tickets'], [{ promised_h: 4, measured_h: 9.5, tickets: 31 }], { kb: 'KB-12' }),
};

const reportBody = `Tickets rose this week. The jump starts on 15 Oct, the day app release 2.4 shipped. Median resolution was <num query_id="q_1" column="median_h">7.2</num> hours yesterday, over the promise.

<grid widths="1,2">
<kpi query_id="q_1" label="Median resolution" column="median_h" unit="h" promised="4" bad="true"/>
<bars query_id="q_2" label="Clusters this week" x="cluster" y="tickets" trend="trend" hot="hot"/>
</grid>

The OTP cluster holds <num query_id="q_2" column="tickets">41</num> tickets and is still growing. I traced it to release 2.4, not the SMS gateway.

<line query_id="q_3" label="Tickets per day" x="day" series='["opened","resolved"]'/>

## Who wrote more than twice

<table query_id="q_4" label="Repeat contacts this week" columns='["customer","contacts","issue"]'/>

## What I changed in memory

<memdiff query_id="q_5"/>

<suggestion query_id="q_6" tag="The docs and the desk disagree" edge="CONTRADICTS" actions='["send_to_team:payments","draft_kb:KB-12","dismiss"]'>KB-12 promises a payin credit within <num query_id="q_6" column="promised_h">4</num> hours. Resolved tickets show <num query_id="q_6" column="measured_h">9.5</num> hours, across <num query_id="q_6" column="tickets">31</num> tickets.</suggestion>`;

export const morningReport: Story = {
  id: 'r7KxQ2mVn8LpT4sW', version: 2, title: 'Morning report, 18 Oct', generated_at: DREAM_AT,
  generated_by: 'dream', topic: 'daily', queries: reportQueries, body: reportBody,
};
// Version 1: the same night's first draft, before the memory diff was added.
export const morningReportV1: Story = {
  ...morningReport, version: 1, body: reportBody.split('## What I changed in memory')[0].trim(),
};

// A story that must not render: a column its query lacks, and a query that doesn't exist.
export const brokenStory: Story = {
  id: 'bR0k3nSt0ryF1xtr', version: 1, title: 'Broken on purpose', generated_at: DREAM_AT,
  generated_by: 'user:demo', topic: 'drift', queries: { q_1: reportQueries.q_2 },
  body: `Clusters by size.

<bars query_id="q_1" label="Clusters" x="cluster" y="tickets_total"/>

Median was <num query_id="q_9" column="median_h">7</num> hours.`,
};

export const stories: Story[] = [morningReport, morningReportV1, brokenStory];

// The dream's own run, for Overview's PipelineFlow.
export const dreamRun: Record<string, StoredQuery> = {
  q_1: q(`MATCH (d:Cluster) WHERE d.created_at <= $as_of
RETURN $ingested AS ingested, count(d) AS clustered, $retired AS retired, $mismatches AS mismatches, $reports AS reports`,
  ['ingested', 'clustered', 'retired', 'mismatches', 'reports'],
  [{ ingested: 412, clustered: 9, retired: 3, mismatches: 2, reports: 1 }], { ingested: 412, retired: 3, mismatches: 2, reports: 1 }),
};

// ---------- Briefing card (Tickets screen) ----------

export const briefingCard: ToolCard = {
  kind: 'briefing',
  title: 'What I know about this ticket',
  queries: {
    q_1: q(`MATCH (t:Ticket {id: $ticket})-[:ABOUT]->(i:Issue)<-[r:INTRODUCED]-(rel:Release),
      (i)-[:IN]->(a:ProductArea)-[:OWNED_BY]->(team:Team)
WHERE r.valid_from <= $as_of AND r.valid_until > $as_of
RETURN t.id AS ticket, i.name AS issue, rel.version AS release, a.name AS area, team.name AS team`,
    ['ticket', 'issue', 'release', 'area', 'team'],
    [{ ticket: 'T-1042', issue: 'OTP not delivered', release: '2.4', area: 'Login and 2FA', team: 'Identity' }], { ticket: 'T-1042' }),
    q_2: q(`MATCH (t:Ticket)-[:ABOUT]->(:Issue {id: $issue}), (t)-[:RESOLVED_BY]->(r:Resolution)-[:BASED_ON]->(k:KBArticle)
WHERE t.created_at <= $as_of
RETURN r.summary AS fix, k.id AS kb, count(t) AS tickets ORDER BY tickets DESC LIMIT 3`,
    ['fix', 'kb', 'tickets'], [
      { fix: 'Switch OTP to voice call', kb: 'KB-31', tickets: 17 },
      { fix: 'Reinstall app 2.4.1', kb: 'KB-33', tickets: 9 },
      { fix: 'Reset device binding', kb: 'KB-08', tickets: 4 },
    ], { issue: 'I-77' }),
    q_3: q(`MATCH (t:Ticket)-[:ABOUT]->(:Issue {id: $issue})
WHERE t.created_at <= $as_of AND t.created_at > $as_of - 7 * 86400000
RETURN count(t) AS similar`, ['similar'], [{ similar: 41 }], { issue: 'I-77' }),
  },
  path: {
    query_id: 'q_1',
    nodes: [
      { id: 't', label: 'Ticket', name: 'T-1042' },
      { id: 'i', label: 'Issue', name: 'OTP not delivered' },
      { id: 'rel', label: 'Release', name: 'App 2.4' },
      { id: 'a', label: 'ProductArea', name: 'Login and 2FA' },
      { id: 'team', label: 'Team', name: 'Identity' },
    ],
    edges: [
      { type: 'ABOUT', from: 't', to: 'i' },
      { type: 'INTRODUCED', from: 'rel', to: 'i' },
      { type: 'IN', from: 'i', to: 'a' },
      { type: 'OWNED_BY', from: 'a', to: 'team' },
    ],
  },
  blocks: [
    { type: 'kpi', query_id: 'q_3', label: 'Similar tickets this week', column: 'similar' },
    { type: 'table', query_id: 'q_2', label: 'What fixed similar tickets', columns: ['fix', 'kb', 'tickets'] },
  ],
};

// ---------- Tickets (desk) ----------

export type ThreadMessage = {
  kind: 'customer' | 'reply' | 'note' | 'mochi'; author?: string; at: string; day?: string; text: string;
  did?: string[]; p?: number; quoted?: string;
};
export type DeskTicket = {
  id: string; name: string; time: string; subject: string; type?: string; p?: number;
  status: 'todo' | 'done' | 'left'; unread?: boolean; reading?: boolean; waitingFor?: string;
  customer: { name: string; clientId: string; status: string[] };
  noticed?: string; history: { id: string; on: string; subject: string; end: string }[]; continues?: string;
  thread: ThreadMessage[]; briefing?: ToolCard;
};

export const tickets: DeskTicket[] = [
  {
    id: 'T-1042', name: 'Priya Raman', time: '09:42', subject: 'OTP never arrives since the app update',
    type: 'Login and 2FA', p: 0.86, status: 'todo', unread: true, waitingFor: '3 h',
    customer: { name: 'Priya Raman', clientId: 'EC-204817', status: ['Active', 'F&O enabled'] },
    noticed: 'Priya wrote about this on 2 Oct too. That ticket was closed after **a template reply**.',
    continues: 'T-0988',
    history: [
      { id: 'T-0988', on: '2 Oct', subject: 'OTP late during login', end: 'Closed after a template reply' },
      { id: 'T-0611', on: '14 Aug', subject: 'Change registered mobile number', end: 'Resolved after a reply' },
    ],
    thread: [
      { kind: 'customer', author: 'Priya Raman', day: 'Today', at: '09:42',
        text: 'I updated the app yesterday. Since then the login OTP never arrives. I tried three times this morning and missed the market open.',
        quoted: 'On 2 Oct, E Corp Support wrote:\n> Please wait a few minutes and request a new OTP.' },
      { kind: 'mochi', at: '09:43', text: 'I read this ticket. It matches the OTP cluster that began with app 2.4.',
        did: ['Matched it to the OTP cluster', 'Found the earlier ticket from 2 Oct', 'Found what fixed similar tickets'], p: 0.86 },
      { kind: 'note', author: 'Arjun Mehta', at: '10:05', text: 'Identity team knows. Voice OTP works as a fallback.' },
    ],
    briefing: briefingCard,
  },
  {
    id: 'T-1041', name: 'Kabir Shah', time: '09:30', subject: 'Payin from yesterday still not in my ledger',
    type: 'Funds and payin', p: 0.58, status: 'todo', unread: true, waitingFor: '4 h',
    customer: { name: 'Kabir Shah', clientId: 'EC-118340', status: ['Active'] },
    history: [{ id: 'T-0950', on: '29 Sep', subject: 'Payin delayed', end: 'Resolved after a reply' }],
    thread: [
      { kind: 'customer', author: 'Kabir Shah', day: 'Today', at: '09:30',
        text: 'I added funds yesterday evening through UPI. The money left my bank but the ledger still shows the old balance.' },
      { kind: 'reply', author: 'Leela Nair', at: '09:51', text: 'Thanks, Kabir. I am checking this with the payments team now.' },
    ],
  },
  {
    id: 'T-1039', name: 'Meera Iyer', time: '08:58', subject: 'Contract note for Friday is missing',
    status: 'todo', reading: true,
    customer: { name: 'Meera Iyer', clientId: 'EC-330912', status: ['Active', 'Dormant soon'] },
    history: [],
    thread: [{ kind: 'customer', author: 'Meera Iyer', day: 'Today', at: '08:58', text: 'I did not get the contract note for my trades on Friday.' }],
  },
  {
    id: 'T-1033', name: 'Rohan Das', time: 'Yesterday', subject: 'Margin alert says I am short, I am not',
    type: 'Margin and risk', p: 0.31, status: 'left',
    customer: { name: 'Rohan Das', clientId: 'EC-097215', status: ['Active'] },
    history: [],
    thread: [{ kind: 'customer', author: 'Rohan Das', day: 'Yesterday', at: '17:12', text: 'The app says I am short on margin, but my holdings cover it. Please check.' }],
  },
  {
    id: 'T-1028', name: 'Leela Nair', time: 'Yesterday', subject: 'How do I download my tax P&L?',
    type: 'Reports', p: 0.92, status: 'done',
    customer: { name: 'Leela Nair', clientId: 'EC-412200', status: ['Active'] },
    history: [],
    thread: [
      { kind: 'customer', author: 'Leela Nair', day: 'Yesterday', at: '15:02', text: 'Where can I download my tax P&L for last year?' },
      { kind: 'reply', author: 'Arjun Mehta', at: '15:20', text: 'It is under Reports, then Tax P&L. Pick the year and download.' },
    ],
  },
];

// ---------- Chat transcript ----------

const chatStoryQueries: Story['queries'] = { q_1: reportQueries.q_2 };
export const chatStory: Story = {
  id: 'cH4tStoryAnsw3r01', version: 1, title: 'Clusters this week', generated_at: DREAM_AT,
  generated_by: 'user:demo', topic: 'clusters', queries: chatStoryQueries,
  body: `Four clusters hold most of this week's tickets.

| Cluster | Tickets | Trend |
|---|---|---|
| OTP not delivered | <num query_id="q_1" column="tickets">41</num> | up |
| Payin not credited | <num query_id="q_1" column="tickets">23</num> | flat |
| Contract note missing | <num query_id="q_1" column="tickets">12</num> | down |

<bars query_id="q_1" label="Clusters this week" x="cluster" y="tickets" trend="trend" hot="hot"/>

<heatmap query_id="q_1"/>`,
};

const sandboxQueries: Record<string, StoredQuery> = { q_1: reportQueries.q_6 };
export const sandboxPass: SandboxHtml = {
  css: `.wrap { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.tile { border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-4); background: var(--bg-surface); }
.lbl { color: var(--ink-muted); font-size: 12px; }
.big { font-family: var(--font-mono); font-size: 26px; color: var(--ink); }
.bad { color: var(--critical); }
p { color: var(--ink-body); font-size: 14px; }`,
  html: `<div class="wrap">
  <div class="tile"><div class="lbl">What the article promises</div><div class="big"><span data-q="q_1" data-col="promised_h"></span> h</div></div>
  <div class="tile"><div class="lbl">What resolved tickets show</div><div class="big bad"><span data-q="q_1" data-col="measured_h"></span> h</div></div>
</div>
<p>Measured across <span data-q="q_1" data-col="tickets"></span> resolved payin tickets.</p>`,
};
export const sandboxReject: SandboxHtml = {
  css: '.big { color: #ff0000; }',
  html: '<div class="big">Payins are slow</div>',
};
export const sandboxQueriesFixture = sandboxQueries;

const likelyCause: ToolCard = { ...briefingCard, kind: 'likely_cause', title: 'Why OTP tickets are up', blocks: [briefingCard.blocks[0]] };

export type ChatItem =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text?: string; cards?: ToolCard[]; story?: Story; html?: { value: SandboxHtml; queries: Record<string, StoredQuery> } };

export const chatTranscript: ChatItem[] = [
  { role: 'user', text: 'Why are OTP tickets up this week?' },
  { role: 'assistant', cards: [likelyCause], text: 'The OTP issue was introduced by app release 2.4. The Identity team owns it. The path I walked is on the card.' },
  { role: 'user', text: 'Show me the clusters as a table.' },
  { role: 'assistant', story: chatStory },
  { role: 'user', text: 'Put the payin promise next to what we measured.' },
  { role: 'assistant', text: 'No block fits this side-by-side, so I laid it out myself. Every figure comes from the stored query.', html: { value: sandboxPass, queries: sandboxQueries } },
];
