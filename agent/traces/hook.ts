// The harness side of decision traces, on only with MOCHI_TRACES=on. Before the first model request of a run it
// looks up the nearest live trace and prepends a short hint (tools, order, Cypher) to the user's message; after a
// successful final answer it records the run as a Trace. A run that resolves a ticket (record_resolution) records
// that ticket with the resolution as its outcome. Hint-only here: replayed rows would bypass QueryDoc, so the receipts
// rule (every number cites a stored q_<n>) means the model still makes the calls. Journal failures never fail a turn.
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import type { AssistantMessage, Message, ToolCall } from '@earendil-works/pi-ai';
import { defineExtension, GenerationTask, hook } from '@earendil-works/pi-durable';
import type { StoredQuery } from '@mochi/contracts';
import { QueryDoc } from '../harness.ts';
import { ensureJournal, plan, recordTrace, ticketOf, TRACE_TOOLS, type JournalDb, type ReadDb } from './index.ts';

type Embed = (texts: string[]) => Promise<number[][]>;
const genSpec = '@mochi/gen';
const gen = async () => (await import(genSpec)) as { embed: Embed; EMBED_DIM: number };
const textOf = (c: Message['content']) => (typeof c === 'string' ? c : c.flatMap((x) => (x.type === 'text' ? [x.text] : [])).join(''));
const warn = (e: unknown) => console.error(`[traces] ${(e as Error).message ?? e}`);

export function traceExtension(o: { read: () => Promise<unknown>; write: () => Promise<unknown>; graph: string; embed?: Embed }) {
  const embed: Embed = o.embed ?? (async (t) => (await gen()).embed(t));
  let ready: Promise<void> | undefined;
  const journal = async () => {
    const db = (await o.write()) as JournalDb;
    ready ??= gen().then((g) => ensureJournal(db, g.EMBED_DIM)).catch((e) => { ready = undefined; throw e; });
    await ready;
    return db;
  };
  const turns = new Map<string, readonly Message[]>(); // taskId -> the run's latest request; in memory, a crash loses one trace

  return defineExtension({
    name: 'mochi-traces',
    hooks: [hook(GenerationTask, {
      beforeRequest: async ({ messages }, api) => {
        const u = messages.findLastIndex((m) => m.role === 'user');
        if (u < 0) return undefined;
        turns.set(String(api.taskId), messages);
        let hint = await api.memo<string>('trace-hint', ctx);
        if (hint === undefined) {
          const question = textOf(messages[u].content);
          hint = await (async () => {
            const [e] = await embed([question]);
            const p = await plan({ journal: await journal(), read: (await o.read()) as ReadDb, graph: o.graph, question, embedding: e, as_of: Date.now() });
            return p?.hint ?? '';
          })().catch((e) => (warn(e), ''));
          await api.memo('trace-hint', hint, ctx);
        }
        if (!hint) return undefined;
        const m = messages[u] as Extract<Message, { role: 'user' }>;
        const content = typeof m.content === 'string' ? `${hint}\n\n${m.content}` : [{ type: 'text' as const, text: hint }, ...m.content];
        return { messages: messages.map((x, i) => (i === u ? { ...m, content } : x)) };
      },
      onYield: async (answer: AssistantMessage, api) => {
        const messages = turns.get(String(api.taskId));
        turns.delete(String(api.taskId));
        if (!messages || answer.stopReason !== 'stop') return undefined;
        const u = messages.findLastIndex((m) => m.role === 'user');
        const run = messages.slice(u + 1);
        const calls = run.flatMap((m) => (m.role === 'assistant' ? m.content.filter((c): c is ToolCall => c.type === 'toolCall') : []));
        const results = run.filter((m) => m.role === 'toolResult');
        const steps = calls.filter((c) => TRACE_TOOLS.has(c.name)).map((c) => ({ tool: c.name, args: c.arguments as Record<string, unknown> }));
        if (!steps.length || results.some((r) => (r as { isError?: boolean }).isError)) return undefined;
        const question = textOf(messages[u].content);
        const resolved = calls.find((c) => c.name === 'record_resolution')?.arguments as { ticketId?: string; summary?: string } | undefined;
        const ids = [...new Set(results.flatMap((r) => textOf(r.content).match(/\bq_\d+\b/g) ?? []))];
        try {
          const doc = await api.snapshot(QueryDoc, api.conversationId, ctx);
          const queries = ids.flatMap((id) => (doc?.byId[id] ? [doc.byId[id] as unknown as StoredQuery] : []));
          const [e] = await embed([question]);
          await recordTrace(await journal(), {
            id: `TR-S${api.conversationId}-${api.taskId}`, ticket_id: resolved?.ticketId ?? ticketOf(question), question, steps, queries,
            outcome: resolved?.summary ?? textOf(answer.content), source: 'session',
          }, e, Date.now());
        } catch (e) { warn(e); }
        return undefined;
      },
    })],
  });
}
