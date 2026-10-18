// Tickets: queue → thread → Mochi's brief. ≥1180 three panes; 768–1179 brief as a sheet; <768 one pane with back.
import { useEffect, useState } from 'react';
import { tickets as fixtureTickets, type DeskTicket } from '../../fixtures/index.ts';
import { Segmented, Button, NeedsYou, Icon, Confidence } from '../components/ds.tsx';
import { TicketRow, TicketThread, MochiBrief, BriefSection, Noticed, CustomerHeader, CustomerHistory } from '../components/desk.tsx';
import { ToolCard } from '../components/blocks.tsx';
import { useWidth } from '../components/shell.tsx';

const VIEWS = [
  { id: 'ready', label: 'Ready', test: (t: DeskTicket) => t.status === 'todo' },
  { id: 'done', label: 'Done today', test: (t: DeskTicket) => t.status === 'done' },
  { id: 'all', label: 'All received', test: () => true },
];
const LINES: Record<string, string> = {
  ready: 'Tickets waiting for a person, with my brief on each.',
  done: 'Tickets your team answered today.',
  all: 'Every ticket I received, newest first.',
};

export function Brief({ t, onClose }: { t: DeskTicket; onClose?: () => void }) {
  // The brief fills: shimmer while the briefing tool runs, then sections rise in, 0.08 s apart.
  const [loading, setLoading] = useState(true);
  useEffect(() => { setLoading(true); const id = setTimeout(() => setLoading(false), 550); return () => clearTimeout(id); }, [t.id]);
  return (
    <MochiBrief loading={loading} mood={loading || t.reading ? 'thinking' : 'idle'}
      status={loading ? 'I’m pulling what I know…' : t.reading ? 'I’m still reading this ticket.' : 'Read when it arrived.'}
      aside={onClose && <button className="mb-x" aria-label="Close the brief" onClick={onClose}><Icon name="close" /></button>}>
      <BriefSection label="What I noticed"><Noticed action={t.noticed && t.continues ? `Link #${t.continues}` : undefined} success="Linked">
        {t.noticed?.split("**").map((s, i) => (i % 2 ? <b key={i}>{s}</b> : s))}
      </Noticed></BriefSection>
      <BriefSection label="Customer" aside="E Corp back office" delay={0.08}>
        <CustomerHeader name={t.customer.name} clientId={t.customer.clientId} status={t.customer.status} />
      </BriefSection>
      <BriefSection label="Briefing" delay={0.16}>
        {t.briefing ? <ToolCard card={t.briefing} />
          : <NeedsYou reason={t.reading ? 'I haven’t finished reading this ticket.' : 'I found no similar resolved tickets in memory.'} />}
      </BriefSection>
      {t.type && t.p !== undefined && <BriefSection label="My guess" delay={0.2}>
        <div className="mb-row-status"><span className="mb-row-type">{t.type}</span><Confidence p={t.p} /></div>
      </BriefSection>}
      <BriefSection label="Earlier tickets" delay={0.24}><CustomerHistory tickets={t.history} continues={t.continues} /></BriefSection>
    </MochiBrief>
  );
}

export function Tickets() {
  const width = useWidth();
  const [view, setView] = useState('ready');
  const [all, setAll] = useState(fixtureTickets);
  const [leaving, setLeaving] = useState<string | null>(null);
  const list = all.filter(VIEWS.find((v) => v.id === view)!.test);
  const [sel, setSel] = useState<string | null>(width >= 768 ? list[0]?.id ?? null : null);
  const [pane, setPane] = useState<'list' | 'ticket' | 'brief'>('list');
  const [sheet, setSheet] = useState(false);
  const [read, setRead] = useState<Set<string>>(new Set());
  const t = all.find((x) => x.id === sel);
  // A handled ticket slides out of Ready; the next one opens.
  const handled = (id: string) => {
    const rest = list.filter((x) => x.id !== id);
    setAll(all.map((x) => (x.id === id ? { ...x, status: 'done' } : x)));
    setLeaving(null);
    if (view === 'ready') setSel(width >= 768 ? rest[0]?.id ?? null : null);
  };

  useEffect(() => { if (width >= 768 && !sel && list[0]) setSel(list[0].id); }, [width, view]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(false); };
    addEventListener('keydown', esc); return () => removeEventListener('keydown', esc);
  }, []);
  const open = (id: string) => { setSel(id); setPane('ticket'); setRead(new Set(read).add(id)); };

  return (
    <div className="mb-desk" data-sheet={sheet || undefined}>
      <aside className="mb-pane mb-queue" data-show={pane === 'list' || undefined} aria-label="Tickets">
        <div className="mb-queue-head">
          <Segmented label="Tickets" value={view} onChange={(v) => { setView(v); setSel(null); }}
            options={VIEWS.map((v) => ({ id: v.id, label: v.label, count: all.filter(v.test).length }))} />
          <p className="t-caption muted">{LINES[view]}</p>
        </div>
        {list.length ? list.map((x) => (
          <TicketRow key={x.id} name={x.name} time={x.time} subject={x.subject} type={x.type} p={x.p} status={x.status}
            reading={x.reading} selected={x.id === sel} unread={x.unread ? !read.has(x.id) : false} onClick={() => open(x.id)}
            leaving={leaving === x.id && view === 'ready'} onLeft={() => handled(x.id)} />
        )) : <div className="mb-empty"><span className="t-body">Nothing to answer right now.</span></div>}
      </aside>

      <main className="mb-pane mb-ticket" data-show={pane === 'ticket' || undefined} aria-label="Ticket">
        {width < 768 && <Button className="mb-back" variant="link" size="sm" onClick={() => setPane('list')}><Icon name="back" />Tickets</Button>}
        {t ? <>
          <div className="mb-ticket-head">
            <div>
              <h1 className="t-title">{t.subject}</h1>
              <p className="t-caption muted">{t.name} · <span className="mono">{t.id}</span></p>
            </div>
            <div className="mb-prev-row" style={{ gap: 'var(--space-2)' }}>
              {width < 1180 && <Button size="sm" onClick={() => (width < 768 ? setPane('brief') : setSheet(true))}>Open Mochi’s brief</Button>}
              {t.status === 'todo' && <Button variant="primary" size="sm" success="Answered"
                onClick={() => setTimeout(() => { setLeaving(t.id); if (view !== 'ready') handled(t.id); }, 500)}>Mark answered</Button>}
            </div>
          </div>
          <TicketThread messages={t.thread} waitingFor={t.waitingFor} />
        </> : <div className="mb-empty"><span className="t-body">Pick a ticket to read it here.</span></div>}
      </main>

      <div className="mb-sheet-scrim" onClick={() => setSheet(false)} />
      <aside className="mb-pane mb-brief" data-show={pane === 'brief' || undefined} aria-label="Mochi’s brief">
        {width < 768 && <Button className="mb-back" variant="link" size="sm" onClick={() => setPane('ticket')}><Icon name="back" />Ticket</Button>}
        {t ? <Brief t={t} onClose={width >= 768 && width < 1180 ? () => setSheet(false) : undefined} /> : null}
      </aside>
    </div>
  );
}
