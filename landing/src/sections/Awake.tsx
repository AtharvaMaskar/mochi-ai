// Awake at every hour: one 24-hour ribbon in the sky's own shades, with the real work marked on it.
// Hovering an hour moves the page sky to that hour. Every mark carries a recorded receipt.
import { useEffect, useRef, useState } from 'react';
import { demo } from '../data';
import { Num, Receipts, useInView } from '../parts/ui';
import { want } from '../sky/store';

const report = demo.night.report.queries, rows = demo.awake.hours.rows as { hour: number; tickets: number }[];
const max = Math.max(...rows.map((r) => r.tickets));
const queries = { ...report, q_10: demo.awake.hours, q_11: demo.awake.offHours };
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

const MARKS = [
  { at: 2, name: 'The dream', body: <>Retired <Num qid="q_2" column="retired" /> facts that stopped being true.</> },
  { at: 6, name: 'Morning report', body: <><span className="t-data">{String(report.q_4.rows[0].kb)}</span> promises <Num qid="q_4" column="promised_h" />h. Practice took <Num qid="q_4" column="measured_h" />h.</> },
  { at: 13, name: 'Briefing, all day', body: <>Read <Num qid="q_1" column="ingested" /> new tickets in the last 24 hours.</> },
  { at: 21, name: 'Ask at any hour', body: <><Num qid="q_11" column="off_hours" /> of <Num qid="q_11" column="total" /> tickets arrived outside 09:00 to 18:00.</> },
];

export function Awake() {
  const [hover, setHover] = useState<number | null>(null), sec = useRef<HTMLElement>(null);
  useInView(sec);
  useEffect(() => { want('awake', { t: hover ?? 13, clouds: 0.3 }); }, [hover]);
  return (
    <section className="awake wrap" id="awake" data-sky="awake" ref={sec} aria-labelledby="awake-h">
      <h2 id="awake-h" className="t-display">Awake at every hour.</h2>
      <p className="t-lead">Tickets do not keep office hours, and neither does Mochi. It briefs by day and dreams at night. Hover an hour to see its sky.</p>
      <Receipts queries={queries}>
        <div className="ribbon" data-ui onPointerLeave={() => setHover(null)}>
          <div className="ribbon-band" role="list" aria-label="Tickets by hour of arrival, IST">
            {rows.map((r) => (
              <span key={r.hour} role="listitem" className={`hr ${hover === r.hour ? 'on' : ''}`} tabIndex={0}
                onPointerEnter={() => setHover(r.hour)} onFocus={() => setHover(r.hour)} onBlur={() => setHover(null)}
                aria-label={`${hh(r.hour)}: ${r.tickets} tickets`} style={{ ['--k' as string]: r.tickets / max }}>
                <i />
              </span>
            ))}
          </div>
          <div className="ribbon-axis t-data">{[0, 6, 12, 18, 24].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{hh(h % 24 === 0 && h ? 24 : h).replace('24:00', '24:00')}</span>)}</div>
          <p className="ribbon-read t-label" aria-live="polite">
            {hover === null ? <>Tickets by the hour they arrived, all {String(demo.awake.offHours.rows[0].total)} of them. Receipt <Num qid="q_10" column="tickets" value="q_10" /></>
              : <><span className="t-data">{hh(hover)}</span> IST: <Num qid="q_10" column="tickets" row={hover} /> tickets arrived in this hour.</>}
          </p>
          <ol className="marks">
            {MARKS.map((m) => (
              <li key={m.name} style={{ ['--at' as string]: m.at / 24 }} onPointerEnter={() => setHover(m.at)}>
                <span className="mark-pin" aria-hidden="true" />
                <span className="t-data">{hh(m.at)}</span>
                <span className="t-headline">{m.name}</span>
                <span className="t-body">{m.body}</span>
              </li>
            ))}
          </ol>
        </div>
      </Receipts>
    </section>
  );
}
