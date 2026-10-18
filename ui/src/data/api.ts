// The ui's data layer: fetchers for the agent's desk API, a fetch hook with honest error reasons, the live story
// socket, and the shared dream-progress store (Overview's PipelineFlow and the MochiIsland both follow it).
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Story, StoredQuery, ToolCard } from '@mochi/contracts';

export type Guess = { issue: string | null; p: number | null; basis: 'graph' | 'vector' | 'none'; query_id: string | null; resolution?: string | null };
export type DeskRow = {
  id: string; fd_id: number; name: string; created_at: number; subject: string; status: string;
  state: 'todo' | 'done' | 'left'; reading: boolean; guess: Guess; /** Assigned to the desk user. */ mine?: boolean;
};
/** Mochi's model draft: the text, the fix plan (plain checklist), and the KB lookup as receipt q_1. */
export type Draft = { ticket: string; text: string; steps: string[]; kb: string | null; resolution: string | null; queries: Record<string, StoredQuery> };
export type DraftHint = 'rewrite' | 'shorter' | 'warmer';
export type DeskList = { view: string; order: string; sim_now: number; counts: { ready: number; done: number; all: number }; rows: DeskRow[]; queries: Record<string, StoredQuery> };
export type Msg = { kind: 'customer' | 'reply' | 'note'; author: string; at: number; text: string; quoted?: string };
export type TicketDetail = {
  id: string; fd_id: number; subject: string; status: string; state: DeskRow['state']; created_at: number;
  requester: { name: string; email: string | null }; customer_id: string | null; merged_into: string | null; claimed?: boolean;
  in_memory: boolean; ingested: boolean; guess: Guess | null; guess_queries: Record<string, StoredQuery>;
  customer: ToolCard | null; thread: Msg[]; /** Freshdesk channel code: 1 email, 2 portal, 3 phone, 7 chat. */ source?: number;
};
export type StoryRow = { id: string; title: string; version: number; generated_at: number; generated_by: string; topic: string; kind?: Kind; status?: string };
export type Kind = 'story' | 'dashboard';
/** Publishing state from the agent. `versions` are the ones this browser may read; `owner` is true for the author. */
export type StoryMeta = { kind: Kind; status: 'draft' | 'published'; published: number[]; versions: number[]; owner: boolean };
export type StoryRead = { story: Story; as_of: number; meta: StoryMeta };
/** The kind-specific public link (hash route under /app). */
export const storyHref = (id: string, kind: Kind = 'story', version?: number, asOf?: number) =>
  `#/${kind}/${id}${version ? `@${version}` : ''}${asOf !== undefined ? `?asOf=${asOf}` : ''}`;
export const shareUrl = (id: string, kind: Kind) => `${location.origin}/${kind}/${id}`;
export type Overview = {
  desk: { ready: number; done: number } | { error: string };
  queries: Record<string, StoredQuery>;
  dream: { running: boolean; last_run: number | null; next_run: number | null };
  morning_report: StoryRow | null;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try { r = await fetch(path, init); } catch { throw new Error('I can’t reach the Mochi agent. Is `npm run dev` running?'); }
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error ?? (r.status === 502 || r.status === 504 ? 'I can’t reach the Mochi agent. Is `npm run dev` running?' : `The agent answered ${r.status}.`));
  return body as T;
}
const post = (body?: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  tickets: (view: string, order = 'newest') => call<DeskList>(`/api/tickets?view=${view}&order=${order}`),
  ticket: (id: string) => call<TicketDetail>(`/api/tickets/${encodeURIComponent(id)}`),
  brief: (id: string) => call<ToolCard>(`/api/tickets/${encodeURIComponent(id)}/brief`, post()),
  answer: (id: string, requestId: string, text?: string) => call<{ status: string }>(`/api/tickets/${encodeURIComponent(id)}/answer`, post({ requestId, text })),
  draft: (id: string, hint?: DraftHint, previous?: string) => call<Draft>(`/api/tickets/${encodeURIComponent(id)}/draft`, post({ hint, previous })),
  claim: (id: string) => call<{ claimed: boolean }>(`/api/tickets/${encodeURIComponent(id)}/claim`, post()),
  overview: () => call<Overview>('/api/overview'),
  stories: () => call<StoryRow[]>('/api/stories'),
  story: (id: string, version?: number, asOf?: number) =>
    call<StoryRead>(`/api/stories/${id}${version ? `@${version}` : ''}${asOf !== undefined ? `?asOf=${asOf}` : ''}`),
  publish: (id: string, on: boolean) => call<Pick<StoryMeta, 'kind' | 'status' | 'published'>>(`/api/stories/${id}/${on ? 'publish' : 'unpublish'}`, post()),
};

export type Loaded<T> = { data?: T; error?: string; loading: boolean; reload: () => void };
/** Run `f` when `deps` change; keeps the last data while reloading. */
export function useData<T>(f: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [s, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    set((x) => ({ ...x, loading: true }));
    f().then((data) => live && set({ data, loading: false }), (e: Error) => live && set({ error: e.message, loading: false }));
    return () => { live = false; };
  }, [...deps, n]);
  return { ...s, reload: useCallback(() => setN((k) => k + 1), []) };
}

/** A story as this browser may read it, kept live: refetched (queries re-run at now) on every socket push, every 60s
 *  for a dashboard, and on `reload`. `?asOf=` or a pinned version freezes it. */
export function useStory(id: string | undefined, version?: number, asOf?: number) {
  const r = useData(() => (id ? api.story(id, version, asOf) : Promise.resolve(undefined)), [id, version, asOf]);
  const frozen = asOf !== undefined;
  const pushed = useLive(id, !frozen, true);
  const [at, setAt] = useState(0);
  useEffect(() => { if (r.data) setAt(Date.now()); }, [r.data]);
  useEffect(() => { if (pushed && !frozen) r.reload(); }, [pushed]);
  const kind = r.data?.meta.kind;
  useEffect(() => {
    if (kind !== 'dashboard' || frozen) return;
    const t = setInterval(r.reload, 60_000);
    return () => clearInterval(t);
  }, [kind, frozen, id]);
  return { ...r, updatedAt: at };
}

/** The story's latest version over the live socket (null until the first message). Reconnects after a drop.
 *  With `everyMessage`, each message (a new version, a publish, a dream's `refresh`) yields a fresh object. */
export function useLive(storyId: string | undefined, enabled = true, everyMessage = false): Story | null {
  const [story, setStory] = useState<Story | null>(null);
  useEffect(() => {
    if (!storyId || !enabled) return;
    let ws: WebSocket | null = null, stop = false, retry: ReturnType<typeof setTimeout>;
    const open = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/stories/${storyId}/live`);
      ws.onmessage = (m) => {
        const v = JSON.parse(String(m.data));
        if (v.type === 'story') setStory(everyMessage ? { ...v.story } : v.story);
        else if (v.type === 'refresh' && everyMessage) setStory((s) => (s ? { ...s } : ({} as Story)));
      };
      ws.onclose = () => { if (!stop) retry = setTimeout(open, 3000); };
    };
    open();
    return () => { stop = true; clearTimeout(retry); ws?.close(); };
  }, [storyId, enabled]);
  return story;
}

// ---------- Dream progress (one run at a time, shared by Overview and the island) ----------

/** The dream trigger's admin token: dev only (a production build drops this branch), so the deployed site hides the button. */
export const ADMIN_TOKEN: string | undefined = import.meta.env.DEV ? import.meta.env.VITE_MOCHI_ADMIN_TOKEN || undefined : undefined;

export const DREAM_STEPS = ['ingest', 'cluster', 'retire', 'mismatch', 'report'] as const;
export type DreamRun = { running: boolean; at: number; step?: string; failed?: string; done?: { story_id: string | null; ms: number; ingested: number; retired: number }; runs: number };
let dream: DreamRun = { running: false, at: 0, runs: 0 };
const subs = new Set<() => void>();
const setDream = (d: Partial<DreamRun>) => { dream = { ...dream, ...d }; subs.forEach((f) => f()); };
export const useDream = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => dream);

/** POST /api/dream/run as server-sent events; `at` counts finished steps. */
export async function runDream() {
  if (dream.running) return;
  setDream({ running: true, at: 0, step: DREAM_STEPS[0], failed: undefined, done: undefined, runs: dream.runs + 1 });
  try {
    const r = await fetch('/api/dream/run', { method: 'POST', headers: { accept: 'text/event-stream', 'x-mochi-admin': ADMIN_TOKEN ?? '' } });
    if (!r.ok || !r.body) throw new Error((await r.json().catch(() => null))?.error ?? `The agent answered ${r.status}.`);
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const e = JSON.parse(part.replace(/^data: /, ''));
        if (e.done) setDream({ done: e.done });
        else if (e.state === 'running') setDream({ step: e.step });
        else if (e.state === 'done') setDream({ at: DREAM_STEPS.indexOf(e.step) + 1 });
        else if (e.state === 'failed') setDream({ failed: e.error ?? 'The dream failed.' });
      }
    }
  } catch (e) {
    setDream({ failed: e instanceof Error && e.message !== 'Failed to fetch' ? e.message : 'I can’t reach the Mochi agent. Is `npm run dev` running?' });
  } finally {
    setDream({ running: false });
  }
}

export const fmtClock = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
export const fmtDay = (ms: number, now = Date.now()) => {
  const d = (t: number) => new Date(t + 19_800_000).toISOString().slice(0, 10);
  if (d(ms) === d(now)) return 'Today';
  if (d(ms) === d(now - 86_400_000)) return 'Yesterday';
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
};
