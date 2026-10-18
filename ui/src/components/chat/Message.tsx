// A turn in the transcript. User words sit right in an ink bubble; Mochi's parts (steps, cards, text) share one
// avatar whose mood says what it is doing: thinking while tools run, speaking while text streams.
// A turn that began live (mood set at mount) arrives: cards get the fading agent-tint ring, words blur in once.
// Replayed history mounts without a mood and shows everything at rest.
import { useRef, useState, type ReactNode } from 'react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import { Mochi, type Mood } from '../ds.tsx';
import { RevealWords } from '../markdown.tsx';

export function Message({ role, mood, children }: { role: 'user' | 'assistant'; mood?: Mood; children: ReactNode }) {
  const live = useRef(!!mood).current;
  if (role === 'user') return <div className="mb-chat-user">{children}</div>;
  return (
    <div className="mb-chat-ai" data-arrive={live || undefined}>
      <Mochi size="sm" mood={mood} still={!mood || mood === 'idle'} />
      <div className="mb-chat-ai-body"><RevealWords.Provider value={live}>{children}</RevealWords.Provider></div>
    </div>
  );
}

/** Copy (when there is text) and Retry (the last answer only), quiet under the message. */
export function MessageActions({ text, onRetry }: { text?: string; onRetry?: () => void }) {
  if (!text && !onRetry) return null;
  return (
    <div className="mb-chat-actions">
      {text && <CopyButton text={text} />}
      {onRetry && <button className="mb-icon-btn" aria-label="Retry" title="Retry" onClick={onRetry}><RotateCcw size={16} strokeWidth={1.5} aria-hidden="true" /></button>}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }, () => undefined); };
  return (
    <button className="mb-icon-btn" aria-label={done ? 'Copied' : 'Copy'} title={done ? 'Copied' : 'Copy'} onClick={copy}>
      {done ? <Check size={16} strokeWidth={1.5} aria-hidden="true" /> : <Copy size={16} strokeWidth={1.5} aria-hidden="true" />}
    </button>
  );
}
