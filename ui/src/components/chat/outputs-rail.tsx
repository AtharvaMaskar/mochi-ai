// Outputs rail (Claude-style Progress panel): this conversation's stories/dashboards, the visitor's latest 5, and the
// tools and graphs the conversation touched. Also the empty-state "Pick up where you left off" cards and the shared
// stories list the Reports nav badge counts. All from GET /api/stories (same visibility as reading a story).
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, LayoutDashboard } from 'lucide-react';
import { ACTIVITY } from '@mochi/contracts';
import { api, useData, type StoryRow } from '../../data/api.ts';

/** Open an artifact in the side panel (provided by Chat). */
export const OpenArtifact = createContext<(id: string) => void>(() => {});
const CHANGED = 'mochi-stories-changed';
/** The visitor's stories, refetched whenever any surface says one changed. */
export function useStories() {
  const r = useData(() => api.stories(), []);
  useEffect(() => { addEventListener(CHANGED, r.reload); return () => removeEventListener(CHANGED, r.reload); }, [r.reload]);
  return r;
}

type Ref = { id: string; version: number; kind?: 'story' | 'dashboard' };
type Msg = { id: string; role: string; content?: unknown; activityType?: string; toolCalls?: { function: { name: string } }[] };

function Row({ s, fresh }: { s: Partial<StoryRow> & Ref; fresh?: boolean }) {
  const open = useContext(OpenArtifact);
  const Icon = s.kind === 'dashboard' ? LayoutDashboard : FileText;
  return (
    <li>
      <button type="button" className="mb-rail-row" data-fresh={fresh || undefined} onClick={() => open(s.id)}>
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
        <span className="mb-rail-name">{s.title ?? 'Saving…'}</span>
        <span className="mb-rail-sub">{s.kind === 'dashboard' ? 'Dashboard' : 'Story'} · {s.status === 'published' ? 'Published' : 'Draft'} · <span className="mono">v{s.version}</span></span>
      </button>
    </li>
  );
}

const KEY = 'mochi-rail-open';
export function OutputsRail({ messages, running }: { messages: Msg[]; running: boolean }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } });
  const toggle = () => { setOpen(!open); try { localStorage.setItem(KEY, open ? '0' : '1'); } catch { /* storage blocked */ } };
  const list = useStories();
  const byId = new Map((list.data ?? []).map((s) => [s.id, s]));
  // this conversation's artifacts, newest version per id; ones that land during a run flash once
  const mine = new Map<string, Ref>();
  for (const m of messages) if (m.activityType === 'mochi.story') { const r = m.content as Ref; mine.set(r.id, r); }
  const fresh = useRef(new Set<string>());
  const seen = useRef(0);
  useEffect(() => {
    if (mine.size === seen.current) return;
    if (running) for (const id of mine.keys()) if (!byId.has(id)) fresh.current.add(id);
    seen.current = mine.size;
    dispatchEvent(new Event(CHANGED));
  }, [messages.length]);
  const here = [...mine.values()].reverse().map((r) => ({ ...byId.get(r.id), ...r, version: Math.max(r.version, byId.get(r.id)?.version ?? 0) }));
  const recent = (list.data ?? []).filter((s) => !mine.has(s.id)).slice(0, 5);
  // tools by count, graphs from every stored query a card brought in
  const tools = new Map<string, number>();
  for (const m of messages) for (const c of m.toolCalls ?? []) tools.set(c.function.name, (tools.get(c.function.name) ?? 0) + 1);
  const graphs = new Set(messages.filter((m) => m.activityType === ACTIVITY.card).flatMap((m) => Object.values((m.content as { queries?: Record<string, { graph: string }> }).queries ?? {}).map((q) => q.graph)));
  return (
    <aside className="mb-rail" aria-label="Outputs" data-collapsed={!open || undefined}>
      <button type="button" className="mb-rail-head" aria-expanded={open} onClick={toggle}>
        <span>Outputs</span><span className="mono muted">{here.length + recent.length}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && (
        <div className="mb-rail-body">
          {here.length > 0 && <section><h3>This conversation</h3><ul>{here.map((s) => <Row key={s.id} s={s} fresh={fresh.current.has(s.id)} />)}</ul></section>}
          {recent.length > 0 && <section><h3>Recent</h3><ul>{recent.map((s) => <Row key={s.id} s={s} />)}</ul></section>}
          {!here.length && !recent.length && <p className="t-caption muted">Stories and dashboards you make show up here.</p>}
          {tools.size > 0 && (
            <section><h3>Used in this session</h3>
              <p className="mb-rail-used mono">{[...tools].map(([n, k]) => `${n} ×${k}`).join(' · ')}{graphs.size ? ` · ${[...graphs].join(' · ')}` : ''}</p>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}

/** Empty chat: up to 3 recent artifacts to reopen. */
export function PickUp() {
  const list = useStories();
  const open = useContext(OpenArtifact);
  const top = (list.data ?? []).slice(0, 3);
  if (!top.length) return null;
  return (
    <section className="mb-pickup" aria-label="Pick up where you left off">
      <h3>Pick up where you left off</h3>
      <div className="mb-pickup-cards">
        {top.map((s) => {
          const Icon = s.kind === 'dashboard' ? LayoutDashboard : FileText;
          return (
            <button key={s.id} type="button" className="mb-pickup-card" onClick={() => open(s.id)}>
              <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
              <span className="mb-rail-name">{s.title}</span>
              <span className="mb-rail-sub">{s.kind === 'dashboard' ? 'Dashboard' : 'Story'} · {s.status === 'published' ? 'Published' : 'Draft'} · <span className="mono">v{s.version}</span></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
