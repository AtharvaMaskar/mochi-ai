// The ticket as a conversation: messages on a spine, the time between them, folded email noise,
// and the next reply at the end: Mochi's model draft, its fix plan, and one primary action (claim, then send).
import { useEffect, useRef, useState } from 'react';
import { Ellipsis, Globe, Lock, Mail, MessageSquare, Phone, type LucideIcon } from 'lucide-react';
import { Button, DrawnCheck, Mochi, NeedsYou } from './ds.tsx';
import { QueryTag, ReceiptProvider } from './receipts.tsx';
import { api, fmtClock, fmtDay, type Draft, type DraftHint, type Msg } from '../data/api.ts';
import { foldNoise, gapWords } from './thread-text.ts';

// Freshdesk ticket source codes (sim ticket_fields).
const CHANNEL: Record<number, { word: string; icon: LucideIcon }> = {
  1: { word: 'Email', icon: Mail }, 2: { word: 'Portal', icon: Globe }, 3: { word: 'Phone', icon: Phone },
  7: { word: 'Chat', icon: MessageSquare }, 9: { word: 'Feedback widget', icon: MessageSquare }, 10: { word: 'Outbound email', icon: Mail },
};
const ic = (I: LucideIcon) => <I size={16} strokeWidth={1.5} aria-hidden="true" />;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function Message({ m, channel, isNew }: { m: Msg; channel?: (typeof CHANNEL)[number]; isNew: boolean }) {
  const [open, setOpen] = useState(false);
  const { body, folded } = foldNoise(m.text);
  const noise = [folded, m.quoted].filter(Boolean).join('\n\n');
  return (
    <li className="mb-tt-item" data-kind={m.kind} data-new={isNew || undefined}>
      <span className="mb-tt-av" aria-hidden="true">{m.kind === 'note' ? ic(Lock) : initials(m.author)}</span>
      <article className="mb-tt-msg">
        <header className="mb-tt-head">
          <b>{m.author}</b>
          <span className="mb-tt-kind">{m.kind === 'customer' ? 'wrote' : m.kind === 'reply' ? 'replied' : 'Internal note'}</span>
          {m.kind !== 'note' && channel && <span className="mb-tt-chan" title={`Via ${channel.word}`}>{ic(channel.icon)}{channel.word}</span>}
          <span className="mono mb-tt-at">{fmtClock(m.at)}</span>
        </header>
        <div className="mb-tt-text">{body}</div>
        {noise && <>
          <button className="mb-tt-fold" aria-expanded={open} aria-label={open ? 'Hide signature and quoted text' : 'Show signature and quoted text'} onClick={() => setOpen(!open)}>{ic(Ellipsis)}</button>
          {open && <div className="mb-tt-noise">{noise}</div>}
        </>}
      </article>
    </li>
  );
}

// ponytail: drafts cached per ticket for this tab, so reopening a ticket doesn't spend another model call.
const drafts = new Map<string, Draft>();
const REVEAL_CAP = 1200; // ms: a long draft still finishes revealing quickly
const TONES:{ hint: DraftHint; label: string }[] = [{ hint: 'shorter', label: 'Shorter' }, { hint: 'warmer', label: 'Warmer' }];

export type Next = { ticketId: string; to: string; claimed: boolean; onClaim: () => Promise<boolean>; onSend: (text: string) => Promise<boolean> };

/** The next reply: Mochi drafts with the model, the agent works the fix plan, claims, and sends. */
function Composer(p: Next) {
  const cached = drafts.get(p.ticketId);
  const [draft, setDraft] = useState<Draft | undefined>(cached);
  const [busy, setBusy] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(cached?.text ?? '');
  const [ticked, setTicked] = useState<boolean[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);
  const [arrived, setArrived] = useState(0); // bumps when a new draft lands, so only that text rises in
  const started = useRef(false);

  const [reveal, setReveal] = useState(false);
  const revealT = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(revealT.current), []);
  const run = (hint?: DraftHint) => {
    setBusy(true); setError(null);
    api.draft(p.ticketId, hint, hint ? text : undefined).then((d) => {
      drafts.set(p.ticketId, d);
      setDraft(d); setText(d.text); setArrived((n) => n + 1);
      // The arriving words blur in once (40 ms stagger, capped), then the editable field takes over at the same size.
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setReveal(true); clearTimeout(revealT.current);
        revealT.current = setTimeout(() => setReveal(false), Math.min(d.text.split(/\s+/).length * 40, REVEAL_CAP) + 360);
      }
      setTicked((t) => (t.length === d.steps.length ? t : d.steps.map(() => false)));
      setBusy(false);
    }, (e: Error) => { setError(e.message); setBusy(false); });
  };
  useEffect(() => { if (!started.current && !cached) { started.current = true; run(); } }, []);

  const steps = draft?.steps ?? [];
  const todo = steps.slice(0, -1); // the last step is this reply: sending ticks it
  const allDone = todo.every((_, i) => ticked[i]);
  const edited = !!draft && text !== draft.text;
  const act = async (f: () => Promise<boolean>) => { setWorking(true); const ok = await f(); setWorking(false); return ok; };
  const send = async () => { setConfirm(false); if (await act(() => p.onSend(text.trim()))) setTicked(steps.map(() => true)); };
  const say = busy ? 'I’m drafting a reply from the likely fix.'
    : error ? 'I couldn’t draft this one. Write the reply here.'
    : edited ? 'You edited my draft.' : 'Nothing is done yet. Work the steps, then send.';

  return (
    <li className="mb-tt-item" data-kind="next">
      <span className="mb-tt-av" aria-hidden="true">{busy ? <Mochi size="xs" mood="thinking" /> : edited || error ? ic(Mail) : <Mochi size="xs" still />}</span>
      <article className="mb-tt-msg" data-ai={!(edited || error) || undefined} data-working={busy || undefined} aria-busy={busy || undefined}>
        <header className="mb-tt-head">
          <b>{edited || error ? 'Your reply' : 'Mochi’s draft'}</b>
          <span className="mb-tt-kind">to {p.to}</span>
        </header>
        <label className="mb-tt-say" htmlFor="mb-tt-compose" role="status">{say}</label>
        {error && <NeedsYou reason={error} action="Try again" onAction={() => run()} />}

        {!draft && busy ? (
          <div className="mb-tt-skel" aria-hidden="true">
            <div className="mb-skel mb-tt-skel-src"><i style={{ width: '58%' }} /></div>
            <div className="mb-skel mb-tt-skel-plan">{[40, 46, 38, 52, 30].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>
            <div className="mb-tt-skel-box mb-skel">{[92, 84, 88, 60].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}</div>
            <div className="mb-tt-skel-tone" />
          </div>
        ) : <>
          {draft?.kb && <ReceiptProvider queries={draft.queries}>
            <p className="mb-tt-src">Drafted from KB: {draft.kb} <QueryTag qid="q_1" /></p>
          </ReceiptProvider>}
          {steps.length > 0 && (
            <fieldset className="mb-tt-plan">
              <legend>{draft?.resolution ? `Likely fix: ${draft.resolution}` : 'Steps'}</legend>
              {steps.map((s, i) => {
                const last = i === steps.length - 1, on = !!ticked[i];
                return (
                  <label key={i} className="mb-tt-step" data-on={on || undefined} data-last={last || undefined}>
                    <input type="checkbox" checked={on} disabled={last}
                      onChange={() => { setConfirm(false); setTicked(steps.map((_, k) => (k === i ? !on : !!ticked[k]))); }} />
                    <span className="mb-tt-box" aria-hidden="true">{on && <DrawnCheck />}</span>
                    <span>{s}{last && <span className="muted"> · ticks when you send</span>}</span>
                  </label>
                );
              })}
            </fieldset>
          )}
          {reveal ? (
            <div className="mb-tt-input mb-tt-reveal" onPointerDown={() => setReveal(false)}>
              {text.split(/(\s+)/).map((w, i) => (/\s/.test(w) ? w
                : <span key={i} style={{ animationDelay: `${Math.min(i * 20, REVEAL_CAP)}ms` }}>{w}</span>))}
            </div>
          ) : (
            <textarea key={arrived} id="mb-tt-compose" className="mb-tt-input" value={text} readOnly={busy}
              onChange={(e) => setText(e.target.value)} placeholder="Write the reply here." />
          )}
          {draft && (
            <div className="mb-tt-tone">
              <Button variant="ai-secondary" size="sm" disabled={busy} onClick={() => run('rewrite')}>Rewrite</Button>
              {TONES.map((t) => <Button key={t.hint} variant="ai-secondary" size="sm" disabled={busy} onClick={() => run(t.hint)}>{t.label}</Button>)}
            </div>
          )}
        </>}

        <div className="mb-tt-act">
          {confirm ? (
            <div className="mb-tt-confirm" role="alert">
              <span>Send without finishing the steps?</span>
              <Button size="sm" onClick={() => setConfirm(false)}>Keep working</Button>
              <Button variant="primary" size="sm" loading={working} onClick={send}>Send anyway</Button>
            </div>
          ) : !p.claimed ? (
            <Button variant="primary" size="sm" loading={working} onClick={() => act(p.onClaim)}>Claim and start</Button>
          ) : (
            <Button variant={allDone ? 'primary' : 'secondary'} size="sm" loading={working} disabledReason={text.trim() ? undefined : 'Write a reply first.'}
              onClick={allDone ? send : () => setConfirm(true)}>Send reply</Button>
          )}
        </div>
      </article>
    </li>
  );
}

export function ConversationThread(p: { messages: Msg[]; source?: number; next?: Next }) {
  const channel = p.source !== undefined ? CHANNEL[p.source] : undefined;
  // Only messages that arrive after the thread first rendered rise in; a switch or re-render moves nothing.
  const seen = useRef(p.messages.length);
  let day = '';
  return (
    <ol className="mb-tt" aria-label="Conversation">
      {p.messages.map((m, i) => {
        const d = fmtDay(m.at), newDay = d !== day; day = d;
        const gap = i ? gapWords(m.at - p.messages[i - 1].at) : null;
        return [
          newDay && <li key={`d${i}`} className="mb-tt-mark mb-tt-day">{d}</li>,
          gap && <li key={`g${i}`} className="mb-tt-mark"><span className="mono">{gap}</span> later</li>,
          <Message key={i} m={m} channel={channel} isNew={i >= seen.current} />,
        ];
      })}
      {p.next && <Composer key={p.next.ticketId} {...p.next} />}
    </ol>
  );
}
