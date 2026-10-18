// trace_story: "how was this report produced?", answered from the Pi Durable journal graph (MOCHI_STORAGE=falkordb,
// agent/storage/falkordb.ts). Walks story → the build/edit_story tool result that returned its id → the tool task →
// the assistant entry that called it, then the earlier tool calls of that conversation whose results registered the
// stored queries (q_<n>) the story cites. Runs read-only as mochi_reader, which may read ~mochi_journal.
import { Type } from '@earendil-works/pi-ai';
import { JOURNAL_GRAPH, type StoredQuery, type ToolCard } from '@mochi/contracts';
import { runStored, type Db, type Result } from './index.ts';
import type { ReadToolSpec } from './tools.ts';

export const TRACE_CYPHER = {
  story: `/* mochi:trace_story.story@v1 */
MATCH (res:Entry {ref: $id})-[:BY_TASK]->(tool:Task)<-[:CALLS]-(call:Entry)-[:IN]->(c:Conversation)
WHERE res.kind = 'pi.tool-result' AND res.at <= $as_of
OPTIONAL MATCH (res)-[:WROTE]->(rev:Revision)-[:OF]->(:Document {kind: 'mochi.story'}) WHERE rev.body CONTAINS $id
RETURN res.tool AS tool, c.id AS conversation, call.id AS call_entry, tool.id AS task, res.id AS result_entry,
  rev.seq AS revision_seq, res.at AS at
ORDER BY at, result_entry`,
  body: `/* mochi:trace_story.body@v1 */
MATCH (r:Revision)-[:OF]->(:Document {kind: 'mochi.story'}) WHERE r.seq IN $seqs AND r.at <= $as_of RETURN r.body AS body`,
  sources: `/* mochi:trace_story.sources@v1 */
MATCH (c:Conversation {id: $conversation})<-[:IN]-(res:Entry)-[:WROTE]->(rev:Revision)-[:OF]->(:Document {kind: 'mochi.queries'})
WHERE res.kind = 'pi.tool-result' AND res.at <= $as_of
MATCH (res)-[:BY_TASK]->(tool:Task)<-[:CALLS]-(call:Entry)
WITH res, tool, call, rev, [q IN $qids WHERE rev.body CONTAINS ('"' + q + '"')] AS queries
WHERE size(queries) > 0
RETURN res.tool AS tool, call.id AS call_entry, tool.id AS task, res.id AS result_entry, rev.seq AS revision_seq, queries
ORDER BY revision_seq, result_entry`,
} as const;

const cited = (body: unknown) => [...new Set([...String(body ?? '').matchAll(/"(q_\d+)":\{"cypher"/g)].map((m) => m[1]))];

export async function traceStory(db: Db, args: { id: string }, as_of: number, graph = JOURNAL_GRAPH): Promise<Result> {
  const run = (cypher: string, params: Record<string, unknown>) =>
    runStored(db, graph, cypher, params, as_of).catch((): StoredQuery => // no journal graph yet (MOCHI_STORAGE=sqlite)
      ({ cypher, graph, params, columns: [], rows: [], ran_at: Date.now() }));
  const story = await run(TRACE_CYPHER.story, { id: args.id });
  const made = story.rows[0];
  const bodies = await run(TRACE_CYPHER.body, { seqs: story.rows.map((r) => r.revision_seq).filter((s) => s !== null) });
  const qids = [...new Set(bodies.rows.flatMap((r) => cited(r.body)))].sort();
  const sources = await run(TRACE_CYPHER.sources, { conversation: made?.conversation ?? -1, qids });
  const tools = [...new Set(sources.rows.map((r) => String(r.tool)))];
  const card: ToolCard = {
    kind: 'briefing',
    title: made
      ? `Story ${args.id}: ${String(made.tool)} (entry ${String(made.call_entry)} → task ${String(made.task)}) from ${qids.length} stored ${qids.length === 1 ? 'query' : 'queries'} of ${tools.join(', ') || 'no traced tool'}`
      : `No journal trace for story ${args.id} (journal needs MOCHI_STORAGE=falkordb)`,
    queries: { q_1: story, q_2: sources },
    path: null, // journal labels are not company labels; the tables below are the path
    blocks: made ? [ // no trace (or no journal graph): the title says so, and there are no rows to tabulate
      { type: 'table', query_id: 'q_1', label: 'Who wrote the story', columns: ['tool', 'call_entry', 'task', 'result_entry', 'revision_seq'] },
      { type: 'table', query_id: 'q_2', label: 'Where its stored queries came from', columns: ['tool', 'call_entry', 'task', 'result_entry', 'queries'] },
    ] : [],
  };
  return { card, queries: card.queries };
}

/** Not in READ_TOOL_SPECS: bench arms share that list, and the journal is not company memory. */
export const TRACE_TOOL: ReadToolSpec = {
  name: 'trace_story',
  description: 'How a story or dashboard was produced, from the execution journal: the build_story/edit_story call that wrote it, and the earlier tool calls whose stored queries it cites, with entry and task ids.',
  parameters: Type.Object({ id: Type.String() }),
  run: (db, a, t) => traceStory(db, a, t),
};
