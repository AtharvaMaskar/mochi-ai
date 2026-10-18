// Shared test setup: a harness on a temp SQLite file, the faux provider, and the fixture graph.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import type { Conversation, EntryRecord } from '@earendil-works/pi-durable';
import { openHarness, type HarnessConfig } from '../harness.ts';
import { userDb } from '../db.ts';
import { admin } from './load-fixture.ts';
import { embedStub } from './embed-stub.ts';

export { ctx };
export const tmpStore = () => join(mkdtempSync(join(tmpdir(), 'mochi-agent-')), 'pi.sqlite');

export async function openTestHarness(graph: string, team: string, extra: Partial<HarnessConfig> = {}) {
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] });
  const db = await admin();
  const pi = await openHarness({
    storage: tmpStore(), provider: faux.provider, model: { provider: faux.provider.name ?? 'faux', modelId: 'faux-1' },
    graph, embed: embedStub, caller: { user: 'A-1', team },
    dbs: { read: async () => db as never, write: async () => db as never, user: userDb as never },
    ...extra,
  });
  return { pi, faux, db, async close() { await pi.close(); await db.close(); } };
}

export async function entries(conv: Conversation): Promise<EntryRecord[]> {
  const out: EntryRecord[] = [];
  let cursor;
  do {
    const page = await conv.entries({ order: 'ascending' }, 200, cursor, ctx);
    out.push(...page.items);
    cursor = page.next;
  } while (cursor);
  return out;
}

/** Tool-result messages of a conversation, in order. */
export async function toolResults(conv: Conversation) {
  return (await entries(conv)).filter((e) => e.kind === 'pi.tool-result')
    .map((e) => e.model![0] as unknown as { toolName: string; isError: boolean; details?: unknown; content: { text?: string }[] });
}
