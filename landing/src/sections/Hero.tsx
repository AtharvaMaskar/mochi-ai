// §1–2 Hero. Text top-left on the container edge; the desk lies on a diagonal as stacked layers sharing one pose
// (the reference's matrix3d, as rotateX 41.8° · rotateY 15.2° · rotateZ −33.2°): a ghost of the Overview behind,
// the desk (queue + ticket) in front, and Mochi's brief lifted at translateZ(80px) with its path drawn and one
// Cypher open. Scrolling straightens all of them together (container scroll, aceternity.md §3.9, one --p), pins
// the desk, and it becomes the live demo. The sky runs a compressed day (75 s per 24 h) with a clock and a
// scrubber. Phones and reduced motion: the flat desk below the actions.
import { useEffect, useRef, useState } from 'react';
import { Mochi, type Mood } from '@mochi/ui/mochi';
import { demo, ago, LINKS, type Brief } from '../data';
import { Button, Check, Num, PathReceipt, Receipts, Shimmer, Sparkles, still } from '../parts/ui';
import { Blocks } from '../parts/Card';
import { want, onHour, currentHour } from '../sky/store';

const story = () => !still() && matchMedia('(min-width: 768px)').matches;
const START_HOUR = 10, NIGHT_STILL = 2.25;

export function Hero() {
  const stage = useRef<HTMLDivElement>(null), board = useRef<HTMLDivElement>(null);
  const [flat, setFlat] = useState(!story());

  useEffect(() => {
    const el = stage.current!;
    const labels = demo.night.retired.map((r) => r.label);
    if (still()) want('hero', { t: NIGHT_STILL, cycle: false, labels }); // a still night frame
    else want('hero', { t: START_HOUR, cycle: true, labels });
    if (!story()) { el.style.setProperty('--p', '1'); return; }
    let raf = 0, wasFlat = false;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect(), run = el.offsetHeight - innerHeight;
      const p = Math.min(1, Math.max(0, -r.top / (run * 0.55))); // straight by just past half-way, then pinned and live
      el.style.setProperty('--p', p.toFixed(4));
      want('hero', { clouds: 1 - p * 0.3, part: p });
      const f = p > 0.985;
      if (f !== wasFlat) { wasFlat = f; setFlat(f); }
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    addEventListener('scroll', on, { passive: true }); addEventListener('resize', on);
    return () => { removeEventListener('scroll', on); removeEventListener('resize', on); cancelAnimationFrame(raf); };
  }, []);

  // ±3° pointer tilt on top of the flat pose (aceternity 3d-card, clamped).
  const tilt = (e: React.PointerEvent) => {
    if (!flat || !story()) return;
    const r = board.current!.getBoundingClientRect();
    board.current!.style.setProperty('--tx', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    board.current!.style.setProperty('--ty', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };
  const untilt = () => { board.current?.style.setProperty('--tx', '0'); board.current?.style.setProperty('--ty', '0'); };

  return (
    <section className="hero" id="top" data-sky="hero">
      <div className="hero-copy">
        <h1 className="t-display-xl"><span>No ticket starts from zero.</span> <span>Every answer shows its path.</span></h1>
        <p className="t-lead">A graph memory briefs every support agent, and every number opens the query behind it.</p>
        <div className="ctas">
          <Button variant="primary" href={LINKS.desk} className="lift">Open the platform</Button>
          <a className="tlink t-label" href="#demo">Watch the demo</a>
        </div>
        <Clock />
      </div>
      <div className={`stage ${flat ? 'is-flat' : ''}`} ref={stage}>
        <div className="stage-pin">
          <div className="board" ref={board} onPointerMove={tilt} onPointerLeave={untilt}>
            <Ghost />
            <Desk live={flat} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Mochi works around the clock: an IST clock, Mochi's state for the hour, and a 24-hour scrubber. */
function Clock() {
  const [h, setH] = useState(currentHour()), idle = useRef(0);
  useEffect(() => onHour(setH), []);
  const n = demo.night.retired.length;
  const [mood, line]: [Mood, string] = h >= 5 && h < 8 ? ['done', 'Morning report ready'] : h >= 8 && h < 18 ? ['speaking', 'Briefing agents'] : h >= 1 && h < 5 ? ['thinking', `Dreaming. Retiring ${n} facts.`] : ['thinking', 'Clustering today’s tickets'];
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const scrub = (v: number) => {
    want('hero', { cycle: false, t: v }); setH(v);
    clearTimeout(idle.current);
    if (!still()) idle.current = window.setTimeout(() => want('hero', { cycle: true }), 6000); // the loop resumes after 6 s idle
  };
  return (
    <div className="clock">
      <Mochi size="sm" mood={mood} />
      <div className="clock-txt">
        <span className="t-data-strong clock-time">IST {clock}</span>
        <span className="t-label clock-line">{line}</span>
      </div>
      <label htmlFor="hour" className="sr">Hour of day, IST</label>
      <input id="hour" className="clock-scrub" type="range" min={0} max={23.99} step={0.05} value={h} style={{ ['--v' as string]: h / 24 }}
        onChange={(e) => scrub(Number(e.target.value))} aria-valuetext={`${clock} IST: ${line}`} />
    </div>
  );
}

/** The back layer: a faint copy of the Overview (greeting and the dream's pipeline). Decorative. */
function Ghost() {
  return (
    <div className="ghost" aria-hidden="true" data-ui>
      <div className="appbar"><span className="brand-s"><Mochi size="xs" still squishable={false} /><span className="t-label">Mochi Brain</span></span><span className="appnav t-label"><span>Tickets</span><b>Overview</b><span>Reports</span></span></div>
      <div className="ghost-body">
        <div className="ghost-greet"><Mochi size="md" mood="done" tone="mood" still squishable={false} /><span className="t-title">Good morning. Here is what changed overnight.</span></div>
        <div className="ghost-rail">{['Ingest', 'Cluster', 'Retire', 'Mismatch', 'Report'].map((s) => <span key={s} className="t-label"><Check />{s}</span>)}</div>
        <div className="ghost-rows">{demo.night.retired.slice(0, 6).map((r) => <span key={r.event} className="t-body"><s>{r.label}</s> {r.now}</span>)}</div>
      </div>
    </div>
  );
}

function Desk({ live }: { live: boolean }) {
  const [sel, setSel] = useState(demo.hero.ticket), [reading, setReading] = useState(false), [mood, setMood] = useState<Mood>('idle');
  const [opened, setOpened] = useState(() => new Set([demo.hero.ticket])), [picked, setPicked] = useState(false), [hover, setHover] = useState(false);
  const timers = useRef<number[]>([]);
  const b: Brief = demo.hero.briefs[sel], t = demo.hero.queue.find((x) => x.id === sel)!;

  const pick = (id: string) => {
    timers.current.forEach(clearTimeout);
    setSel(id); setPicked(true); setOpened((s) => new Set(s).add(id));
    if (still()) { setReading(false); setMood('speaking'); return; }
    setReading(true); setMood('thinking');
    timers.current = [
      window.setTimeout(() => { setReading(false); setMood('speaking'); }, 1100),
      window.setTimeout(() => setMood('idle'), 4200),
    ];
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return (
    <div className="desk-wrap">
      <p className={`hint ${live ? 'on' : ''}`} aria-live="polite">
        <Mochi size="xs" mood={mood} label="Mochi" />
        <span className="t-label">{picked ? 'Click any number to see its query.' : 'Pick a ticket. I’ll brief you.'}</span>
      </p>
      <div className="desk-stack">
        <div className="desk" data-ui aria-label="Mochi Brain desk: the ticket queue and the ticket">
          <div className="appbar">
            <span className="brand-s"><Mochi size="xs" still squishable={false} label="Mochi" /><span className="t-label">Mochi Brain</span></span>
            <span className="appnav t-label"><b>Tickets</b><span>Overview</span><span>Reports</span></span>
            <span className="island t-caption"><Mochi size="xs" mood={reading ? 'thinking' : 'idle'} squishable={false} label="Mochi" />
              {reading ? <>Reading <span className="t-data">{sel}</span></> : <>Brief ready for <span className="t-data">{sel}</span></>}</span>
          </div>
          <div className="desk-body">
            <aside className="queue" aria-label="Unresolved tickets, newest first">
              <div className="queue-head t-caption">Unresolved, newest first</div>
              <ul>
                {demo.hero.queue.map((q) => (
                  <li key={q.id}>
                    <button type="button" className={`row ${sel === q.id ? 'sel' : ''} ${opened.has(q.id) ? 'read' : 'new'}`} onClick={() => pick(q.id)} aria-pressed={sel === q.id} tabIndex={live ? 0 : -1}>
                      <span className="d" aria-hidden="true" />
                      <span className="who t-label">{q.name}</span><span className="meta t-data">{ago(q.created_at)}</span>
                      <span className="subj t-caption">{q.subject}</span>
                      <span className="id t-data-xs">{q.id}</span>
                      {!opened.has(q.id) && <span className="sr">New</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            <section className="thread" aria-label="The ticket">
              <div className="thread-head"><span className="t-title">{b.subject}</span><span className="t-data">{b.ticket}</span></div>
              <div className="msg">
                <div className="msg-meta t-caption"><b className="t-label">{b.customer}</b> wrote, <span className="t-data">{ago(t.created_at)}</span> ago</div>
                <p className="t-body">{b.body}</p>
              </div>
              <div className="compose t-body" aria-hidden="true">Reply to {b.customer.split(' ')[0]}</div>
            </section>
            <div className="brief-slot" aria-hidden="true" />
          </div>
        </div>
        <section className="brief" aria-label="Mochi's brief" data-ui>
          <div className="brief-head" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
            <span className="brief-mochi"><Mochi size="sm" mood={mood} /><Sparkles color="--agent-sky" active={hover} /></span>
            <span className="t-label">Mochi’s brief</span>
            <span className="state t-caption">{reading ? 'Reading the graph' : <>Ready for <span className="t-data">{sel}</span></>}</span>
          </div>
          {reading ? <div className="brief-body"><Shimmer lines={6} /></div> : <BriefBody key={sel} b={b} pinOpen={!live && !picked && innerWidth >= 1100} />}
        </section>
      </div>
      <p className="recorded t-label">Recorded from the seeded demo. E Corp Securities and its customers are fictional.</p>
    </div>
  );
}

function BriefBody({ b, pinOpen }: { b: Brief; pinOpen: boolean }) {
  const q = b.card.queries, fix = q.q_4.rows[0], who = q.q_5.rows[0], cause = String(q.q_6.rows[0].release), team = String(q.q_1.rows[0].team);
  return (
    <Receipts queries={q} initial={pinOpen ? 'q_2:median_h:0' : null}>
      <div className="brief-body rise">
        <div>
          <div className="lbl t-caption">Noticed</div>
          <p className="t-noticed noticed">This is {b.issue}. “{String(fix.summary)}” fixed it <Num qid="q_4" column="used" /> times.</p>
        </div>
        <div>
          <div className="lbl t-caption">Path</div>
          {b.card.path && <PathReceipt path={b.card.path} />}
        </div>
        <Blocks card={b.card} />
        <div className="facts">
          <div className="fact"><div className="lbl t-caption">Customer</div><div className="t-label">{b.customer}, <Num qid="q_3" column="tickets_90d" /> tickets in 90 days</div></div>
          <div className="fact"><div className="lbl t-caption">Owning team</div><div className="t-label">{team}</div></div>
          <div className="fact"><div className="lbl t-caption">Who knows this</div><div className="t-label">{String(who.name)}, <Num qid="q_5" column="solved" /> solved</div></div>
          <div className="fact"><div className="lbl t-caption">Live cause</div><div className="t-label">{cause === 'none' ? 'No release on record' : <>Release <Num qid="q_6" column="release" /></>}</div></div>
        </div>
        <div className="foot">
          <span className="t-caption">Suggested: {String(fix.summary)}</span>
          <span className="acts"><Button size="sm">Overturn</Button><Button size="sm" variant="primary" success="Used">Use this</Button></span>
        </div>
      </div>
    </Receipts>
  );
}
