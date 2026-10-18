// Conversations sidebar: this browser's chat threads, newest first, kept in localStorage as {id, title, at}[]. The
// agent restores a durable conversation by threadId, so switching is only a new threadId.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { PanelLeftClose, PanelLeftOpen, SquarePen } from 'lucide-react';

type Thread = { id: string; title: string; at: number };
const KEY = 'mochi-threads', EVT = 'mochi-threads-changed';
const read = (): string => { try { return localStorage.getItem(KEY) ?? '[]'; } catch { return '[]'; } };
const parse = (raw: string): Thread[] => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; } };

/** Add a thread the first time it has a user message; its title is that message. */
export function rememberThread(id: string, first: string) {
  const all = parse(read());
  if (all.some((t) => t.id === id)) return;
  const title = first.replace(/\s+/g, ' ').trim().slice(0, 80);
  try { localStorage.setItem(KEY, JSON.stringify([{ id, title, at: Date.now() }, ...all].slice(0, 50))); } catch { /* storage blocked */ }
  dispatchEvent(new Event(EVT));
}

/** A remembered open/closed flag (defaults open). */
export function useThreadsOpen(key: string): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== '0'; } catch { return true; } });
  // below 1180px the sidebar is an overlay: start closed there
  useEffect(() => { if (innerWidth < 1180) setOpen(false); }, []);
  return [open, (v) => { setOpen(v); if (innerWidth >= 1180) try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* storage blocked */ } }];
}

/** A command message reads as words: "/story X" -> "Story: X". */
const plain = (t: string) => t.replace(/^\/(story|dashboard)\s+/, (_, k: string) => (k === 'story' ? 'Story: ' : 'Dashboard: '));
const ago = (at: number, now: number) => {
  const m = Math.round((now - at) / 60_000);
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const subscribe = (f: () => void) => { addEventListener(EVT, f); addEventListener('storage', f); return () => { removeEventListener(EVT, f); removeEventListener('storage', f); }; };
/** The current conversation's title for the centre header, or null before its first message. */
export function useThreadTitle(id: string): string | null {
  const t = parse(useSyncExternalStore(subscribe, read)).find((x) => x.id === id);
  return t ? plain(t.title) : null;
}

const icon = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;
/** Open: header (Chats, collapse), a "New conversation" row, the list. Collapsed: a 48px strip (expand, new). */
export function Threads({ current, open, onPick, onNew, onToggle }: { current: string; open: boolean; onPick: (id: string) => void; onNew: () => void; onToggle: (open: boolean) => void }) {
  const list = parse(useSyncExternalStore(subscribe, read));
  const now = Date.now();
  if (!open) return (
    <nav className="mb-threads mb-strip" data-collapsed aria-label="Conversations">
      <div className="mb-col-head"><button type="button" className="mb-icon-btn" aria-label="Show conversations" title="Show conversations" onClick={() => onToggle(true)}><PanelLeftOpen {...icon} /></button></div>
      <div className="mb-strip-body"><button type="button" className="mb-icon-btn" aria-label="New conversation" title="New conversation" onClick={onNew}><SquarePen {...icon} /></button></div>
    </nav>
  );
  return (
    <nav className="mb-threads" aria-label="Conversations">
      <div className="mb-col-head">
        <span className="mb-col-title">Chats</span>
        <button type="button" className="mb-icon-btn" aria-label="Hide conversations" title="Hide conversations" onClick={() => onToggle(false)}><PanelLeftClose {...icon} /></button>
      </div>
      <ul>
        <li><button type="button" className="mb-thread-row mb-thread-new" onClick={onNew}><SquarePen {...icon} /><span className="mb-thread-title">New conversation</span></button></li>
        {list.map((t) => (
          <li key={t.id}>
            <button type="button" className="mb-thread-row" aria-current={t.id === current ? 'true' : undefined} onClick={() => onPick(t.id)}>
              <span className="mb-thread-title">{plain(t.title)}</span>
              <span className="mono mb-thread-at">{ago(t.at, now)}</span>
            </button>
          </li>
        ))}
      </ul>
      {!list.length && <p className="t-caption muted mb-threads-empty">Your conversations show up here.</p>}
    </nav>
  );
}

