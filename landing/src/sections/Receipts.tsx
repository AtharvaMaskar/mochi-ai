// §6 Receipts: a pinned fragment changes as three statements scroll past (sticky-scroll reveal, window-targeted),
// with a tracing beam along the statements. Each state is also reachable by keyboard (the statements are buttons).
import { useEffect, useRef, useState } from 'react';
import type { StoredQuery } from '@mochi/contracts';
import { demo, fmtIST } from '../data';
import { Cypher, Num, PathReceipt, Receipts, Rolling, still, useInView } from '../parts/ui';
import { Kpi } from '../parts/Card';

const brief = demo.hero.briefs[demo.hero.ticket].card;
const STATEMENTS = [
  { h: 'Click a number. Its Cypher opens.', p: 'Every figure is a stored query with its graph, parameters and time. Nothing on a brief is typed by hand.' },
  { h: 'Every brief shows its path.', p: 'The hops Mochi walked, from the customer to the team that owns the fix, drawn as it reads them.' },
  { h: 'Ask what it knew yesterday.', p: 'Every query takes $as_of. A retired fact keeps its end date in the graph, so the past still answers.' },
];

export function ReceiptsSection() {
  const [on, setOn] = useState(0), sec = useRef<HTMLElement>(null), items = useRef<(HTMLElement | null)[]>([]);
  useInView(sec);
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setOn(Number((e.target as HTMLElement).dataset.i)); }), { rootMargin: '-45% 0px -45% 0px' });
    items.current.forEach((el) => el && io.observe(el));
    const beam = () => { const r = sec.current!.getBoundingClientRect(); sec.current!.style.setProperty('--beam', Math.min(1, Math.max(0, (innerHeight * 0.5 - r.top) / r.height)).toFixed(4)); };
    beam(); addEventListener('scroll', beam, { passive: true });
    return () => { io.disconnect(); removeEventListener('scroll', beam); };
  }, []);

  return (
    <section className="rcpts wrap" id="receipts" data-sky="receipts" ref={sec} aria-labelledby="rc-h">
      <h2 id="rc-h" className="t-display">Every number shows its work.</h2>
      <div className="rc-grid">
        <div className="rc-statements">
          <span className="beam" aria-hidden="true"><i /></span>
          {STATEMENTS.map((s, i) => (
            <article key={i} data-i={i} ref={(el) => { items.current[i] = el; }} className={`stmt ${on === i ? 'on' : ''}`}>
              <button type="button" className="stmt-btn" aria-pressed={on === i} onClick={() => setOn(i)} onFocus={() => setOn(i)}>
                <h3 className="t-display stmt-h">{s.h}</h3>
              </button>
              <p className="t-lead">{s.p}</p>
              <div className="stmt-frag"><Frag state={i} /></div>
            </article>
          ))}
        </div>
        <div className="rc-pin"><div className="rc-sticky"><Frag state={on} /></div></div>
      </div>
    </section>
  );
}

function Frag({ state }: { state: number }) {
  return (
    <Receipts queries={{ ...brief.queries, q_7: demo.asof.query }}>
      <div className="rcf" data-ui key={state}>
        {state === 0 && <KpiOpen />}
        {state === 1 && <PathState />}
        {state === 2 && <AsOf />}
      </div>
    </Receipts>
  );
}

function KpiOpen() {
  const b = brief.blocks[0] as Extract<(typeof brief.blocks)[number], { type: 'kpi' }>, q = brief.queries[b.query_id];
  return (
    <>
      <Kpi b={b} q={q} />
      <div className="grown">
        <div className="pop-head"><span className="t-data-strong">{b.query_id}</span><span className="t-caption">{q.graph} · {q.rows.length} row · as of <span className="t-data">{fmtIST(Number(q.params.as_of))}</span></span></div>
        <Cypher text={q.cypher} typing={!still()} />
      </div>
    </>
  );
}

function PathState() {
  const [n, setN] = useState(0);
  return (
    <>
      <div className="t-label rcf-h">Brief for <span className="t-data">{demo.hero.ticket}</span></div>
      {brief.path && <PathReceipt path={brief.path} key={n} />}
      <ol className="hops">
        {brief.path!.edges.map((e) => {
          const a = brief.path!.nodes.find((x) => x.id === e.from)!, b = brief.path!.nodes.find((x) => x.id === e.to)!;
          return <li key={e.type} className="t-body"><b>{a.label}</b> {a.name} <span className="t-data">{e.type}</span> <b>{b.label}</b> {b.name}</li>;
        })}
      </ol>
      <button type="button" className="tlink t-label rcf-redraw" onClick={() => setN((k) => k + 1)}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>Draw the path again</button>
    </>
  );
}

function AsOf() {
  const a = demo.asof, [after, setAfter] = useState(false), why = demo.night.retired.find((r) => r.label.startsWith(`Release ${a.release} `));
  useEffect(() => { const t = setTimeout(() => setAfter(true), still() ? 0 : 700); return () => clearTimeout(t); }, []);
  const before: StoredQuery = { ...a.query, params: { ...a.query.params, as_of: a.before_ms }, rows: [{ open_tickets: a.before }] };
  return (
    <Receipts queries={{ q_7: after ? a.query : before }}>
      <div className={`asof ${after ? 'after' : ''}`}>
        <div className="seg t-label" role="group" aria-label="As of">
          <span className="seg-glide" aria-hidden="true" />
          <button type="button" aria-pressed={!after} onClick={() => setAfter(false)}>Before the dream</button>
          <button type="button" aria-pressed={after} onClick={() => setAfter(true)}>After the dream</button>
        </div>
        <div className="asof-banner t-caption">As of <span className="t-data">{fmtIST(after ? a.after_ms : a.before_ms)}</span></div>
        <div className="lbl t-caption">Open tickets on issues release {a.release} introduced</div>
        <div className="asof-num t-display"><Rolling value={after ? a.after : a.before} /></div>
        <div className="t-label">Receipt: <Num qid="q_7" column="open_tickets" value={`q_7 · ${after ? a.after : a.before}`} /></div>
        {why && <p className="t-body asof-why">The dream retired “{why.label}”: {why.now.toLowerCase()}. The tickets stay; the cause has an end date.</p>}
      </div>
    </Receipts>
  );
}
