// Mochi's summary card: the one surface in the brief that reads as Mochi talking.
// Ported from Aceternity (docs/research/aceternity.md §3.4, §3.13, §3.16): an agent-tint ring that turns only while Mochi works,
// a word-by-word reveal the first time a ticket's brief arrives, and a ring glow that leans toward the pointer.
import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { StoredQuery, Visual } from '@mochi/contracts';
import { Button, NeedsYou, Confidence } from './ds.tsx';
import { Noticed } from './desk.tsx';
import { Mochi, type Mood } from './Mochi.tsx';
import { Suggestion } from './blocks.tsx';
import { QueryTag, NumPill, ReceiptProvider, useReceipts } from './receipts.tsx';
import type { Guess, TicketDetail } from '../data/api.ts';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const seen = new Set<string>(); // ticket ids whose reveal already played this session; never replays
const WORD_MS = 260, SPREAD_MS = 300; // per-word fade and the window the stagger fits in: total < 600 ms

/** Splits text (and text inside <b>) into word spans numbered from `n.i`; other elements pass through untouched. */
function words(node: ReactNode, n: { i: number }): ReactNode {
  return Children.map(node, (c) => {
    if (typeof c === 'string') return c.split(/(\s+)/).map((w, k) => !w || /^\s+$/.test(w) ? w : <span key={k} className="mb-word" style={{ ['--i' as string]: n.i++ }}>{w}</span>);
    if (isValidElement<{ children?: ReactNode }>(c) && c.type === 'b') return cloneElement(c, undefined, words(c.props.children, n));
    return c;
  });
}

/** The confidence word opens the query that computed it; the likely fix carries its count from the same query. */
function GuessWord({ g, issue, fix }: { g: Guess; issue: ReactNode; fix: ReactNode }) {
  const { open, queries } = useReceipts();
  const support = queries[g.query_id!]?.rows.find((r) => r.issue === g.issue)?.support_count;
  return (
    <div className="mb-sum-guess">
      <p className="mb-sum-lead"><span>{issue}</span>
        <Button variant="link" size="sm" aria-label="Open the receipt for this confidence" onClick={(e) => open(g.query_id!, e.currentTarget, g.basis === 'graph' ? 'confidence' : 'score')}>
          <Confidence p={g.p!} hidePct />
        </Button>
      </p>
      {g.resolution && <p className="mb-sum-line">{fix}
        {typeof support === 'number' && <> · worked on <NumPill query_id={g.query_id!} column="support_count" row={queries[g.query_id!].rows.findIndex((r) => r.issue === g.issue)} /> similar tickets</>}</p>}
      <p className="t-caption muted">{g.basis === 'graph' ? 'Share of resolved tickets on this issue fixed this way' : 'Closest resolved ticket by meaning (no issue link yet)'}</p>
    </div>
  );
}

/** Card stack (ported): with more than one suggestion the top one leads and the next two peek behind. Turned by hand only. */
function SuggestionStack({ items }: { items: Extract<Visual, { type: 'suggestion' }>[] }) {
  const [top, setTop] = useState(0);
  const n = items.length;
  if (n < 2) return <>{items.map((s, i) => <Suggestion key={i} {...s} compact />)}</>;
  const cur = top % n; // a new ticket may have fewer suggestions
  const turn = (by: number) => setTop((cur + by + n) % n);
  return (
    <div className="mb-sum-part" role="group" aria-label="Mochi’s suggestions">
      <div className="mb-stack">
        {items.map((s, i) => {
          const d = Math.min((i - cur + n) % n, 3);
          return <div key={i} className="mb-stack-card" data-d={d} style={{ ['--d' as string]: d }} aria-hidden={d ? true : undefined} {...(d ? { inert: '' } : {})}>
            <Suggestion {...s} compact />
          </div>;
        })}
      </div>
      <div className="mb-stack-nav">
        <button className="mb-x" aria-label="Previous suggestion" onClick={() => turn(-1)}><ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" /></button>
        <span aria-live="polite">{cur + 1} of {n}</span>
        <button className="mb-x" aria-label="Next suggestion" onClick={() => turn(1)}><ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" /></button>
      </div>
    </div>
  );
}

/** Pointer glow: one rAF-throttled pointermove eases the ring's --start angle toward the pointer while it is near the card. */
function useGlow(el: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (reduced()) return;
    let raf = 0, cur = 0, target = 0, x = 0, y = 0;
    const tick = () => {
      raf = 0;
      const node = el.current; if (!node) return;
      const r = node.getBoundingClientRect(), pad = 64;
      const near = x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
      node.style.setProperty('--glow', near ? '1' : '0');
      if (!near) return;
      target = (Math.atan2(x - (r.left + r.width / 2), (r.top + r.height / 2) - y) * 180) / Math.PI; // 0° at the top, clockwise, like conic-gradient
      const d = ((target - cur + 540) % 360) - 180; // shortest arc
      cur += d * 0.18;
      node.style.setProperty('--start', cur.toFixed(1));
      if (Math.abs(d) > 0.5) raf = requestAnimationFrame(tick);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      x = e.clientX; y = e.clientY;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    addEventListener('pointermove', move, { passive: true });
    return () => { removeEventListener('pointermove', move); cancelAnimationFrame(raf); };
  }, [el]);
}

export function BriefSummary({ t, qs, sugg, working, mood }: {
  t: TicketDetail; qs: Record<string, StoredQuery>; sugg: Extract<Visual, { type: 'suggestion' }>[]; working: boolean; mood: Mood;
}) {
  const c = t.customer?.queries.q_1?.rows[0];
  const others = (t.customer?.queries.q_3?.rows ?? []).filter((r) => r.ticket !== t.id).length;
  const g = t.guess;
  const team = sugg.map((s) => qs[s.query_id]?.rows[0]?.team).find(Boolean);
  const noticed = t.merged_into ? <>This ticket was <b>merged into {t.merged_into}</b>. Answer there.</>
    : others ? <>This customer has <b>{others === 1 ? 'one other open ticket' : `${others} other open tickets`}</b>.</> : null;

  // The reveal plays once per ticket: decided when the card mounts for a ticket, remembered in memory.
  const play = useMemo(() => !seen.has(t.id) && !reduced(), [t.id]);
  useEffect(() => { seen.add(t.id); }, [t.id]);
  const n = { i: 0 };
  const say = (x: ReactNode) => play ? words(x, n) : x;
  const said = say(noticed); // numbered first, so the noticed line leads and the guess follows
  const guess = g?.issue && g.p !== null && g.query_id ? <ReceiptProvider queries={t.guess_queries}><GuessWord g={g} issue={say(g.issue)} fix={g.resolution && say(`Likely fix: ${g.resolution}`)} /></ReceiptProvider> : null;
  const step = n.i > 1 ? Math.min(40, SPREAD_MS / (n.i - 1)) : 0;
  const [revealing, setRevealing] = useState(play);
  useEffect(() => {
    setRevealing(play);
    if (!play) return;
    const id = setTimeout(() => setRevealing(false), step * n.i + WORD_MS);
    return () => clearTimeout(id);
  }, [t.id, play]); // eslint-disable-line react-hooks/exhaustive-deps

  const ref = useRef<HTMLDivElement>(null);
  useGlow(ref);
  const busy = working || revealing;

  return (
    <div className="mb-sum-ai" ref={ref} data-working={busy || undefined} style={{ ['--step' as string]: `${step}ms` }}>
      <span className="mb-sum-halo" aria-hidden="true" />
      <section className="mb-sum" aria-label="Summary">
        <div className="mb-sum-part">
          <div className="mb-sum-says"><span aria-hidden="true"><Mochi size="xs" mood={busy ? 'thinking' : mood} still={!busy} /></span><h3 className="mb-sum-eyebrow">What I noticed</h3></div>
          <Noticed>{said}</Noticed>
        </div>
        <div className="mb-sum-part"><h3 className="mb-sum-eyebrow">My guess</h3>
          {guess ?? <><p className="mb-sum-lead">Can’t tell</p>
            <NeedsYou reason={t.in_memory ? 'I can’t link this ticket to a known issue or a similar resolved ticket yet.' : 'This ticket hasn’t reached my memory yet.'} /></>}
        </div>
        <ReceiptProvider queries={qs}>
          {team ? <p className="mb-sum-line">Owning team: <b>{String(team)}</b> <QueryTag qid={sugg[0].query_id} /></p> : null}
        </ReceiptProvider>
        <div className="mb-sum-part"><h3 className="mb-sum-eyebrow">Customer</h3>
          {c ? <ReceiptProvider queries={t.customer!.queries}>
            <p className="mb-sum-line mb-sum-cust"><span className="mb-sum-cust-text" title={[c.name, c.customer_id, c.segment, c.plan, c.city].filter(Boolean).join(' · ')}>
              <b>{String(c.name)}</b> · <span className="mono">{String(c.customer_id)}</span>{[c.segment, c.plan, c.city].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
              <QueryTag qid="q_1" /></p>
            {t.requester.name !== c.name && <p className="t-caption muted">{t.requester.name}, writing for {String(c.name)}</p>}
          </ReceiptProvider> : <p className="mb-sum-line">{t.requester.name} · not found in the back office</p>}
        </div>
        <ReceiptProvider queries={qs}><SuggestionStack items={sugg} /></ReceiptProvider>
      </section>
    </div>
  );
}
