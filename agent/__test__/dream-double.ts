// Test double for agent/dream/index.ts (the real one is owned by add-dream): a DreamTask that only sleeps.
import { defineTask } from '@earendil-works/pi-durable';

export const DreamTask = defineTask<{ every: number }, { phase: 'wait' }, null>({
  name: 'test.dream-double',
  version: 1,
  initial: () => ({ phase: 'wait' }),
  phases: { wait: async (_task, rt, c) => { await rt.sleep(rt.now() + 1e12, c); } },
  abort: (_t, rt, c) => rt.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), c),
});

export const calls: unknown[] = [];
export async function runDreamNow(args: Record<string, unknown>) {
  calls.push(args);
  return { ok: true, story_id: null };
}
