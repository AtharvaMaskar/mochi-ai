// Arm A: stuff everything into the prompt, truncated at the context limit minus a 4k answer reserve. The corpus is the
// system prompt, a stable prefix that is prompt-cached as a real deployment would (design decision 6); the question
// is the user turn. Its uncached cost is recorded beside it.
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
      const r = await ctx.llm.complete('arm_a', `Question: ${q.question}`, { system: `${ANSWER_SYSTEM}\n\nContext:\n${text}`, cache: true });
      return { answer: r.text, usage: r.usage, retrieval_ms, truncated };
    },
    async apply(e) { context += `\n${eventText(e)}`; return { usage: ZERO, ms: 0 }; },
  };
}
