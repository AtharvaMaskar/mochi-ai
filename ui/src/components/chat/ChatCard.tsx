// A tool card in the chat stream arrives folded to one line: what kind of lookup, its title, how many rows, and its
// receipts. Mochi's answer is the prose below the cards; the rows are one click away.
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ToolCard as Card } from '@mochi/contracts';
import { KIND, ToolCard } from '../blocks.tsx';
import { QueryTag, ReceiptProvider } from '../receipts.tsx';

export function ChatCard({ card }: { card: Card }) {
  const kind = KIND[card.kind] ?? card.kind;
  const [open, setOpen] = useState(false);
  const qids = Object.keys(card.queries);
  const rows = qids.reduce((n, q) => n + (card.queries[q]?.rows.length ?? 0), 0);
  return (
    <div className="mb-chat-card mb-chat-fold" data-open={open || undefined}>
      <div className="mb-chat-fold-head">
        <button className="mb-chat-fold-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronRight className="mb-chat-fold-chev" size={16} strokeWidth={1.5} aria-hidden="true" />
          <span className="mb-chat-fold-kind">{kind}</span>
          <span className="mb-chat-fold-title">{card.title.replace(/ · \d+ rows?$/, '')}</span>
          <span className="mono mb-chat-fold-n">{rows} {rows === 1 ? 'row' : 'rows'}</span>
        </button>
        <ReceiptProvider queries={card.queries}>{qids.map((q) => <QueryTag key={q} qid={q} />)}</ReceiptProvider>
      </div>
      <div className="mb-chat-fold-body"><div>{open && <ToolCard card={card} />}</div></div>
    </div>
  );
}
