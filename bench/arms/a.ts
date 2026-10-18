// Arm A: stuff everything into the prompt, truncated at the context limit minus a 4k answer reserve.
import { ZERO } from '../llm.ts';
import { ANSWER_SYSTEM, ask, corpus, eventText, timed, type Arm, type Ctx } from './index.ts';

const RESERVE = 4000;
// ponytail: 3 chars/token is a conservative pre-send estimate used only to decide where to cut;
// recorded tokens always come from provider usage.
const CHARS_PER_TOKEN = 3;

export function armA(ctx: Ctx, o: { limitTokens?: number } = {}): Arm {
  let context = '';
  return {
    arch: 'A',
    async prepare() { context = corpus(ctx.dataset); return ZERO; },
    async answer(q) {
      const [{ text, truncated }, retrieval_ms] = await timed(async () => {
        const limit = (o.limitTokens ?? ctx.llm.model().contextWindow) - RESERVE;
        const max = Math.max(0, limit * CHARS_PER_TOKEN - ask('', q).length);
        return context.length > max ? { text: context.slice(0, max), truncated: true } : { text: context, truncated: false };
      });
      const r = await ctx.llm.complete('arm_a', ask(text, q), { system: ANSWER_SYSTEM });
      return { answer: r.text, usage: r.usage, retrieval_ms, truncated };
    },
    async apply(e) { context += `\n${eventText(e)}`; return { usage: ZERO, ms: 0 }; },
  };
}
