// Step 8 · the morning report: a templated story whose every number is a stored $as_of query.
// The model wrote only the suggestion prose; digits in it are wrapped only when the stored row holds them.
import { newStoryId, parseStory, type Story, type StoredQuery } from '@mochi/contracts';
import { num, suggestionBlock } from '../suggestion-block.ts';
import { R } from './cypher.ts';
import type { SuggestionOut } from './rules.ts';
import type { Db } from './types.ts';

// The client drops result headers, so each query names its columns (they match its RETURN).
const COLUMNS: Record<string, string[]> = {
  [R.ingested]: ['ingested'], [R.memdiff]: ['change', 'fact'], [R.clusters]: ['cluster', 'tickets', 'trend'],
  [R.suggestion]: ['id', 'edge', 'target', 'team', 'support', 'confidence', 'measured', 'promised', 'delta', 'status'],
};

async function stored(db: Db, graph: string, cypher: string, params: Record<string, unknown>, ran_at: number): Promise<StoredQuery> {
  const res = await db.selectGraph(graph).roQuery<Record<string, unknown>>(cypher, { params: params as any });
  return { cypher, graph, params, columns: COLUMNS[cypher], rows: res.data ?? [], ran_at };
}

export async function buildReport(db: Db, graph: string, as_of: number, suggestions: SuggestionOut[]): Promise<{ story: Story | null; errors: string[] }> {
  const queries: Record<string, StoredQuery> = {};
  const p = { as_of };
  queries.q_1 = await stored(db, graph, R.ingested, p, as_of);
  queries.q_2 = await stored(db, graph, R.memdiff, p, as_of);
  queries.q_3 = await stored(db, graph, R.clusters, p, as_of);
  const ingested = queries.q_1.rows[0]?.ingested ?? 0;
  const retired = queries.q_2.rows.filter((r) => r.change === 'retired').length;
  const top = queries.q_3.rows[0];

  const body: string[] = [
    `The dream read ${num('q_1', 'ingested', ingested)} new tickets and changed what the brain believes.`,
    '', '<kpi query_id="q_1" label="Tickets ingested" column="ingested"/>', '',
    '## What memory changed', '',
    retired ? 'Facts retired by temporal invalidation, and the facts that replaced them.' : 'No fact was retired in this window.',
    '', '<memdiff query_id="q_2"/>', '',
    '## Emerging clusters', '',
    top ? `The fastest-growing cluster added ${num('q_3', 'trend', top.trend)} tickets since yesterday.` : 'Not enough tickets in the last 7 days to form clusters.',
    '', '<bars query_id="q_3" label="Emerging clusters" x="cluster" y="tickets" trend="trend"/>',
  ];

  if (suggestions.length) body.push('', '## Where doctrine and practice disagree');
  for (const [n, s] of suggestions.slice(0, 3).entries()) {
    const qid = `q_${4 + n}`;
    queries[qid] = await stored(db, graph, R.suggestion, { as_of, id: s.id }, as_of);
    const b = suggestionBlock(qid, { ...queries[qid].rows[0], edge: s.edge, team: queries[qid].rows[0]?.team ?? s.area, text: s.text });
    body.push('', `<suggestion query_id="${qid}" tag="${b.tag}" edge="${b.edge}" actions='${JSON.stringify(b.actions)}'>`, b.text, '</suggestion>');
  }

  const story = {
    id: newStoryId(), version: 1, title: `Morning report, ${new Date(as_of).toISOString().slice(0, 10)}`,
    generated_at: as_of, generated_by: 'dream', topic: 'morning_report', queries, body: body.join('\n'),
  };
  const parsed = parseStory(story);
  return parsed.ok ? { story: parsed.story, errors: [] } : { story: null, errors: parsed.errors };
}

/** ~10 lines for the agent's system prompt, built from the stored rows (never re-asked of a model). */
export function summarize(story: Story): string {
  const q = story.queries;
  const memdiff = q.q_2?.rows ?? [];
  const lines = [
    `${story.title} (story ${story.id})`,
    `Tickets ingested: ${q.q_1?.rows[0]?.ingested ?? 0}`,
    `Facts retired: ${memdiff.filter((r) => r.change === 'retired').length}; added: ${memdiff.filter((r) => r.change === 'added').length}`,
    ...memdiff.filter((r) => r.change === 'retired').slice(0, 3).map((r) => `  retired: ${r.fact}`),
  ];
  const top = q.q_3?.rows[0];
  if (top) lines.push(`Top cluster: ${top.cluster}, ${top.tickets} tickets (+${top.trend} since yesterday)`);
  for (const id of Object.keys(q).filter((k) => Number(k.slice(2)) >= 4)) {
    const r = q[id].rows[0];
    if (r) lines.push(`Suggestion ${r.id}: ${r.edge} ${r.target}, support ${r.support}${r.delta != null ? `, delta ${r.delta}h` : ''} → team ${r.team}`);
  }
  return lines.join('\n');
}
