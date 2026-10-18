// One Arm interface, one file per arm (design decision 1). The runner loops arms x questions.
import type { FalkorDB } from 'falkordb';
import type { Dataset, EvalQuestion, ContradictionEvent } from '@mochi/contracts';
import type { Llm, Usage } from '../llm.ts';

export type Arch = 'A' | 'B' | 'C' | 'D' | 'E';
export type Answer = { answer: string; usage: Usage; retrieval_ms: number; truncated?: boolean; reads?: number };
export type Arm = {
  arch: Arch;
  /** Builds the arm's memory from the dataset; returns ingestion tokens. */
  prepare(): Promise<Usage>;
  answer(q: EvalQuestion): Promise<Answer>;
  /** Replays one contradiction event into the arm's memory; returns maintenance tokens and write time. */
  apply(e: ContradictionEvent): Promise<{ usage: Usage; ms: number }>;
};

/** Graph names bench may create; `prefix` is `bench` for runs and `test_bench` for tests. */
export function names(prefix: string) {
  return {
    world: `${prefix}_world`, stale: `${prefix}_stale`, vectors: `${prefix}_vectors`, ingest: `${prefix}_ingest`, ingestPrev: `${prefix}_ingest_prev`,
    ingestScratch: `${prefix}_ingest_scratch`, ablation: `${prefix}_ablation`, ablationPrev: `${prefix}_ablation_prev`,
    ablationScratch: `${prefix}_ablation_scratch`, clusters: `${prefix}_clusters`, conc: `${prefix}_concurrency`,
    concPrev: `${prefix}_concurrency_prev`, concScratch: `${prefix}_concurrency_scratch`,
    user: (i: number) => (prefix === 'bench' ? `user_bench_${i}` : `${prefix}_user_${i}`),
  };
}
export type Names = ReturnType<typeof names>;

export type Ctx = { llm: Llm; db: FalkorDB; dataset: Dataset; names: Names; artifacts: string };

export const ANSWER_SYSTEM = 'You answer support questions about a fictional broker using only the context given. '
  + 'Reply with the answer only: an id, a name, a number, a version or yes/no where possible. No explanation.';

// Every record rendered as one line: identical information for arms A, B and C.
const iso = (_k: string, v: unknown) => (typeof v === 'number' && v > 1e12 ? new Date(v).toISOString().slice(0, 16) : v);
const KINDS = {
  customers: 'Customer', tickets: 'Ticket', issues: 'Issue', product_areas: 'ProductArea', teams: 'Team', agents: 'AgentUser',
  resolutions: 'Resolution', kb_articles: 'KBArticle', releases: 'Release', plans: 'Plan',
} as const;
export type Chunk = { label: (typeof KINDS)[keyof typeof KINDS]; id: string; text: string };

export function chunks(d: Dataset): Chunk[] {
  return Object.entries(KINDS).flatMap(([key, label]) =>
    (d[key as keyof typeof KINDS] as { id?: string; name?: string; version?: string }[]).map((x) => ({
      label, id: x.id ?? x.version ?? x.name ?? '', text: `${label} ${JSON.stringify(x, iso)}`,
    })));
}
export const eventText = (e: ContradictionEvent) => `Event ${JSON.stringify(e, iso)}`;
export const eventLabel = (e: ContradictionEvent): Chunk['label'] => (e.kind === 'plan_change' ? 'Customer' : 'Issue');
export const corpus = (d: Dataset) => chunks(d).map((r) => r.text).join('\n');

export const ask = (context: string, q: EvalQuestion) => `Context:\n${context}\n\nQuestion: ${q.question}`;

export async function timed<T>(f: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const v = await f();
  return [v, performance.now() - t0];
}
