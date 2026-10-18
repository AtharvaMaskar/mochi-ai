// AG-UI adapter (ported from the author's durable-agents/src/agui-agent.ts, pi 1.2 -> 1.3): each AG-UI thread is one
// Pi user conversation; Pi agent events map to AG-UI events. Rich UI has exactly two paths, both emitted by tool code:
// ACTIVITY.card after a read tool (content = its ToolCard) and ACTIVITY.html after a passing render_html.
import { AbstractAgent, type AgentConfig } from '@ag-ui/client';
import { EventType, type BaseEvent, type Message, type RunAgentInput } from '@ag-ui/core';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { defineDoc, watchEvents, type ConversationId } from '@earendil-works/pi-durable';
import { InMemoryAgentRunner, type AgentRunnerConnectRequest } from '@copilotkit/runtime/v2';
import { Observable } from 'rxjs';
import { ACTIVITY } from '@mochi/contracts';
import { READ_TOOLS, type Pi } from './harness.ts';
import { scopedThread } from './api/visitor.ts';

type Block = { type: string; text?: string; id?: string; name?: string; arguments?: unknown };
type ToolMsg = { toolCallId?: string; toolName?: string; isError?: boolean; details?: Record<string, unknown>; content?: unknown };

// `<visitor id>:<AG-UI threadId>` -> Pi conversation id; session-scoped so the mapping survives restarts.
export const Threads = defineDoc<{ map: Record<string, number> }>({
  kind: 'mochi.agui-threads', version: 1, scope: 'session', initial: () => ({ map: {} }),
});

const MAX_RESULT = 4000;
const clip = (s: string) => (s.length > MAX_RESULT ? `${s.slice(0, MAX_RESULT)}…` : s);
const blocksText = (content: unknown) =>
  typeof content === 'string' ? content : ((content as Block[]) ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n');

/** The activity a tool result carries, if any: a card from a read tool, or guarded HTML from render_html. */
export function activityOf(m: ToolMsg | undefined): { activityType: string; content: Record<string, unknown> } | null {
  if (!m || m.isError || !m.details || !m.toolName) return null;
  if ((READ_TOOLS as readonly string[]).includes(m.toolName)) return { activityType: ACTIVITY.card, content: m.details };
  if (m.toolName === 'render_html') return { activityType: ACTIVITY.html, content: m.details };
  return null;
}

export async function conversationFor(pi: Pi, raw: string) {
  const threadId = scopedThread(raw); // a threadId only names a thread inside this visitor's scope
  const id = await pi.root.commit(async (tx) => {
    const doc = await tx.doc(Threads);
    if (doc.map[threadId] === undefined) {
      const c = await tx.createConversation({ ownership: { kind: 'ownerless' } });
      await pi.setCaller(tx, c.id);
      doc.map[threadId] = c.id as unknown as number;
    }
    return doc.map[threadId]!;
  }, ctx);
  const conv = (await pi.harness.conversation(id as unknown as ConversationId, ctx))!;
  await conv.configure(pi.userAgent, ctx); // model + loadout without record_resolution
  return conv;
}

/** The thread's transcript as AG-UI messages: user text, assistant text + tool calls, tool results and their activities. */
export async function history(pi: Pi, threadId: string): Promise<Message[]> {
  const id = (await pi.harness.snapshot(Threads, ctx))?.map[scopedThread(threadId)];
  if (id === undefined) return [];
  const conv = (await pi.harness.conversation(id as unknown as ConversationId, ctx))!;
  const messages: Message[] = [];
  let cursor;
  do {
    const page = await conv.entries({ order: 'ascending' }, 200, cursor, ctx);
    for (const e of page.items as unknown as Array<{ id: number; kind: string; model?: Array<Record<string, unknown>> }>) {
      const m = e.model?.[0];
      if (!m) continue;
      if (e.kind === 'pi.user') messages.push({ id: `e${e.id}`, role: 'user', content: blocksText(m.content) });
      else if (e.kind === 'pi.assistant') {
        const blocks = (m.content as Block[]) ?? [];
        const toolCalls = blocks.filter((b) => b.type === 'toolCall')
          .map((b) => ({ id: b.id!, type: 'function' as const, function: { name: b.name!, arguments: JSON.stringify(b.arguments ?? {}) } }));
        messages.push({ id: `e${e.id}`, role: 'assistant', content: blocksText(blocks), ...(toolCalls.length ? { toolCalls } : {}) });
      } else if (e.kind === 'pi.tool-result') {
        messages.push({ id: `e${e.id}`, role: 'tool', toolCallId: String(m.toolCallId), content: clip(blocksText(m.content)) });
        const act = activityOf(m as ToolMsg);
        if (act) messages.push({ id: `e${e.id}-activity`, role: 'activity', ...act } as Message);
      }
    }
    cursor = page.next;
  } while (cursor);
  return messages;
}

export class PiDurableAgent extends AbstractAgent {
  pi: Pi;
  private abort?: () => Promise<void>;

  constructor(pi: Pi, config: AgentConfig = {}) {
    super({ description: 'Mochi support copilot (Pi Durable + FalkorDB)', ...config });
    this.pi = pi;
  }

  clone() {
    const copy = new PiDurableAgent(this.pi, { agentId: this.agentId, description: this.description, threadId: this.threadId });
    copy.setMessages(this.messages);
    return copy;
  }

  abortRun() {
    void this.abort?.();
    super.abortRun();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((sub) => {
      const emit = (e: Record<string, unknown>) => sub.next(e as unknown as BaseEvent);
      const { threadId, runId } = input;
      let stopped = false;
      (async () => {
        const user = [...input.messages].reverse().find((m) => m.role === 'user');
        if (!user) throw new Error('No user message in this run');
        const conv = await conversationFor(this.pi, threadId);
        this.abort = () => conv.abort(ctx);
        emit({ type: EventType.RUN_STARTED, threadId, runId });

        // One AG-UI text message per assistant turn. Pi coalesces partial updates when the listener lags, so keep the
        // in-flight message's blocks and stream whatever text is new since the last emit.
        let turn = 0, msgId = '', textOpen = false, sentText = '';
        let partial: Block[] = [];
        const flush = (text: string) => {
          if (!text.startsWith(sentText)) return; // rewritten mid-stream (a retry); sent text can't be taken back
          const delta = text.slice(sentText.length);
          if (!delta) return;
          if (!textOpen) emit({ type: EventType.TEXT_MESSAGE_START, messageId: msgId, role: 'assistant' });
          textOpen = true;
          emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: msgId, delta });
          sentText = text;
        };
        const parentOf = new Map<string, string>();
        let submissionId: unknown;
        let runEnded: () => void = () => {};
        const ended = new Promise<void>((r) => (runEnded = r));
        const stream = await watchEvents(this.pi.harness, conv.id, ctx);
        stream.start(async (events) => {
          for (const ev of events as unknown as Array<Record<string, any>>) {
            if (stopped) return;
            switch (ev.type) {
              case 'message_start':
                if (ev.message?.role !== 'assistant') break;
                msgId = `${runId}-m${++turn}`;
                textOpen = false;
                sentText = '';
                partial = structuredClone(ev.message.content ?? []);
                flush(blocksText(partial));
                break;
              case 'message_update':
                for (const c of ev.changes) {
                  if (c.type === 'message') partial = structuredClone(c.message.content);
                  else if (['text_start', 'thinking_start', 'toolcall_start', 'block'].includes(c.type)) partial[c.contentIndex] = structuredClone(c.block);
                  else if (c.type === 'text_delta') {
                    const b = (partial[c.contentIndex] ??= { type: 'text', text: '' });
                    b.text = (b.text ?? '') + c.delta;
                  }
                }
                flush(blocksText(partial));
                break;
              case 'snapshot':
                if (msgId && ev.generation?.message) {
                  partial = structuredClone(ev.generation.message.content);
                  flush(blocksText(partial));
                }
                break;
              case 'message_end':
                if (ev.entry?.kind !== 'pi.assistant') break;
                flush(blocksText(ev.entry.model?.[0]?.content));
                if (textOpen) emit({ type: EventType.TEXT_MESSAGE_END, messageId: msgId });
                textOpen = false;
                break;
              case 'tool_execution_start': {
                const parent = (ev.parentToolCallId && parentOf.get(ev.parentToolCallId)) || msgId;
                parentOf.set(ev.toolCallId, parent);
                emit({ type: EventType.TOOL_CALL_START, toolCallId: ev.toolCallId, toolCallName: ev.toolName, parentMessageId: parent });
                emit({ type: EventType.TOOL_CALL_ARGS, toolCallId: ev.toolCallId, delta: JSON.stringify(ev.args ?? {}) });
                emit({ type: EventType.TOOL_CALL_END, toolCallId: ev.toolCallId });
                break;
              }
              case 'tool_execution_end': {
                const m = ev.entry?.model?.[0] as ToolMsg | undefined;
                const text = m ? blocksText(m.content) : (ev.result?.diagnostics ?? []).map((d: { message: string }) => d.message).join('\n');
                emit({ type: EventType.TOOL_CALL_RESULT, messageId: `${ev.toolCallId}-result`, toolCallId: ev.toolCallId, role: 'tool', content: clip(text || '(no result)') });
                const act = activityOf(m && { ...m, toolName: m.toolName ?? ev.toolName });
                if (act) emit({ type: EventType.ACTIVITY_SNAPSHOT, messageId: `${ev.toolCallId}-activity`, ...act });
                break;
              }
              case 'run_end':
                if (ev.inputs.includes(submissionId)) runEnded();
                break;
            }
          }
        });

        // Same thread + message ids -> same requestId -> one Pi submission, even when the POST is retried.
        const submission = await conv.submit({ type: 'input', content: String(blocksText(user.content)), requestId: `agui:${threadId}:${user.id}` }, ctx);
        submissionId = submission.id;
        const settled = await submission.wait(ctx);
        // The settle can land before the last event batch is delivered; wait for run_end briefly.
        await Promise.race([ended, new Promise((r) => setTimeout(r, 2000))]);
        await stream.stop();
        if (textOpen) emit({ type: EventType.TEXT_MESSAGE_END, messageId: msgId });
        if (settled.status === 'done') emit({ type: EventType.RUN_FINISHED, threadId, runId });
        else emit({ type: EventType.RUN_ERROR, message: `Unanswered: ${JSON.stringify((settled as { reason?: unknown }).reason ?? settled)}` });
        sub.complete();
      })().catch((e) => {
        emit({ type: EventType.RUN_ERROR, message: (e as Error).message });
        sub.complete();
      });
      return () => { stopped = true; };
    });
  }
}

/** Runner whose connect() replays the thread from Pi's durable transcript, so a reload or restart keeps history. */
export class PiRunner extends InMemoryAgentRunner {
  pi: Pi;
  constructor(pi: Pi) {
    super();
    this.pi = pi;
  }
  connect(request: AgentRunnerConnectRequest) {
    // ponytail: a run in flight replays from the in-memory store (this process only); idle threads replay from Pi.
    return new Observable<BaseEvent>((sub) => {
      (async () => {
        if (await this.isRunning({ threadId: request.threadId })) return super.connect(request).subscribe(sub);
        const messages = await history(this.pi, request.threadId);
        const runId = `connect-${Date.now()}`;
        for (const e of [
          { type: EventType.RUN_STARTED, threadId: request.threadId, runId },
          { type: EventType.MESSAGES_SNAPSHOT, messages },
          { type: EventType.RUN_FINISHED, threadId: request.threadId, runId },
        ]) sub.next(e as unknown as BaseEvent);
        sub.complete();
      })().catch((e) => sub.error(e));
    });
  }
}
