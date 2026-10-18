// Seeded PRNG (mulberry32). The generator never touches Math.random or the clock.
export type Rng = ReturnType<typeof rng>;

export function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)); // inclusive
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const weighted = <T>(pairs: readonly (readonly [T, number])[]): T => {
    let r = next() * pairs.reduce((s, [, w]) => s + w, 0);
    for (const [x, w] of pairs) if ((r -= w) < 0) return x;
    return pairs[pairs.length - 1][0];
  };
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  return { next, int, pick, weighted, shuffle };
}
