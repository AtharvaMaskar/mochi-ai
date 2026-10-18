// Tickets: queue → thread → Mochi's brief. ≥1180 three panes; 768–1179 brief as a sheet; <768 one pane with back.
// The queue and threads come from the helpdesk (through the agent); the brief, guess and history from the graph.
import { useEffect, useState } from 'react';
import { Segmented, Button, NeedsYou, Icon, Confidence } from '../components/ds.tsx';
import { TicketRow, MochiBrief, BriefSection, Noticed, CustomerHeader, CustomerHistory } from '../components/desk.tsx';
import { ToolCard } from '../components/blocks.tsx';
import { QueryTag, ReceiptProvider, useReceipts } from '../components/receipts.tsx';
import { useWidth } from '../components/shell.tsx';
import { ConversationThread } from '../components/thread.tsx';
import { draftReply } from '../components/thread-text.ts';
import { api, fmtClock, fmtDay, useData, type Guess, type TicketDetail } from '../data/api.ts';

const VIEWS = [{ id: 'ready', label: 'Ready' }, { id: 'done', label: 'Done today' }, { id: 'all', label: 'All received' }] as const;
const LINES: Record<string, string> = {
  ready: 'Tickets waiting for a person, with my brief on each.',
  done: 'Tickets your team answered today.',
  all: 'Every ticket I received, newest first.',
};
const POLL_MS = 15_000; // the helpdesk replays new tickets; the queue picks them up

/** The graph customer's name when someone else wrote in for them (a family member, an assistant). */
function writingFor(t: TicketDetail): string | null {
  const name = t.customer?.queries.q_1.rows[0]?.name;
  return name && String(name).toLowerCase() !== t.requester.name.toLowerCase() ? String(name) : null;
}

/** The confidence word opens the query that computed it. */
function GuessWord({ g }: { g: Guess }) {
  const { open } = useReceipts();
  return (
    <div className="mb-row-status">
      <span className="mb-row-type">{g.issue}</span>
      <Button variant="link" size="sm" aria-label="Open the receipt for this confidence" onClick={(e) => open(g.query_id!, e.currentTarget, g.basis === 'graph' ? 'confidence' : 'score')}>
        <Confidence p={g.p!} />
      </Button>
      <span className="t-caption muted">{g.basis === 'graph' ? 'Share of resolved tickets on this issue fixed this way' : 'Closest resolved ticket by meaning (no issue link yet)'}</span>
    </div>
  );
}

/** The view tabs; each count opens q_0, the helpdesk request that produced it. */
function ViewTabs({ view, counts, onChange }: { view: string; counts?: Record<string, number>; onChange: (v: string) => void }) {
  const { open } = useReceipts();
  return <Segmented label="Tickets" value={view} onChange={onChange}
    options={VIEWS.map((v) => ({ id: v.id, label: v.label, count: counts?.[v.id] }))} onCount={counts && ((id, el) => open('q_0', el, id))} />;
}

export function Brief({ t, onClose }: { t: TicketDetail; onClose?: () => void }) {
  const brief = useData(() => api.brief(t.id), [t.id]);
  const c = t.customer?.queries.q_1.rows[0];
  const history = (t.customer?.queries.q_2.rows ?? []).filter((r) => r.ticket !== t.id)
    .map((r) => ({ id: String(r.ticket), on: fmtDay(Number(r.created_at)), subject: String(r.subject), end: String(r.ended) }));
  const others = (t.customer?.queries.q_3.rows ?? []).filter((r) => r.ticket !== t.id).length;
  const g = t.guess;
  const noticed = t.merged_into ? <>This ticket was <b>merged into {t.merged_into}</b>. Answer there.</>
    : others ? <>This customer has <b>{others === 1 ? 'one other open ticket' : `${others} other open tickets`}</b>.</> : null;
  return (
    <MochiBrief loading={brief.loading && !brief.data} mood={brief.loading || !t.ingested ? 'thinking' : 'idle'}
      status={brief.loading ? 'I’m pulling what I know…' : !t.in_memory ? 'This ticket isn’t in my memory yet.' : !t.ingested ? 'I’ll read this ticket properly at the next dream.' : 'Read when it arrived.'}
      aside={onClose && <button className="mb-x" aria-label="Close the brief" onClick={onClose}><Icon name="close" /></button>}>
      <BriefSection label="What I noticed"><Noticed>{noticed}</Noticed></BriefSection>
      <BriefSection label="Customer" aside="From memory" delay={0.08}>
        <CustomerHeader name={t.requester.name} clientId={t.customer_id ?? undefined} state={c ? 'found' : 'not_found'}
          status={c ? [c.segment, c.plan, c.city].filter(Boolean).map(String) : undefined} />
      </BriefSection>
      <BriefSection label="Briefing" delay={0.16}>
        {brief.data ? <ToolCard card={brief.data} />
          : brief.error ? <NeedsYou reason={brief.error} action="Try again" onAction={brief.reload} /> : null}
      </BriefSection>
      <BriefSection label="My guess" delay={0.2}>
        {g?.issue && g.p !== null && g.query_id
          ? <ReceiptProvider queries={t.guess_queries}><GuessWord g={g} /></ReceiptProvider>
          : <><div className="mb-row-status"><span className="mb-row-type">Can’t tell</span></div>
            <NeedsYou reason={t.in_memory ? 'I can’t link this ticket to a known issue or a similar resolved ticket yet.' : 'This ticket hasn’t reached my memory yet.'} /></>}
      </BriefSection>
      <BriefSection label="Earlier tickets" delay={0.24}><CustomerHistory tickets={history} /></BriefSection>
    </MochiBrief>
  );
}

export function Tickets() {
  const width = useWidth();
  const [view, setView] = useState('ready');
  const list = useData(() => api.tickets(view), [view]);
  const [gone, setGone] = useState<Set<string>>(new Set()); // answered here; hidden until the next reload confirms
  const [leaving, setLeaving] = useState<string | null>(null);
  const rows = (list.data?.rows ?? []).filter((x) => !gone.has(x.id) || view !== 'ready');
  const [sel, setSel] = useState<string | null>(null);
  const [pane, setPane] = useState<'list' | 'ticket' | 'brief'>('list');
  const [sheet, setSheet] = useState(false);
  const [read, setRead] = useState<Set<string>>(new Set());
  const detail = useData(() => (sel ? api.ticket(sel) : Promise.resolve(null)), [sel]);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const t = detail.data && detail.data.id === sel ? detail.data : null;

  useEffect(() => { const id = setInterval(list.reload, POLL_MS); return () => clearInterval(id); }, [list.reload]);
  useEffect(() => { if (width >= 768 && !sel && rows[0]) setSel(rows[0].id); }, [width, view, rows[0]?.id]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(false); };
    addEventListener('keydown', esc); return () => removeEventListener('keydown', esc);
  }, []);
  const open = (id: string) => { setSel(id); setPane('ticket'); setRead(new Set(read).add(id)); };
  // A handled ticket slides out of Ready; the next one opens.
  const handled = (id: string) => {
    const rest = rows.filter((x) => x.id !== id);
    setGone(new Set(gone).add(id));
    setLeaving(null);
    if (view === 'ready') setSel(width >= 768 ? rest[0]?.id ?? null : null);
    list.reload(); detail.reload();
  };
  const answer = async (id: string, text: string) => {
    setAnswerError(null);
    try { await api.answer(id, `${id}:${crypto.randomUUID()}`, text); } catch (e) { setAnswerError((e as Error).message); return false; }
    setTimeout(() => { if (view === 'ready') setLeaving(id); else handled(id); }, 500);
    return true;
  };
  const forName = t && writingFor(t);
  const counts = list.data?.counts;

  return (
    <div className="mb-desk" data-sheet={sheet || undefined}>
      <aside className="mb-pane mb-queue" data-show={pane === 'list' || undefined} aria-label="Tickets">
        <ReceiptProvider queries={list.data?.queries ?? {}}>
          <div className="mb-queue-head">
            <ViewTabs view={view} counts={counts} onChange={(v) => { setView(v); setSel(null); }} />
            <p className="t-caption muted">{LINES[view]}{counts && <> <QueryTag qid="q_0" /></>}</p>
          </div>
        </ReceiptProvider>
        {list.error && !list.data ? <NeedsYou mood="sorry" title="I can’t load the tickets" reason={list.error} action="Try again" onAction={list.reload} />
          : !list.data ? <div className="mb-skel" aria-label="Loading tickets">{[80, 64, 72].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>
          : rows.length ? rows.map((x) => (
            <TicketRow key={x.id} name={x.name} time={fmtDay(x.created_at, list.data!.sim_now) === 'Today' ? fmtClock(x.created_at) : fmtDay(x.created_at, list.data!.sim_now)}
              subject={x.subject} type={x.guess.issue ?? undefined} p={x.guess.p ?? undefined} status={x.state}
              reading={x.reading && x.state === 'todo'} selected={x.id === sel} unread={x.state === 'todo' ? !read.has(x.id) : false} onClick={() => open(x.id)}
              leaving={leaving === x.id && view === 'ready'} onLeft={() => handled(x.id)} />
          )) : <div className="mb-empty"><span className="t-body">{view === 'ready' ? 'Nothing to answer right now.' : 'No tickets here yet.'}</span></div>}
      </aside>

      <main className="mb-pane mb-ticket" data-show={pane === 'ticket' || undefined} aria-label="Ticket">
        {width < 768 && <Button className="mb-back" variant="link" size="sm" onClick={() => setPane('list')}><Icon name="back" />Tickets</Button>}
        {t ? <>
          <div className="mb-ticket-head">
            <div>
              <h1 className="t-title">{t.subject}</h1>
              <p className="t-caption muted">{t.requester.name}{forName && <>, writing for {forName}</>}
                {t.customer_id && <> · <span className="mono">{t.customer_id}</span></>} · <span className="mono">{t.id}</span></p>
            </div>
            <div className="mb-prev-row" style={{ gap: 'var(--space-2)' }}>
              {width < 1180 && <Button size="sm" onClick={() => (width < 768 ? setPane('brief') : setSheet(true))}>Open Mochi’s brief</Button>}
            </div>
          </div>
          <ConversationThread key={t.id} messages={t.thread} source={t.source}
            next={t.state === 'todo' ? { to: t.requester.name, onSend: (text) => answer(t.id, text),
              draft: draftReply({ requester: t.requester.name, customer: forName, resolution: t.guess?.resolution }) } : undefined} />
          {answerError && <NeedsYou mood="sorry" title="I couldn’t send the reply" reason={answerError} />}
        </> : detail.error ? <NeedsYou mood="sorry" title="I can’t open this ticket" reason={detail.error} action="Try again" onAction={detail.reload} />
          : sel ? <div className="mb-skel" aria-label="Loading the ticket">{[92, 70, 84].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>
          : <div className="mb-empty"><span className="t-body">Pick a ticket to read it here.</span></div>}
      </main>

      <div className="mb-sheet-scrim" onClick={() => setSheet(false)} />
      <aside className="mb-pane mb-brief" data-show={pane === 'brief' || undefined} aria-label="Mochi’s brief">
        {width < 768 && <Button className="mb-back" variant="link" size="sm" onClick={() => setPane('ticket')}><Icon name="back" />Ticket</Button>}
        {t ? <Brief key={t.id} t={t} onClose={width >= 768 && width < 1180 ? () => setSheet(false) : undefined} /> : null}
      </aside>
    </div>
  );
}
