// The sky engine. One rAF loop for every layer; one value drives it all: --sky-t, the hour in IST (0–24).
// Four keyframed shades (dawn 06, day 08–17, dusk 19, night 21–04) are interpolated, never improvised per layer,
// and every colour is a design-system token mixed with paper. Layers, back to front: time-of-day gradient
// (also the no-WebGL fallback) → paper grain (WebGL, half res, night only) → dusk band → mood tint → dawn light
// → three cloud layers (pointer + scroll parallax; colour from the palette) → stars canvas (stars, the path
// constellation, labelled shooting stars). Pauses on hidden tabs; one still frame per state under reduced motion.
import { useEffect, useRef } from 'react';
import { sky, onSky, publishHour, CYCLE_S, type SkyWant } from './store';
import { paper } from './paper';
import { stars } from './stars';

type RGB = [number, number, number];
const hex = (v: string): RGB => { const h = v.trim().replace('#', ''); const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const css = (c: RGB) => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join(''); // computed from tokens
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lum = (c: RGB) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const wrap = (h: number) => ((h % 24) + 24) % 24;
const ramp = (h: number, a: number, b: number) => clamp((h - a) / (b - a));

function palette() {
  const s = getComputedStyle(document.documentElement), v = (n: string) => hex(s.getPropertyValue(n));
  const page = v('--bg-page'), ink = v('--ink'), skyC = v('--agent-sky'), ube = v('--agent-ube'), sakura = v('--agent-sakura'),
    yuzu = v('--agent-yuzu'), anzu = v('--agent-anzu'), white = v('--on-ink');
  // [top, middle, horizon, glow behind the frame, cloud]
  const night: RGB[] = [mix(ink, ube, 0.1), mix(ink, ube, 0.2), mix(ink, ube, 0.3), mix(ink, ube, 0.48), mix(ink, ube, 0.42)];
  const dawn: RGB[] = [page, mix(page, sakura, 0.08), mix(mix(page, sakura, 0.2), yuzu, 0.25), mix(page, yuzu, 0.22), mix(white, sakura, 0.1)];
  const day: RGB[] = [page, page, mix(page, skyC, 0.09), mix(page, skyC, 0.1), white];
  const dusk: RGB[] = [mix(ink, skyC, 0.42), mix(page, ube, 0.32), mix(page, anzu, 0.25), mix(page, anzu, 0.3), mix(page, anzu, 0.28)];
  const keys: [number, RGB[]][] = [[0, night], [4, night], [6, dawn], [8, day], [17, day], [19, dusk], [21, night], [24, night]];
  return { keys, light: s.getPropertyValue('--on-ink').trim(), warm: s.getPropertyValue('--agent-yuzu').trim() };
}
const at = (keys: [number, RGB[]][], h: number) => {
  let i = 0; while (i < keys.length - 2 && h > keys[i + 1][0]) i++;
  const [t0, a] = keys[i], [t1, b] = keys[i + 1], k = clamp((h - t0) / (t1 - t0));
  return a.map((c, j) => mix(c, b[j], k));
};
// How much of each phase is showing at hour h.
const phases = (h: number) => ({
  night: Math.max(1 - ramp(h, 4, 6), ramp(h, 19, 21)),
  stars: Math.max(1 - ramp(h, 5, 6.5), ramp(h, 18.5, 20.5)),
  dawn: Math.min(ramp(h, 4.5, 6), 1 - ramp(h, 7, 8.5)),
  dusk: Math.min(ramp(h, 17, 18.8), 1 - ramp(h, 19.5, 21)),
});

// Few, large, bright clouds in the lower 45% of the sky, behind and below the product frame.
const CLOUDS: { layer: 'far' | 'mid' | 'near'; l: number; t: number; w: number }[] = [
  { layer: 'far', l: 8, t: 58, w: 760 }, { layer: 'far', l: 58, t: 56, w: 820 },
  { layer: 'mid', l: 36, t: 68, w: 760 }, { layer: 'mid', l: 74, t: 64, w: 640 },
  { layer: 'near', l: -8, t: 80, w: 820 }, { layer: 'near', l: 50, t: 82, w: 900 }, { layer: 'near', l: 86, t: 74, w: 620 },
];

export function Sky() {
  const root = useRef<HTMLDivElement>(null), paperRef = useRef<HTMLCanvasElement>(null), starRef = useRef<HTMLCanvasElement>(null), probe = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = root.current!, docEl = document.documentElement, still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pal = palette();
    const gl = paper(paperRef.current!);
    el.dataset.webgl = gl ? 'on' : 'off';
    const st = stars(starRef.current!, getComputedStyle(probe.current!).font);
    const cur = { ...sky(), tintOp: 0 } as SkyWant & { tintOp: number };
    let tgt = sky(), raf = 0, last = performance.now(), lastNight = -1, lastStars = 0, lastPub = 0, mx = 0, my = 0, pmx = 0, pmy = 0, ms = 0;

    const write = () => {
      const h = wrap(cur.t), [c0, cm, c1, c2, cl] = at(pal.keys, h), ph = phases(h);
      const s = el.style;
      s.setProperty('--sky-t', h.toFixed(3));
      s.setProperty('--c0', css(c0)); s.setProperty('--cm', css(cm)); s.setProperty('--c1', css(c1)); s.setProperty('--c2', css(c2)); s.setProperty('--cloud', css(cl));
      s.setProperty('--clouds', cur.clouds.toFixed(3)); s.setProperty('--part', cur.part.toFixed(3));
      s.setProperty('--aurora', (ph.dusk * 0.85).toFixed(3)); s.setProperty('--dawn', ph.dawn.toFixed(3)); s.setProperty('--tint-op', cur.tintOp.toFixed(3));
      if (tgt.tint) s.setProperty('--tint', `var(${tgt.tint})`);
      // Text over the sky flips to light when the top of the sky is dark; shadows halve at night (landing.css).
      docEl.style.setProperty('--darkp', `${Math.round(clamp((0.62 - lum(c0)) / 0.3) * 100)}%`);
      docEl.style.setProperty('--nightp', ph.night.toFixed(3));
      return { h, ...ph };
    };
    const resize = () => { gl?.resize(); st.resize(); lastNight = -1; frame(performance.now(), true); };

    const frame = (now: number, force = false) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (tgt.cycle && !still) cur.t = wrap(cur.t + (dt * 24) / CYCLE_S); // the hero's compressed day
      else { const d = ((tgt.t - cur.t + 36) % 24) - 12; cur.t = wrap(cur.t + d * (still ? 1 : 1 - Math.exp(-dt * 2.6))); } // shortest way round the clock
      const k = still ? 1 : 1 - Math.exp(-dt * 2.6);
      cur.clouds += (tgt.clouds - cur.clouds) * k; cur.part += (tgt.part - cur.part) * k;
      cur.constellation += (tgt.constellation - cur.constellation) * (still ? 1 : 1 - Math.exp(-dt * 1.2));
      cur.tintOp += ((tgt.tint ? 0.55 : 0) - cur.tintOp) * k;
      pmx += (mx - pmx) * (1 - Math.exp(-dt * 4)); pmy += (my - pmy) * (1 - Math.exp(-dt * 4));
      el.style.setProperty('--mx', pmx.toFixed(3)); el.style.setProperty('--my', pmy.toFixed(3));
      const t0 = performance.now();
      const { h, night, stars: starsOp, dawn } = write();
      if (gl && (force || Math.abs(night - lastNight) > 0.05)) { gl.draw(night); lastNight = night; } // static grain, night only
      if (force || still || ((starsOp > 0.01 || st.busy()) && now - lastStars > 33)) { // stars capped at 30fps
        st.draw({ light: pal.light, warm: pal.warm, op: starsOp, dawn, meteors: tgt.cycle ? (h > 1 && h < 3.2 ? 0.8 : 0) : tgt.meteors, labels: tgt.labels, constellation: cur.constellation, motion: !still, dt: Math.max(dt, (now - lastStars) / 1000), now });
        lastStars = now;
      }
      if (force || now - lastPub > 200) { publishHour(h); lastPub = now; }
      ms = ms * 0.95 + (performance.now() - t0) * 0.05;
      (window as unknown as { __skyMs: number }).__skyMs = ms; // read by the verification run
    };
    const loop = (now: number) => { frame(now); raf = requestAnimationFrame(loop); };
    const start = () => { cancelAnimationFrame(raf); last = performance.now(); if (!still && !document.hidden) raf = requestAnimationFrame(loop); };
    const vis = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    const off = onSky(() => { tgt = sky(); if (still) frame(performance.now(), true); });
    const move = (e: PointerEvent) => { mx = (e.clientX / innerWidth) * 2 - 1; my = (e.clientY / innerHeight) * 2 - 1; };
    const scroll = () => el.style.setProperty('--sy', String(Math.min(scrollY, 2400)));

    resize(); scroll(); start();
    addEventListener('resize', resize); addEventListener('scroll', scroll, { passive: true });
    if (!still) addEventListener('pointermove', move, { passive: true });
    document.addEventListener('visibilitychange', vis);
    return () => { cancelAnimationFrame(raf); off(); removeEventListener('resize', resize); removeEventListener('scroll', scroll); removeEventListener('pointermove', move); document.removeEventListener('visibilitychange', vis); };
  }, []);

  return (
    <div className="sky" ref={root} aria-hidden="true">
      <div className="sky-grad" />
      <canvas className="sky-paper" ref={paperRef} />
      <div className="sky-aurora" />
      <div className="sky-tint" />
      <div className="sky-dawn"><i /><i /><b /></div>
      {(['far', 'mid', 'near'] as const).map((layer) => (
        <div key={layer} className={`sky-layer ${layer}`}>
          <div className="sky-drift">
            {CLOUDS.filter((c) => c.layer === layer).map((c, i) => (
              <div key={i} className={`cloud ${c.l > 45 ? 'r' : 'l'}`} style={{ left: `${c.l}%`, top: `${c.t}%`, ['--w' as string]: `${c.w}px` }}><i /><i /><i /><i /><i /></div>
            ))}
          </div>
        </div>
      ))}
      <canvas className="sky-stars" ref={starRef} />
      <span className="t-caption sky-probe" ref={probe} />
    </div>
  );
}
