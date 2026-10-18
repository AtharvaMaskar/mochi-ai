// Conversations sidebar: this browser's chat threads, newest first, kept in localStorage as {id, title, at}[]. The
// agent restores a durable conversation by threadId, so switching is only a new threadId.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { PanelLeftClose, SquarePen } from 'lucide-react';
import { Button } from '../ds.tsx';

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

export function Threads({ current, onPick, onNew, onClose }: { current: string; onPick: (id: string) => void; onNew: () => void; onClose: () => void }) {
  const raw = useSyncExternalStore((f) => { addEventListener(EVT, f); addEventListener('storage', f); return () => { removeEventListener(EVT, f); removeEventListener('storage', f); }; }, read);
  const list = parse(raw);
  const now = Date.now();
  return (
    <nav className="mb-threads" aria-label="Conversations">
      <div className="mb-threads-head">
        <Button size="sm" onClick={onNew}><SquarePen size={16} strokeWidth={1.5} aria-hidden="true" />New conversation</Button>
        <button type="button" className="mb-icon-btn" aria-label="Hide conversations" onClick={onClose}><PanelLeftClose size={16} strokeWidth={1.5} aria-hidden="true" /></button>
      </div>
      {list.length ? (
        <ul>
          {list.map((t) => (
            <li key={t.id}>
              <button type="button" className="mb-thread-row" aria-current={t.id === current ? 'true' : undefined} onClick={() => onPick(t.id)}>
                <span className="mb-thread-title">{plain(t.title)}</span>
                <span className="mono mb-thread-at">{ago(t.at, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="t-caption muted mb-threads-empty">Your conversations show up here.</p>}
    </nav>
  );
}
