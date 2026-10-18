// §4 Demo video in a container-scroll card (aceternity.md §3.9: rotateX 20° → 0, scale 1.05 → 1, title −100px),
// continuing the hero desk's settle. public/demo.mp4 drops in later; until then the poster is a real fragment.
import { useEffect, useRef, useState } from 'react';
import { Mochi } from '@mochi/ui/mochi';
import { demo } from '../data';
import { useInView } from '../parts/ui';

// Keep in step with public/chapters.vtt.
export const CHAPTERS = [
  { id: 'problem', label: 'Problem', at: 0, line: 'Every ticket starts from zero today.' },
  { id: 'briefing', label: 'Briefing', at: 48, line: 'A brief waiting on the ticket: likely cause and the fix that worked.' },
  { id: 'receipts', label: 'Receipts', at: 61, line: 'The path it walked, and the Cypher behind a number.' },
  { id: 'draft', label: 'Draft', at: 72, line: 'Mochi drafts the reply from the fix; you claim and work the steps.' },
  { id: 'dream', label: 'Dream', at: 81, line: 'The morning report: retired facts, KB-07 against practice, clusters.' },
  { id: 'chat', label: 'Chat', at: 114, line: 'Who knows this issue, and a graph algorithm as a tool.' },
  { id: 'bench', label: 'Benchmark', at: 158, line: 'Five memory designs, the same questions.' },
];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function Demo() {
  const sec = useRef<HTMLElement>(null), video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading'), [chapter, setChapter] = useState<string | null>(null), [ripple, setRipple] = useState(0);
  useInView(sec);

  useEffect(() => {
    const el = sec.current!;
    let raf = 0;
    const update = () => { raf = 0; const r = el.getBoundingClientRect(); el.style.setProperty('--p', Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight * 0.9))).toFixed(4)); };
    const on = () => { if (!raf) raf = requestAnimationFrame(update); };
    update(); addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);

  const seek = (c: (typeof CHAPTERS)[number]) => {
    setChapter(c.id); setRipple((n) => n + 1);
    const v = video.current;
    if (v && state === 'ready') { v.currentTime = c.at; void v.play().catch(() => {}); }
  };

  return (
    <section className="demo" id="demo" data-sky="demo" ref={sec} aria-labelledby="demo-h">
      <div className="wrap demo-title"><h2 id="demo-h" className="t-display">Three minutes, no slides.</h2></div>
      <div className="demo-persp">
        <div className="demo-card">
          <div className="demo-screen">
            <video ref={video} src="/demo.mp4" preload="metadata" controls={state === 'ready'} playsInline
              onLoadedMetadata={() => setState('ready')} onError={() => setState('missing')} aria-label="Mochi demo video">
              <track kind="chapters" src="/chapters.vtt" srcLang="en" label="Chapters" default />
            </video>
            {state !== 'ready' && <Poster missing={state === 'missing'} />}
          </div>
        </div>
      </div>
      <div className="wrap">
        <ol className="chapters" aria-label="Chapters">
          {CHAPTERS.map((c) => (
            <li key={c.id}>
              <button type="button" className={`chap ${chapter === c.id ? 'on' : ''}`} onClick={() => seek(c)} aria-describedby={`chap-${c.id}`}>
                <span className="chap-dot" aria-hidden="true">{chapter === c.id && <i key={ripple} />}</span>
                <span className="t-headline">{c.label}</span><span className="t-data">{mmss(c.at)}</span>
              </button>
              <span className="chap-tip t-label" id={`chap-${c.id}`} role="tooltip">{c.line}</span>
            </li>
          ))}
        </ol>
        {state === 'missing' && chapter && <p className="t-label demo-note" aria-live="polite">Video coming. This chapter starts at <span className="t-data">{mmss(CHAPTERS.find((c) => c.id === chapter)!.at)}</span>.</p>}
      </div>
    </section>
  );
}

/** Poster: a frame of the product itself, the morning report as Mochi writes it at dawn. */
function Poster({ missing }: { missing: boolean }) {
  const retired = demo.night.retired.slice(0, 3);
  return (
    <div className="poster" data-ui>
      <div className="poster-head">
        <Mochi size="sm" mood={missing ? 'sorry' : 'idle'} label={missing ? 'Mochi, sorry: the video is not here yet' : 'Mochi'} />
        <span className="t-title">What I learned overnight</span>
      </div>
      <ul className="poster-list">
        {retired.map((r) => <li key={r.event} className="t-body"><s>{r.label}</s> <span className="md-new">{r.now}</span></li>)}
      </ul>
      <p className="poster-tag t-label">{missing ? 'Video coming.' : 'Loading the video.'}</p>
    </div>
  );
}
