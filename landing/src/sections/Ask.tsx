// §3 Ask the brain: the headline is a real input. Typing finds the nearest recorded question; submitting
// dissolves the question into rising particles (aceternity placeholders-and-vanish, rewritten) and reveals
// the recorded answer. It never calls the model.
import { useMemo, useRef, useState } from 'react';
import { Mochi, type Mood } from '@mochi/ui/mochi';
import { demo, LINKS, type Ask as AskT } from '../data';
import { CardView } from '../parts/Card';
import { Reveal, still, useInView } from '../parts/ui';

const words = (s: string) => s.toLowerCase().replace(/[’']s\b/g, '').split(/[^a-z0-9-]+/).filter((w) => w.length > 1);
export function nearest(text: string): AskT | null {
  const ws = new Set(words(text));
  let best: AskT | null = null, score = 0;
  for (const a of demo.asks) {
    const keys = new Set([...a.keywords, ...words(a.ask)]);
    const s = [...ws].filter((w) => keys.has(w) || [...keys].some((k) => k.length > 3 && (k.startsWith(w) || w.startsWith(k)) && w.length > 2)).length;
    if (s > score) { score = s; best = a; }
  }
  return score > 0 ? best : null;
}

function vanish(input: HTMLInputElement, canvas: HTMLCanvasElement) {
  const r = input.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = r.width * dpr; canvas.height = r.height * 2 * dpr;
  const ctx = canvas.getContext('2d')!, cs = getComputedStyle(input);
  ctx.scale(dpr, dpr); ctx.font = cs.font; ctx.fillStyle = cs.color; ctx.textBaseline = 'middle';
  ctx.fillText(input.value, parseFloat(cs.paddingLeft) || 0, r.height * 1.5);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data, ps: { x: number; y: number; vx: number; vy: number; r: number }[] = [];
  for (let y = 0; y < canvas.height; y += 3) for (let x = 0; x < canvas.width; x += 3) if (img[(y * canvas.width + x) * 4 + 3] > 128) ps.push({ x: x / dpr, y: y / dpr, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 60, r: 1.2 });
  let t0 = performance.now(), last = t0;
  const loop = (now: number) => {
    const dt = (now - last) / 1000, k = (now - t0) / 900; last = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.globalAlpha = Math.max(0, 1 - k);
    for (const p of ps) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 30 * dt; ctx.fillRect(p.x, p.y, p.r, p.r); }
    if (k < 1) requestAnimationFrame(loop); else ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  requestAnimationFrame(loop);
}

export function Ask() {
  const [text, setText] = useState(demo.asks[0].ask), [shown, setShown] = useState<AskT | null>(demo.asks[0]), [missed, setMissed] = useState(''), [mood, setMood] = useState<Mood>('speaking'), [n, setN] = useState(0);
  const input = useRef<HTMLInputElement>(null), canvas = useRef<HTMLCanvasElement>(null), sec = useRef<HTMLElement>(null);
  const match = useMemo(() => nearest(text), [text]);
  useInView(sec);

  const submit = (q = text) => {
    const a = nearest(q);
    if (!still() && input.current && canvas.current && q.trim()) vanish(input.current, canvas.current);
    setShown(null); setMissed(''); setMood('thinking');
    setTimeout(() => {
      if (a) { setShown(a); setText(a.ask); setN((k) => k + 1); setMood('speaking'); } else { setMissed(q); setMood('curious'); }
    }, still() ? 0 : 650);
  };

  return (
    <section className="ask wrap" id="ask" data-sky="ask" ref={sec} aria-labelledby="ask-h">
      <h2 id="ask-h" className="sr">Ask the brain</h2>
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); submit(); }} data-ui>
        <label htmlFor="ask-in" className="sr">Ask the brain a question</label>
        <input id="ask-in" ref={input} className={`ask-in t-display-xl ${mood === 'thinking' ? 'gone' : ''}`} value={text} autoComplete="off" spellCheck={false}
          onChange={(e) => { setText(e.target.value); setMood('listening'); }} onBlur={() => setMood(shown ? 'speaking' : 'idle')} />
        <canvas className="ask-dust" ref={canvas} aria-hidden="true" />
      </form>
      <div className="ask-row">
        <p className="t-label ask-hint">
          <Mochi size="sm" mood={mood} />
          <span aria-live="polite">{mood === 'listening' ? (match ? <>Nearest recorded question: “{match.ask}” Press Enter.</> : 'No recorded question matches yet.') : mood === 'thinking' ? 'Reading the graph.' : 'Recorded from the seeded demo. Type, or pick one below.'}</span>
        </p>
      </div>
      <div className="ask-grid">
      <div className="ask-answer" aria-live="polite">
        {shown && (
          <div key={n}>
            <p className="t-noticed ask-say"><Reveal text={shown.answer} /></p>
            <div className="rise"><CardView card={shown.card} /></div>
          </div>
        )}
        {missed && (
          <p className="t-lead ask-miss">I only have recorded answers on this page. <a className="tlink" href={LINKS.chat(missed)}>Ask the live desk instead</a>.</p>
        )}
      </div>
      <ul className="ask-chips">
        {demo.asks.map((a) => (
          <li key={a.id}><button type="button" className="chip t-lead" onClick={() => { setText(a.ask); submit(a.ask); }}>{a.ask}</button></li>
        ))}
      </ul>
      </div>
    </section>
  );
}
