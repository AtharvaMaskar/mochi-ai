// Stars, a constellation and shooting stars on one 2D canvas. Rewritten from the algorithm notes in
// docs/research/aceternity.md §3.1 and §5.1–5.2 (per-star phase, DPR-aware, dt-based speed, labelled streaks).
type Star = { x: number; y: number; r: number; phase: number; period: number };
type Streak = { x: number; y: number; vx: number; vy: number; life: number; dist: number; label: string };

// The constellation is the hero brief's path: Customer → Ticket → Issue → ProductArea → Team.
const CONST = [
  { x: 0.58, y: 0.16, label: 'Customer' }, { x: 0.66, y: 0.10, label: 'Ticket' }, { x: 0.75, y: 0.17, label: 'Issue' },
  { x: 0.83, y: 0.11, label: 'ProductArea' }, { x: 0.91, y: 0.19, label: 'Team' },
];

export type StarFrame = { light: string; warm: string; op: number; dawn: number; meteors: number; labels: string[]; constellation: number; motion: boolean; dt: number; now: number };

// font: a computed CSS font shorthand (from a .t-caption probe), so canvas text uses the page's type.
export function stars(canvas: HTMLCanvasElement, font: string) {
  const ctx = canvas.getContext('2d')!;
  let w = 0, h = 0, dpr = 1, field: Star[] = [], streaks: Streak[] = [], spawnIn = 0, labelAt = 0;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.ceil(w * dpr); canvas.height = Math.ceil(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(240, Math.floor(w * h * 0.00012));
    let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647); // seeded, so stills match
    field = Array.from({ length: n }, () => ({ x: rnd() * w, y: rnd() * h * 0.85, r: 0.5 + rnd() * 0.9, phase: rnd() * 6.28, period: 1.6 + rnd() * 1.6 }));
  }

  function spawn(f: StarFrame) {
    const label = f.labels.length ? f.labels[labelAt++ % f.labels.length] : '';
    const ang = Math.PI * (0.78 + Math.random() * 0.1); // down and to the left
    const speed = 520 + Math.random() * 260;
    streaks.push({ x: w * (0.45 + Math.random() * 0.6), y: -10 + Math.random() * h * 0.25, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: 0, dist: 0, label });
  }

  function draw(f: StarFrame) {
    ctx.clearRect(0, 0, w, h);
    const sec = f.now / 1000;
    if (f.op > 0.01) {
      const tint = f.dawn; // stars warm toward yuzu at dawn
      for (const st of field) {
        const tw = f.motion ? 0.55 + Math.abs(Math.sin(sec / st.period + st.phase)) * 0.45 : 0.8;
        ctx.globalAlpha = f.op * tw;
        ctx.fillStyle = tint > 0.5 ? f.warm : f.light;
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.283); ctx.fill();
      }
      if (f.constellation > 0.01) {
        const pts = CONST.map((p) => ({ x: p.x * w, y: p.y * h, label: p.label }));
        const k = f.constellation * (pts.length - 1);
        ctx.strokeStyle = f.light; ctx.lineWidth = 1;
        for (let i = 0; i < pts.length - 1; i++) {
          const seg = Math.max(0, Math.min(1, k - i));
          if (!seg) break;
          const a = pts[i], b = pts[i + 1], cx = (a.x + b.x) / 2, cy = Math.min(a.y, b.y) - 18;
          ctx.globalAlpha = 0.55 * f.op;
          ctx.beginPath(); ctx.moveTo(a.x, a.y);
          // draw a partial quadratic arc by sampling
          for (let s = 0.05; s <= seg + 1e-6; s += 0.05) {
            const x = (1 - s) * (1 - s) * a.x + 2 * (1 - s) * s * cx + s * s * b.x, y = (1 - s) * (1 - s) * a.y + 2 * (1 - s) * s * cy + s * s * b.y;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.font = font; ctx.fillStyle = f.light;
        pts.forEach((p, i) => {
          const on = Math.max(0, Math.min(1, k - i + 1));
          ctx.globalAlpha = f.op * (0.35 + 0.65 * on);
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, 6.283); ctx.fill();
          ctx.globalAlpha = f.op * 0.8 * on; ctx.fillText(p.label, p.x + 6, p.y - 6);
        });
      }
    }
    if (!f.motion) { streaks = []; ctx.globalAlpha = 1; return; }
    if (f.meteors > 0 && f.op > 0.3) {
      spawnIn -= f.dt;
      if (spawnIn <= 0 && streaks.length < 3) { spawn(f); spawnIn = 1 / f.meteors * (0.6 + Math.random() * 0.8); }
    }
    ctx.font = font;
    streaks = streaks.filter((s) => {
      s.x += s.vx * f.dt; s.y += s.vy * f.dt; s.dist += Math.hypot(s.vx, s.vy) * f.dt; s.life += f.dt;
      const len = Math.min(220, 12 * (1 + s.dist / 100));
      const sp = Math.hypot(s.vx, s.vy), tx = s.x - (s.vx / sp) * len, ty = s.y - (s.vy / sp) * len;
      const fade = s.life > 1.6 ? Math.max(0, 1 - (s.life - 1.6) / 0.6) : 1;
      // tail: eight segments fading toward the back
      ctx.strokeStyle = f.light; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (let k = 0; k < 8; k++) {
        const a0 = k / 8, a1 = (k + 1) / 8;
        ctx.globalAlpha = fade * f.op * a1 * a1;
        ctx.beginPath(); ctx.moveTo(tx + (s.x - tx) * a0, ty + (s.y - ty) * a0); ctx.lineTo(tx + (s.x - tx) * a1, ty + (s.y - ty) * a1); ctx.stroke();
      }
      if (s.label) { ctx.fillStyle = f.light; ctx.globalAlpha = fade * f.op * 0.95; ctx.fillText(s.label, s.x + 10, s.y + 4); }
      return fade > 0 && s.x > -400 && s.y < h + 40;
    });
    ctx.globalAlpha = 1;
  }
  return { resize, draw, busy: () => streaks.length > 0 };
}
