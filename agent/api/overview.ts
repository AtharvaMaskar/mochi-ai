// Overview (counts with their stored query, dream status, latest morning report), the story list, and the dream's
// progress as server-sent events.
import type { ServerResponse } from 'node:http';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import type { Story } from '@mochi/contracts';
import { CYPHER, runStored, type Db } from '../queries/index.ts';
import type { Pi } from '../harness.ts';
import { StoryDoc } from '../story-doc.ts';
import { isDone, isReady, listTickets, ms, simNow } from './sim.ts';

const DAY = 86_400_000;
export const DREAM_STEPS = ['ingest', 'cluster', 'retire', 'mismatch', 'report'] as const;
// The dream's own hook names -> the UI step each one finishes (agent/dream/index.ts runs them in this order).
const DONE_ON: Record<string, (typeof DREAM_STEPS)[number]> = { ingest: 'ingest', clusters: 'cluster', rules: 'retire', suggestions: 'mismatch', report: 'report' };

export const dreamState = { running: false, last: null as null | { at: number; ms: number; story_id: string | null; ingested: number; retired: number; mismatches: number } };

export async function storyList(pi: Pi) {
  const all = (await pi.harness.snapshot(StoryDoc, ctx))?.stories ?? {};
  return Object.values(all).map((v) => v.at(-1) as unknown as Story)
    .map((s) => ({ id: s.id, title: s.title, version: s.version, generated_at: s.generated_at, generated_by: s.generated_by, topic: s.topic }))
    .sort((a, b) => b.generated_at - a.generated_at);
}

export async function overview(pi: Pi, db: Db) {
  const as_of = Date.now();
  const stories = await storyList(pi);
  const morning = stories.find((s) => s.generated_by === 'dream') ?? null;
  const q_1 = await runStored(db, pi.graph, CYPHER.deskCounts, { window_ms: DAY }, as_of);
  let desk: { ready: number; done: number } | { error: string };
  try {
    const [all, now] = await Promise.all([listTickets(), simNow()]);
    const day = (t: number) => new Date(t + 19_800_000).toISOString().slice(0, 10);
    desk = { ready: all.filter(isReady).length, done: all.filter((t) => isDone(t) && day(ms(t.updated_at)) === day(now)).length };
  } catch (e) { desk = { error: (e as Error).message }; }
  const every = Number(process.env.MOCHI_DREAM_EVERY_MS ?? DAY);
  const lastAt = dreamState.last?.at ?? morning?.generated_at ?? null;
  return {
    desk, queries: { q_1 },
    dream: { running: dreamState.running, last_run: lastAt, next_run: lastAt ? lastAt + every : null, last: dreamState.last },
    morning_report: morning,
  };
}

type Runner = (onStep: (name: string) => void) => Promise<Record<string, unknown>>;

/** Stream one dream run: a running/done event per UI step, then the report (or the failure). */
export async function streamDream(res: ServerResponse, run: Runner) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  let at = 0;
  send({ step: DREAM_STEPS[0], state: 'running' });
  dreamState.running = true;
  try {
    const report = await run((name) => {
      const step = DONE_ON[name];
      if (!step || DREAM_STEPS.indexOf(step) < at) return;
      send({ step, state: 'done' });
      at = DREAM_STEPS.indexOf(step) + 1;
      if (at < DREAM_STEPS.length) send({ step: DREAM_STEPS[at], state: 'running' });
    });
    const r = report as { as_of: number; ms: number; story_id: string | null; ingested: number; retired: number; mismatches: unknown[] };
    dreamState.last = { at: Date.now(), ms: r.ms, story_id: r.story_id, ingested: r.ingested, retired: r.retired, mismatches: r.mismatches.length };
    const { story: _s, ...rest } = report; // the story itself is served by /api/stories/:id
    send({ done: rest });
  } catch (e) {
    send({ step: DREAM_STEPS[Math.min(at, DREAM_STEPS.length - 1)], state: 'failed', error: (e as Error).message });
  } finally {
    dreamState.running = false;
    res.end();
  }
}
