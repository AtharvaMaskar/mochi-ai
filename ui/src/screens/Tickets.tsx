// Tickets: queue → thread → Mochi's brief. ≥1180 three panes; 768–1179 brief as a sheet; <768 one pane with back.
// The queue and threads come from the helpdesk (through the agent); the brief, guess and history from the graph.
import { useEffect, useRef, useState } from 'react';
import { Segmented, Button, NeedsYou, Icon } from '../components/ds.tsx';
import { Check, PanelRightOpen, PanelRightClose } from 'lucide-react';
import type { StoredQuery, Visual } from '@mochi/contracts';
import { TicketRow, MochiBrief, Disclosure, useStored } from '../components/desk.tsx';
import { BlockView, Table, FixGroups, HistoryList, groupFixes, historyRows } from '../components/blocks.tsx';
import { QueryTag, PathReceipt, ReceiptProvider, useReceipts } from '../components/receipts.tsx';
import { useWidth } from '../components/shell.tsx';
import { BriefSummary } from '../components/brief-summary.tsx';
import { ConversationThread } from '../components/thread.tsx';
import { api, fmtClock, fmtDay, useData, type TicketDetail } from '../data/api.ts';

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

/** The view tabs; each count opens q_0, the helpdesk request that produced it. */
function ViewTabs({ view, counts, onChange }: { view: string; counts?: Record<string, number>; onChange: (v: string) => void }) {
  const { open } = useReceipts();
  return <Segmented label="Tickets" value={view} onChange={onChange}
    options={VIEWS.map((v) => ({ id: v.id, label: v.label, count: counts?.[v.id] }))} onCount={counts && ((id, el) => open('q_0', el, id))} />;
}

const qname = (q?: StoredQuery) => (q && /mochi:([\w.]+)@/.exec(q.cypher)?.[1]) || '';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function Brief({ t, onClose }: { t: TicketDetail; onClose?: () => void }) {
  const brief = useData(() => api.brief(t.id), [t.id]);
  const [wide, setWide] = useStored('mochi.brief.wide');

  // The brief's blocks, picked by the stored query's name. The customer table is the customer line above, so it is not repeated.
  const card = brief.data, qs = card?.queries ?? {};
  const blocks = (card?.blocks ?? []) as Visual[];
  const named = (n: string) => blocks.find((b) => qname(qs[b.query_id]) === n);
  const sugg = blocks.filter((b): b is Extract<Visual, { type: 'suggestion' }> => b.type === 'suggestion');
  const similar = named('briefing.similar'), prefs = named('memory.preferences');
  const hist = ['briefing.recent', 'memory.customer_before'].map(named).filter((b) => b !== undefined);
  const used = new Set([named('briefing.profile'), similar, prefs, ...hist, ...sugg]);
  const rest = blocks.filter((b) => !used.has(b));
  const histN = historyRows(qs, hist.map((b) => b.query_id), t.id).length;
  const fixes = similar ? groupFixes(qs[similar.query_id]?.rows ?? []) : [];
  const memN = prefs ? qs[prefs.query_id]?.rows.length ?? 0 : 0;
  const pathTypes = card?.path ? [card.path.nodes[0]?.label, card.path.nodes.at(-1)?.label].filter(Boolean).join(' to ') : '';

  return (
    <MochiBrief loading={brief.loading && !brief.data} mood={brief.loading || !t.ingested ? 'thinking' : 'idle'} wide={wide}
      status={brief.loading ? 'I’m pulling what I know…' : !t.in_memory ? 'This ticket isn’t in my memory yet.' : !t.ingested ? 'I’ll read this ticket properly at the next dream.' : 'Read when it arrived.'}
      aside={<span className="mb-brief-acts">
        <button className="mb-x mb-brief-wide" aria-label={wide ? 'Narrow the brief' : 'Expand the brief'} aria-pressed={wide} onClick={() => setWide(!wide)}>
          {wide ? <PanelRightClose className="mb-icon" size={16} strokeWidth={1.5} aria-hidden="true" /> : <PanelRightOpen className="mb-icon" size={16} strokeWidth={1.5} aria-hidden="true" />}
        </button>
        {onClose && <button className="mb-x" aria-label="Close the brief" onClick={onClose}><Icon name="close" /></button>}
      </span>}>
      <BriefSummary t={t} qs={qs} sugg={sugg} working={brief.loading} mood={brief.loading || !t.ingested ? 'thinking' : 'idle'} />

      {brief.error && !card && <NeedsYou reason={brief.error} action="Try again" onAction={brief.reload} />}
      {card && <ReceiptProvider queries={qs}>
        <div className="mb-evid">
          {card.path && <Disclosure id="path" label="The path I walked" preview={plural(card.path.nodes.length, 'step') + (pathTypes ? ` · ${pathTypes}` : '')} pills={<QueryTag qid={card.path.query_id} />}>
            <PathReceipt path={card.path} bare />
          </Disclosure>}
          {similar && <Disclosure id="similar" label="What fixed similar tickets" pills={<QueryTag qid={similar.query_id} />}
            preview={fixes.length ? `${plural(fixes.length, 'fix', 'fixes')} · ${plural(fixes.reduce((n, f) => n + f.tickets.length, 0), 'ticket')}` : 'None yet'}>
            <FixGroups query_id={similar.query_id} />
          </Disclosure>}
          {hist.length > 0 && <Disclosure id="history" label="Customer history" preview={histN ? plural(histN, 'earlier ticket') : 'None yet'}
            pills={<span className="mb-disc-pills">{hist.map((b) => <QueryTag key={b.query_id} qid={b.query_id} />)}</span>}>
            <HistoryList qids={hist.map((b) => b.query_id)} exclude={t.id} />
          </Disclosure>}
          {prefs?.type === 'table' && <Disclosure id="memory" label="From your memory" preview={memN ? plural(memN, 'note') : 'None yet'} pills={<QueryTag qid={prefs.query_id} />}>
            <Table {...prefs} brief bare />
          </Disclosure>}
          {rest.map((b, i) => b.type === 'table' ? <Table key={i} {...b} brief exclude={t.id} /> : <BlockView key={i} v={b} />)}
        </div>
      </ReceiptProvider>}
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
  // On a switch the last ticket stays, dimmed, until the next one lands: the click answers at once and nothing reflows.
  const t = detail.data && !detail.error ? detail.data : null;
  const stale = !!t && t.id !== sel;
  const ticketPane = useRef<HTMLElement>(null);
  useEffect(() => { ticketPane.current?.scrollTo({ top: 0 }); }, [t?.id]); // a new ticket opens at its top
  const [claimed, setClaimed] = useState<Set<string>>(new Set()); // claimed here; the next reload confirms
  const [claimError, setClaimError] = useState<string | null>(null);
  const claim = async (id: string) => {
    setClaimError(null);
    try { await api.claim(id); } catch (e) { setClaimError((e as Error).message); return false; }
    setClaimed((s) => new Set(s).add(id));
    return true;
  };

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
  const isClaimed = !!t && (!!t.claimed || claimed.has(t.id));
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
              leaving={leaving === x.id && view === 'ready'} onLeft={() => handled(x.id)} mine={x.mine || claimed.has(x.id)} />
          )) : <div className="mb-empty"><span className="t-body">{view === 'ready' ? 'Nothing to answer right now.' : 'No tickets here yet.'}</span></div>}
      </aside>

      <main ref={ticketPane} className="mb-pane mb-ticket" data-show={pane === 'ticket' || undefined} data-stale={stale || undefined} aria-label="Ticket" aria-busy={stale || undefined}>
        {width < 768 && <Button className="mb-back" variant="link" size="sm" onClick={() => setPane('list')}><Icon name="back" />Tickets</Button>}
        {t ? <>
          <div className="mb-ticket-head" key={`head-${t.id}`}>
            <div>
              <h1 className="t-title">{t.subject}</h1>
              <p className="t-caption muted">{t.requester.name}{forName && <>, writing for {forName}</>}
                {t.customer_id && <> · <span className="mono">{t.customer_id}</span></>} · <span className="mono">{t.id}</span></p>
            </div>
            <div className="mb-prev-row" style={{ gap: 'var(--space-2)' }}>
              {t.state === 'todo' && (isClaimed ? <span className="mb-claimed"><Check size={16} strokeWidth={1.5} aria-hidden="true" />Claimed by you</span>
                : <Button size="sm" onClick={() => void claim(t.id)}>Claim</Button>)}
              {width < 1180 && <Button size="sm" onClick={() => (width < 768 ? setPane('brief') : setSheet(true))}>Open Mochi’s brief</Button>}
            </div>
          </div>
          {claimError && <NeedsYou mood="sorry" title="I couldn’t claim this ticket" reason={claimError} />}
          <ConversationThread key={`thread-${t.id}`} messages={t.thread} source={t.source}
            next={t.state === 'todo' ? { ticketId: t.id, to: t.requester.name, claimed: isClaimed, onClaim: () => claim(t.id), onSend: (text) => answer(t.id, text) } : undefined} />
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
