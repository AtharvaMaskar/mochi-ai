// Graph contract (SPEC §1). Every label, edge type, graph name and temporal rule used by the
// loader, dream, agent queries, bench and README comes from here. Never hand-format these.

export const GRAPH = {
  company: 'mochi_company',
  companyPrev: 'mochi_company_prev', // GRAPH.COPY snapshot taken before each dream
  scratch: 'algo_scratch', // live-edge projection for algorithms (they ignore edge properties)
  team: (slug: string) => `team_${safe(slug)}`,
  user: (agentId: string) => `user_${safe(agentId)}`,
  cust: (customerId: string) => `cust_${safe(customerId)}`,
} as const;

function safe(s: string): string {
  const v = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!v) throw new Error(`empty graph-name part: ${JSON.stringify(s)}`);
  return v;
}

export const L = {
  Customer: 'Customer', Ticket: 'Ticket', Issue: 'Issue', ProductArea: 'ProductArea', Team: 'Team',
  AgentUser: 'AgentUser', Resolution: 'Resolution', KBArticle: 'KBArticle', Release: 'Release', Plan: 'Plan',
  Policy: 'Policy', ObservedPattern: 'ObservedPattern', Suggestion: 'Suggestion',
  DoctrineCandidate: 'DoctrineCandidate', Cluster: 'Cluster',
} as const;
export type Label = keyof typeof L;

type EdgeDef = { from: readonly Label[]; to: readonly Label[] };
const e = (from: Label | Label[], to: Label | Label[]): EdgeDef => ({ from: [from].flat(), to: [to].flat() });

export const E = {
  RAISED: e('Customer', 'Ticket'),
  ON_PLAN: e('Customer', 'Plan'),
  ABOUT: e('Ticket', 'Issue'),
  IN: e(['Issue', 'DoctrineCandidate', 'Policy'], 'ProductArea'),
  OWNED_BY: e('ProductArea', 'Team'),
  SOLVED: e('AgentUser', 'Ticket'),
  MEMBER_OF: e('AgentUser', 'Team'),
  RESOLVED_BY: e('Ticket', 'Resolution'),
  BASED_ON: e('Resolution', 'KBArticle'),
  INTRODUCED: e('Release', 'Issue'),
  FOLLOWS: e('Ticket', 'Ticket'),
  CONTRADICTS: e('ObservedPattern', ['KBArticle', 'Policy']),
  UNDOCUMENTED: e('ObservedPattern', 'ProductArea'),
  SEEN_IN: e('ObservedPattern', 'Ticket'),
  FROM: e('Suggestion', 'ObservedPattern'),
  FOR: e('Suggestion', 'Team'),
  FEEDBACK: e('AgentUser', 'Suggestion'),
  IN_CLUSTER: e('Ticket', 'Cluster'),
} as const satisfies Record<string, EdgeDef>;
export type EdgeType = keyof typeof E;

// Mutable facts. Each carries valid_from / valid_until (epoch ms); retire = SET valid_until + CREATE new.
export const TEMPORAL_EDGES = ['ON_PLAN', 'INTRODUCED', 'CONTRADICTS', 'UNDOCUMENTED', 'IN_CLUSTER'] as const satisfies readonly EdgeType[];

// FalkorDB cannot store null, so a live fact ends at 9999-12-31 (docs/falkordb.md gotcha 1).
export const VALID_FOREVER = 253402300799000;
export const untilOrForever = (v: number | null) => v ?? VALID_FOREVER;

// One filter for live and as-of reads; live passes $as_of = now. Every temporal read uses these.
export const EDGE_AS_OF = (alias: string) => `${alias}.valid_from <= $as_of AND ${alias}.valid_until > $as_of`;
export const NODE_AS_OF = (alias: string) => `${alias}.created_at <= $as_of`;

export const TEMPORAL_INDEXES = TEMPORAL_EDGES.map((t) => `CREATE INDEX FOR ()-[r:${t}]-() ON (r.valid_until)`);

export const SOURCE = ['seed', 'dream', 'teach', 'session'] as const;
export type Source = (typeof SOURCE)[number];

// Property names that other modules key on. Every node also carries `source` and `created_at`.
export const P = {
  id: 'id', name: 'name', version: 'version', createdAt: 'created_at', source: 'source',
  sourceTicket: 'source_ticket', sourceTicketIds: 'source_ticket_ids', sourceSession: 'source_session', taughtBy: 'taught_by',
  validFrom: 'valid_from', validUntil: 'valid_until', embedding: 'embedding',
  promisedTat: 'promised_tat_hours', steps: 'steps', measuredTat: 'measured_tat_hours',
  supportCount: 'support_count', lastSeen: 'last_seen', summary: 'summary', delta: 'delta',
  ingestedAt: 'ingested_at', text: 'text', evidenceTicketIds: 'evidence_ticket_ids', confidence: 'confidence', expiresAt: 'expires_at', status: 'status',
} as const;
// Mismatch engine (SPEC §1): gen plants above these, dream checks against them.
export const MISMATCH = { MIN_SUPPORT: 5, TAT_TOLERANCE: 0.25 } as const;

export const SUGGESTION_STATUS = ['open', 'right', 'wrong', 'expired'] as const;

// Database-enforced tiers (SPEC §1). Rule strings must match docker-compose.yml (acl.test.ts checks).
export const ACL = {
  reader: { user: 'mochi_reader', passwordEnv: 'MOCHI_READER_PASSWORD',
    rules: 'resetkeys ~mochi_company ~team_* resetchannels -@all +GRAPH.RO_QUERY +GRAPH.EXPLAIN +GRAPH.LIST +PING +INFO +CLIENT|SETINFO' },
  dream: { user: 'mochi_dream', passwordEnv: 'MOCHI_DREAM_PASSWORD',
    rules: 'resetkeys ~mochi_company ~mochi_company_prev ~algo_scratch ~team_* resetchannels -@all +GRAPH.QUERY +GRAPH.RO_QUERY +GRAPH.EXPLAIN +GRAPH.COPY +GRAPH.DELETE +GRAPH.CONSTRAINT +GRAPH.LIST +PING +INFO +CLIENT|SETINFO' },
  demoUser: { user: 'user_demo', passwordEnv: 'MOCHI_DEMO_USER_PASSWORD',
    rules: 'resetkeys ~mochi_company resetchannels -@all +GRAPH.RO_QUERY +GRAPH.LIST +PING +INFO +CLIENT|SETINFO (~user_demo ~cust_* ~team_* +GRAPH.QUERY +GRAPH.RO_QUERY)' },
} as const;

// Reports labels / rel types in a Cypher string that are not in the contract.
export function checkCypherNames(cypher: string): string[] {
  const src = cypher.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''").replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = new Set<string>();
  for (const m of src.matchAll(/\(\s*\w*((?:\s*:\s*\w+)+)/g))
    for (const l of m[1].split(':').map((s) => s.trim()).filter(Boolean)) if (!(l in L)) bad.add(`label ${l}`);
  for (const m of src.matchAll(/\[\s*\w*\s*:\s*([\w|:\s]+?)\s*(?:[*{\]])/g))
    for (const t of m[1].split(/[|:]/).map((s) => s.trim()).filter(Boolean)) if (!(t in E)) bad.add(`edge ${t}`);
  return [...bad];
}
