// @-mentions: graph records named in a chat message. The composer sends "@T-4285" in the text plus a trailing
// "Context: T-4285 (ticket), I-03 (issue: TOTP setup fails)" line so Mochi starts from those records; the bubble
// shows both only as chips (tickets and customers are EntityLinks with their hover card).
import { CircleDot, Ticket, User } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Mention } from '../../data/api.ts';
import { EntityLink } from '../entity.tsx';

export const KIND_ICON = { ticket: Ticket, customer: User, issue: CircleDot } as const;
const ID = '[A-Z]{1,2}-\\d+';

/** The line the composer appends; issue names ride along because their ids mean nothing to a reader. */
export const contextLine = (ms: Mention[]) =>
  ms.length ? `\n\nContext: ${ms.map((m) => `${m.id} (${m.kind === 'issue' ? `issue: ${m.name}` : m.kind})`).join(', ')}` : '';

/** A sent message split into what the user typed and the records its Context line names. */
export function splitContext(text: string): { body: string; named: Map<string, Mention> } {
  const m = text.match(/\n\nContext: ([^\n]*)$/);
  const named = new Map<string, Mention>();
  if (m) for (const x of m[1].matchAll(new RegExp(`(${ID}) \\((ticket|customer|issue)(?:: ([^)]*))?\\)`, 'g')))
    named.set(x[1], { id: x[1], kind: x[2] as Mention['kind'], name: x[3] ?? x[1] });
  return { body: m ? text.slice(0, m.index) : text, named };
}

export function MentionChip({ m, children }: { m: Mention; children?: ReactNode }) {
  const Icon = KIND_ICON[m.kind];
  return (
    <span className="mb-mention" data-kind={m.kind}>
      <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
      {m.kind === 'issue' ? <span title={m.id}>{m.name}</span> : <EntityLink id={m.id} />}
      {children}
    </span>
  );
}

/** Body text with every @id the Context line names turned into a chip; other @words stay text. */
export function withMentions(body: string, named: Map<string, Mention>): ReactNode[] {
  return body.split(new RegExp(`@(${ID})\\b`, 'g')).map((part, i) => {
    if (!(i % 2)) return part;
    const m = named.get(part);
    return m ? <MentionChip key={i} m={m} /> : `@${part}`;
  });
}
