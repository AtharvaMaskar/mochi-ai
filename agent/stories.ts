// Story service (SPEC §4 shareable stories): versioned commits that must pass parseStory, and as-of re-render that
// replays every stored query read-only with $as_of. No per-query code: the contract puts $as_of in every stored query.
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import type { JsonObject, Tx } from '@earendil-works/pi-durable';
import { newStoryId, parseStory, type Story } from '@mochi/contracts';
import { runStored, type Db } from './queries/index.ts';
import { StoryDoc } from './story-doc.ts';

type Committer = { commit<T>(change: (tx: Tx) => T | Promise<T>, context: typeof ctx): Promise<T> };
type Reader = { snapshot(token: typeof StoryDoc, context: typeof ctx): Promise<Readonly<{ stories: Record<string, JsonObject[]> }> | undefined> };

export type Draft = Omit<Story, 'id' | 'version'> & { id?: string };

/** Append a version inside an open Pi transaction (the one StoryDoc writer). Nothing is stored unless parseStory passes. */
export async function appendStory(tx: Pick<Tx, 'doc'>, draft: Draft): Promise<{ ok: true; story: Story } | { ok: false; errors: string[] }> {
  const id = draft.id ?? newStoryId();
  const doc = await tx.doc(StoryDoc);
  const versions = doc.stories[id] ?? [];
  const parsed = parseStory({ ...draft, id, version: versions.length + 1 } as Story);
  if (!parsed.ok) return parsed;
  doc.stories[id] = [...versions, structuredClone(parsed.story) as JsonObject];
  return { ok: true as const, story: parsed.story };
}

/** Commit a new version (or a new story when `id` is absent). */
export function commitStory(on: Committer, draft: Draft) {
  return on.commit((tx) => appendStory(tx, draft), ctx);
}

/** Version `n` (1-based), or the latest. */
export async function getStory(on: Reader, id: string, n?: number): Promise<Story | undefined> {
  const versions = (await on.snapshot(StoryDoc, ctx))?.stories[id];
  if (!versions?.length) return undefined;
  return (n === undefined ? versions.at(-1) : versions[n - 1]) as Story | undefined;
}

/** The newest morning report the dream committed (for section("morning_report")). */
export async function latestDreamStory(on: Reader): Promise<Story | undefined> {
  const all = Object.values((await on.snapshot(StoryDoc, ctx))?.stories ?? {}).map((v) => v.at(-1) as Story).filter((s) => s.generated_by === 'dream');
  return all.sort((a, b) => b.generated_at - a.generated_at)[0];
}

/** Re-run every stored query read-only at `as_of`; prose stays, rows refresh. */
export async function rerender(db: Db, story: Story, as_of: number): Promise<{ story: Story; as_of: number }> {
  const queries = Object.fromEntries(await Promise.all(Object.entries(story.queries).map(async ([qid, q]) => {
    // A scratch-projection receipt (graph_algorithm on temporal edges) is a snapshot: the reader cannot rebuild it.
    if (q.graph.endsWith('scratch')) return [qid, q] as const;
    const { as_of: _drop, ...params } = q.params;
    return [qid, await runStored(db, q.graph, q.cypher, params, as_of)] as const;
  })));
  return { story: { ...story, queries }, as_of };
}

/** `/api/stories/<id>[@n]` path part -> id and optional version. */
export function parseStoryRef(ref: string): { id: string; version?: number } | null {
  const m = ref.match(/^([A-Za-z0-9_-]{16,})(?:@(\d+))?$/);
  return m ? { id: m[1], version: m[2] ? Number(m[2]) : undefined } : null;
}
