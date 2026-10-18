// Micro-interactions (docs/design-system/micro-interactions.md): keycap buttons, rolling numbers,
// receipts that grow from their pill with Cypher typing in, paths that draw, sparkles. No sounds.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { StoredQuery, PathReceipt as PathT } from '@mochi/contracts';
import { fmtIST } from '../data';

export const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const haptic = () => { try { navigator.vibrate?.(8); } catch { /* not supported */ } };

/** Marks an element in or out of view (data-inview) so CSS pauses its animations off-screen. */
export function useInView<T extends HTMLElement>(ref: RefObject<T | null>, onChange?: (v: boolean) => void, margin = '0px') {
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { el.dataset.inview = String(e.isIntersecting); onChange?.(e.isIntersecting); }, { rootMargin: margin });
    io.observe(el); return () => io.disconnect();
  }, []); // eslint-disable-line
}

// ---------- keycap button ----------
type BtnProps = { children: ReactNode; variant?: 'primary' | 'secondary' | 'quiet'; href?: string; onClick?: () => void; success?: string; size?: 'md' | 'sm'; type?: 'button' | 'submit'; className?: string; label?: string };
export function Button(p: BtnProps) {
  const [lit, setLit] = useState(0), [done, setDone] = useState(false), ref = useRef<HTMLElement>(null);
  const down = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    (e.currentTarget as HTMLElement).style.setProperty('--fx', `${e.clientX - r.left}px`);
    (e.currentTarget as HTMLElement).style.setProperty('--fy', `${e.clientY - r.top}px`);
    setLit((n) => n + 1);
  };
  const click = () => {
    if (p.variant === 'primary' || p.success) haptic();
    if (p.success) { const el = ref.current!; el.style.width = `${el.offsetWidth}px`; setDone(true); setTimeout(() => { setDone(false); el.style.width = ''; }, 1100); }
    p.onClick?.();
  };
  const cls = ['key', `key-${p.variant ?? 'secondary'}`, p.size === 'sm' && 'key-sm', lit && (lit % 2 ? 'lit-a' : 'lit-b'), done && 'key-done', p.className].filter(Boolean).join(' ');
  const body = done ? <><Check />{p.success}</> : p.children;
  return p.href
    ? <a ref={ref as RefObject<HTMLAnchorElement>} className={`${cls} t-label`} href={p.href} onPointerDown={down} onClick={click} aria-label={p.label}>{body}</a>
    : <button ref={ref as RefObject<HTMLButtonElement>} type={p.type ?? 'button'} className={`${cls} t-label`} onPointerDown={down} onClick={click} aria-label={p.label}>{body}</button>;
}
export const Check = () => <svg className="check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" /></svg>;

// ---------- rolling number ----------
export function Rolling({ value, className }: { value: string | number; className?: string }) {
  const chars = String(value).split('');
  return (
    <span className={`roll ${className ?? ''}`} aria-label={String(value)}>
      {chars.map((c, i) => /\d/.test(c)
        ? <span key={chars.length - i} className="roll-col" aria-hidden="true"><span className="roll-strip" style={{ transform: `translateY(${-Number(c) * 1.1}em)` }}>{'0123456789'.split('').map((d) => <span key={d} data-d={d} />)}</span></span>
        : <span key={`${chars.length - i}${c}`} aria-hidden="true">{c}</span>)}
    </span>
  );
}

// ---------- receipts ----------
type Queries = Record<string, StoredQuery>;
const Ctx = createContext<{ queries: Queries; open: string | null; setOpen: (id: string | null) => void }>({ queries: {}, open: null, setOpen: () => {} });
export function Receipts({ queries, children, initial = null }: { queries: Queries; children: ReactNode; initial?: string | null }) {
  const [open, setOpen] = useState<string | null>(initial);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    const out = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.rc')) setOpen(null); };
    addEventListener('keydown', key); addEventListener('pointerdown', out);
    return () => { removeEventListener('keydown', key); removeEventListener('pointerdown', out); };
  }, [open]);
  return <Ctx.Provider value={{ queries, open, setOpen }}>{children}</Ctx.Provider>;
}

const KW = /\b(MATCH|OPTIONAL MATCH|WHERE|RETURN|ORDER BY|LIMIT|AND|OR|AS|IS NOT NULL|CASE|WHEN|THEN|ELSE|END|DESC|IN|count|sum|round|percentileDisc)\b/g;
export function Cypher({ text, typing }: { text: string; typing: boolean }) {
  const lines = text.split('\n'), [n, setN] = useState(typing ? 0 : lines.length);
  useEffect(() => {
    if (!typing) return;
    const step = Math.max(16, Math.floor(300 / lines.length)); // all lines in at most 300 ms
    const iv = setInterval(() => setN((k) => (k >= lines.length ? (clearInterval(iv), k) : k + 1)), step);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line
  return (
    <code className="cy t-data">
      {lines.map((l, i) => (
        <span key={i} className={`cy-l ${i < n ? 'in' : ''}`}>
          {l.split(KW).map((part, j) => (j % 2 ? <b key={j}>{part}</b> : part))}{'\n'}
        </span>
      ))}
    </code>
  );
}

/** A figure that opens its Cypher. The popover grows from the pill; one open at a time. */
export function Num({ qid, column, value, unit, row = 0, big, className }: { qid: string; column: string; value?: ReactNode; unit?: string; row?: number; big?: boolean; className?: string }) {
  const { queries, open, setOpen } = useContext(Ctx), key = `${qid}:${column}:${row}`;
  const q = queries[qid], ref = useRef<HTMLSpanElement>(null), [side, setSide] = useState<'l' | 'r'>('l'), [up, setUp] = useState(false);
  if (!q) throw new Error(`receipt ${qid} missing`);
  const v = value ?? String(q.rows[row]?.[column] ?? '');
  const isOpen = open === key;
  useLayoutEffect(() => {
    if (!isOpen || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setSide(r.left > innerWidth * 0.55 ? 'r' : 'l'); setUp(r.top > innerHeight * 0.6);
  }, [isOpen]);
  return (
    <span className={`rc ${big ? 'rc-big' : ''} ${className ?? ''}`} ref={ref}>
      <button type="button" className={`num ${big ? 't-title' : ''} ${isOpen ? 'on' : ''}`} aria-expanded={isOpen}
        aria-label={`${v}${unit ?? ''}, open the query behind it`} onClick={() => setOpen(isOpen ? null : key)}>
        {v}{unit && <small>{unit}</small>}
      </button>
      {isOpen && (
        <span className={`pop ${side} ${up ? 'up' : ''}`} role="dialog" aria-label={`Query ${qid}`}>
          <span className="pop-head"><span className="t-data-strong">{qid}</span><span className="t-caption">{q.graph}</span></span>
          <Cypher text={q.cypher} typing={!still()} />
          <span className="pop-foot t-caption">{q.rows.length} {q.rows.length === 1 ? 'row' : 'rows'} · as of <span className="t-data">{fmtIST(Number(q.params.as_of))}</span> · recorded from the seeded demo</span>
        </span>
      )}
    </span>
  );
}

/** The receipt pill for a whole card: opens the query that produced the path. */
export function QueryPill({ qid }: { qid: string }) {
  return <Num qid={qid} column="__pill" value={`${qid} · Cypher`} className="qpill t-data" />;
}

/** Pills appear left to right with the edge line drawing between them (60 ms stagger), once. */
export function PathReceipt({ path, play = true }: { path: PathT; play?: boolean }) {
  const byId = new Map(path.nodes.map((n) => [n.id, n]));
  const order: { node: PathT['nodes'][number]; edge?: { type: string; back: boolean } }[] = [];
  // walk the chain from the first node, following edges either way
  const seen = new Set<string>(); let at = path.nodes[0];
  order.push({ node: at }); seen.add(at.id);
  for (;;) {
    const e = path.edges.find((x) => (x.from === at.id && !seen.has(x.to)) || (x.to === at.id && !seen.has(x.from)));
    if (!e) break;
    const back = e.to === at.id; at = byId.get(back ? e.from : e.to)!; seen.add(at.id);
    order.push({ node: at, edge: { type: e.type, back } });
  }
  return (
    <span className={`path ${play ? 'play' : ''}`} key={play ? 'p' : 's'}>
      {order.map(({ node, edge }, i) => (
        <span key={node.id} className="hop" style={{ ['--i' as string]: i }}>
          {edge && <span className="edge t-data-xs"><svg viewBox="0 0 24 8" aria-hidden="true"><path d={edge.back ? 'M23 4H2M6 1L2 4l4 3' : 'M1 4h21M18 1l4 3-4 3'} /></svg>{edge.type}</span>}
          <span className="node t-data"><span className="node-l">{node.label}</span> {node.name}</span>
        </span>
      ))}
      <QueryPill qid={path.query_id} />
    </span>
  );
}

// ---------- sparkles (aceternity §3.5, rewritten as a small canvas) ----------
export function Sparkles({ color, active, burst = 0 }: { color: string; active: boolean; burst?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!, ctx = c.getContext('2d')!; if (still()) return;
    const dpr = Math.min(devicePixelRatio || 1, 1.5), w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr; ctx.scale(dpr, dpr);
    const fill = getComputedStyle(c).getPropertyValue(color).trim() || getComputedStyle(c).color;
    const ps = Array.from({ length: burst ? 36 : 46 }, () => ({ x: w / 2 + (Math.random() - 0.5) * w * (burst ? 0.3 : 0.9), y: h * (burst ? 0.5 : 0.75) + (Math.random() - 0.5) * h * 0.4, vx: (Math.random() - 0.5) * (burst ? 120 : 14), vy: -10 - Math.random() * (burst ? 90 : 18), r: 0.8 + Math.random() * 1.8, ph: Math.random() * 6.28, life: 0 }));
    let raf = 0, last = performance.now(), on = active || !!burst;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, w, h); ctx.fillStyle = fill;
      let alive = 0;
      for (const p of ps) {
        p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (!burst && p.y < h * 0.15) { p.y = h * 0.8; p.life = 0; }
        const a = burst ? Math.max(0, 1 - p.life / 1.1) : 0.25 + 0.75 * Math.abs(Math.sin(now / 600 + p.ph));
        if (a > 0) alive++;
        ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
      if (on && alive) raf = requestAnimationFrame(loop); else ctx.clearRect(0, 0, w, h);
    };
    if (on) raf = requestAnimationFrame(loop);
    return () => { on = false; cancelAnimationFrame(raf); ctx.clearRect(0, 0, w, h); };
  }, [active, burst, color]);
  return <canvas className="sparkles" ref={ref} aria-hidden="true" />;
}

export const Shimmer = ({ lines = 5 }: { lines?: number }) => (
  <span className="shim" aria-hidden="true">{Array.from({ length: lines }, (_, i) => <i key={i} style={{ ['--i' as string]: i }} />)}</span>
);

/** Words fade in and un-blur one by one (aceternity text-generate, as CSS). */
export const Reveal = ({ text, className }: { text: string; className?: string }) => (
  <span className={`reveal ${className ?? ''}`} aria-label={text}>
    {text.split(' ').map((w, i) => <span key={i} aria-hidden="true" style={{ ['--i' as string]: i }}>{w} </span>)}
  </span>
);
