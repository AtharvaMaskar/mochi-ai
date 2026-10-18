// Anthropic's published rates, checked 2026-10-18 (design decision 5). USD per 1M tokens. The only price source for
// cost_usd: pi-ai's catalog is cross-checked, never trusted (its Sonnet 5.5 cache-read rate differs, for one).
// Cache writes are 1.25x input (5-minute TTL) and Haiku cache reads 0.1x input: Anthropic's standard multipliers.
export type Rate = { input: number; output: number; cacheRead: number; cacheWrite: number };
type Price = Rate & { over?: { tokens: number } & Rate };

export const PRICES: Record<string, Price> = {
  'claude-haiku-5-5': {
    input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125,
    over: { tokens: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
  },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** The rate tier that applies to one call: the prompt size counts uncached, cache-read and cache-write tokens. */
export function rate(model: string, t: Tokens): Rate {
  const p = PRICES[model];
  if (!p) throw new Error(`no published price for ${model} in bench/prices.ts`);
  return p.over && t.input + t.cacheRead + t.cacheWrite > p.over.tokens ? p.over : p;
}

/** One call's cost, and what the same call would cost with no prompt caching (every prompt token at the input rate). */
export function price(model: string, t: Tokens): { cost: number; uncached: number } {
  const r = rate(model, t);
  const m = 1e-6;
  return {
    cost: (t.input * r.input + t.cacheRead * r.cacheRead + t.cacheWrite * r.cacheWrite + t.output * r.output) * m,
    uncached: ((t.input + t.cacheRead + t.cacheWrite) * r.input + t.output * r.output) * m,
  };
}
