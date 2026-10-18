// The one LLM wrapper (design decision 3). Every arm, the judge and the ablations call
// complete() here, so usage sums and the --max-usd guard cannot be bypassed.
import { createModels, type Api, type Model } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';

try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* no .env: use the real environment */ }

export type Usage = { input: number; output: number; cost: number };
export const ZERO: Usage = { input: 0, output: 0, cost: 0 };
export const add = (a: Usage, b: Usage): Usage => ({ input: a.input + b.input, output: a.output + b.output, cost: a.cost + b.cost });

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

export type CompleteOpts = { model?: string; system?: string; maxTokens?: number };
export type Llm = ReturnType<typeof createLlm>;

/** `reply` scripts the faux provider under --dry (default: a fixed string). */
export function createLlm(opts: { dry: boolean; maxUsd: number; reply?: (prompt: string, system: string) => string }) {
  const answerModel = env('MOCHI_MODEL');
  const judgeModel = env('MOCHI_JUDGE_MODEL');
  const models = createModels();
  const faux = opts.dry ? fauxProvider({ provider: 'anthropic', models: [{ id: answerModel }, { id: judgeModel }] }) : null;
  if (faux) models.setProvider(faux.provider);
  else { env('ANTHROPIC_API_KEY'); models.setProvider(anthropicProvider()); }
  const reply = opts.reply ?? (() => 'faux');

  const byCaller: Record<string, Usage> = {};
  let spent = 0;

  function record(caller: string, u: Usage) {
    byCaller[caller] = add(byCaller[caller] ?? ZERO, u);
    spent += u.cost;
    if (spent > opts.maxUsd) throw new CostCapError(`cost cap: spent $${spent.toFixed(4)} > --max-usd ${opts.maxUsd}`);
  }

  async function complete(caller: string, prompt: string, o: CompleteOpts = {}): Promise<{ text: string; usage: Usage }> {
    if (spent > opts.maxUsd) throw new CostCapError(`cost cap: spent $${spent.toFixed(4)} > --max-usd ${opts.maxUsd}`);
    const id = o.model ?? answerModel;
    const model = models.getModel('anthropic', id);
    if (!model) throw new Error(`model ${id} not available`);
    const system = o.system ?? '';
    faux?.appendResponses([() => fauxAssistantMessage(reply(prompt, system))]);
    // temperature 0 is requested; pi-ai drops it for models whose catalog says supportsTemperature:false.
    const msg = await models.complete(model, { systemPrompt: system, messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] },
      { temperature: 0, maxTokens: o.maxTokens ?? 4096 });
    if (msg.stopReason === 'error' || msg.stopReason === 'aborted') throw new Error(`${caller}: ${msg.errorMessage ?? msg.stopReason}`);
    const usage = { input: msg.usage.input + msg.usage.cacheRead + msg.usage.cacheWrite, output: msg.usage.output, cost: msg.usage.cost.total };
    record(caller, usage);
    const text = msg.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('').trim();
    return { text, usage };
  }

  return { dry: opts.dry, answerModel, judgeModel, complete, record, byCaller, spent: () => spent, model: (id = answerModel) => catalogModel(id) };
}
