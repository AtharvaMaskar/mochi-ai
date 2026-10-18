// §5 The night: one slider drives the whole page sky through the dream (dusk → night → dawn).
// Retire streaks shooting stars labelled with the facts retired; Mismatch lands a suggestion; Morning renders the report.
import { useEffect, useRef, useState } from 'react';
import { Mochi, type Mood } from '@mochi/ui/mochi';
import { demo, fmtIST } from '../data';
import { Check, Receipts, Num, useInView, still } from '../parts/ui';
import { Bars, MemDiff, Prose, Suggestion } from '../parts/Card';
import { want } from '../sky/store';

const STOPS: { name: string; clause: string; line: string; mood: Mood; t: number }[] = [
  { name: 'Ingest', clause: 'First, read the day’s tickets.', line: 'Every ticket that arrived today becomes nodes and edges in the company graph.', mood: 'listening', t: 18.6 },
  { name: 'Cluster', clause: 'Then group what repeats.', line: 'Tickets about the same issue gather. The path from customer to team lights up.', mood: 'thinking', t: 21.5 },
  { name: 'Retire', clause: 'Retire what stopped being true.', line: 'A fixed bug no longer causes tickets. The old fact gets an end date. Nothing is deleted.', mood: 'thinking', t: 25 },
  { name: 'Mismatch', clause: 'Catch the docs disagreeing.', line: 'When practice and the knowledge base part ways, Mochi writes a suggestion for the team.', mood: 'curious', t: 29 },
  { name: 'Morning', clause: 'Write the morning report.', line: 'Every agent wakes up knowing what changed overnight, with the query behind each number.', mood: 'done', t: 31.5 },
];
// Stop hours run past midnight (26 = 02:00); the sky wraps them.
const skyT = (v: number) => { const i = Math.min(3, Math.floor(v)), k = v - i; return (STOPS[i].t + (STOPS[i + 1].t - STOPS[i].t) * k) % 24; };

const report = demo.night.report, queries = { ...report.queries, q_9: demo.night.cluster };
const intro = report.body.split('<memdiff')[0].trim();
const sug = /<suggestion[^>]*actions='([^']*)'[^>]*>([\s\S]*?)<\/suggestion>/.exec(report.body)!;
const actions: string[] = JSON.parse(sug[1]), sugText = sug[2].trim();

export function Night() {
  const [v, setV] = useState(0), stop = Math.round(v), sec = useRef<HTMLElement>(null), frag = useRef<HTMLDivElement>(null);
  const s = STOPS[stop];
  useInView(sec);

  useEffect(() => {
    want('night', { t: skyT(v), clouds: 0.22, part: 0, meteors: stop === 2 ? 1.4 : stop === 1 || stop === 3 ? 0.12 : 0,
      labels: stop === 2 ? demo.night.retired.map((r) => r.label) : [], constellation: stop >= 1 && stop <= 3 ? 1 : 0 });
  }, [v, stop]);

  return (
    <section className="night" id="night" data-sky="night" ref={sec} aria-labelledby="night-h">
      <div className="wrap">
        <h2 id="night-h" className="t-display">Drag the brain through a night.</h2>
        <div className="night-split">
          <div className="night-copy" aria-live="polite">
            <h3 className="t-display night-clause" key={stop}>{s.clause}</h3>
            <p className="t-lead">{s.line}</p>
          </div>
          <div className="night-frag" ref={frag}>
            <Receipts queries={queries}>
              <div className="dream" data-ui>
                <div className="rail">
                  {STOPS.map((x, i) => (
                    <span key={x.name} className={`step ${i < stop ? 'done' : ''} ${i === stop ? 'now' : ''}`}>
                      <span className="step-mark">{i < stop ? <Check /> : i === stop ? <Mochi size="xs" mood={x.mood} squishable={false} label={`Mochi, ${x.name}`} /> : <i />}</span>
                      <span className="t-caption">{x.name}</span>
                    </span>
                  ))}
                </div>
                <div className="dream-body rise" key={stop}>{body(stop)}</div>
              </div>
            </Receipts>
          </div>
        </div>
        <div className="slider">
          <label htmlFor="night-range" className="sr">Dream stage</label>
          <input id="night-range" type="range" min={0} max={4} step={0.01} value={v} style={{ ['--v' as string]: v / 4 }}
            aria-valuetext={`${s.name}: ${s.clause}`}
            onChange={(e) => setV(Number(e.target.value))} onPointerUp={() => setV(Math.round(v))} onKeyUp={() => setV(Math.round(v))}
            onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setV(Math.min(4, stop + 1)); } if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setV(Math.max(0, stop - 1)); } }} />
          <div className="stops">
            {STOPS.map((x, i) => <button type="button" key={x.name} className={`t-label stop ${i === stop ? 'on' : ''}`} style={{ ['--i' as string]: i }} onClick={() => setV(i)}>{x.name}</button>)}
          </div>
        </div>
        <ul className="sr">{demo.night.retired.map((r) => <li key={r.event}>Retired: {r.label}. {r.now}.</li>)}</ul>
      </div>
    </section>
  );
}

function body(stop: number) {
  const n = demo.night;
  if (stop === 0) return (
    <>
      <div className="t-label dream-h">Read <Num qid="q_1" column="ingested" /> new tickets</div>
      <ul className="ing">{n.ingested.map((t) => <li key={t.id}><span className="t-data">{t.id}</span><span className="t-body">{t.subject}</span><span className="t-data">{fmtIST(t.created_at).replace(' IST', '')}</span></li>)}</ul>
    </>
  );
  if (stop === 1) return <Bars b={{ type: 'bars', query_id: 'q_9', label: 'New tickets by issue', x: 'issue', y: 'tickets' }} q={n.cluster} />;
  if (stop === 2) return (
    <>
      <div className="t-label dream-h">Retired <Num qid="q_2" column="retired" /> facts</div>
      <MemDiff qid="q_3" q={report.queries.q_3} limit={5} />
    </>
  );
  if (stop === 3) return <Suggestion text={<ProseInline text={sugText} />} actions={actions} />;
  return (
    <div className="report">
      <div className="report-h"><Mochi size="sm" mood="done" /><span className="t-title">{report.title}</span></div>
      <Prose text={intro} className="t-noticed" />
      <MemDiff qid="q_3" q={report.queries.q_3} limit={3} />
      <Suggestion text={<ProseInline text={sugText} />} actions={actions} />
    </div>
  );
}
const ProseInline = ({ text }: { text: string }) => <Prose text={text} inline />;
