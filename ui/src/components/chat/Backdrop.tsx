// The chat's atmosphere: a grain gradient and an 8x8 wave dither (Paper Shaders, Apache-2.0) in our tokens, behind
// everything. It follows Mochi: home = the full atmosphere on the greeting; working = half strength with the wave
// moving, only after a 600 ms wake so a fast answer never shows it; calm = an answer is on screen, a quiet still ground.
// Frozen (speed 0) when calm, when the tab is hidden, and under reduced motion.
import { useEffect, useState } from 'react';
import { Dithering, GrainGradient } from '@paper-design/shaders-react';

export type Mood = 'home' | 'working' | 'calm';

const IN = '600ms cubic-bezier(0.05, 0.7, 0.1, 1)';
const OUT = '900ms cubic-bezier(0.2, 0, 0, 1)';
const WAKE = '1500ms cubic-bezier(0.4, 0, 0.2, 1) 600ms';

/** `a` mixed toward `b` by t (0..1); both #rrggbb tokens. */
const mix = (a: string, b: string, t: number) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
const read = () => {
  const s = getComputedStyle(document.documentElement), v = (n: string) => s.getPropertyValue(n).trim();
  return { page: v('--bg-page'), sky: v('--agent-sky'), ube: v('--agent-ube') };
};

export function Backdrop({ mood }: { mood: Mood }) {
  const [t, setT] = useState(read);
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    // tokens change with the theme select (data-theme) and with the system scheme
    const again = () => setT(read());
    const mo = new MutationObserver(again);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', again);
    const vis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', vis);
    return () => { mo.disconnect(); mq.removeEventListener('change', again); document.removeEventListener('visibilitychange', vis); };
  }, []);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const moving = mood !== 'calm' && !hidden && !still;
  const dither = mood === 'home' ? 1 : mood === 'working' ? 0.5 : 0;
  const fade = (o: number, rise: string) => ({ opacity: o, transition: still ? 'none' : `opacity ${rise}` });
  return (
    <div className="mb-chat-backdrop" aria-hidden="true">
      <div className="mb-chat-backdrop-layer" style={fade(mood === 'calm' ? 0.55 : 1, mood === 'calm' ? OUT : IN)}>
        <GrainGradient style={{ position: 'absolute', inset: 0 }} colorBack={t.page}
          colors={[mix(t.page, t.sky, 0.22), mix(t.page, t.ube, 0.16), mix(t.page, t.sky, 0.1)]}
          softness={0.85} intensity={0.24} noise={0.12} shape="corners" speed={moving ? 0.22 : 0} />
      </div>
      <div className="mb-chat-backdrop-layer" style={fade(dither, mood === 'working' ? WAKE : dither ? IN : OUT)}>
        <Dithering style={{ position: 'absolute', inset: 0, opacity: 0.28 }} colorBack={`${t.page}00`} colorFront={t.sky}
          shape="wave" type="8x8" size={1.5} scale={0.9} speed={moving ? 0.3 : 0} />
      </div>
      {/* a paper wash under the reading column, so text on the ground keeps its contrast */}
      <div className="mb-chat-backdrop-layer mb-chat-backdrop-wash" />
    </div>
  );
}
