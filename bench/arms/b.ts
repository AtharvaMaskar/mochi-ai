// Arm B: vector top-k=8 over FalkorDB's vector index (bench_vectors graph). Retrieval ignores edges.
import { embed, EMBED_DIM } from '../deps.ts';
import { ZERO } from '../llm.ts';
import { VECTOR_LABELS, VECTOR_QUERY, vectorIndex, vectorInsert } from '../cypher.ts';
import { ANSWER_SYSTEM, ask, chunks, eventLabel, eventText, timed, type Arm, type Chunk, type Ctx } from './index.ts';

export const K = 8;

export function armB(ctx: Ctx): Arm & { retrieve(text: string): Promise<string[]> } {
  const g = ctx.db.selectGraph(ctx.names.vectors);
  let seq = 0;

  async function insert(cs: Chunk[]) {
    const vs = await embed(cs.map((c) => c.text));
    for (const label of VECTOR_LABELS) {
      const rows = cs.flatMap((c, i) => (c.label === label ? [{ id: `${c.id}#${seq++}`, text: c.text, v: vs[i] }] : []));
      if (rows.length) await g.query(vectorInsert(label), { params: { rows } });
    }
  }

  async function retrieve(text: string): Promise<string[]> {
    const [v] = await embed([text]);
    const hits = (await Promise.all(VECTOR_LABELS.map(async (label) =>
      (await g.roQuery<{ text: string; score: number }>(VECTOR_QUERY, { params: { label, k: K, v } })).data ?? []))).flat();
    return hits.sort((a, b) => a.score - b.score).slice(0, K).map((h) => h.text);
  }

  return {
    arch: 'B',
    async prepare() {
      await g.delete().catch(() => {});
      for (const label of VECTOR_LABELS) await g.query(vectorIndex(label, EMBED_DIM));
      await insert(chunks(ctx.dataset));
      return ZERO; // embeddings are local (gen's embed), no LLM tokens
    },
    async answer(q) {
      const [hits, retrieval_ms] = await timed(() => retrieve(q.question));
      const r = await ctx.llm.complete('arm_b', ask(hits.join('\n'), q), { system: ANSWER_SYSTEM });
      return { answer: r.text, usage: r.usage, retrieval_ms };
    },
    async apply(e) {
      const id = e.kind === 'plan_change' ? e.customer_id : e.issue_id;
      const [, ms] = await timed(() => insert([{ label: eventLabel(e), id, text: eventText(e) }]));
      return { usage: ZERO, ms };
    },
    retrieve,
  };
}
