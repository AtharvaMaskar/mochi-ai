// Live chat: CopilotKit v2 headless against /api/copilotkit, our own transcript and composer (no CopilotKit styles,
// so tokens own the look). Rich UI has exactly two paths: ACTIVITY.card -> ToolCard, ACTIVITY.html -> SandboxFrame.
// openGenerativeUI is never enabled.
import { useEffect, useMemo, useState } from 'react';
import { CopilotKitProvider, useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import { ACTIVITY, parseStory, type SandboxHtml, type Story, type StoredQuery, type ToolCard as Card } from '@mochi/contracts';
import type { ChatItem } from '../../fixtures/index.ts';
import { ToolCard } from '../components/blocks.tsx';
import { StoryView } from '../components/story.tsx';
import { StoryMarkdown } from '../components/markdown.tsx';
import { SandboxFrame } from '../components/sandbox.tsx';
import { ReceiptProvider } from '../components/receipts.tsx';
import { Mochi, Button, NeedsYou } from '../components/ds.tsx';

/** A fixture transcript item (#/preview). */
export function Answer({ m }: { m: Extract<ChatItem, { role: 'assistant' }> }) {
  return (
    <div className="mb-chat-ai">
      <Mochi size="sm" still />
      <div className="mb-chat-ai-body">
        {m.cards?.map((c, i) => <ToolCard key={i} card={c} />)}
        {m.text && <StoryMarkdown text={m.text} />}
        {m.story && <StoryView input={m.story} header={false} />}
        {m.html && <SandboxFrame value={m.html.value} queries={m.html.queries} height={220} />}
      </div>
    </div>
  );
}

type Msg = { id: string; role: string; content?: unknown; activityType?: string };
const THREAD_KEY = 'mochi-thread';
const newThread = () => { const id = crypto.randomUUID(); try { localStorage.setItem(THREAD_KEY, id); } catch { /* storage blocked */ } return id; };
const loadThread = () => { try { return localStorage.getItem(THREAD_KEY) ?? newThread(); } catch { return newThread(); } };

/** Mochi's text: a story in the viz grammar over the conversation's stored queries; plain markdown if it doesn't parse. */
function AiText({ text, queries }: { text: string; queries: Record<string, StoredQuery> }) {
  const story: Story = { id: 'chatAnswer000000', version: 1, title: 'Answer', generated_at: Date.now(), generated_by: 'user:chat', topic: 'chat', queries, body: text };
  if (parseStory(story).ok) return <StoryView input={story} header={false} />;
  return <ReceiptProvider queries={queries}><StoryMarkdown text={text} /></ReceiptProvider>;
}

/** The agent's own words when it refused (the per-IP chat cap answers 429 with a sentence), else the error. */
const reason = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.match(/"error"\s*:\s*"([^"]+)"/)?.[1] ?? (/\b429\b/.test(msg) ? 'You’ve asked a lot in a short time. Try again in a few minutes.' : msg);
};

function Conversation({ threadId }: { threadId: string }) {
  const { agent, isReady } = useAgent({ agentId: 'mochi' });
  const { copilotkit } = useCopilotKit();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isReady) return;
    agent.threadId = threadId;
    agent.setMessages([]);
    copilotkit.connectAgent({ agent }).catch((e: unknown) => setError(reason(e)));
  }, [agent, isReady, threadId]);
  const messages = agent.messages as unknown as Msg[];
  // every stored query a card brought into this thread, so <num> and tags in Mochi's text resolve to receipts
  const queries = useMemo(() => Object.assign({}, ...messages.filter((m) => m.activityType === ACTIVITY.card).map((m) => (m.content as Card).queries)) as Record<string, StoredQuery>, [messages.length]);
  const send = async () => {
    const q = text.trim();
    if (!q || agent.isRunning) return;
    setText(''); setError(null);
    agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: q });
    try { await copilotkit.runAgent({ agent }); } catch (e) { setError(reason(e)); }
  };
  const last = messages.at(-1);
  return (
    <>
      <div className="mb-chat" aria-label="Conversation with Mochi" aria-live="polite">
        {!messages.length && !agent.isRunning && <NeedsYou mood="idle" title="Ask me about a ticket" reason="Try “Brief me on T-0091” or “Which release caused the OTP tickets?”. Every number I give you opens its Cypher." />}
        {messages.map((m) => {
          if (m.role === 'user') return <div key={m.id} className="mb-chat-user">{String(m.content)}</div>;
          if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim())
            return <div key={m.id} className="mb-chat-ai"><Mochi size="sm" still /><div className="mb-chat-ai-body"><AiText text={m.content} queries={queries} /></div></div>;
          if (m.role === 'activity' && m.activityType === ACTIVITY.card)
            return <div key={m.id} className="mb-chat-ai"><Mochi size="sm" still /><div className="mb-chat-ai-body"><ToolCard card={m.content as Card} /></div></div>;
          if (m.role === 'activity' && m.activityType === ACTIVITY.html) {
            const h = m.content as SandboxHtml & { queries: Record<string, StoredQuery> };
            return <div key={m.id} className="mb-chat-ai"><Mochi size="sm" still /><div className="mb-chat-ai-body"><SandboxFrame value={{ html: h.html, css: h.css }} queries={h.queries} height={220} /></div></div>;
          }
          return null;
        })}
        {agent.isRunning && last?.role !== 'assistant' && (
          <div className="mb-chat-ai"><Mochi size="sm" mood="thinking" /><div className="mb-skel" aria-label="Mochi is thinking">{[70, 50].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div></div>
        )}
        {error && <NeedsYou mood="sorry" title="I couldn’t answer" reason={error} />}
      </div>
      <form className="mb-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="sr" htmlFor="ask">Ask Mochi</label>
        <input id="ask" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about tickets, customers or last night's dream" />
        <Button variant="primary" size="sm" type="submit" loading={agent.isRunning}
          disabledReason={!isReady ? 'I’m still connecting to the agent.' : !text.trim() ? 'Type a question first.' : undefined}>Ask</Button>
      </form>
    </>
  );
}

export function Chat() {
  const [threadId, setThreadId] = useState(loadThread);
  return (
    // The durable agent keeps the whole conversation server side, so each run sends only the newest message.
    <CopilotKitProvider runtimeUrl="/api/copilotkit" messageFilter={(m) => m.slice(-1)} showDevConsole={false} enableInspector={false}>
      <div className="mb-page mb-page-narrow">
        <div className="mb-prev-row"><Button variant="link" size="sm" onClick={() => setThreadId(newThread())}>New conversation</Button></div>
        <Conversation key={threadId} threadId={threadId} />
      </div>
    </CopilotKitProvider>
  );
}
