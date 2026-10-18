// Plain-text helpers for the ticket thread: fold email noise, word the gap between messages.

// ponytail: line heuristics, not a parser. A sign-off only folds in the last few lines, so "Thanks for the help" mid-email stays.
const QUOTE = /^(>|On .{4,160}wrote:\s*$|-{2,} ?(Original|Forwarded) [Mm]essage|From: )/;
const SENT_FROM = /^Sent from my /i;
const SIGNOFF = /^(thanks|thank you|thanks and regards|regards|best|best regards|kind regards|warm regards|cheers|sincerely)\b[^.?]{0,20}[,.]?\s*$/i;
const SIG_DELIM = /^-- ?$/;
const TAIL = 6; // a sign-off this many non-empty lines from the end or closer starts the signature

/** Split an email into what was said and the noise below it (sign-off, signature, "Sent from my …", quoted text). */
export function foldNoise(text: string): { body: string; folded: string } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nonEmptyAfter = (i: number) => lines.slice(i).filter((l) => l.trim()).length;
  const at = lines.findIndex((raw, i) => {
    const l = raw.trim();
    if (i === 0 || !l) return false;
    return QUOTE.test(l) || SENT_FROM.test(l) || SIG_DELIM.test(l) || (SIGNOFF.test(l) && nonEmptyAfter(i) <= TAIL);
  });
  if (at <= 0) return { body: text.trim(), folded: '' };
  const body = lines.slice(0, at).join('\n').trim();
  return body ? { body, folded: lines.slice(at).join('\n').trim() } : { body: text.trim(), folded: '' };
}

/** "50 min later", "3 h later", "2 days later"; under a minute says nothing. */
export function gapWords(ms: number): string | null {
  const min = Math.round(ms / 60_000);
  if (min < 1) return null;
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}
