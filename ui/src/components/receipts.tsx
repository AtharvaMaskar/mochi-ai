// Receipts: every number resolves through ReceiptProvider to the stored query that produced it.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { StoredQuery, PathReceipt as PathReceiptT } from '@mochi/contracts';
import { Icon, RollingNumber } from './ds.tsx';

type Queries = Record<string, StoredQuery>;
type Open = { qid: string; x: number; y: number; ox: number; column?: string } | null;
type Ctx = { queries: Queries; asOf?: number; open: (qid: string, el: HTMLElement, column?: string) => void };
const ReceiptCtx = createContext<Ctx | null>(null);

export function useReceipts(): Ctx {
  const c = useContext(ReceiptCtx);
  if (!c) throw new Error('receipt components need a ReceiptProvider');
  return c;
}

export const fmtTime = (ms: number) => new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST';

export function ReceiptProvider({ queries, asOf, children }: { queries: Queries; asOf?: number; children: ReactNode }) {
  const [shown, setShown] = useState<Open>(null);
  const open: Ctx['open'] = (qid, el, column) => {
    const r = el.getBoundingClientRect();
    const w = Math.min(440, window.innerWidth - 32);
    const x = Math.max(16, Math.min(r.left, window.innerWidth - w - 16));
    setShown({ qid, column, x, y: r.bottom + 6, ox: r.left + r.width / 2 - x });
  };
  return (
    <ReceiptCtx.Provider value={{ queries, asOf, open }}>
      {children}
      {shown && <ReceiptPopover key={`${shown.qid}${shown.x}${shown.y}`} qid={shown.qid} column={shown.column} q={queries[shown.qid]} asOf={asOf} x={shown.x} y={shown.y} ox={shown.ox} onClose={() => setShown(null)} />}
    </ReceiptCtx.Provider>
  );
}

export function ReceiptPopover(p: { qid: string; column?: string; q?: StoredQuery; asOf?: number; x: number; y: number; ox?: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(p.y), [above, setAbove] = useState(false);
  useEffect(() => {
    const el = ref.current!;
    const h = el.offsetHeight;
    if (p.y + h > window.innerHeight - 16) { setTop(Math.max(16, p.y - h - 40)); setAbove(true); }
    el.focus();
    const away = (e: PointerEvent) => { if (!el.contains(e.target as Node)) p.onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    const t = setTimeout(() => document.addEventListener('pointerdown', away));
    document.addEventListener('keydown', esc);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [p.qid, p.y]);
  const params = p.q ? { ...p.q.params, as_of: p.asOf ?? p.q.ran_at } : {};
  const lines = p.q?.cypher.split('\n') ?? [];
  const step = Math.min(40, 300 / Math.max(1, lines.length)); // the whole Cypher is in within 300 ms
  return (
    <div ref={ref} className="mb-pop" role="dialog" aria-label={`Receipt for ${p.qid}`} tabIndex={-1}
      style={{ left: p.x, top, transformOrigin: `${p.ox ?? 24}px ${above ? '100%' : '0'}` }}>
      <div className="mb-pop-head">
        <b>Receipt <span className="mono">{p.qid}</span>{p.column && <span className="mono muted"> · {p.column}</span>}</b>
        <button className="mb-x" aria-label="Close receipt" onClick={p.onClose}><Icon name="close" /></button>
      </div>
      {p.q ? <>
        <pre>{lines.map((l, i) => <span key={i} className="mb-pop-line" style={{ animationDelay: `${120 + i * step}ms` }}>{l}{'\n'}</span>)}</pre>
        <dl className="mb-kv">
          <dt>graph</dt><dd>{p.q.graph}</dd>
          <dt>params</dt><dd>{JSON.stringify(params)}</dd>
          <dt>ran_at</dt><dd>{p.q.ran_at} · {fmtTime(p.q.ran_at)}</dd>
          <dt>as_of</dt><dd>{p.asOf === undefined ? `live (${p.q.ran_at})` : `${p.asOf} · ${fmtTime(p.asOf)}`}</dd>
          <dt>rows</dt><dd>{p.q.rows.length}</dd>
        </dl>
      </> : <p className="muted">No stored query has this id.</p>}
    </div>
  );
}

/** The query id as a pill that opens its receipt. */
export function QueryTag({ qid }: { qid: string }) {
  const { open } = useReceipts();
  return <button className="mb-qid" onClick={(e) => open(qid, e.currentTarget)} aria-label={`Open receipt ${qid}`}>{qid}</button>;
}

/** A number from a stored query. With `value` (a story's <num>), the value must be one of the column's rows;
 *  without it, the pill shows rows[row][column]. */
export function NumPill(p: { query_id: string; column: string; value?: string; row?: number; size?: 'lg'; bad?: boolean; unit?: string }) {
  const { queries, open } = useReceipts();
  const q = queries[p.query_id];
  const stored = q?.rows[p.row ?? 0]?.[p.column];
  const shown = p.value ?? (stored === undefined || stored === null ? '—' : String(stored));
  const drift = !q || (p.value !== undefined && !q.rows.some((r) => String(r[p.column]) === p.value));
  return (
    <button className={`mb-num${p.size === 'lg' ? ' mb-num-lg' : ''}`} data-drift={drift || undefined} data-bad={p.bad || undefined}
      title={drift ? `This figure is not in ${p.query_id}'s rows` : `From ${p.query_id}.${p.column}`}
      onClick={(e) => open(p.query_id, e.currentTarget, p.column)}>
      {/^-?[\d.,]+$/.test(shown) ? <RollingNumber value={shown} /> : shown}{p.unit && <span className="mb-kpi-unit">{p.unit}</span>}
    </button>
  );
}

/** The traversal as connected pills. Consecutive nodes share a row; a branch starts a new row from its parent. */
export function PathReceipt({ path }: { path: PathReceiptT }) {
  const byId = new Map(path.nodes.map((n) => [n.id, n]));
  let seq = 0; // pills and edges draw left to right, 60 ms apart
  const d = () => ({ animationDelay: `${seq++ * 60}ms` });
  const node = (id: string) => { const n = byId.get(id)!; return <span className="mb-node" style={d()} key={`n${id}${seq}`}><span className="mono">{n.label}</span>{n.name}</span>; };
  const rows: ReactNode[][] = [];
  path.nodes.forEach((n, k) => {
    if (k === 0) { rows.push([node(n.id)]); return; }
    const prev = path.nodes[k - 1].id;
    const link = (j: string) => path.edges.find((e) => (e.from === j && e.to === n.id) || (e.to === j && e.from === n.id));
    let e = link(prev), from = prev;
    if (!e) { const earlier = path.nodes.slice(0, k).reverse().find((m) => link(m.id)); if (earlier) { e = link(earlier.id); from = earlier.id; } }
    if (!e) { rows.push([node(n.id)]); return; }
    if (from !== prev) rows.push([node(from)]);
    const fwd = e.from === from;
    // an edge and the node it reaches wrap together, so no arrow dangles at a line end
    rows[rows.length - 1].push(
      <span className="mb-hop" key={`h${k}`}>
        <span className="mb-edge mb-edge-draw" style={d()} aria-label={`${fwd ? '' : 'reverse '}${e.type}`}>{fwd ? '→' : '←'} {e.type} {fwd ? '→' : '←'}</span>
        {node(n.id)}
      </span>);
  });
  return (
    <div className="mb-path">
      <div className="mb-block-head"><span className="mb-block-label">The path I walked</span><QueryTag qid={path.query_id} /></div>
      {rows.map((r, i) => <div className="mb-path-row" key={i}>{r}</div>)}
    </div>
  );
}
