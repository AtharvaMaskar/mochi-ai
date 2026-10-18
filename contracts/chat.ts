// Chat contract (SPEC §4). Tool cards are emitted by tool code (never the model) as AG-UI
// activities; ui renders their blocks with the same components as story tags.
import { z } from 'zod';
import { StoredQuery, checkVisual, type Visual } from './story.ts';
import { L, E } from './graph.ts';

export const ACTIVITY = { card: 'mochi.card', html: 'mochi.html' } as const;

const qid = z.string().regex(/^q_\d+$/);
const NumRef = z.object({ query_id: qid, column: z.string(), value: z.string() });
export const VisualBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('kpi'), query_id: qid, label: z.string(), column: z.string(), unit: z.string().optional(), promised: z.number().optional(), bad: z.boolean().optional() }),
  z.object({ type: z.literal('bars'), query_id: qid, label: z.string(), x: z.string(), y: z.string(), trend: z.string().optional(), hot: z.string().optional() }),
  z.object({ type: z.literal('line'), query_id: qid, label: z.string(), x: z.string(), series: z.array(z.string()).min(1) }),
  z.object({ type: z.literal('table'), query_id: qid, label: z.string(), columns: z.array(z.string()).min(1) }),
  z.object({ type: z.literal('memdiff'), query_id: qid }),
  z.object({ type: z.literal('suggestion'), query_id: qid, tag: z.string(), edge: z.string(), actions: z.array(z.string()), text: z.string(), nums: z.array(NumRef) }),
]);

export const PathReceipt = z.object({
  query_id: qid,
  nodes: z.array(z.object({ id: z.string(), label: z.string(), name: z.string() })).min(1),
  edges: z.array(z.object({ type: z.string(), from: z.string(), to: z.string() })),
});
export type PathReceipt = z.infer<typeof PathReceipt>;

export const ToolCard = z.object({
  kind: z.enum(['briefing', 'likely_cause', 'who_knows', 'clusters', 'blast_radius', 'similar', 'query', 'algorithm']),
  title: z.string().min(1),
  queries: z.record(qid, StoredQuery),
  path: PathReceipt.nullable(),
  blocks: z.array(VisualBlock),
});
export type ToolCard = z.infer<typeof ToolCard>;

export function validateCard(input: unknown): { ok: true; value: ToolCard } | { ok: false; errors: string[] } {
  const r = ToolCard.safeParse(input);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const c = r.data;
  const errors: string[] = [];
  for (const [id, q] of Object.entries(c.queries)) if (!q.cypher.includes('$as_of')) errors.push(`${id}: stored query must take $as_of`);
  for (const b of c.blocks) errors.push(...checkVisual(b as Visual, c.queries));
  if (c.path) {
    if (!c.queries[c.path.query_id]) errors.push(`path: unknown query_id ${c.path.query_id}`);
    const ids = new Set(c.path.nodes.map((n) => n.id));
    for (const n of c.path.nodes) if (!(n.label in L)) errors.push(`path: unknown label ${n.label}`);
    for (const e of c.path.edges) {
      if (!(e.type in E)) errors.push(`path: unknown edge type ${e.type}`);
      for (const end of [e.from, e.to]) if (!ids.has(end)) errors.push(`path: edge ${e.type} endpoint ${end} is not a receipt node`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: c };
}
