// Live chat: CopilotKit v2 headless against /api/copilotkit, our own transcript and composer (no CopilotKit styles,
// so tokens own the look). Rich UI: ACTIVITY.card -> ToolCard, ACTIVITY.html -> SandboxFrame, and `mochi.story`
// ({id, version, kind} from build_story/edit_story) -> a story card that opens the side panel. openGenerativeUI is
// never enabled. Layout: conversations left, transcript centre, Outputs rail right; an open StoryPanel takes the rail's
// column (a sheet on narrow screens). The rail is portalled in from Conversation, which owns the messages.
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CopilotKitProvider, useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import { ACTIVITY, parseStory, type SandboxHtml, type Story, type StoredQuery, type ToolCard as Card } from '@mochi/contracts';
import type { ChatItem } from '../../fixtures/index.ts';
import { ChatCard } from '../components/chat/ChatCard.tsx';
import { StoryView } from '../components/story.tsx';
import { StoryMarkdown } from '../components/markdown.tsx';
import { SandboxFrame } from '../components/sandbox.tsx';
import { ReceiptProvider } from '../components/receipts.tsx';
import { Mochi, NeedsYou } from '../components/ds.tsx';
import { StoryPanel } from '../components/story-panel.tsx';
import { OpenArtifact, OutputsRail } from '../components/chat/outputs-rail.tsx';
import { Threads, rememberThread, useThreadsOpen } from '../components/chat/threads.tsx';
import { createPortal } from 'react-dom';
import { FileText, LayoutDashboard, PanelLeftOpen, PanelRightOpen, TrendingUp, Users } from 'lucide-react';
import { MessageList } from '../components/chat/MessageList.tsx';
import { Message, MessageActions } from '../components/chat/Message.tsx';
import { Composer, type Command } from '../components/chat/Composer.tsx';
import { ToolProgress } from '../components/chat/ToolProgress.tsx';
import { EmptyState, type Starter } from '../components/chat/EmptyState.tsx';
import { Backdrop } from '../components/chat/Backdrop.tsx';

const STORY_ACTIVITY = 'mochi.story'; // agent/stories.ts STORY_ACTIVITY
type StoryRef = { id: string; version: number; kind?: 'story' | 'dashboard' };
// The harness parses these prefixes; the composer only puts "/story " or "/dashboard " at the start of the message.
const COMMANDS: Command[] = [{ name: '/story', hint: 'Write a story from this conversation' }, { name: '/dashboard', hint: 'Build a live dashboard' }];
// Starters: plain words on the card; the message sent may carry the command.
const PROMPTS: Starter[] = [
  { icon: FileText, title: 'Write a story', sub: 'What changed in support this week', send: '/story What changed in support this week' },
  { icon: LayoutDashboard, title: 'Build a dashboard', sub: 'SLA breaches by product area', send: '/dashboard SLA breaches by product area' },
  { icon: Users, title: 'Find who knows', sub: 'TOTP failures', send: 'Who knows about TOTP failures?' },
  { icon: TrendingUp, title: 'Explain a change', sub: 'Why payouts got slower this week', send: 'Why did payouts get slower this week?' },
];

/** A fixture transcript item (#/preview). */
export function Answer({ m }: { m: Extract<ChatItem, { role: 'assistant' }> }) {
  return (
    <div className="mb-chat-ai">
      <Mochi size="sm" still />
      <div className="mb-chat-ai-body">
        {m.cards?.map((c, i) => <ChatCard key={i} card={c} />)}
        {m.text && <StoryMarkdown text={m.text} />}
        {m.story && <StoryView input={m.story} header={false} />}
        {m.html && <SandboxFrame value={m.html.value} queries={m.html.queries} height={220} />}
      </div>
    </div>
  );
}

type Msg = { id: string; role: string; content?: unknown; activityType?: string; toolCallId?: string; toolCalls?: { id: string; function: { name: string; arguments?: string } }[] };
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

/** A saved story in the transcript; clicking it reopens the panel. */
function StoryChip({ s, onOpen }: { s: StoryRef; onOpen: () => void }) {
  const open = useContext(OpenId) === s.id;
  return (
    <button className="mb-story-chip" aria-pressed={open} onClick={onOpen}>
      <span className="mb-story-chip-kind">{s.kind === 'dashboard' ? 'Dashboard' : 'Story'}</span>
      <span className="mono">v{s.version}</span>
      <span className="muted">{open ? 'Open beside the chat' : 'Open'}</span>
    </button>
  );
}

// memo + the open id via context: opening or closing the panel re-renders only the story chips, never the transcript
const OpenId = createContext<string | null>(null);
const Conversation = memo(function Conversation({ threadId, onOpen, rail }: { threadId: string; onOpen: (id: string) => void; rail: HTMLElement | null }) {
  const { agent, isReady } = useAgent({ agentId: 'mochi' });
  const { copilotkit } = useCopilotKit();
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
  const running = agent.isRunning;
  const first = messages.find((m) => m.role === 'user')?.content;
  useEffect(() => { if (typeof first === 'string') rememberThread(threadId, first); }, [first]);
  const send = async (q: string) => {
    if (running) return;
    setError(null);
    agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: q });
    try { await copilotkit.runAgent({ agent }); } catch (e) { setError(reason(e)); }
  };
  const stop = () => { try { copilotkit.stopAgent({ agent }); } catch { agent.abortRun(); } };
  // A story activity that arrives during this page's life opens (or advances) the panel; replayed history doesn't.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const m of messages) if (m.activityType === STORY_ACTIVITY && !seen.current.has(m.id)) {
      seen.current.add(m.id);
      if (agent.isRunning) onOpen((m.content as StoryRef).id);
    }
  }, [messages.length, agent.isRunning]);
  // one turn = a user message and every part Mochi answered with; the parts share one avatar
  const turns: { user?: Msg; parts: Msg[] }[] = [];
  for (const m of messages) {
    if (m.role === 'user') turns.push({ user: m, parts: [] });
    else if (turns.length) turns[turns.length - 1].parts.push(m);
    else turns.push({ parts: [m] });
  }
  const results = new Set(messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId));
  const tail = messages.at(-1);
  const streaming = tail?.role === 'assistant' && typeof tail.content === 'string' && tail.content.trim() !== '';
  return (
    <div className="mb-chat-shell">
      {rail && createPortal(<OutputsRail messages={messages} running={running} />, rail)}
      <Backdrop mood={!messages.length && !running ? 'home' : running ? 'working' : 'calm'} />
      <MessageList pinKey={turns.length} busy={running}>
        {!messages.length && !running && <EmptyState prompts={PROMPTS} onPick={(p) => void send(p)} />}
        {turns.map((t, i) => {
          const live = running && i === turns.length - 1;
          const steps = t.parts.flatMap((m) => (m.toolCalls ?? []).map((c) => ({ id: c.id, name: c.function.name, args: c.function.arguments, done: results.has(c.id) || !live })));
          const texts = t.parts.filter((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()).map((m) => String(m.content));
          const acts = t.parts.filter((m) => m.role === 'activity');
          const mood = !live ? undefined : steps.some((s) => !s.done) || !streaming ? 'thinking' : 'speaking';
          const user = t.user;
          return (
            <div key={user?.id ?? i} className="mb-chat-turn">
              {user && <Message role="user">{String(user.content)}</Message>}
              {(live || steps.length > 0 || texts.length > 0 || acts.length > 0) && (
                // order: what Mochi is doing, then what it found (cards), then what it says
                <Message role="assistant" mood={mood}>
                  <ToolProgress steps={steps} />
                  {acts.map((m) => <Activity key={m.id} m={m} onOpen={onOpen} />)}
                  {texts.map((x, j) => <AiText key={j} text={x} queries={queries} />)}
                  {live && !steps.length && !texts.length && !acts.length && <div className="mb-skel" aria-label="Mochi is thinking">{[70, 50].map((w, k) => <i key={k} style={{ width: `${w}%` }} />)}</div>}
                  {!live && <MessageActions text={texts.join('\n\n') || undefined} onRetry={i === turns.length - 1 && user && !running ? () => void send(String(user.content)) : undefined} />}
                </Message>
              )}
            </div>
          );
        })}
        {error && <NeedsYou mood="sorry" title="I couldn’t answer" reason={error} />}
      </MessageList>
      <Composer onSend={(q) => void send(q)} onStop={stop} running={running} commands={COMMANDS}
        placeholder="Ask about tickets or customers"
        disabledReason={!isReady ? 'I’m still connecting to the agent.' : undefined} />
    </div>
  );
});

/** Rich UI paths: a tool card, guarded sandbox HTML, or a story chip that opens the panel. */
function Activity({ m, onOpen }: { m: Msg; onOpen: (id: string) => void }) {
  if (m.activityType === ACTIVITY.card) return <ChatCard card={m.content as Card} />;
  if (m.activityType === STORY_ACTIVITY) { const s = m.content as StoryRef; return <StoryChip s={s} onOpen={() => onOpen(s.id)} />; }
  if (m.activityType !== ACTIVITY.html) return null;
  const h = m.content as SandboxHtml & { queries: Record<string, StoredQuery> };
  return <SandboxFrame value={{ html: h.html, css: h.css }} queries={h.queries} height={220} />;
}

const SHEET_KEY = 'mochi-threads-open';
export function Chat() {
  const [threadId, setThreadId] = useState(loadThread);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rail, setRail] = useState<HTMLElement | null>(null);
  const [side, setSide] = useThreadsOpen(SHEET_KEY);
  const [outputs, setOutputs] = useState(false); // the rail as a sheet below 768px
  const openArtifact = useMemo(() => (id: string) => { setOutputs(false); setOpenId(id); }, []);
  const go = (id: string) => { setOpenId(null); try { localStorage.setItem(THREAD_KEY, id); } catch { /* storage blocked */ } setThreadId(id); };
  return (
    // The durable agent keeps the whole conversation server side, so each run sends only the newest message.
    <CopilotKitProvider runtimeUrl="/api/copilotkit" messageFilter={(m) => m.slice(-1)} showDevConsole={false} enableInspector={false}>
      <OpenArtifact.Provider value={openArtifact}>
        <div className="mb-split" data-side={side ? 'open' : 'closed'} data-outputs={outputs || undefined}>
          <Threads current={threadId} onPick={go} onNew={() => go(newThread())} onClose={() => setSide(false)} />
          <button type="button" className="mb-scrim" aria-label="Close" tabIndex={-1} onClick={() => { setSide(false); setOutputs(false); }} />
          <div className="mb-split-chat">
            <div className="mb-page mb-page-narrow">
              <div className="mb-chat-bar">
                <button type="button" className="mb-icon-btn mb-side-toggle" aria-label="Show conversations" onClick={() => setSide(true)}><PanelLeftOpen size={16} strokeWidth={1.5} aria-hidden="true" /></button>
                <button type="button" className="mb-icon-btn mb-outputs-toggle" aria-label="Show outputs" onClick={() => setOutputs(true)}><PanelRightOpen size={16} strokeWidth={1.5} aria-hidden="true" /></button>
              </div>
              <OpenId.Provider value={openId}><Conversation key={threadId} threadId={threadId} onOpen={setOpenId} rail={rail} /></OpenId.Provider>
            </div>
          </div>
          <div className="mb-split-rail" ref={setRail} />
          <StoryPanel id={openId} onClose={() => setOpenId(null)} />
        </div>
      </OpenArtifact.Provider>
    </CopilotKitProvider>
  );
}
