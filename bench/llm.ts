// The one LLM wrapper (design decision 3). Every arm, the judge and the ablations call
// complete() here, so usage sums and the --max-usd guard cannot be bypassed.
import { createModels, type Api, type AssistantMessage, type Context, type Model, type ToolCall } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { price } from './prices.ts';

try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* no .env: use the real environment */ }

/** cost is bench/prices.ts x provider usage; uncached is the same call with no prompt caching (missing = cost). */
export type Usage = { input: number; output: number; cost: number; uncached?: number };
export const ZERO: Usage = { input: 0, output: 0, cost: 0, uncached: 0 };
export const add = (a: Usage, b: Usage): Usage =>
  ({ input: a.input + b.input, output: a.output + b.output, cost: a.cost + b.cost, uncached: (a.uncached ?? a.cost) + (b.uncached ?? b.cost) });

export class CostCapError extends Error {}

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name} (see .env.example)`);
  return v;
}

// Catalog lookup only (prices, context window); never calls the provider.
const catalog = createModels();
catalog.setProvider(anthropicProvider());
export function catalogModel(id: string): Model<Api> {
  const m = catalog.getModel('anthropic', id);
  if (!m) throw new Error(`model ${id} is not in the pi-ai anthropic catalog`);
  return m;
}

/** cache: mark the system prompt and last user turn for prompt caching (arm A's stable corpus). Off by default. */
export type CompleteOpts = { model?: string; system?: string; maxTokens?: number; cache?: boolean };
export type Llm = ReturnType<typeof createLlm>;

/** Scripts the faux provider under --dry: a text reply, or tool calls. */
export type Reply = (prompt: string, system: string) => string | ToolCall[];

/** `reply` scripts the faux provider under --dry (default: a fixed string). */
export function createLlm(opts: { dry: boolean; maxUsd: number; reply?: Reply; models?: string[] }) {
  const defaultModel = env('MOCHI_MODEL');
  let answerModel = defaultModel;
  const judgeModel = env('MOCHI_JUDGE_MODEL');
  const models = createModels();
  const ids = [...new Set([defaultModel, judgeModel, ...(opts.models ?? [])])];
  const faux = opts.dry ? fauxProvider({ provider: 'anthropic', models: ids.map((id) => ({ id })) }) : null;
  if (faux) models.setProvider(faux.provider);
  else { env('ANTHROPIC_API_KEY'); models.setProvider(anthropicProvider()); }
  const reply = opts.reply ?? (() => 'faux');

  const byCaller: Record<string, Usage> = {};
  let spent = 0, piCost = 0;
  const cacheByCaller: Record<string, { read: number; write: number }> = {};

  function record(caller: string, u: Usage) {
    byCaller[caller] = add(byCaller[caller] ?? ZERO, u);
    spent += u.cost;
    if (spent > opts.maxUsd) throw new CostCapError(`cost cap: spent $${spent.toFixed(4)} > --max-usd ${opts.maxUsd}`);
  }

  /** One provider call on a full context (messages, tools); usage is recorded under `caller`. */
  async function turn(caller: string, context: Context, o: { model?: string; maxTokens?: number; cache?: boolean } = {}): Promise<{ msg: AssistantMessage; usage: Usage }> {
    if (spent > opts.maxUsd) throw new CostCapError(`cost cap: spent $${spent.toFixed(4)} > --max-usd ${opts.maxUsd}`);
    const id = o.model ?? answerModel;
    const model = models.getModel('anthropic', id);
    if (!model) throw new Error(`model ${id} not available`);
    const last = context.messages.at(-1) as { content?: unknown } | undefined;
    const prompt = typeof last?.content === 'string' ? last.content : (last?.content as { text?: string }[] ?? []).map((c) => c.text ?? '').join('');
    faux?.appendResponses([() => {
      const r = reply(prompt, context.systemPrompt ?? '');
      return typeof r === 'string' ? fauxAssistantMessage(r) : fauxAssistantMessage(r, { stopReason: 'toolUse' });
    }]);
    // temperature 0 is requested; pi-ai drops it for models whose catalog says supportsTemperature:false.
    // Thinking off for every caller, as the dream does: pi-ai otherwise sends adaptive thinking to managed-effort
    // models, which drops temperature 0 and can spend the whole maxTokens budget before any answer text.
    // pi-ai caches by default ("short"); bench opts in per call so only arm A pays cache writes (design decision 6).
    const msg = await models.complete(model, context,
      { temperature: 0, maxTokens: o.maxTokens ?? 4096, thinkingEnabled: false, cacheRetention: o.cache ? 'short' : 'none' } as { temperature: number; maxTokens: number });
    if (msg.stopReason === 'error' || msg.stopReason === 'aborted') throw new Error(`${caller}: ${msg.errorMessage ?? msg.stopReason}`);
    const u = msg.usage;
    const p = price(id, u);
    piCost += u.cost.total; // cross-check only, written to usage.json
    const c = (cacheByCaller[caller] ??= { read: 0, write: 0 });
    c.read += u.cacheRead; c.write += u.cacheWrite;
    const usage = { input: u.input + u.cacheRead + u.cacheWrite, output: u.output, cost: p.cost, uncached: p.uncached };
    record(caller, usage);
    return { msg, usage };
  }

  async function complete(caller: string, prompt: string, o: CompleteOpts = {}): Promise<{ text: string; usage: Usage }> {
    const { msg, usage } = await turn(caller, { systemPrompt: o.system ?? '', messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] }, o);
    const text = msg.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('').trim();
    return { text, usage };
  }

  return {
    dry: opts.dry, defaultModel, judgeModel, complete, turn, record, byCaller, cacheByCaller, spent: () => spent, piCost: () => piCost,
    /** The model the arms answer with; --models switches it between sweeps. */
    get answerModel() { return answerModel; },
    use(id: string) { answerModel = id; },
    model: (id = answerModel) => catalogModel(id),
  };
}
