// Outputs card (Claude-style Progress panel, opened from a chip in the chat header): this conversation's
// stories/dashboards, the visitor's latest 5, the tools used and the graph the conversation touched. Also the
// empty-state "Pick up where you left off" cards and the shared stories list the Reports nav badge counts.
// Artifacts come from GET /api/stories (same visibility as reading a story).
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { FileText, Files, LayoutDashboard, X } from 'lucide-react';
import { ACTIVITY, type PathReceipt, type ToolCard } from '@mochi/contracts';
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

// Open/closed is remembered only for deliberate toggles (the chip, the X); Escape and an outside click just dismiss.
const KEY = 'mochi-outputs-open';
const remembered = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const remember = (v: boolean) => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* storage blocked */ } };
const phone = () => matchMedia('(max-width: 767px)').matches;

/** The chat header's Outputs chip and its floating card (a sheet on phones). */
export function Outputs({ messages, running }: { messages: Msg[]; running: boolean }) {
  const [open, setOpen] = useState(() => remembered() && !phone());
  const [pulse, setPulse] = useState(0);
  const host = useRef<HTMLDivElement>(null), chip = useRef<HTMLButtonElement>(null);
  const cardId = useId();
  const toggle = () => { remember(!open); setOpen(!open); };
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); chip.current?.focus(); } };
    const away = (e: PointerEvent) => { const t = e.target as Element; if (!host.current?.contains(t) && !t.closest?.('.mb-ent-card, .mb-pop')) setOpen(false); };
    document.addEventListener('keydown', esc); document.addEventListener('pointerdown', away);
    return () => { document.removeEventListener('keydown', esc); document.removeEventListener('pointerdown', away); };
  }, [open]);
  const list = useStories();
  const byId = new Map((list.data ?? []).map((s) => [s.id, s]));
  // this conversation's artifacts, newest version per id; ones that land during a run flash once and pulse the chip
  const mine = new Map<string, Ref>();
  for (const m of messages) if (m.activityType === 'mochi.story') { const r = m.content as Ref; mine.set(r.id, r); }
  const fresh = useRef(new Set<string>());
  const seen = useRef(0);
  useEffect(() => {
    if (mine.size === seen.current) return;
    if (running) {
      for (const id of mine.keys()) if (!byId.has(id)) fresh.current.add(id);
      setPulse((p) => p + 1);
      if (remembered() && !phone()) setOpen(true);
    }
    seen.current = mine.size;
    dispatchEvent(new Event(CHANGED));
  }, [messages.length]);
  const here = [...mine.values()].reverse().map((r) => ({ ...byId.get(r.id), ...r, version: Math.max(r.version, byId.get(r.id)?.version ?? 0) }));
  const recent = (list.data ?? []).filter((s) => !mine.has(s.id)).slice(0, 5);
  const tools = new Map<string, number>();
  for (const m of messages) for (const c of m.toolCalls ?? []) tools.set(c.function.name, (tools.get(c.function.name) ?? 0) + 1);
  const touched = graphTouched(messages.filter((m) => m.activityType === ACTIVITY.card).map((m) => m.content as ToolCard));
  const n = here.length + recent.length;
  return (
    <div className="mb-out" ref={host}>
      <button ref={chip} type="button" className="mb-out-chip" aria-expanded={open} aria-controls={open ? cardId : undefined}
        aria-label={`Outputs, ${n}`} title="Outputs" data-pulse={pulse ? (pulse % 2 ? 'a' : 'b') : undefined} onClick={toggle}>
        <Files size={16} strokeWidth={1.5} aria-hidden="true" /><span className="mono">{n}</span>
      </button>
      {open && <>
        <button type="button" className="mb-out-scrim" tabIndex={-1} aria-label="Close outputs" onClick={() => setOpen(false)} />
        <section id={cardId} className="mb-out-card mb-rail" role="dialog" aria-label="Outputs"
          onClick={(e) => { if (phone() && (e.target as Element).closest('.mb-rail-row')) setOpen(false); }}>
          <div className="mb-out-head">
            <span className="mb-col-title">Outputs <span className="mono muted">{n}</span></span>
            <button type="button" className="mb-icon-btn" aria-label="Close outputs" title="Close outputs" onClick={toggle}><X size={16} strokeWidth={1.5} aria-hidden="true" /></button>
          </div>
          <div className="mb-rail-body">
            {here.length > 0 && <section><h3>This conversation</h3><ul>{here.map((s) => <Row key={s.id} s={s} fresh={fresh.current.has(s.id)} />)}</ul></section>}
            {recent.length > 0 && <section><h3>Recent</h3><ul>{recent.map((s) => <Row key={s.id} s={s} />)}</ul></section>}
            {!n && <p className="t-caption muted">Stories and dashboards you make show up here.</p>}
            {tools.size > 0 && (
              <section><h3>Used in this session</h3>
                <p className="mb-rail-used mono">{[...tools].map(([k, c]) => `${k} ×${c}`).join(' · ')}{touched.graphs.length ? ` · ${touched.graphs.join(' · ')}` : ''}</p>
                {touched.nodes > 0 && <GraphTouched t={touched} />}
              </section>
            )}
          </div>
        </section>
      </>}
    </div>
  );
}

// ---------- Graph touched: what this conversation's stored queries and path receipts reached (client side) ----------
const RECORD_ID = /^[A-Z]{1,3}-\d+$/;
export function graphTouched(cards: ToolCard[]) {
  const nodes = new Set<string>(), edges = new Set<string>(), graphs = new Set<string>();
  let path: PathReceipt | null = null;
  const take = (v: unknown) => { for (const x of Array.isArray(v) ? v : [v]) if (typeof x === 'string' && RECORD_ID.test(x)) nodes.add(x); };
  for (const c of cards) {
    for (const q of Object.values(c.queries ?? {})) { graphs.add(q.graph); for (const r of q.rows) Object.values(r).forEach(take); }
    if (c.path) {
      path = c.path;
      for (const p of c.path.nodes) nodes.add(p.id);
      for (const e of c.path.edges) edges.add(`${e.from}|${e.type}|${e.to}`);
    }
  }
  return { nodes: nodes.size, edges: edges.size, graphs: [...graphs], path };
}
const count = (k: number, w: string) => <><span className="mono">{k}</span> {w}{k === 1 ? '' : 's'}</>;

function GraphTouched({ t }: { t: ReturnType<typeof graphTouched> }) {
  return (
    <div className="mb-gt">
      <p className="mb-gt-count" title={t.graphs.join(' · ')}>{count(t.nodes, 'node')} · {count(t.edges, 'edge')} across {count(t.graphs.length, 'graph')}</p>
      {t.path && <PathSketch key={`${t.path.query_id}:${t.path.nodes[0].id}`} path={t.path} />}
    </div>
  );
}

/** At most 8 nodes of the latest path receipt, layered by hops from its first node; edges draw in, 60 ms apart. */
function PathSketch({ path }: { path: PathReceipt }) {
  const ns = path.nodes.slice(0, 8), ids = new Set(ns.map((x) => x.id));
  const es = path.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const depth = new Map([[ns[0].id, 0]]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of es) for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) if (depth.has(a) && !depth.has(b)) { depth.set(b, depth.get(a)! + 1); grew = true; }
  }
  for (const x of ns) if (!depth.has(x.id)) depth.set(x.id, Math.max(...depth.values()) + 1);
  const cols = Math.max(...depth.values()) + 1;
  const layer = (d: number) => ns.filter((x) => depth.get(x.id) === d);
  const tall = Math.max(...Array.from({ length: cols }, (_, d) => layer(d).length));
  const W = 300, PAD = 28, ROW = 34, H = tall * ROW + 14;
  const at = new Map(ns.map((x) => {
    const d = depth.get(x.id)!, l = layer(d), i = l.indexOf(x);
    return [x.id, { x: cols === 1 ? W / 2 : PAD + (d * (W - 2 * PAD)) / (cols - 1), y: H / 2 - 6 + (i - (l.length - 1) / 2) * ROW, d }];
  }));
  const short = (x: PathReceipt['nodes'][number]) => (RECORD_ID.test(x.id) ? x.id : x.name.length > 9 ? `${x.name.slice(0, 8)}…` : x.name);
  return (
    <svg className="mb-gt-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Latest path: ${ns.map((x) => x.name).join(', ')}`}>
      {es.map((e, i) => {
        const a = at.get(e.from)!, b = at.get(e.to)!;
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} pathLength={1} style={{ animationDelay: `${i * 60}ms` }}><title>{e.type}</title></line>;
      })}
      {ns.map((x, i) => {
        const p = at.get(x.id)!, below = cols < 6 || p.d % 2 === 0;
        return (
          <g key={x.id} className="mb-gt-node" style={{ animationDelay: `${i * 60}ms` }}>
            <title>{`${x.label}: ${x.name}`}</title>
            <circle cx={p.x} cy={p.y} r={4} />
            <text x={p.x} y={below ? p.y + 17 : p.y - 9} textAnchor="middle">{short(x)}</text>
          </g>
        );
      })}
    </svg>
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
