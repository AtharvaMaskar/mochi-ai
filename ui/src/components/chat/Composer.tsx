// The composer, pinned under the transcript: an autosizing textarea, Enter sends, Shift+Enter is a newline, and the
// keycap becomes Stop while Mochi runs. "/" at the start opens the `commands` menu (story-panel passes /story, /dashboard).
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '../ds.tsx';

export type Command = { name: string; hint: string };

export function Composer({ onSend, onStop, running = false, disabledReason, commands = [], placeholder = 'Ask about tickets, customers or last night’s dream' }: {
  onSend: (text: string) => void; onStop?: () => void; running?: boolean;
  /** Why sending can't happen yet (e.g. still connecting). Tapping send shakes and shows it. */ disabledReason?: string;
  /** Slash commands; names include the slash, e.g. { name: '/story', hint: 'Write a report from this chat' }. */ commands?: Command[];
  placeholder?: string;
}) {
  const [text, setText] = useState(''), [pick, setPick] = useState(0), [closed, setClosed] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null), id = useId();
  useLayoutEffect(() => { const t = ta.current; if (t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; } }, [text]);
  const matches = !closed && /^\/\S*$/.test(text) ? commands.filter((c) => c.name.startsWith(text)) : [];
  const sel = matches.length ? pick % matches.length : 0;
  const choose = (c: Command) => { setText(`${c.name} `); ta.current?.focus(); };
  const send = () => {
    const q = text.trim();
    if (!q || running || disabledReason) return;
    onSend(q); setText(''); ta.current?.focus();
  };
  const why = disabledReason ?? (!text.trim() ? 'Type a question first.' : undefined);
  return (
    <form className="mb-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
      {matches.length > 0 && (
        <ul className="mb-composer-menu" role="listbox" id={`${id}-menu`} aria-label="Commands">
          {matches.map((c, i) => (
            <li key={c.name} id={`${id}-${i}`} role="option" aria-selected={i === sel} onPointerDown={(e) => { e.preventDefault(); choose(c); }}>
              <span className="mono">{c.name}</span><span className="muted">{c.hint}</span>
            </li>
          ))}
        </ul>
      )}
      <label className="sr" htmlFor={`${id}-ask`}>Ask Mochi</label>
      <textarea id={`${id}-ask`} ref={ta} rows={1} value={text} placeholder={placeholder}
        aria-controls={matches.length ? `${id}-menu` : undefined} aria-activedescendant={matches.length ? `${id}-${sel}` : undefined}
        onChange={(e) => { setText(e.target.value); setPick(0); setClosed(false); }}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setPick(sel + (e.key === 'ArrowDown' ? 1 : matches.length - 1)); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(matches[sel]); return; }
            if (e.key === 'Escape') { setClosed(true); return; }
          }
          // Enter presses the keycap, so a refused send shakes and says why instead of doing nothing
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!running) e.currentTarget.form?.querySelector<HTMLButtonElement>('button[type=submit]')?.click(); }
        }} />
      {running
        ? <Button variant="secondary" size="sm" type="button" onClick={() => { onStop?.(); ta.current?.focus(); }}><Square size={12} strokeWidth={2} fill="currentColor" aria-hidden="true" />Stop</Button>
        : <Button variant="primary" size="sm" type="submit" disabledReason={why}><ArrowUp size={16} strokeWidth={1.5} aria-hidden="true" />Ask</Button>}
    </form>
  );
}
