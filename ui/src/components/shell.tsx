// Shell: hash router, top bar (brand, ScreenNav, MochiIsland), width hook.
import { useEffect, useState } from 'react';
import { Mochi } from './ds.tsx';
import { api, fmtClock, useData, useDream } from '../data/api.ts';

export type Route =
  | { name: 'tickets' } | { name: 'overview' } | { name: 'chat' } | { name: 'preview' }
  | { name: 'report'; id: string; version?: number; asOf?: number; kind?: 'story' | 'dashboard' }; // kind absent: #/r/ (redirects)

export function parseHash(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const asOfRaw = new URLSearchParams(query).get('asOf');
  const asOf = asOfRaw && /^\d+$/.test(asOfRaw) ? Number(asOfRaw) : undefined;
  const r = path.match(/^\/(r|story|dashboard)\/([A-Za-z0-9_-]+)(?:@(\d+))?$/);
  if (r) return { name: 'report', id: r[2], version: r[3] ? Number(r[3]) : undefined, asOf, kind: r[1] === 'r' ? undefined : r[1] as 'story' | 'dashboard' };
  if (path === '/overview' || path === '/today') return { name: 'overview' };
  if (path === '/chat') return { name: 'chat' };
  if (path === '/preview') return { name: 'preview' };
  return { name: 'tickets' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => { setRoute(parseHash(location.hash)); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function useWidth(): number {
  const [w, setW] = useState(() => innerWidth);
  useEffect(() => { const on = () => setW(innerWidth); addEventListener('resize', on); return () => removeEventListener('resize', on); }, []);
  return w;
}

export const SCREENS = [
  { id: 'tickets', label: 'Tickets', href: '#/' },
  { id: 'overview', label: 'Overview', href: '#/overview' },
  { id: 'report', label: 'Reports', href: '#/r/latest' },
  { id: 'chat', label: 'Chat', href: '#/chat' },
];

export function ScreenNav(p: { items: typeof SCREENS; current: string; fill?: boolean; label?: string }) {
  return (
    <nav className="mb-nav" data-fill={p.fill || undefined} aria-label={p.label ?? 'Screens'}>
      {p.items.map((i) => <a key={i.id} href={i.href} aria-current={i.id === p.current ? 'page' : undefined}>{i.label}</a>)}
    </nav>
  );
}

/** Mochi's one live presence. Compact: what Mochi is doing. Working: the moving edge. */
export function MochiIsland(p: { state?: 'compact'; working?: boolean; line: string }) {
  return (
    <div className="mb-island-host">
      <div className="mb-island" data-working={p.working || undefined} role="status" aria-live="polite">
        <Mochi size="sm" mood={p.working ? 'thinking' : 'idle'} squishable={false} label={p.working ? 'Mochi, working' : 'Mochi, idle'} />
        <span className="mb-island-t">{p.line}</span>
        {p.working && <span className="mb-island-live" aria-hidden="true" />}
      </div>
    </div>
  );
}

const STEP_WORD: Record<string, string> = { ingest: 'reading tickets', cluster: 'clustering', retire: 'retiring old facts', mismatch: 'checking the docs', report: 'writing the report' };
/** The island follows the dream's progress, then new tickets waiting in memory, then the last dream. */
function useIsland(): { working: boolean; line: string } {
  const dream = useDream();
  const o = useData(() => api.overview(), [dream.running]);
  useEffect(() => { const id = setInterval(o.reload, 30_000); return () => clearInterval(id); }, [o.reload]);
  if (dream.running) return { working: true, line: `I’m dreaming: ${STEP_WORD[dream.step ?? 'ingest']}` };
  const pending = Number(o.data?.queries.q_1?.rows[0]?.pending ?? 0);
  if (pending > 0) return { working: true, line: 'I’m reading new tickets' };
  const last = o.data?.dream.last_run;
  if (last) return { working: false, line: `I dreamed at ${fmtClock(last)}. The morning report is ready.` };
  return { working: false, line: o.error ? 'I can’t reach the agent right now.' : 'I haven’t dreamed yet.' };
}

export function TopBar({ current }: { current: string; working?: boolean }) {
  const island = useIsland();
  return (
    <>
      <header className="mb-bar">
        <div className="mb-bar-left">
          <a className="mb-brand" href="#/"><Mochi size="xs" still squishable={false} label="Mochi" />Mochi Brain</a>
          <ScreenNav items={SCREENS} current={current} />
        </div>
        <MochiIsland working={island.working} line={island.line} />
        <div />
      </header>
      <div className="mb-navrow"><ScreenNav items={SCREENS} current={current} fill /></div>
    </>
  );
}
