// Step 2 · ingest the day's tickets: closed-vocabulary LLM extraction, zod-pruned, one atomic
// UNWIND … MERGE per batch of 20 (no MULTI). Batch extraction is memoized so a resume never pays twice.
import { z } from 'zod';
import { AreaName, ResolutionKind } from '@mochi/contracts';
import { Q } from './cypher.ts';
import { norm, rows, runIdOf } from './rules.ts';
import type { Db, DreamModel, StepUsage } from './types.ts';

export const BATCH = 20;

export const Extraction = z.object({
  ticket_id: z.string().min(1),
  issue: z.string().trim().min(3).max(120),
  area: AreaName,
  resolution: z.object({ kind: ResolutionKind, summary: z.string().trim().min(3).max(240) }).optional(),
});
export type Extraction = z.infer<typeof Extraction>;

type Pending = { id: string; subject: string; body: string; status: string; issue_id: string | null; res_id: string | null };
type IssueRow = { id: string; name: string; area: string };
/** Memo with runtime.memo semantics: return the stored value for `key`, else compute and store it. */
export type Memo = <T>(key: string, compute: () => Promise<T>) => Promise<T>;
export type Hook = (step: string) => void | Promise<void>;

export function systemPrompt(issues: IssueRow[]): string {
  return [
    'You extract entities from customer-support tickets of a fictional stock broker into a closed vocabulary.',
    'Reply with JSON only, no prose: {"items":[{"ticket_id":string,"issue":string,"area":string,"resolution"?:{"kind":string,"summary":string}}]}.',
    `area must be one of: ${AreaName.options.join(', ')}.`,
    `resolution.kind must be one of: ${ResolutionKind.options.join(', ')}. Include resolution only for resolved or closed tickets.`,
    'issue is a short canonical issue class (e.g. "payment debited, order not placed"). Reuse an existing issue name when it fits:',
    ...issues.slice(0, 50).map((i) => `- ${i.name} [${i.area}]`),
  ].join('\n');
}

/** Parse model text into validated items; anything off-schema or for an unknown ticket is dropped. */
export function parseExtraction(text: string, ids: string[]): Extraction[] {
  const start = text.search(/[[{]/);
  let json: unknown;
  try { json = JSON.parse(text.slice(start, Math.max(text.lastIndexOf('}'), text.lastIndexOf(']')) + 1)); } catch { return []; }
  const items = Array.isArray(json) ? json : (json as any)?.items;
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  return items.flatMap((it) => {
    const r = Extraction.safeParse(it);
    if (!r.success || !ids.includes(r.data.ticket_id) || seen.has(r.data.ticket_id)) return [];
    seen.add(r.data.ticket_id);
    return [r.data];
  });
}

const slug = (s: string) => norm(s).replace(/ /g, '-').slice(0, 48);

export async function ingest(db: Db, graph: string, as_of: number, llm: DreamModel, opts: { memo: Memo; hook: Hook; usage: StepUsage }) {
  const run = runIdOf(as_of);
  const pendingRows = await rows<Pending>(db, graph, Q.pendingTickets, { as_of });
  const pending = new Map(pendingRows.map((t) => [t.id, t]));
  const issues = await rows<IssueRow>(db, graph, Q.issues);
  const byKey = new Map(issues.map((i) => [`${norm(i.name)}|${i.area}`, i]));
  const byId = new Map(issues.map((i) => [i.id, i]));
  const areas = new Set((await rows<{ name: string }>(db, graph, Q.areas)).map((a) => a.name));
  // The batch plan is fixed at the first attempt, so a resumed run reuses the same batch keys.
  const plan = await opts.memo('ingest:plan', async () => [...pending.keys()]);
  const batches: { id: string; size: number }[] = [];
  let dropped = 0, ingested = 0;

  for (let k = 0; k * BATCH < plan.length; k++) {
    const ids = plan.slice(k * BATCH, (k + 1) * BATCH);
    const todo = ids.filter((id) => pending.has(id));
    if (!todo.length) continue;
    const extracted = await opts.memo(`ingest:${ids[0]}:${ids.at(-1)}`, async () => {
      const tickets = ids.map((id) => pending.get(id)).filter(Boolean).map((t) => ({ id: t!.id, subject: t!.subject, body: t!.body, status: t!.status }));
      const msg = await llm.models.complete(llm.model, {
        systemPrompt: systemPrompt(issues),
        messages: [{ role: 'user', content: JSON.stringify(tickets), timestamp: Date.now() }],
      }, { maxTokens: 4096, thinkingEnabled: false } as any);
      opts.usage.input += msg.usage.input; opts.usage.output += msg.usage.output; opts.usage.calls++;
      const text = msg.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('');
      return parseExtraction(text, ids);
    });
    await opts.hook(`extracted:${k}`);
    // An enum area with no ProductArea node in the graph cannot be written: dropped, not half-written.
    const valid = extracted.filter((x) => pending.has(x.ticket_id) && areas.has(x.area));
    dropped += todo.length - valid.length;
    const out = valid.map((x) => {
      const t = pending.get(x.ticket_id)!;
      // A ticket that already has an Issue keeps it; otherwise match by normalised name + area, else a new Issue.
      const known = (t.issue_id && byId.get(t.issue_id)) || byKey.get(`${norm(x.issue)}|${x.area}`);
      const issue = known ?? { id: `I-${x.area}-${slug(x.issue)}`, name: x.issue, area: x.area };
      byKey.set(`${norm(issue.name)}|${issue.area}`, issue);
      const resolved = (t.status === 'resolved' || t.status === 'closed') && !t.res_id && x.resolution;
      return { ticket_id: t.id, issue_id: issue.id, issue_name: issue.name, area: issue.area,
        res_id: `RES-${t.id}`, res_kind: resolved ? x.resolution!.kind : '', res_summary: resolved ? x.resolution!.summary : '' };
    });
    if (!out.length) continue;
    const batch_id = `${run}:${k}`;
    const [{ written }] = await rows<{ written: number }>(db, graph, Q.ingestBatch, { rows: out, as_of, batch_id, batch_size: out.length });
    batches.push({ id: batch_id, size: out.length });
    ingested += written;
    for (const x of out) pending.delete(x.ticket_id);
    await opts.hook(`written:${k}`);
  }
  return { ingested, dropped, batches };
}
