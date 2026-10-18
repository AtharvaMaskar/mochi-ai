// Main run: arms x eval questions -> records, summary, ingestion. Questions tied to an event are
// asked after every arm has replayed the events (the JSON ground truth has them applied).
import type { Eval, Results } from '@mochi/contracts';
import type { Arm } from '../arms/index.ts';
import { score, type Vote } from '../score.ts';
import type { Llm } from '../llm.ts';

type Rec = Results['records'][number];

export const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

export function summarize(records: Rec[]): Results['summary'] {
  const out: Results['summary'] = {};
  for (const r of records) {
    const arm = (out[r.arch] ??= {});
    if (arm[r.bucket]) continue;
    const rs = records.filter((x) => x.arch === r.arch && x.bucket === r.bucket);
    const ms = rs.map((x) => x.retrieval_ms);
    arm[r.bucket] = {
      accuracy: rs.filter((x) => x.correct).length / rs.length,
      mean_input_tokens: rs.reduce((s, x) => s + x.input_tokens, 0) / rs.length,
      p50_ms: pct(ms, 50), p95_ms: pct(ms, 95),
    };
  }
  return out;
}

export async function runMain(o: { llm: Llm; arms: Arm[]; eval: Eval; events: Parameters<Arm['apply']>[0][]; votes: Vote[] }):
  Promise<Pick<Results, 'records' | 'summary' | 'ingestion'>> {
  const records: Rec[] = [], ingestion: Results['ingestion'] = [];
  const pre = o.eval.questions.filter((q) => !q.after_event), post = o.eval.questions.filter((q) => q.after_event);
  for (const arm of o.arms) {
    const u = await arm.prepare();
    ingestion.push({ arch: arm.arch, tokens: u.input + u.output });
    const ask = async (qs: typeof pre) => {
      for (const q of qs) {
        const a = await arm.answer(q);
        records.push({
          arch: arm.arch, question_id: q.id, bucket: q.bucket, input_tokens: a.usage.input, output_tokens: a.usage.output,
          retrieval_ms: Math.round(a.retrieval_ms * 100) / 100, answer: a.answer, correct: await score(o.llm, q, arm.arch, a.answer, o.votes),
          ...(a.truncated !== undefined ? { truncated: a.truncated } : {}),
        });
      }
    };
    await ask(pre);
    if (post.length) for (const e of [...o.events].sort((a, b) => a.at - b.at)) await arm.apply(e);
    await ask(post);
  }
  return { records, summary: summarize(records), ingestion };
}
