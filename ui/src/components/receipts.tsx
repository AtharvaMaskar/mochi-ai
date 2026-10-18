// Receipts: every number resolves through ReceiptProvider to the stored query that produced it.
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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

/** The traversal, one step per row: the edge (mono) then the node it reaches; no node appears twice. Where the walk
 *  branches, the shorter branch is indented under its node and the chain carries on from that node. Rows draw in
 *  one after another (80 ms apart). `bare` drops the head when a disclosure already shows the label and pill. */
export function PathReceipt({ path, bare }: { path: PathReceiptT; bare?: boolean }) {
  const byId = new Map(path.nodes.map((n) => [n.id, n]));
  // spanning tree from the first node, children in edge order
  const kids = new Map<string, { e: PathReceiptT['edges'][number]; to: string }[]>();
  const queue = path.nodes.length ? [path.nodes[0].id] : [], seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    for (const e of path.edges) {
      const to = e.from === queue[i] ? e.to : e.to === queue[i] ? e.from : null;
      if (!to || seen.has(to) || !byId.has(to)) continue;
      seen.add(to); queue.push(to);
      kids.set(queue[i], [...(kids.get(queue[i]) ?? []), { e, to }]);
    }
  }
  const depth = (id: string): number => Math.max(0, ...(kids.get(id) ?? []).map((k) => 1 + depth(k.to)));
  type Step = { id: string; side: number; e?: PathReceiptT['edges'][number]; fwd?: boolean };
  const steps: Step[] = [];
  const walk = (id: string, side: number) => {
    const ks = [...(kids.get(id) ?? [])].sort((a, b) => depth(a.to) - depth(b.to)); // the deepest branch carries the chain
    ks.forEach((k, i) => { const s = i < ks.length - 1 ? side + 1 : side; steps.push({ id: k.to, side: s, e: k.e, fwd: k.e.from === id }); walk(k.to, s); });
  };
  if (path.nodes[0]) { steps.push({ id: path.nodes[0].id, side: 0 }); walk(path.nodes[0].id, 0); }
  for (const n of path.nodes) if (!seen.has(n.id)) steps.push({ id: n.id, side: 0 });
  return (
    <div className="mb-path">
      {!bare && <div className="mb-block-head"><span className="mb-block-label">The path I walked</span><QueryTag qid={path.query_id} /></div>}
      <ol className="mb-vpath">
        {steps.map((s, i) => {
          const n = byId.get(s.id)!;
          return (
            <li key={s.id} style={{ '--i': i, '--side': s.side } as CSSProperties}>
              {s.e && <span className="mb-vpath-edge" aria-label={`${s.fwd ? '' : 'reverse '}${s.e.type}`}>{s.fwd ? '↓' : '↑'} {s.e.type}</span>}
              <span className="mb-vpath-node" title={`${n.label} · ${n.name} · ${n.id}`}><span className="mono">{n.label}</span><span className="mb-vpath-name">{n.name}</span></span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
