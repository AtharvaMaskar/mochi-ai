// Staleness run: from a fresh load (the world before the events), replay each contradiction event
// through C (LLM rewrite, tokens counted) and D (applyEvent, no LLM), then ask that event's question.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Dataset, Eval, Results } from '@mochi/contracts';
import type { Arm } from '../arms/index.ts';
import { score, type Vote } from '../score.ts';
import type { Llm } from '../llm.ts';

export async function runStaleness(o: { llm: Llm; arms: Arm[]; dataset: Dataset; eval: Eval; votes: Vote[]; artifacts: string }):
  Promise<Pick<Results, 'staleness'>> {
  const staleness: Results['staleness'] = [], writes: { event_id: string; arch: string; ms: number }[] = [];
  for (const arm of o.arms) {
    await arm.prepare(); // C: a fresh dream pass; D: loadDataset(..., {fresh: true})
    for (const e of [...o.dataset.contradiction_events].sort((a, b) => a.at - b.at)) {
      const m = await arm.apply(e);
      writes.push({ event_id: e.id, arch: arm.arch, ms: Math.round(m.ms * 100) / 100 });
      const q = o.eval.questions.find((x) => x.after_event === e.id);
      // No question tied to the event: nothing can show the fresh answer, so it is not counted as fresh.
      const fresh = q ? await score(o.llm, q, arm.arch, (await arm.answer(q)).answer, o.votes) : false;
      staleness.push({ event_id: e.id, arch: arm.arch, maintenance_tokens: m.usage.input + m.usage.output, answer_fresh: fresh });
    }
  }
  writeFileSync(join(o.artifacts, 'staleness.json'), JSON.stringify({ writes }, null, 2));
  return { staleness };
}
