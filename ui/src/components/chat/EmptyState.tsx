// A new conversation: Mochi, one line, starter cards that send when chosen, and recent artifacts to pick up.
import type { LucideIcon } from 'lucide-react';
import { Mochi } from '../ds.tsx';
import { PickUp } from './outputs-rail.tsx';

/** A starter card: plain words shown; `send` is the message (it may start with /story or /dashboard). */
export type Starter = { icon: LucideIcon; title: string; sub: string; send: string };

export function EmptyState({ prompts, onPick }: { prompts: Starter[]; onPick: (prompt: string) => void }) {
  return (
    <div className="mb-chat-empty">
      <Mochi size="md" />
      <p className="mb-chat-empty-title">Ask me about a ticket, a customer or last night’s dream.</p>
      <p className="muted">Every number I give you opens its Cypher.</p>
      <div className="mb-starters">
        {prompts.map(({ icon: Icon, title, sub, send }) => (
          <button key={send} type="button" className="mb-starter" onClick={() => onPick(send)}>
            <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
            <span className="mb-starter-title">{title}</span>
            <span className="mb-starter-sub">{sub}</span>
          </button>
        ))}
      </div>
      <PickUp />
    </div>
  );
}
