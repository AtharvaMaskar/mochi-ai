// Story service (SPEC §4 shareable stories): versioned commits that must pass parseStory, and as-of re-render that
// replays every stored query read-only with $as_of. No per-query code: the contract puts $as_of in every stored query.
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import type { JsonObject, Tx } from '@earendil-works/pi-durable';
import { newStoryId, parseStory, type Story } from '@mochi/contracts';
import { runStored, type Db } from './queries/index.ts';
import { StoryDoc } from './story-doc.ts';

type Committer = { commit<T>(change: (tx: Tx) => T | Promise<T>, context: typeof ctx): Promise<T> };
type DocValue = { stories: Record<string, JsonObject[]>; meta?: Record<string, JsonObject> };
type Reader = { snapshot(token: typeof StoryDoc, context: typeof ctx): Promise<Readonly<DocValue> | undefined> };

export type Draft = Omit<Story, 'id' | 'version'> & { id?: string };
export type Kind = 'story' | 'dashboard';
/** Publishing state. `published` lists every version the owner published; the last one is what strangers read. */
export type Meta = { kind: Kind; status: 'draft' | 'published'; owner: string; published: number[] };
export const STORY_ACTIVITY = 'mochi.story';

/** Append a version inside an open Pi transaction (the one StoryDoc writer). Nothing is stored unless parseStory passes. */
export async function appendStory(tx: Pick<Tx, 'doc'>, draft: Draft, meta?: Meta): Promise<{ ok: true; story: Story } | { ok: false; errors: string[] }> {
  const id = draft.id ?? newStoryId();
  const doc = await tx.doc(StoryDoc);
  const versions = doc.stories[id] ?? [];
  const parsed = parseStory({ ...draft, id, version: versions.length + 1 } as Story);
  if (!parsed.ok) return parsed;
  doc.stories[id] = [...versions, structuredClone(parsed.story) as JsonObject];
  if (meta && !versions.length) { if (!doc.meta) doc.meta = {}; doc.meta[id] = meta as unknown as JsonObject; }
  return { ok: true as const, story: parsed.story };
}

/** Commit a new version (or a new story when `id` is absent). */
export function commitStory(on: Committer, draft: Draft, meta?: Meta) {
  return on.commit((tx) => appendStory(tx, draft, meta), ctx);
}

/** The version `vid` may read (`n`, or their default), or null. Owners and meta-less stories read every version;
 *  anyone else reads published versions only, and nothing while the story is a draft. */
export function visible(doc: Readonly<DocValue> | null | undefined, id: string, vid: string | null, n?: number) {
  const versions = doc?.stories[id];
  if (!versions?.length) return null;
  const m = doc!.meta?.[id] as unknown as Meta | undefined;
  const owner = !!m && !!vid && m.owner === vid;
  const open = !m || owner;
  const list = open ? versions.map((_, i) => i + 1) : m!.status === 'published' ? m!.published : [];
  const v = n ?? list.at(-1);
  if (!v || !list.includes(v) || !versions[v - 1]) return null;
  return { story: versions[v - 1] as unknown as Story, meta: { kind: m?.kind ?? 'story', status: m?.status ?? 'published', published: m?.published ?? [], versions: list, owner } };
}
export type Visible = NonNullable<ReturnType<typeof visible>>;

export async function readStory(on: Reader, id: string, vid: string | null, n?: number) {
  return visible(await on.snapshot(StoryDoc, ctx), id, vid, n);
}

/** Publish (the latest version) or unpublish; owner only. Returns the new meta, or null when `vid` doesn't own `id`. */
export function setStoryStatus(on: Committer, id: string, vid: string | null, status: Meta['status']) {
  return on.commit(async (tx) => {
    const doc = await tx.doc(StoryDoc);
    const m = doc.meta?.[id] as unknown as Meta | undefined;
    if (!m || !vid || m.owner !== vid) return null;
    const latest = doc.stories[id]?.length ?? 0;
    if (status === 'published' && m.published.at(-1) !== latest) m.published = [...m.published, latest];
    m.status = status;
    return JSON.parse(JSON.stringify(m)) as Meta; // a doc proxy can't leave the commit
  }, ctx);
}

/** Apply search/replace edits to a body. Each old_str must occur exactly once in the body as it stands at that edit. */
export function applyEdits(body: string, edits: { old_str: string; new_str: string }[]): { ok: true; body: string } | { ok: false; error: string } {
  for (const [i, e] of edits.entries()) {
    if (!e.old_str) return { ok: false, error: `edit ${i + 1}: old_str is empty` };
    const n = body.split(e.old_str).length - 1;
    if (n === 0) return { ok: false, error: `edit ${i + 1}: old_str not found. Copy it exactly from the current body (below).` };
    if (n > 1) return { ok: false, error: `edit ${i + 1}: old_str occurs ${n} times. Add surrounding text so it matches once.` };
    body = body.replace(e.old_str, () => e.new_str);
  }
  return { ok: true, body };
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
