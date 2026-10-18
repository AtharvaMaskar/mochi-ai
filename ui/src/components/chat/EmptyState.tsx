// A new conversation: Mochi, one line, and example prompts that send when chosen.
import { Mochi } from '../ds.tsx';

export function EmptyState({ prompts, onPick }: { prompts: string[]; onPick: (prompt: string) => void }) {
  return (
    <div className="mb-chat-empty">
      <Mochi size="md" />
      <p className="mb-chat-empty-title">Ask me about a ticket, a customer or last night’s dream.</p>
      <p className="muted">Every number I give you opens its Cypher.</p>
      <div className="mb-chat-prompts">
        {prompts.map((p) => <button key={p} type="button" className="mb-chat-prompt" onClick={() => onPick(p)}>{p}</button>)}
      </div>
    </div>
  );
}
