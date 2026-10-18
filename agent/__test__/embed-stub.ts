// Deterministic stand-in for @mochi/gen's embed(): a 4-dim hashed bag of words, L2-normalised. Same words -> same vector.
export const STUB_DIM = 4;

export async function embedStub(texts: string[]): Promise<number[][]> {
  return texts.map((t) => {
    const v = new Array(STUB_DIM).fill(0);
    for (const w of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let h = 0;
      for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      v[h % STUB_DIM] += 1;
    }
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  });
}
