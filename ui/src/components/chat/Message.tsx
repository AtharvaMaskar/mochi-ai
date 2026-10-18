// A turn in the transcript. User words sit right in an ink bubble; Mochi's parts (steps, cards, text) share one
// avatar whose mood says what it is doing: thinking while tools run, speaking while text streams.
import type { ReactNode } from 'react';
import { Mochi, Button, type Mood } from '../ds.tsx';

export function Message({ role, mood, children }: { role: 'user' | 'assistant'; mood?: Mood; children: ReactNode }) {
  if (role === 'user') return <div className="mb-chat-user">{children}</div>;
  return (
    <div className="mb-chat-ai">
      <Mochi size="sm" mood={mood} still={!mood || mood === 'idle'} />
      <div className="mb-chat-ai-body">{children}</div>
    </div>
  );
}

/** Copy (when there is text) and Retry (the last answer only), quiet under the message. */
export function MessageActions({ text, onRetry }: { text?: string; onRetry?: () => void }) {
  if (!text && !onRetry) return null;
  return (
    <div className="mb-chat-actions">
      {text && <Button variant="link" size="sm" success="Copied" onClick={() => { void navigator.clipboard?.writeText(text).catch(() => undefined); }}>Copy</Button>}
      {onRetry && <Button variant="link" size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
