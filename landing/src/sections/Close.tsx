// §9–12: built for, FAQ, the "Ask Mochi about …" CTA, and the footer with the hover wordmark and the dream countdown.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Mochi } from '@mochi/ui/mochi';
import bench from 'virtual:bench';
import { LINKS } from '../data';
import { Button, Ico, Rolling, still, useInView } from '../parts/ui';
import { want } from '../sky/store';

export function BuiltFor() {
  return (
    <section className="built wrap" data-sky="built" aria-labelledby="built-h">
      <h2 id="built-h" className="t-display">Built for Graph Hacks.</h2>
      <p className="t-lead built-row">
        Entered in all three tracks: <b>Agents That Act on Connected Data</b>, <b>Agent Memory and Coordination</b> and <b>Company Brain</b>. Every answer runs on FalkorDB; take the graph away and nothing works.
      </p>
    </section>
  );
}

const FAQ = [
  { q: 'Why a graph?', a: 'Support questions are joins: customer to ticket to issue to the team that owns the fix. In FalkorDB each hop is an edge, so the path Mochi walked is also the receipt you can check.' },
  { q: 'Is any of this real data?', a: 'No. E Corp Securities is a fictional broker. Every customer, ticket and agent is generated from seed 42. The figures on this page are recorded from that seeded demo.' },
  { q: 'What if the dream is wrong?', a: 'It never edits a fact in place. It sets an end date on the old one and adds the new one, so every query can run as of any time and you can see both.' },
  { q: 'Does it scale?', a: 'The benchmark measures concurrency, with briefings read while the dream writes. Until those figures are in bench/results.json, this page makes no claim.' },
  { q: 'How do I run it?', a: 'Clone the repo, start FalkorDB with docker compose up, then run npm run gen, npm run load and npm run dev. The README has the graph model and every Cypher query the product depends on.' },
  { q: 'Which AI tools built this?', a: 'Claude Code wrote most of the code; the team reviewed each change before it merged. The README discloses it, and we can explain every query and design decision.' },
];

export function Faq() {
  return (
    <section className="faq wrap" id="faq" data-sky="faq" aria-labelledby="faq-h">
      <h2 id="faq-h" className="t-display faq-h">Fair questions.</h2>
      <div className="faq-list">
        {FAQ.map((f, i) => (
          <details key={f.q} name="faq" className="tile" open={i === 0}>
            <summary className="t-title"><span>{f.q}</span><i className="plus" aria-hidden="true" /></summary>
            <p className="t-lead">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

// "Ask Mochi about …": Flip Words port (aceternity.md §9). Subjects are the seeded demo's; one is always shown, so Ask
// works without typing. Clicking or typing freezes the rotation; reduced motion shows the first subject, still.
const SUBJECTS = ['TOTP failures', 'payouts getting slower', 'who fixed KYC delays', 'last night’s dream', 'KB-07'];
const ARROW = ['M5 12h14', 'm12 5 7 7-7 7'], MOON = ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'];

export function Cta() {
  const [q, setQ] = useState(''), [focus, setFocus] = useState(false), [{ i, prev }, setFlip] = useState<{ i: number; prev: number | null }>({ i: 0, prev: null });
  const sizer = useRef<HTMLSpanElement>(null), field = useRef<HTMLSpanElement>(null);
  const frozen = focus || q !== '';
  useEffect(() => {
    if (frozen || still()) return;
    const iv = setInterval(() => setFlip((f) => ({ i: (f.i + 1) % SUBJECTS.length, prev: f.i })), 3000);
    return () => clearInterval(iv);
  }, [frozen]);
  useEffect(() => { if (prev === null) return; const t = setTimeout(() => setFlip((f) => ({ ...f, prev: null })), 400); return () => clearTimeout(t); }, [prev]);
  // Container Text Flip: the blank's width follows the word it holds (or what you type).
  useLayoutEffect(() => { if (field.current && sizer.current) field.current.style.width = `${sizer.current.offsetWidth}px`; }, [q, i]);
  const subject = SUBJECTS[i];
  const ask = () => { location.href = LINKS.chat(q.trim() || subject); };
  return (
    <section className="cta wrap" id="cta" data-sky="cta" aria-labelledby="cta-h">
      <h2 id="cta-h" className="sr">Ask Mochi</h2>
      <form className="cta-bar" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <span className="cta-mochi"><Mochi size="md" mood={q ? 'listening' : focus ? 'curious' : 'idle'} tone="mood" /></span>
        <label htmlFor="cta-in" className="cta-line t-display">
          <span className="cta-lead">Ask Mochi about</span>{' '}
          <span className="cta-field" ref={field} data-typing={q ? '' : undefined}>
            <span className="cta-measure" aria-hidden="true"><span className="cta-sizer" ref={sizer}>{q || subject}</span></span>
            <input id="cta-in" className="cta-in" value={q} autoComplete="off" spellCheck={false} enterKeyHint="go"
              aria-label="Ask Mochi about" placeholder={focus ? subject : ''}
              onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} />
            {!frozen && (
              <span className="cta-flip" aria-hidden="true">
                {prev !== null && <span key={`out-${prev}`} className="cta-word cta-out">{SUBJECTS[prev]}</span>}
                <span key={subject} className="cta-word">{[...subject].map((c, k) => <span key={k} style={{ animationDelay: `${k * 30}ms` }}>{c === ' ' ? ' ' : c}</span>)}</span>
              </span>
            )}
          </span>
        </label>
        <Button variant="primary" type="submit" className="cta-go">Ask<Ico d={ARROW} /></Button>
      </form>
      <p className="t-lead cta-note">Opens the live desk’s chat with your question, answered from the seeded graph.</p>
    </section>
  );
}

// The deploy schedules the dream nightly at this hour (DreamInput.first); change both together.
const DREAM_HOUR_IST = 2;
const IST = 5.5 * 3600_000;
function nextDream(now: number) {
  const d = new Date(now + IST); // IST wall clock, read through the UTC getters
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DREAM_HOUR_IST) - IST;
  return next > now ? next : next + 86_400_000;
}

/** Text Hover Effect port (aceternity.md §9): an outlined "mochi" whose stroke lights sky → ube → sakura around the
 *  cursor. Touch and reduced motion keep the still outline. */
function HoverWordmark() {
  const svg = useRef<SVGSVGElement>(null), txt = useRef<SVGTextElement>(null), spot = useRef<SVGRadialGradientElement>(null);
  const [b, setB] = useState({ x: 0, y: 0, w: 1000, h: 300 });
  useLayoutEffect(() => {
    // Crop to the ink, not the font's line box: the glyphs' real ascent/descent come from canvas measureText.
    const fit = () => {
      const el = txt.current, r = el?.getBBox(); if (!el || !r?.width) return;
      const cs = getComputedStyle(el), ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${cs.fontWeight} 240px ${cs.fontFamily}`;
      const m = ctx.measureText('mochi'), up = m.actualBoundingBoxAscent, down = m.actualBoundingBoxDescent;
      setB({ x: r.x - 4, y: -up - 4, w: r.width + 8, h: up + down + 8 });
    };
    fit(); document.fonts?.ready.then(fit);
  }, []);
  useEffect(() => {
    const el = svg.current, g = spot.current;
    if (!el || !g || still() || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let raf = 0, tx = 0, ty = 0, cx = 0, cy = 0;
    const tick = () => { // a short ease toward the cursor, like the original's mask transition
      cx += (tx - cx) * 0.22; cy += (ty - cy) * 0.22;
      g.setAttribute('cx', String(cx)); g.setAttribute('cy', String(cy));
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.5 ? requestAnimationFrame(tick) : 0;
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect(), vb = el.viewBox.baseVal;
      tx = vb.x + ((e.clientX - r.left) / r.width) * vb.width; ty = vb.y + ((e.clientY - r.top) / r.height) * vb.height;
      if (!el.dataset.lit) { cx = tx; cy = ty; el.dataset.lit = ''; }
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const leave = () => { delete el.dataset.lit; };
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); cancelAnimationFrame(raf); };
  }, []);
  const t = (cls: string, extra?: object) => <text x="0" y="0" fontSize="240" className={cls} vectorEffect="non-scaling-stroke" {...extra}>mochi</text>;
  return (
    <svg ref={svg} className="foot-wordmark" viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} aria-hidden="true">
      <defs>
        <linearGradient id="wm-ink" x1="0" x2="1" y1="0" y2="0"><stop offset="0" className="wm-s1" /><stop offset=".5" className="wm-s2" /><stop offset="1" className="wm-s3" /></linearGradient>
        <radialGradient id="wm-spot" ref={spot} gradientUnits="userSpaceOnUse" cx={b.x + b.w / 2} cy={b.y + b.h / 2} r={b.h * 0.75}>
          <stop offset="0" className="wm-m1" /><stop offset="1" className="wm-m0" />
        </radialGradient>
        <mask id="wm-mask" maskUnits="userSpaceOnUse" x={b.x} y={b.y} width={b.w} height={b.h}><rect x={b.x} y={b.y} width={b.w} height={b.h} fill="url(#wm-spot)" /></mask>
      </defs>
      {t('wm-base', { ref: txt })}
      {t('wm-lit', { mask: 'url(#wm-mask)' })}
    </svg>
  );
}

export function Footer() {
  const [now, setNow] = useState(() => Date.now()), ref = useRef<HTMLElement>(null);
  const dusk = { t: 19, clouds: 0.35 }; // the page's day ends at dusk
  useInView(ref, (v) => { if (v) want('footer', dusk); });
  useEffect(() => { want('footer', dusk); const iv = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(iv); }, []); // eslint-disable-line
  const left = Math.max(0, nextDream(now) - now), h = Math.floor(left / 3600_000), m = Math.floor((left % 3600_000) / 60_000);
  return (
    <footer className="site-foot wrap" ref={ref} data-sky="footer">
      <div className="foot-top">
        <div className="foot-lede">
          <p className="foot-dream t-lead"><Ico d={MOON} />
            <span>Next dream in <span className="t-data-strong"><Rolling value={`${h}h ${String(m).padStart(2, '0')}m`} /></span> · <span className="t-data">0{DREAM_HOUR_IST}:00 IST</span></span>
          </p>
          <p className="t-body foot-tag">A support desk where no ticket starts from zero.</p>
        </div>
        <nav className="foot-col" aria-labelledby="fc-product">
          <h3 id="fc-product" className="t-eyebrow">Product</h3>
          <a className="tlink t-label" href={LINKS.desk}>Open the platform</a>
          <a className="tlink t-label" href="#demo">Demo</a>
          {bench && <a className="tlink t-label" href="#bench">Benchmark</a>}
        </nav>
        <nav className="foot-col" aria-labelledby="fc-build">
          <h3 id="fc-build" className="t-eyebrow">Build</h3>
          <a className="tlink t-label" href={LINKS.repo}>GitHub</a>
          <a className="tlink t-label" href={LINKS.blog}>Decision log blog</a>
          <a className="tlink t-label" href={`${LINKS.repo}#readme`}>README</a>
        </nav>
      </div>
      <div className="foot-legal t-caption">
        <span>Synthetic data only. E Corp Securities is fictional.</span>
        <span>Built with Claude Code for Graph Hacks, October 2026.</span>
        <span>Effects adapted from Aceternity UI.</span>
      </div>
      <HoverWordmark />
    </footer>
  );
}
