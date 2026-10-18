// The ticket as a conversation: messages on a spine, the time between them, folded email noise,
// and the next reply at the end (Mochi's draft in an editable composer, one primary action).
import { useState } from 'react';
import { Ellipsis, Globe, Lock, Mail, MessageSquare, Phone, type LucideIcon } from 'lucide-react';
import { Button, Mochi } from './ds.tsx';
import { fmtClock, fmtDay, type Msg } from '../data/api.ts';
import { foldNoise, gapWords } from './thread-text.ts';

// Freshdesk ticket source codes (sim ticket_fields).
const CHANNEL: Record<number, { word: string; icon: LucideIcon }> = {
  1: { word: 'Email', icon: Mail }, 2: { word: 'Portal', icon: Globe }, 3: { word: 'Phone', icon: Phone },
  7: { word: 'Chat', icon: MessageSquare }, 9: { word: 'Feedback widget', icon: MessageSquare }, 10: { word: 'Outbound email', icon: Mail },
};
const ic = (I: LucideIcon) => <I size={16} strokeWidth={1.5} aria-hidden="true" />;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function Message({ m, channel, delay }: { m: Msg; channel?: (typeof CHANNEL)[number]; delay: number }) {
  const [open, setOpen] = useState(false);
  const { body, folded } = foldNoise(m.text);
  const noise = [folded, m.quoted].filter(Boolean).join('\n\n');
  return (
    <li className="mb-tt-item" data-kind={m.kind} style={{ animationDelay: `${delay}s` }}>
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

/** The next reply: Mochi's draft, editable; one primary action. */
function Composer(p: { draft: string; to: string; onSend: (text: string) => Promise<boolean>; delay: number }) {
  const [text, setText] = useState(p.draft);
  const [sending, setSending] = useState(false);
  const edited = text !== p.draft;
  const send = async () => { setSending(true); const ok = await p.onSend(text.trim()); if (!ok) setSending(false); };
  return (
    <li className="mb-tt-item" data-kind="next" style={{ animationDelay: `${p.delay}s` }}>
      <span className="mb-tt-av" aria-hidden="true">{p.draft && !edited ? <Mochi size="xs" still /> : ic(Mail)}</span>
      <article className="mb-tt-msg">
        <header className="mb-tt-head">
          <b>{p.draft && !edited ? 'Mochi’s draft' : 'Your reply'}</b>
          <span className="mb-tt-kind">to {p.to}</span>
        </header>
        <label className="mb-tt-say" htmlFor="mb-tt-compose">
          {!p.draft ? 'I have no likely fix to draft from. Write the reply here.'
            : edited ? 'You edited my draft.' : 'I drafted this from what fixed similar tickets. Check it first.'}
        </label>
        <textarea id="mb-tt-compose" className="mb-tt-input" value={text} rows={Math.max(5, text.split('\n').length + 1)} onChange={(e) => setText(e.target.value)} />
        <div className="mb-tt-act">
          <Button variant="primary" size="sm" loading={sending} disabledReason={text.trim() ? undefined : 'Write a reply first.'} onClick={send}>Send reply</Button>
        </div>
      </article>
    </li>
  );
}

export function ConversationThread(p: { messages: Msg[]; source?: number; next?: { draft: string; to: string; onSend: (text: string) => Promise<boolean> } }) {
  const channel = p.source !== undefined ? CHANNEL[p.source] : undefined;
  let day = '';
  return (
    <ol className="mb-tt" aria-label="Conversation">
      {p.messages.map((m, i) => {
        const d = fmtDay(m.at), newDay = d !== day; day = d;
        const gap = i ? gapWords(m.at - p.messages[i - 1].at) : null;
        return [
          newDay && <li key={`d${i}`} className="mb-tt-mark mb-tt-day">{d}</li>,
          gap && <li key={`g${i}`} className="mb-tt-mark"><span className="mono">{gap}</span> later</li>,
          <Message key={i} m={m} channel={channel} delay={i * 0.08} />,
        ];
      })}
      {p.next && <Composer {...p.next} delay={p.messages.length * 0.08} />}
    </ol>
  );
}
