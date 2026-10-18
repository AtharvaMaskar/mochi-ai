// Chat on a static transcript. Assistant content renders in order: tool cards, story segments, sandboxed HTML.
import { chatTranscript, type ChatItem } from '../../fixtures/index.ts';
import { ToolCard } from '../components/blocks.tsx';
import { StoryView } from '../components/story.tsx';
import { StoryMarkdown } from '../components/markdown.tsx';
import { SandboxFrame } from '../components/sandbox.tsx';
import { Mochi, Button } from '../components/ds.tsx';

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

export function Chat() {
  return (
    <div className="mb-page mb-page-narrow">
      <div className="mb-chat" aria-label="Conversation with Mochi">
        {chatTranscript.map((m, i) => (m.role === 'user' ? <div key={i} className="mb-chat-user">{m.text}</div> : <Answer key={i} m={m} />))}
      </div>
      <form className="mb-composer" onSubmit={(e) => e.preventDefault()}>
        <label className="sr" htmlFor="ask">Ask Mochi</label>
        <input id="ask" placeholder="Ask about tickets, customers or last night's dream" />
        <Button variant="primary" size="sm" disabledReason="This transcript is a fixture. Live chat comes with the integration.">Ask</Button>
      </form>
    </div>
  );
}
