// Rewrites the generated README sections from code, so the README never drifts from what runs.
//   node scripts/readme-cypher.ts          rewrite README.md
//   node scripts/readme-cypher.ts --check  exit 1 if README.md differs from the code
// Sections: `cypher` (agent queries + dream queries, verbatim) and `ledger` (bench/results.json, or pending).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { validateResults } from '@mochi/contracts';
import { allCypher } from '../agent/queries/index.ts';
import { Q, R } from '../agent/dream/cypher.ts';

const README = new URL('../README.md', import.meta.url);
const RESULTS = new URL('../bench/results.json', import.meta.url);

// One-line purpose per query, shown in the collapsed summary. A query missing here renders with its name only.
const PURPOSE: Record<string, string> = {
  'briefing.profile': 'ticket → customer → live plan → issue', 'briefing.recent': "the customer's last three other tickets",
  'briefing.similar': 'ticket → issue ← solved tickets → resolution → KB path', 'briefing.similarVector': 'vector neighbours → resolution → KB (fallback path)',
  'briefing.suggestions': 'open doctrine-vs-practice suggestions for the owning team', likelyCause: 'ticket → issue ← release that introduced it (live edge)',
  whoKnows: 'agents who solved this issue, with their team', whoKnowsIssues: 'issue list for who-knows lookups',
  emergingClusters: 'live clusters ranked by growth in a window', 'blastRadius.segments': 'release → issues → tickets → customers, by segment',
  'blastRadius.totals': 'customers, tickets and open tickets hit by a release', 'blastRadius.affected': 'the affected tickets and customers',
  'blastRadius.owner': 'release → issue → product area → owning team', searchSimilar: 'free-text vector search over tickets',
  'customerProfile.profile': 'customer and live plan', 'customerProfile.history': 'closed tickets and how each ended',
  'customerProfile.open': 'open tickets', 'customerProfile.merged': 'duplicates merged into a primary ticket',
  'entity.customerActivity': 'open tickets and last contact', 'entity.ticket': 'one ticket with customer and resolution',
  'entity.kb': 'KB article with owning team and promise', 'entity.search': 'search box: tickets, customers, issues',
  deskGuess: "queue guess: each ticket's issue and best-supported fix", deskCounts: 'desk header counts: ingested, pending, clusters, retired, mismatches',
  pendingTickets: 'tickets the dream has not ingested yet', areas: 'product areas for extraction', issues: 'known issues for extraction',
  ingestBatch: 'MERGE extracted issues and resolutions, mark tickets ingested', knn: 'six nearest tickets by vector index',
  ticketIds: 'tickets to embed and link', liveSimilar: 'current SIMILAR_TO edges', retireSimilar: 'close SIMILAR_TO edges that dropped out',
  createSimilar: 'create new temporal SIMILAR_TO edges', windowPairs: "last 7 days' ticket → issue pairs for clustering",
  projectPairs: 'project those pairs into algo_scratch', labelPropagation: 'label propagation on the projection',
  retireClusterEdges: 'close IN_CLUSTER edges for tickets that moved', createClusterEdges: 'create new IN_CLUSTER edges',
  kbResolved: 'measured resolution times per KB article', policyResolved: 'measured resolution times per policy',
  workarounds: 'workarounds used with no KB article', writePatterns: 'write ObservedPattern nodes with SEEN_IN evidence',
  retireMismatches: "close last run's mismatch edges", contradictsKB: 'pattern CONTRADICTS a KB article',
  contradictsPolicy: 'pattern CONTRADICTS a policy', undocumented: 'pattern UNDOCUMENTED in a product area',
  feedback: 'right/wrong feedback on suggestions', suggestions: 'all suggestions, for expiry and status',
  openSuggestions: 'open suggestions for a quiet-night report', setSuggestionStatus: 'apply feedback and expiry',
  owner: 'owning team of a product area', createSuggestions: 'suggestion FROM pattern, FOR owning team',
  candidates: 'unreviewed doctrine candidates taught in chat', commitPolicies: 'commit reviewed teachings as Policy',
  markReviewed: 'mark candidates reviewed', counts: 'node and edge totals for the report',
  memdiff: 'facts retired and added in the last day', clusters: 'clusters with day-over-day trend',
  ingested: 'tickets ingested in the last day', suggestion: 'one suggestion with its evidence edge and team',
};
const block = (name: string, cypher: string) =>
  `<details><summary><b>${name}</b>${PURPOSE[name] ? ` · ${PURPOSE[name]}` : ''}</summary>\n\n\`\`\`cypher\n${cypher}\n\`\`\`\n\n</details>`;
const group = (title: string, note: string, src: string, rows: [string, string][]) =>
  [`### ${title}\n\n${note} Source: \`${src}\`.`, rows.map(([n, c]) => block(n, c)).join('\n')].join('\n\n');

function cypherSection(): string {
  return [
    group('Agent queries', 'All read-only, run as `mochi_reader` through `GRAPH.RO_QUERY`, and every one filters on `$as_of`.', 'agent/queries/index.ts', allCypher()),
    group('Dream queries', 'The dream, as `mochi_dream`, is the only writer of `mochi_company`; changed facts are retired with `valid_until`, never deleted.', 'agent/dream/cypher.ts', Object.entries(Q)),
    group('Morning report queries', 'Stored with the report and re-run read-only at `$as_of` on refresh.', 'agent/dream/cypher.ts', Object.entries(R)),
  ].join('\n\n');
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function ledgerSection(): string {
  if (!existsSync(RESULTS)) return '_Feature Ledger: pending benchmark run. `bench/results.json` does not exist yet, so no figures are shown._';
  const r = validateResults(JSON.parse(readFileSync(RESULTS, 'utf8')));
  if (!r.ok) throw new Error(`bench/results.json is invalid: ${r.errors.slice(0, 3).join('; ')}`);
  const rows = r.value.ledger.map((l) => `| ${[l.feature, l.mechanism, l.measured_against, l.result, l.status.replace('_', ' ')].map(cell).join(' | ')} |`);
  return [`Source: \`bench/results.json\`, run at ${new Date(r.value.run_at).toISOString()}, seed ${r.value.seed}.`, '',
    '| feature | graph mechanism | measured against | result | status |', '|---|---|---|---|---|', ...rows].join('\n');
}

function replace(text: string, name: string, body: string): string {
  const start = `<!-- ${name}:start (generated by scripts/readme-cypher.ts, do not edit) -->`, end = `<!-- ${name}:end -->`;
  const i = text.indexOf(start), j = text.indexOf(end);
  if (i < 0 || j < i) throw new Error(`README.md: missing markers for "${name}"`);
  return `${text.slice(0, i + start.length)}\n${body}\n${text.slice(j)}`;
}

const old = readFileSync(README, 'utf8');
const sections = { cypher: cypherSection(), ledger: ledgerSection() };
let next = old;
for (const [name, body] of Object.entries(sections)) next = replace(next, name, body);

if (process.argv.includes('--check')) {
  const drift = Object.entries(sections).filter(([n, b]) => replace(old, n, b) !== old).map(([n]) => n);
  if (drift.length) {
    console.error(`README.md drifted from code in: ${drift.join(', ')}. Run: node scripts/readme-cypher.ts`);
    process.exit(1);
  }
  console.log('README.md matches the code.');
} else if (next !== old) {
  writeFileSync(README, next);
  console.log('README.md rewritten.');
} else console.log('README.md already up to date.');
