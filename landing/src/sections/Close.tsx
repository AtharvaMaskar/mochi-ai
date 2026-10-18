// §9–12: built for, FAQ, the sentence-with-a-blank CTA, and the tile footer with the live dream countdown.
import { useEffect, useRef, useState } from 'react';
import { Mochi } from '@mochi/ui/mochi';
import { LINKS } from '../data';
import { Rolling, useInView } from '../parts/ui';
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

export function Cta() {
  const [q, setQ] = useState(''), [typing, setTyping] = useState(false);
  return (
    <section className="cta wrap" id="cta" data-sky="cta" aria-labelledby="cta-h">
      <h2 id="cta-h" className="sr">Ask the brain</h2>
      <form className="cta-form t-display" onSubmit={(e) => { e.preventDefault(); if (q.trim()) location.href = LINKS.chat(q.trim()); }}>
        <span className="cta-mochi"><Mochi size="md" mood={typing ? 'listening' : 'idle'} tone="mood" /></span>
        <span>Ask the brain about</span>{' '}
        <label htmlFor="cta-in" className="sr">Your question</label>
        <input id="cta-in" className="cta-in" placeholder="refunds" value={q} autoComplete="off"
          onChange={(e) => setQ(e.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} />{' '}
        <button type="submit" className="cta-go">now</button>
      </form>
      <p className="t-lead cta-note">Opens the live desk’s chat with your question. The live desk answers from the seeded graph.</p>
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

export function Footer() {
  const [now, setNow] = useState(() => Date.now()), ref = useRef<HTMLElement>(null);
  useInView(ref, (v) => { if (v) want('footer', { t: 19, clouds: 0.6 }); });
  useEffect(() => { want('footer', { t: 19, clouds: 0.6 }); const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);
  const left = Math.max(0, nextDream(now) - now), h = Math.floor(left / 3600_000), m = Math.floor((left % 3600_000) / 60_000), s = Math.floor((left % 60_000) / 1000);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  return (
    <footer className="foot-board" ref={ref} data-sky="footer">
      <div className="tile t-word">
        <span className="t-display-xl wordmark-xl">mochi</span>
        <span className="tile-mochi"><Mochi size="lg" mood="idle" tone="mood" label="Mochi. Tap to squish." /></span>
      </div>
      <div className="tile t-dream">
        <span className="t-lead">Next dream in</span>
        <span className="t-display countdown" aria-live="off"><Rolling value={`${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`} /></span>
        <span className="t-label">It is <span className="t-data-strong">{time}</span> in India. The dream runs nightly at <span className="t-data">0{DREAM_HOUR_IST}:00</span> IST.</span>
      </div>
      <nav className="tile t-links" aria-label="Elsewhere">
        <a className="tlink t-lead" href={LINKS.repo}>Code on GitHub</a>
        <a className="tlink t-lead" href={LINKS.blog}>The decision log</a>
        <a className="tlink t-lead" href={LINKS.video}>Demo video</a>
        <a className="tlink t-lead" href={`${LINKS.repo}#readme`}>README and licence</a>
      </nav>
      <div className="tile t-credits">
        <p className="t-body">Synthetic data only. E Corp Securities is fictional.</p>
        <p className="t-body">Effects adapted from patterns by Aceternity UI. Paper grain ported from our blog’s shader.</p>
        <p className="t-body">Built with Claude Code for Graph Hacks, October 2026.</p>
      </div>
    </footer>
  );
}
