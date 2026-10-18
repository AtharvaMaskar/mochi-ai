// Flat ports of the product's tool-card blocks (kpi, table, bars, memdiff, suggestion). Every figure is a Num.
import type { ToolCard, StoredQuery } from '@mochi/contracts';
import { Num, PathReceipt, Receipts, Button } from './ui';

type Block = ToolCard['blocks'][number];
const isNum = (v: unknown) => typeof v === 'number';

export function Kpi({ b, q }: { b: Extract<Block, { type: 'kpi' }>; q: StoredQuery }) {
  const v = q.rows[0][b.column] as number;
  // The promise is shown only from the block's own query row (e.g. promised_h), so it carries a receipt.
  const pc = Object.keys(q.rows[0]).find((k) => k.startsWith('promised') && isNum(q.rows[0][k]));
  const promised = pc ? (q.rows[0][pc] as number) : undefined;
  return (
    <div className="kpi">
      <div>
        <div className="lbl t-caption">{b.label}</div>
        <Num qid={b.query_id} column={b.column} unit={b.unit} big />
        {pc && <div className="t-caption kpi-vs">promised <Num qid={b.query_id} column={pc} unit={b.unit} /></div>}
      </div>
      {b.bad && v > (promised ?? Infinity) && <span className="sig t-caption"><i />Over promise</span>}
    </div>
  );
}

export function Table({ b, q }: { b: Extract<Block, { type: 'table' }>; q: StoredQuery }) {
  return (
    <table className="tbl">
      <caption className="lbl t-caption">{b.label}</caption>
      <thead><tr>{b.columns.map((c) => <th key={c} scope="col" className="t-caption">{c}</th>)}</tr></thead>
      <tbody>
        {q.rows.map((r, i) => (
          <tr key={i}>{b.columns.map((c) => <td key={c} className={isNum(r[c]) ? 'n' : 't-body'}>{isNum(r[c]) ? <Num qid={b.query_id} column={c} row={i} /> : String(r[c])}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export function Bars({ b, q }: { b: Extract<Block, { type: 'bars' }>; q: StoredQuery }) {
  const max = Math.max(...q.rows.map((r) => Number(r[b.y])));
  return (
    <div className="bars">
      <div className="lbl t-caption">{b.label}</div>
      {q.rows.map((r, i) => (
        <div className="bar" key={i} style={{ ['--w' as string]: Number(r[b.y]) / max }}>
          <span className="t-data">{String(r[b.x])}</span><span className="bar-track"><i /></span><Num qid={b.query_id} column={b.y} row={i} />
        </div>
      ))}
    </div>
  );
}

export function Blocks({ card }: { card: ToolCard }) {
  return (
    <>
      {card.blocks.map((b, i) => {
        const q = card.queries[b.query_id];
        if (b.type === 'kpi') return <Kpi key={i} b={b} q={q} />;
        if (b.type === 'table') return <Table key={i} b={b} q={q} />;
        if (b.type === 'bars') return <Bars key={i} b={b} q={q} />;
        return null;
      })}
    </>
  );
}

export function CardView({ card, play = true }: { card: ToolCard; play?: boolean }) {
  return (
    <Receipts queries={card.queries}>
      <div className="card" data-ui>
        <div className="card-head t-label">{card.title}</div>
        {card.path && <div className="card-path"><PathReceipt path={card.path} play={play} /></div>}
        <Blocks card={card} />
      </div>
    </Receipts>
  );
}

/** Memory diff: retired facts struck through, the new ones beside them. */
export function MemDiff({ qid, q, limit = 5 }: { qid: string; q: StoredQuery; limit?: number }) {
  const retired = q.rows.filter((r) => r.change === 'retired'), added = q.rows.filter((r) => r.change === 'added');
  return (
    <ul className="memdiff" aria-label={`What memory changed (${qid})`}>
      {retired.slice(0, limit).map((r, i) => (
        <li key={i} style={{ ['--i' as string]: i }}>
          <s className="t-body">{String(r.fact)}</s>
          <span className="t-body md-new">{String(added[i]?.fact ?? '')}</span>
        </li>
      ))}
    </ul>
  );
}

/** Story prose: <num query_id column>v</num> tags become receipts; other text stays plain. */
const NUM = /<num query_id="(q_\d+)" column="([^"]+)">([^<]*)<\/num>/g;
export function Prose({ text, className, inline }: { text: string; className?: string; inline?: boolean }) {
  const parts = text.split(NUM), out: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 4) {
    out.push(parts[i]);
    if (i + 3 < parts.length) out.push(<Num key={i} qid={parts[i + 1]} column={parts[i + 2]} value={parts[i + 3]} />);
  }
  return inline ? <span className={className}>{out}</span> : <p className={className}>{out}</p>;
}

export function Suggestion({ text, actions }: { text: React.ReactNode; actions: string[] }) {
  const word = (a: string) => a.startsWith('send_to_team:') ? `Send to ${a.split(':')[1]} team` : a.startsWith('draft_kb:') ? `Draft ${a.split(':')[1]} update` : 'Dismiss';
  return (
    <div className="suggest">
      <div className="t-label suggest-tag">The docs and reality disagree</div>
      <p className="t-body">{text}</p>
      <div className="acts">{actions.map((a, i) => <Button key={a} size="sm" variant={i === 0 ? 'primary' : 'secondary'} success={i === 0 ? 'Sent' : undefined}>{word(a)}</Button>)}</div>
    </div>
  );
}
