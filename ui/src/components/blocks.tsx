// Receipt-bearing blocks. Each reads its rows through ReceiptProvider and shows its query id.
// Bars and Line are hand-rolled SVG/CSS in token colours.
import { useRef, useState } from 'react';
import type { Visual, ToolCard as ToolCardT } from '@mochi/contracts';
import { useReceipts, QueryTag, NumPill, PathReceipt, ReceiptProvider } from './receipts.tsx';
import { StoryMarkdown } from './markdown.tsx';
import { Button, NeedsYou, DrawnCheck, RollingNumber } from './ds.tsx';

const isNum = (v: unknown) => typeof v === 'number';
const fmt = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

function Head({ label, qid }: { label: string; qid: string }) {
  return <div className="mb-block-head"><span className="mb-block-label">{label}</span><QueryTag qid={qid} /></div>;
}
function useRows(qid: string) { return useReceipts().queries[qid]?.rows ?? []; }
/** Live update: when a block's rows change, its edge flashes agent-sky once (600 ms). */
function useFlash(qid: string) {
  const sig = JSON.stringify(useRows(qid));
  const prev = useRef(sig), n = useRef(0);
  if (prev.current !== sig) { prev.current = sig; n.current++; }
  return { 'data-flash': n.current ? (n.current % 2 ? 'a' : 'b') : undefined };
}

export function Kpi(v: Extract<Visual, { type: 'kpi' }>) {
  const row = useRows(v.query_id)[0] ?? {};
  const value = row[v.column];
  // The promise comes from the block's own query (e.g. kb.promised_tat_hours AS promised_h). A bare attribute with
  // no such column still renders, as a drift pill: a number without a receipt is visibly flagged.
  const pc = Object.keys(row).find((k) => k.startsWith('promised') && isNum(row[k]));
  const promised = pc ? (row[pc] as number) : v.promised;
  const delta = promised !== undefined && isNum(value) ? Math.round(((value as number) - promised) * 10) / 10 : undefined;
  return (
    <div className="mb-block" {...useFlash(v.query_id)}>
      <Head label={v.label} qid={v.query_id} />
      <div className="mb-kpi-row"><NumPill query_id={v.query_id} column={v.column} size="lg" bad={v.bad} unit={v.unit} /></div>
      {promised !== undefined && (
        <div className="mb-kpi-delta" data-bad={v.bad || undefined}>
          Promised <NumPill query_id={v.query_id} column={pc ?? 'promised'} value={pc ? undefined : String(promised)} unit={v.unit} />
          {delta !== undefined && <> · <span className="mono">{delta > 0 ? '+' : ''}{delta}{v.unit}</span> {delta > 0 ? 'over the promise' : 'within the promise'}</>}
        </div>
      )}
    </div>
  );
}

const TREND: Record<string, string> = { up: '↑ growing', down: '↓ shrinking', flat: '→ steady' };
export function Bars(v: Extract<Visual, { type: 'bars' }>) {
  const rows = useRows(v.query_id);
  const max = Math.max(1, ...rows.map((r) => Number(r[v.y]) || 0));
  return (
    <div className="mb-block" {...useFlash(v.query_id)}>
      <Head label={v.label} qid={v.query_id} />
      <div className="mb-bars">
        {rows.map((r, i) => {
          const hot = v.hot ? r[v.hot] === true : false;
          return (<div className="mb-bars-row" key={i}>
            <span className="mb-bars-x" title={fmt(r[v.x])}>{fmt(r[v.x])}</span>
            <span className="mb-bars-track"><span className="mb-bars-fill" data-hot={hot || undefined} style={{ width: `${((Number(r[v.y]) || 0) / max) * 100}%`, animationDelay: `${i * 0.06}s` }} /></span>
            <span className="mb-bars-v">
              {hot && <span className="mb-hot">Hot</span>}
              {v.trend && <span className="mb-trend">{TREND[String(r[v.trend])] ?? fmt(r[v.trend])}</span>}
              <span className="mono"><RollingNumber value={fmt(r[v.y])} /></span>
            </span>
          </div>);
        })}
      </div>
    </div>
  );
}

export function Line(v: Extract<Visual, { type: 'line' }>) {
  const rows = useRows(v.query_id);
  const W = 600, H = 180, pad = 8;
  const vals = rows.flatMap((r) => v.series.map((s) => Number(r[s]) || 0));
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const x = (i: number) => (rows.length < 2 ? W / 2 : (i / (rows.length - 1)) * W);
  const y = (n: number) => H - pad - ((n - min) / (max - min)) * (H - pad * 2);
  return (
    <div className="mb-block mb-line" {...useFlash(v.query_id)}>
      <Head label={v.label} qid={v.query_id} />
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${v.label}: ${v.series.join(', ')} by ${v.x}`}>
        <line className="mb-line-axis" x1="0" x2={W} y1={H - pad} y2={H - pad} />
        <line className="mb-line-axis" x1="0" x2={W} y1={y(max)} y2={y(max)} strokeDasharray="2 4" />
        {v.series.map((s, k) => (
          <path key={s} className={`mb-line-s${k % 3}`} d={rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(Number(r[s]) || 0)}`).join(' ')} />
        ))}
      </svg>
      <div className="mb-line-x"><span>{fmt(rows[0]?.[v.x])}</span><span>max {max}</span><span>{fmt(rows.at(-1)?.[v.x])}</span></div>
      <div className="mb-legend">
        {v.series.map((s, k) => <span key={s}><svg viewBox="0 0 18 6" aria-hidden="true"><line className={`mb-line-s${k % 3}`} x1="0" x2="18" y1="3" y2="3" strokeWidth="2" /></svg>{s}</span>)}
      </div>
    </div>
  );
}

export function Table(v: Extract<Visual, { type: 'table' }>) {
  const all = useRows(v.query_id);
  const [open, setOpen] = useState(false);
  const rows = open ? all : all.slice(0, 10);
  const numCol = (c: string) => rows.length > 0 && rows.every((r) => isNum(r[c]));
  return (
    <div className="mb-block" {...useFlash(v.query_id)}>
      <Head label={v.label} qid={v.query_id} />
      <div className="mb-table-wrap">
        <table className="mb-table">
          <thead><tr>{v.columns.map((c) => <th key={c} data-num={numCol(c) || undefined}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{v.columns.map((c) => <td key={c} data-num={numCol(c) || undefined}>{isNum(r[c]) ? <RollingNumber value={fmt(r[c])} /> : fmt(r[c])}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {all.length > 10 && (
        <button className="mb-table-more t-caption" onClick={() => setOpen(!open)}>
          {open ? 'Show fewer' : `Showing 10 of ${all.length} · show all`}
        </button>
      )}
    </div>
  );
}

export function MemDiff(v: Extract<Visual, { type: 'memdiff' }>) {
  const rows = useRows(v.query_id);
  return (
    <div className="mb-block" {...useFlash(v.query_id)}>
      <Head label="What changed in memory" qid={v.query_id} />
      <ul className="mb-memdiff">
        {rows.map((r, i) => (
          <li key={i} data-change={String(r.change)}>
            <span className="mb-memdiff-tag">{r.change === 'retired' ? 'Retired' : 'Added'}</span>
            <span className="mb-memdiff-fact">{fmt(r.fact)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const actionLabel = (a: string) => {
  const [verb, arg] = a.split(':');
  if (verb === 'send_to_team') return [`Send to the ${arg} team`, 'Sent'];
  if (verb === 'draft_kb') return [`Draft a fix for ${arg}`, 'Drafted'];
  if (verb === 'dismiss') return ['Dismiss', 'Dismissed'];
  return [a.replaceAll('_', ' '), 'Done'];
};
export function Suggestion(v: Extract<Visual, { type: 'suggestion' }>) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="mb-block mb-sugg" {...useFlash(v.query_id)}>
      <div className="mb-block-head"><span className="mb-edge">{v.edge}</span><QueryTag qid={v.query_id} /></div>
      <div className="mb-sugg-tag">{v.tag}</div>
      <StoryMarkdown text={v.text} />
      <div className="mb-sugg-acts">
        {done ? <span className="mb-did"><DrawnCheck />{done}</span> : v.actions.map((a, i) => {
          const [label, word] = actionLabel(a);
          return <Button key={a} size="sm" variant={i === 0 ? 'primary' : a === 'dismiss' ? 'link' : 'secondary'} onClick={() => setDone(word)}>{label}</Button>;
        })}
      </div>
    </div>
  );
}

export function BlockView({ v }: { v: Visual }) {
  switch (v.type) {
    case 'kpi': return <Kpi {...v} />;
    case 'bars': return <Bars {...v} />;
    case 'line': return <Line {...v} />;
    case 'table': return <Table {...v} />;
    case 'memdiff': return <MemDiff {...v} />;
    case 'suggestion': return <Suggestion {...v} />;
  }
}

const KIND: Record<ToolCardT['kind'], string> = {
  briefing: 'Briefing', likely_cause: 'Likely cause', who_knows: 'Who knows', clusters: 'Clusters', blast_radius: 'Blast radius', similar: 'Similar tickets',
};
/** A tool card as tool code emitted it: title, path receipt, blocks. Its queries are the receipts. */
export function ToolCard({ card, asOf }: { card: ToolCardT; asOf?: number }) {
  return (
    <ReceiptProvider queries={card.queries} asOf={asOf}>
      <section className="mb-card" aria-label={card.title}>
        <div><div className="mb-card-kind">{KIND[card.kind]}</div><div className="mb-card-title">{card.title}</div></div>
        {card.path && <PathReceipt path={card.path} />}
        {card.blocks.map((b, i) => <BlockView key={i} v={b as Visual} />)}
        {!card.path && card.blocks.length === 0 && <NeedsYou reason="This card came back empty." />}
      </section>
    </ReceiptProvider>
  );
}
