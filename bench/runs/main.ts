// Main run: arms x models x eval questions -> records, per_task, summary, ingestion. Questions tied to an event are
// asked after every arm has replayed the events (the JSON ground truth has them applied). Each arm builds its memory
// once, on the first model; only the answering model changes across the sweep (design decision 3). summary and
// ingestion are the first model's.
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

/** Headline (SPEC §3): per task, per model x arch, accuracy beside cost and end-to-end latency. */
export function perTask(records: Rec[]): NonNullable<Results['per_task']> {
  const groups = Map.groupBy(records, (r) => `${r.model_id}\u0000${r.arch}`);
  return [...groups.values()].map((rs) => {
    const cost = rs.reduce((s, r) => s + (r.cost_usd ?? 0), 0), ms = rs.map((r) => r.total_ms ?? 0);
    return {
      model_id: rs[0].model_id ?? '', arch: rs[0].arch, n: rs.length, accuracy: rs.filter((r) => r.correct).length / rs.length,
      cost_usd_mean: cost / rs.length, cost_usd_total: cost, p50_ms: pct(ms, 50), p95_ms: pct(ms, 95),
    };
  });
}

/** What each task would have cost without prompt caching (arm A caches its corpus): an artifact column, never hidden. */
export type CostRow = { model_id: string; arch: string; question_id: string; cost_usd: number; cost_usd_uncached: number };

export async function runMain(o: {
  llm: Llm; arms: Arm[]; eval: Eval; events: Parameters<Arm['apply']>[0][]; votes: Vote[]; models?: string[]; costs?: CostRow[]; sink?: Rec[];
}): Promise<Pick<Results, 'records' | 'per_task' | 'summary' | 'ingestion'>> {
  const records: Rec[] = [], ingestion: Results['ingestion'] = [];
  const models = o.models ?? [o.llm.answerModel];
  const pre = o.eval.questions.filter((q) => !q.after_event), post = o.eval.questions.filter((q) => q.after_event);
  for (const arm of o.arms) {
    const u = await arm.prepare();
    ingestion.push({ arch: arm.arch, tokens: u.input + u.output });
    const ask = async (qs: typeof pre) => {
      for (const model_id of models) for (const q of qs) {
        o.llm.use(model_id);
        const t0 = performance.now();
        const a = await arm.answer(q);
        const total_ms = Math.round((performance.now() - t0) * 100) / 100;
        o.costs?.push({ model_id, arch: arm.arch, question_id: q.id, cost_usd: a.usage.cost, cost_usd_uncached: a.usage.uncached ?? a.usage.cost });
        const rec: Rec = {
          model_id, cost_usd: a.usage.cost, total_ms,
          arch: arm.arch, question_id: q.id, bucket: q.bucket, input_tokens: a.usage.input, output_tokens: a.usage.output,
          retrieval_ms: Math.round(a.retrieval_ms * 100) / 100, answer: a.answer, correct: await score(o.llm, q, models.length > 1 ? `${arm.arch}:${model_id}` : arm.arch, a.answer, o.votes),
          ...(a.truncated !== undefined ? { truncated: a.truncated } : {}),
        };
        records.push(rec);
        o.sink?.push(rec); // survives a cost-cap abort mid-arm
      }
      o.llm.use(models[0]);
    };
    await ask(pre);
    if (post.length) for (const e of [...o.events].sort((a, b) => a.at - b.at)) await arm.apply(e);
    await ask(post);
    console.log(`bench: main arm ${arm.arch} done ($${o.llm.spent().toFixed(4)} so far)`);
  }
  return { records, per_task: perTask(records), summary: summarize(records.filter((r) => r.model_id === models[0])), ingestion };
}
