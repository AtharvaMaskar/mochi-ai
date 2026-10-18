// The ui's data layer: fetchers for the agent's desk API, a fetch hook with honest error reasons, the live story
// socket, and the shared dream-progress store (Overview's PipelineFlow and the MochiIsland both follow it).
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Story, StoredQuery, ToolCard } from '@mochi/contracts';

export type Guess = { issue: string | null; p: number | null; basis: 'graph' | 'vector' | 'none'; query_id: string | null; resolution?: string | null };
export type DeskRow = {
  id: string; fd_id: number; name: string; created_at: number; subject: string; status: string;
  state: 'todo' | 'done' | 'left'; reading: boolean; guess: Guess;
};
export type DeskList = { view: string; order: string; sim_now: number; counts: { ready: number; done: number; all: number }; rows: DeskRow[]; queries: Record<string, StoredQuery> };
export type Msg = { kind: 'customer' | 'reply' | 'note'; author: string; at: number; text: string; quoted?: string };
export type TicketDetail = {
  id: string; fd_id: number; subject: string; status: string; state: DeskRow['state']; created_at: number;
  requester: { name: string; email: string | null }; customer_id: string | null; merged_into: string | null;
  in_memory: boolean; ingested: boolean; guess: Guess | null; guess_queries: Record<string, StoredQuery>;
  customer: ToolCard | null; thread: Msg[];
};
export type StoryRow = { id: string; title: string; version: number; generated_at: number; generated_by: string; topic: string };
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
  answer: (id: string, requestId: string) => call<{ status: string }>(`/api/tickets/${encodeURIComponent(id)}/answer`, post({ requestId })),
  overview: () => call<Overview>('/api/overview'),
  stories: () => call<StoryRow[]>('/api/stories'),
  story: (id: string, version?: number, asOf?: number) =>
    call<{ story: Story; as_of: number }>(`/api/stories/${id}${version ? `@${version}` : ''}${asOf !== undefined ? `?asOf=${asOf}` : ''}`),
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

/** The story's latest version over the live socket (null until the first message). Reconnects after a drop. */
export function useLive(storyId: string | undefined, enabled = true): Story | null {
  const [story, setStory] = useState<Story | null>(null);
  useEffect(() => {
    if (!storyId || !enabled) return;
    let ws: WebSocket | null = null, stop = false, retry: ReturnType<typeof setTimeout>;
    const open = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/stories/${storyId}/live`);
      ws.onmessage = (m) => { const v = JSON.parse(String(m.data)); if (v.type === 'story') setStory(v.story); };
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
