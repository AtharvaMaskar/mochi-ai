// The composer, pinned under the transcript: an autosizing textarea, Enter sends, Shift+Enter is a newline, and the
// keycap becomes Stop while Mochi runs. "/" at the start opens the `commands` menu (story-panel passes /story, /dashboard).
// With `mentions`, "@" opens tickets, customers and issues from the graph (GET /api/entity/search); a pick puts "@T-4285"
// in the text and a removable chip above it, and the sent message carries a Context line naming each record.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Square, X } from 'lucide-react';
import { Button } from '../ds.tsx';
import { api, type Mention } from '../../data/api.ts';
import { KIND_ICON, contextLine } from './mentions.tsx';

export type Command = { name: string; hint: string };
type Item = { key: string; body: ReactNode; pick: () => void };

export function Composer({ onSend, onStop, running = false, disabledReason, commands = [], mentions = false, placeholder = 'Ask about tickets, customers or last night’s dream' }: {
  onSend: (text: string) => void; onStop?: () => void; running?: boolean;
  /** Why sending can't happen yet (e.g. still connecting). Tapping send shakes and shows it. */ disabledReason?: string;
  /** Slash commands; names include the slash, e.g. { name: '/story', hint: 'Write a report from this chat' }. */ commands?: Command[];
  /** "@" searches the graph for records to name. */ mentions?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(''), [pick, setPick] = useState(0), [closed, setClosed] = useState(false);
  const [caret, setCaret] = useState(0), [found, setFound] = useState<Mention[]>([]), [chosen, setChosen] = useState<Mention[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null), id = useId(), place = useRef<number | null>(null);
  useLayoutEffect(() => {
    const t = ta.current; if (!t) return;
    t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`;
    if (place.current !== null) { t.setSelectionRange(place.current, place.current); setCaret(place.current); place.current = null; }
  }, [text]);
  const at = mentions && !closed ? text.slice(0, caret).match(/(?:^|\s)@([^\s@]{0,40})$/) : null;
  const q = at?.[1];
  useEffect(() => {
    if (q === undefined) { setFound([]); return; }
    let live = true;
    const t = setTimeout(() => api.search(q).then((r) => live && setFound(r.results), () => live && setFound([])), 120);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  const chips = chosen.filter((m, i) => chosen.findIndex((x) => x.id === m.id) === i && new RegExp(`@${m.id}\\b`).test(text));
  const choose = (c: Command) => { setText(`${c.name} `); ta.current?.focus(); };
  const mention = (m: Mention) => {
    const head = text.slice(0, caret).replace(/@[^\s@]*$/, `@${m.id} `);
    place.current = head.length; setCaret(head.length);
    setText(head + text.slice(caret)); setChosen([...chosen, m]); ta.current?.focus();
  };
  const unmention = (m: Mention) => { setText(text.replace(new RegExp(`@${m.id}\\b ?`, 'g'), '')); setChosen(chosen.filter((x) => x.id !== m.id)); ta.current?.focus(); };
  const items: Item[] = !closed && /^\/\S*$/.test(text)
    ? commands.filter((c) => c.name.startsWith(text)).map((c) => ({ key: c.name, body: <><span className="mono">{c.name}</span><span className="muted">{c.hint}</span></>, pick: () => choose(c) }))
    : q !== undefined ? found.map((m) => {
      const Icon = KIND_ICON[m.kind];
      return { key: `${m.kind}:${m.id}`, pick: () => mention(m), body: <><Icon size={16} strokeWidth={1.5} aria-hidden="true" /><span className="mono">{m.id}</span><span className="muted mb-mention-name">{m.name}</span></> };
    }) : [];
  const sel = items.length ? pick % items.length : 0;
  const send = () => {
    const body = text.trim();
    if (!body || running || disabledReason) return;
    onSend(body + contextLine(chips)); setText(''); setChosen([]); ta.current?.focus();
  };
  const why = disabledReason ?? (!text.trim() ? 'Type a question first.' : undefined);
  return (
    <form className="mb-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
      {items.length > 0 && (
        <ul className="mb-composer-menu" role="listbox" id={`${id}-menu`} aria-label={q !== undefined ? 'Records' : 'Commands'} data-mentions={q !== undefined || undefined}>
          {items.map((it, i) => (
            <li key={it.key} id={`${id}-${i}`} role="option" aria-selected={i === sel} onPointerDown={(e) => { e.preventDefault(); it.pick(); }}>{it.body}</li>
          ))}
        </ul>
      )}
      {chips.length > 0 && (
        <div className="mb-composer-chips" aria-label="Records named">
          {chips.map((m) => {
            const Icon = KIND_ICON[m.kind];
            return (
              <span key={m.id} className="mb-mention" data-kind={m.kind}>
                <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
                <span className={m.kind === 'issue' ? undefined : 'mono'} title={m.kind === 'issue' ? m.id : m.name}>{m.kind === 'issue' ? m.name : m.id}</span>
                <button type="button" className="mb-mention-x" aria-label={`Remove ${m.kind === 'issue' ? m.name : m.id}`} onClick={() => unmention(m)}><X size={12} strokeWidth={1.5} aria-hidden="true" /></button>
              </span>
            );
          })}
        </div>
      )}
      <label className="sr" htmlFor={`${id}-ask`}>Ask Mochi</label>
      <textarea id={`${id}-ask`} ref={ta} rows={1} value={text} placeholder={placeholder}
        aria-controls={items.length ? `${id}-menu` : undefined} aria-activedescendant={items.length ? `${id}-${sel}` : undefined}
        onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); setPick(0); setClosed(false); }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (items.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setPick(sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); items[sel].pick(); return; }
            if (e.key === 'Escape') { e.stopPropagation(); setClosed(true); return; }
          }
          // Enter presses the keycap, so a refused send shakes and says why instead of doing nothing
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!running) e.currentTarget.form?.querySelector<HTMLButtonElement>('button[type=submit]')?.click(); }
        }} />
      {running
        ? <Button className="mb-composer-send" variant="secondary" size="sm" type="button" aria-label="Stop" title="Stop" onClick={() => { onStop?.(); ta.current?.focus(); }}><Square size={12} strokeWidth={2} fill="currentColor" aria-hidden="true" /></Button>
        : <Button className="mb-composer-send" variant="primary" size="sm" type="submit" aria-label="Send" title="Send" disabledReason={why}><ArrowUp size={16} strokeWidth={2} aria-hidden="true" /></Button>}
    </form>
  );
}
