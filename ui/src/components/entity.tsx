// EntityLink: an ID with a dotted underline that opens a hover card of its graph record (customer, ticket, KB article),
// with the receipt pill of the stored query that produced it. Hover opens after 300 ms intent and closes 150 ms after
// leaving (the card is hoverable); click or tap toggles and pins; focus opens; Escape closes.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NeedsYou } from './ds.tsx';
import { QueryTag, ReceiptProvider } from './receipts.tsx';
import { api, type EntityCard } from '../data/api.ts';

/** IDs that have a card: customers, tickets, KB articles. */
export const ENTITY_ID = /^(?:C-\d{4,}|T-\d{4,}|KB-\d+)$/;
const ANY_ID = /\b(C-\d{4,}|T-\d{4,}|KB-\d+)\b/;

// ponytail: in-memory per page load; a failed fetch is dropped so the next hover retries.
const cache = new Map<string, Promise<EntityCard>>();
function load(id: string) {
  let p = cache.get(id);
  if (!p) { p = api.entity(id); cache.set(id, p); p.catch(() => cache.delete(id)); }
  return p;
}

const day = (ms: unknown) => (typeof ms === 'number' ? new Date(ms).toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }) : '—');
const word = (s: unknown) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).replaceAll('_', ' ') : '—');
const KIND = { customer: 'Customer', ticket: 'Ticket', kb: 'KB article' } as const;
const kindOf = (id: string): keyof typeof KIND => (id.startsWith('C-') ? 'customer' : id.startsWith('T-') ? 'ticket' : 'kb');

/** Text with every customer/ticket/KB id turned into an EntityLink (message bodies). */
export function linkifyIds(text: string): ReactNode[] {
  return text.split(new RegExp(ANY_ID.source, 'g')).map((part, i) => (i % 2 ? <EntityLink key={i} id={part} /> : part));
}

export function EntityLink({ id }: { id: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const cardId = useId();
  const later = (f: () => void, ms: number) => { clearTimeout(timer.current); timer.current = setTimeout(f, ms); };
  const cancel = () => clearTimeout(timer.current);
  const close = () => { cancel(); setOpen(false); setPinned(false); };
  const leave = () => { if (!pinned) later(close, 150); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); trigger.current?.focus(); } };
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!layer.current?.contains(t) && !trigger.current?.contains(t) && !(t as Element).closest?.('.mb-pop')) close(); };
    const scroll = (e: Event) => { if (!layer.current?.contains(e.target as Node)) close(); };
    document.addEventListener('keydown', esc);
    document.addEventListener('pointerdown', away);
    addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('keydown', esc); document.removeEventListener('pointerdown', away); removeEventListener('scroll', scroll, true); };
  }, [open]);
  return (
    <>
      <button ref={trigger} type="button" className="mb-ent" aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? cardId : undefined}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') { load(id).catch(() => {}); later(() => setOpen(true), 300); } }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') leave(); }}
        onFocus={() => { cancel(); setOpen(true); }}
        onBlur={(e) => { if (!layer.current?.contains(e.relatedTarget as Node)) leave(); }}
        onClick={(e) => {
          e.stopPropagation(); cancel();
          if (open && pinned) close(); else { setOpen(true); setPinned(true); }
          if (e.detail === 0) requestAnimationFrame(() => layer.current?.querySelector<HTMLElement>('[role=dialog]')?.focus()); // keyboard: into the card
        }}>
        {id}
      </button>
      {open && trigger.current && createPortal(
        <div ref={layer} onPointerEnter={cancel} onPointerLeave={leave} onClick={(e) => e.stopPropagation()}>
          <Card id={id} cardId={cardId} anchor={trigger.current} onPin={() => setPinned(true)} />
        </div>, document.body)}
    </>
  );
}

function Card({ id, cardId, anchor, onPin }: { id: string; cardId: string; anchor: HTMLElement; onPin: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [s, set] = useState<{ card?: EntityCard; error?: string }>({});
  const [pos, setPos] = useState<{ x: number; y: number; ox: number; above: boolean } | null>(null);
  useEffect(() => { let live = true; load(id).then((card) => live && set({ card }), (e: Error) => live && set({ error: e.message })); return () => { live = false; }; }, [id]);
  // Same placement as the receipt popover: left-aligned to the trigger, clamped to the viewport, flipped above if it would overflow.
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect(), el = ref.current!;
    const w = el.offsetWidth, h = el.offsetHeight;
    const x = Math.max(16, Math.min(r.left, innerWidth - w - 16));
    const above = r.bottom + 8 + h > innerHeight - 16 && r.top - 8 - h >= 16;
    setPos({ x, y: above ? r.top - 8 - h : r.bottom + 8, ox: r.left + r.width / 2 - x, above });
  }, [s.card, s.error]);
  const kind = s.card?.kind ?? kindOf(id);
  return (
    <ReceiptProvider queries={s.card?.queries ?? {}}>
      <div ref={ref} id={cardId} className="mb-ent-card" role="dialog" aria-label={`${KIND[kind]} ${id}`} tabIndex={-1} data-above={pos?.above || undefined}
        onPointerDownCapture={(e) => { if ((e.target as Element).closest('.mb-qid')) onPin(); }}
        style={pos ? { left: pos.x, top: pos.y, transformOrigin: `${pos.ox}px ${pos.above ? '100%' : '0'}` } : { visibility: 'hidden' }}>
        <span className="mb-ent-kind">{KIND[kind]} <span className="mono">{id}</span></span>
        {s.error ? <NeedsYou mood="sorry" title="I can’t show this record" reason={s.error} />
          : !s.card ? <div className="mb-skel" aria-label="Loading">{[70, 92, 56].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>
          : <Body c={s.card} />}
      </div>
    </ReceiptProvider>
  );
}

function Body({ c }: { c: EntityCard }) {
  const f = c as Record<string, unknown>;
  const open = (ticket: unknown, label: string) => (ticket ? <a className="mb-ent-open" href={`#/?ticket=${encodeURIComponent(String(ticket))}`}>{label}</a> : null);
  const foot = (link: ReactNode) => <div className="mb-ent-foot"><span className="mb-ent-qids">{Object.keys(c.queries).map((q) => <QueryTag key={q} qid={q} />)}</span>{link}</div>;
  if (c.kind === 'customer') return <>
    <b className="mb-ent-title">{String(f.name)}</b>
    <span className="mb-ent-sub">{[word(f.segment), f.plan ? word(f.plan) : 'No live plan', f.city ?? '—'].join(' · ')}</span>
    <dl className="mb-ent-kv">
      <dt>Open tickets</dt><dd className="mono">{String(f.open_tickets ?? 0)}</dd>
      <dt>Last contact</dt><dd>{day(f.last_contact)}</dd>
    </dl>
    {foot(open(f.latest_ticket, 'Open latest ticket'))}
  </>;
  if (c.kind === 'ticket') {
    const done = f.status === 'resolved' || f.status === 'closed';
    return <>
      <b className="mb-ent-title">{String(f.subject)}</b>
      <span className="mb-ent-sub">{word(f.status)} · opened {day(f.created_at)}</span>
      <dl className="mb-ent-kv">
        {done && <><dt>Resolution</dt><dd>{f.resolution ? String(f.resolution) : 'Closed with no recorded fix'}</dd></>}
        <dt>Customer</dt><dd>{String(f.customer)} <span className="mono muted">{String(f.customer_id)}</span></dd>
      </dl>
      {foot(open(c.id, 'Open ticket'))}
    </>;
  }
  return <>
    <b className="mb-ent-title">{String(f.title)}</b>
    <dl className="mb-ent-kv">
      <dt>Owning team</dt><dd>{f.team ? word(f.team) : 'No owner recorded'}</dd>
      <dt>Promised TAT</dt><dd>{f.promised_tat_hours === null || f.promised_tat_hours === undefined ? 'None promised' : <><span className="mono">{String(f.promised_tat_hours)}</span> h</>}</dd>
    </dl>
    {foot(null)}
  </>;
}
