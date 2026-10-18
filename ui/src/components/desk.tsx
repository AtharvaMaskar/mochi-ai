// Desk components, ported from the MochiAI reference with our own copy.
import { useEffect, useState, type ReactNode } from 'react';
import { Mochi, Confidence, Button, DrawnCheck, Icon, type Mood, type IconName } from './ds.tsx';
import type { ThreadMessage } from '../../fixtures/index.ts';

const STATUS = {
  todo: { text: 'To answer', dot: 'var(--warning-dot)' },
  done: { text: 'Answered', dot: 'var(--success)' },
  left: { text: 'Left to you', dot: 'var(--ink-faint)' },
};
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function TicketRow(p: { name: string; time: string; subject: string; type?: string; p?: number; status?: keyof typeof STATUS; reading?: boolean; selected?: boolean; unread?: boolean; onClick?: () => void;
  /** Slide the row out once handled (420 ms); onLeft then removes it. */ leaving?: boolean; onLeft?: () => void }) {
  const st = STATUS[p.status ?? 'todo'];
  useEffect(() => {
    if (!p.leaving) return;
    const t = setTimeout(() => p.onLeft?.(), reduced() ? 0 : 420);
    return () => clearTimeout(t);
  }, [p.leaving]);
  return (
    <button className="mb-row" data-leaving={p.leaving || undefined} aria-current={p.selected ? 'true' : 'false'} data-unread={p.unread === undefined ? undefined : String(p.unread)} onClick={p.onClick}>
      <span className="mb-row-line"><span className="mb-row-name">{p.name}</span><span className="mono muted">{p.time}</span></span>
      <span className="mb-row-subj">{p.subject}</span>
      <span className="mb-row-foot">
        <span className="mb-row-status">
          {p.reading ? <><span className="mb-withmochi" aria-hidden="true" />Reading</> : <><span className="mb-row-dot" style={{ background: st.dot }} />{st.text}</>}
        </span>
        {!p.reading && <span className="mb-row-status">
          <span className="mb-row-type">{p.type ?? "Can't tell"}</span>
          {p.p !== undefined && <Confidence p={p.p} hidePct />}
        </span>}
      </span>
    </button>
  );
}

const KIND_WORD = { customer: 'Customer', reply: 'Reply', note: 'Internal note', mochi: 'Mochi' };
function Message({ m }: { m: ThreadMessage }) {
  const [quoted, setQuoted] = useState(false);
  return (
    <div className="mb-msg" data-kind={m.kind}>
      <div className="mb-msg-head">
        {m.kind === 'mochi' ? <Mochi size="xs" still /> : null}
        <b>{m.kind === 'mochi' ? 'Mochi' : m.author}</b>
        {m.kind !== 'customer' && m.kind !== 'mochi' && <span className="mb-msg-kind">{KIND_WORD[m.kind]}</span>}
        <span className="mono">{m.at}</span>
      </div>
      <div className="mb-msg-text">{m.text}</div>
      {m.did && <div className="mb-dids">{m.did.map((d) => <span className="mb-did" key={d}><DrawnCheck />{d}</span>)}</div>}
      {m.p !== undefined && <Confidence p={m.p} />}
      {m.quoted && <>
        <Button variant="link" size="sm" aria-expanded={quoted} onClick={() => setQuoted(!quoted)}>{quoted ? 'Hide quoted text' : 'Show quoted text'}</Button>
        {quoted && <pre className="mb-msg-quoted">{m.quoted}</pre>}
      </>}
    </div>
  );
}
export function TicketThread({ messages, collapseAfter = 6, waitingFor }: { messages: ThreadMessage[]; collapseAfter?: number; waitingFor?: string }) {
  const [all, setAll] = useState(false);
  const fold = !all && messages.length > collapseAfter;
  const shown = fold ? [messages[0], ...messages.slice(-3)] : messages;
  return (
    <div className="mb-thread">
      {shown.map((m, i) => (
        <div key={i} className="mb-thread">
          {m.day && <div className="mb-day">{m.day}</div>}
          <Message m={m} />
          {fold && i === 0 && <Button className="mb-fold" variant="link" size="sm" onClick={() => setAll(true)}>Show {messages.length - 4} earlier messages</Button>}
        </div>
      ))}
      {waitingFor && <div className="mb-waiting"><span className="mb-row-dot" style={{ background: 'var(--warning-dot)' }} />Waiting for a reply · <span className="mono">{waitingFor}</span></div>}
    </div>
  );
}

export function MochiBrief(p: { mood?: Mood; title?: string; status?: string; still?: boolean; aside?: ReactNode; loading?: boolean; children?: ReactNode }) {
  return (
    <div className="mb-brief-inner" data-mood={p.mood}>
      <div className="mb-brief-head">
        <Mochi size="sm" mood={p.mood ?? 'idle'} still={p.still} />
        <div><div className="mb-brief-title">{p.title ?? 'Mochi’s brief'}</div>{p.status && <div className="mb-brief-status">{p.status}</div>}</div>
        {p.aside}
      </div>
      <div className="mb-brief-body">
        {p.loading ? <div className="mb-skel" aria-label="Mochi is writing the brief">{[92, 70, 84, 56, 76].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div> : p.children}
      </div>
    </div>
  );
}
export function BriefSection(p: { label: string; aside?: string; did?: string[]; delay?: number; children?: ReactNode }) {
  return (
    <section className="mb-section" style={{ animationDelay: `${p.delay ?? 0}s` }}>
      <h3 className="mb-section-head"><span>{p.label}</span>{p.aside && <span>{p.aside}</span>}</h3>
      {p.did && <div className="mb-dids">{p.did.map((d) => <span className="mb-did" key={d}><DrawnCheck />{d}</span>)}</div>}
      {p.children}
    </section>
  );
}

export function Noticed(p: { children?: ReactNode; action?: string; success?: string; onAction?: () => void; note?: ReactNode }) {
  if (!p.children) return <p className="mb-noticed-quiet">Nothing unusual for this ticket.</p>;
  return (
    <div className="mb-noticed">
      <p className="mb-noticed-text">{p.children}</p>
      {p.note ? <p className="mb-noticed-note">{p.note}</p> : p.action && <Button variant="primary" success={p.success} onClick={p.onAction}>{p.action}</Button>}
    </div>
  );
}

export function CustomerHeader(p: { name: string; clientId?: string; status?: string[]; source?: string; age?: string; state?: 'found' | 'not_found' | 'unreachable'; onRetry?: () => void }) {
  const initials = p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="mb-cust">
      <div className="mb-cust-av" aria-hidden="true">{initials}</div>
      <div style={{ minWidth: 0 }}>
        <p className="mb-cust-name"><span>{p.name}</span>{p.source && <span className="mb-cust-src">{p.source}{p.age && ` · ${p.age}`}</span>}</p>
        <p className="mb-cust-line">
          {p.state === 'unreachable' ? <>I couldn’t reach the back office. <Button variant="link" size="sm" onClick={p.onRetry}>Try again</Button></>
            : p.state === 'not_found' ? 'Not found in the back office'
            : <>{p.clientId && <span className="mono">{p.clientId}</span>}{p.status?.length ? ` · ${p.status.join(' · ')}` : ''}</>}
        </p>
      </div>
    </div>
  );
}

export function CustomerHistory(p: { tickets: { id: string; on: string; subject: string; end: string }[]; continues?: string }) {
  if (!p.tickets.length) return <p className="muted">No earlier tickets from this customer.</p>;
  return (
    <div className="mb-section">
      {p.continues && <p className="mb-hist-cont">This continues <span className="mono">{p.continues}</span>.</p>}
      <ul className="mb-hist-rows">
        {p.tickets.map((t) => (
          <li key={t.id}>
            <span className="mb-hist-on">{t.on}</span>
            <span className="mb-hist-row"><span className="mb-hist-subj">{t.subject} <span className="mono muted">{t.id}</span></span><span className="mb-hist-end">{t.end}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const hello = (now: Date, name?: string) => {
  const h = Number(now.toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}.` : `${part}.`;
};
/** The greeting: a hello, what needs the team, and a receipt of what Mochi did. Numbers come in as NumPills. */
export function MochiGreeting(p: { name?: string; now?: Date; headline: ReactNode; receipt: ReactNode; action?: string; onAction?: () => void; mood?: Mood; still?: boolean }) {
  return (
    <div className="mb-greet">
      <Mochi size="md" mood={p.mood ?? 'idle'} still={p.still} />
      <div className="mb-greet-text">
        <p className="mb-greet-hello">{hello(p.now ?? new Date(), p.name)}</p>
        <p className="mb-greet-head">{p.headline}</p>
        <p className="mb-greet-receipt">{p.receipt}</p>
        {p.action && <Button variant="secondary" onClick={p.onAction}>{p.action}</Button>}
      </div>
    </div>
  );
}

export type FlowStep = { label: string; icon: IconName | 'mochi'; count: ReactNode; caption?: string; tone?: 'warn' | 'live' };
/** The dream's steps, in order, with where Mochi stands. */
export function PipelineFlow(p: { steps: FlowStep[]; summary: { text: string; tone?: 'ok' | 'warn' }; rail: { at: number; mood?: Mood; line: string };
  /** Replays the dream: Mochi walks the rail step by step and each step's check draws as it finishes. Bump to replay. */ run?: number }) {
  const [at, setAt] = useState(p.rail.at);
  useEffect(() => {
    if (!p.run) return;
    setAt(0);
    const id = setInterval(() => setAt((a) => { if (a >= p.steps.length) { clearInterval(id); return a; } return a + 1; }), 900);
    return () => clearInterval(id);
  }, [p.run]);
  const moving = at < p.steps.length;
  return (
    <section className="mb-pf" aria-label="Last night's dream">
      <div className="mb-pf-head">
        <h2 className="mb-pf-title">Last night's dream</h2>
        <p className="mb-pf-sum" data-tone={p.summary.tone} aria-live="polite"><i />{p.summary.text}</p>
      </div>
      <ol className="mb-pf-steps">
        {p.steps.map((s, i) => (
          <li key={s.label} className="mb-pf-step" data-tone={i === at ? 'live' : s.tone} style={{ animationDelay: `${i * 0.08}s` }}>
            <span className="mb-pf-label">{s.icon === 'mochi' ? <Mochi size="xs" still /> : <Icon name={s.icon} />}{s.label}{i < at && <DrawnCheck key={`c${p.run}`} />}</span>
            <span className="mb-pf-count">{i < at || !moving ? s.count : '—'}</span>
            <span className="mb-pf-cap">{s.caption}</span>
          </li>
        ))}
      </ol>
      <div className="mb-pf-rail">
        <span className="mb-pf-mochi" style={{ left: `${(Math.min(at, p.steps.length - 1) / Math.max(1, p.steps.length - 1)) * 100}%` }}>
          <Mochi size="xs" mood={moving ? 'thinking' : p.rail.mood ?? 'done'} />
        </span>
      </div>
      <p className="mb-pf-say" aria-live="polite">{moving ? `I’m on ${p.steps[at].label.toLowerCase()}.` : p.rail.line}</p>
    </section>
  );
}
