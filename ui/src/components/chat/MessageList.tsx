// The transcript: the only scroller in the chat. Follows the stream while the reader is at the bottom; any scroll up
// releases it and shows "Jump to latest". A ResizeObserver re-pins on growth (Safari has no overflow-anchor).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown } from 'lucide-react';

const NEAR = 48; // px from the bottom that still counts as "at the bottom"

export function MessageList({ children, pinKey, busy, label = 'Conversation with Mochi' }: {
  children: ReactNode; /** Change it (e.g. the user-message count) to scroll down and re-pin, as after a send. */ pinKey?: unknown;
  /** true while Mochi is still writing, so screen readers wait for the finished answer. */ busy?: boolean; label?: string;
}) {
  const box = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null), stuck = useRef(true), lastTop = useRef(0);
  const [away, setAway] = useState(false);
  const toBottom = () => { const b = box.current; if (b) b.scrollTop = b.scrollHeight; };
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => { if (stuck.current) toBottom(); });
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { stuck.current = true; setAway(false); toBottom(); }, [pinKey]);
  // Only a move up releases the pin: content growing between our scroll and this event must not read as "scrolled away".
  const onScroll = () => {
    const b = box.current!;
    if (b.scrollHeight - b.scrollTop - b.clientHeight < NEAR) stuck.current = true;
    else if (b.scrollTop < lastTop.current - 1) stuck.current = false;
    lastTop.current = b.scrollTop; setAway(!stuck.current);
  };
  return (
    <div className="mb-chat-list-wrap">
      <div ref={box} className="mb-chat-list" onScroll={onScroll}>
        <div ref={inner} className="mb-chat" role="log" aria-label={label} aria-live="polite" aria-busy={busy || undefined}>{children}</div>
      </div>
      {away && (
        <button type="button" className="mb-chat-jump" onClick={() => { stuck.current = true; setAway(false); toBottom(); }}>
          <ArrowDown size={16} strokeWidth={1.5} aria-hidden="true" />Jump to latest
        </button>
      )}
    </div>
  );
}
