// Receipt-bearing blocks. Each reads its rows through ReceiptProvider and shows its query id.
// Bars and Line are hand-rolled SVG/CSS in token colours.
import { useRef, useState } from 'react';
import type { Visual, ToolCard as ToolCardT } from '@mochi/contracts';
import { useReceipts, QueryTag, NumPill, PathReceipt, ReceiptProvider } from './receipts.tsx';
import { StoryMarkdown } from './markdown.tsx';
import { ENTITY_ID, EntityLink } from './entity.tsx';
import { Button, NeedsYou, DrawnCheck, RollingNumber } from './ds.tsx';

const isNum = (v: unknown) => typeof v === 'number';
// Dates in tables: a time-like column or an epoch-ms integer shows as "18 Oct 05:05" (IST), "18 Oct 2026" when not this
// year; the raw value stays in the title so the receipt is still checkable. Rows are never changed.
const TZ = 'Asia/Kolkata';
const DAY_TIME = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const DAY_YEAR = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const YEAR = new Intl.DateTimeFormat('en-IN', { year: 'numeric', timeZone: TZ });
export const isWhen = (c: string, v: unknown) => typeof v === 'number' && Number.isInteger(v) && ((/(_at|_on|date|time)$/i.test(c) && v > 1e11) || (v >= 1e12 && v < 1e13));
export const fmtWhen = (ms: number, now = Date.now()) =>
  (YEAR.format(ms) === YEAR.format(now) ? DAY_TIME : DAY_YEAR).format(ms).replace(',', '');
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

const HEAD: Record<string, string> = { kb: 'KB article', sla: 'SLA', tat: 'TAT', kpi: 'KPI' };
/** snake_case column → "Sentence case" header, with a few known words. */
export const humanise = (c: string) => HEAD[c] ?? (c.charAt(0).toUpperCase() + c.slice(1)).replaceAll('_', ' ');
/** Columns that are plumbing, not facts: hidden in the brief. */
const internal = (c: string) => c === 'source_session' || (c.endsWith('_id') && c !== 'ticket');
const isTicket = (c: string, v: unknown) => c === 'ticket' || /^T-\d+$/.test(String(v));
const None = () => <p className="mb-none">None yet.</p>;

/** `brief` hides internal columns; `exclude` drops the ticket being viewed; `bare` drops the head (a disclosure shows it). */
export function Table(v: Extract<Visual, { type: 'table' }> & { brief?: boolean; exclude?: string; bare?: boolean }) {
  const all = useRows(v.query_id).filter((r) => !v.exclude || r.ticket !== v.exclude);
  const [open, setOpen] = useState(false);
  const rows = open ? all : all.slice(0, 10);
  const cols = v.brief ? v.columns.filter((c) => !internal(c)) : v.columns;
  const numCol = (c: string) => rows.length > 0 && rows.every((r) => isNum(r[c]) && !isWhen(c, r[c]));
  return (
    <div className="mb-block" {...useFlash(v.query_id)}>
      {!v.bare && <Head label={v.label} qid={v.query_id} />}
      {all.length === 0 ? <None /> : <div className="mb-table-wrap">
        <table className="mb-table">
          <thead><tr>{cols.map((c) => <th key={c} data-num={numCol(c) || undefined}>{humanise(c)}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} data-num={numCol(c) || undefined} className={isTicket(c, r[c]) ? 'mb-tid' : undefined}>{isWhen(c, r[c]) ? <span className="mono" title={String(r[c])}>{fmtWhen(r[c] as number)}</span> : isNum(r[c]) ? <RollingNumber value={fmt(r[c])} /> : ENTITY_ID.test(String(r[c])) ? <EntityLink id={String(r[c])} /> : fmt(r[c])}</td>)}</tr>)}</tbody>
        </table>
      </div>}
      {all.length > 10 && (
        <button className="mb-table-more t-caption" onClick={() => setOpen(!open)}>
          {open ? 'Show fewer' : `Showing 10 of ${all.length} · show all`}
        </button>
      )}
    </div>
  );
}

/** Similar-fix rows grouped by resolution + KB article, client-side; the stored query and its pill are unchanged. */
export function groupFixes(rows: Record<string, unknown>[]) {
  const g = new Map<string, { resolution: string; kb: string | null; tickets: string[] }>();
  for (const r of rows) {
    const k = JSON.stringify([r.resolution, r.kb ?? null]);
    if (!g.has(k)) g.set(k, { resolution: fmt(r.resolution), kb: r.kb ? String(r.kb) : null, tickets: [] });
    g.get(k)!.tickets.push(String(r.ticket));
  }
  return [...g.values()].sort((a, b) => b.tickets.length - a.tickets.length);
}
export function FixGroups({ query_id }: { query_id: string }) {
  const groups = groupFixes(useRows(query_id));
  if (!groups.length) return <None />;
  return (
    <ul className="mb-fixes">
      {groups.map((f) => (
        <li key={f.resolution + f.kb}>
          <span className="mb-fix-what">{f.resolution} <span className="mb-fix-n">· {f.tickets.length} {f.tickets.length === 1 ? 'ticket' : 'tickets'}</span></span>
          {f.kb && <span className="mb-fix-sub" title={f.kb}>{f.kb}</span>}
          <span className="mb-fix-ids">{f.tickets.map((t) => <span key={t} className="mb-tid"><EntityLink id={t} /></span>)}</span>
        </li>
      ))}
    </ul>
  );
}

/** One customer history from several stored queries (tickets, remembered episodes), deduped by ticket and
 *  without the ticket being viewed. */
export function historyRows(queries: Record<string, { rows: Record<string, unknown>[] }>, qids: string[], exclude: string) {
  const seen = new Set<string>([exclude]);
  return qids.flatMap((q) => (queries[q]?.rows ?? []).flatMap((r) => {
    const id = String(r.ticket);
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, text: fmt(r.subject ?? r.summary), end: r.status ? humanise(String(r.status)) : undefined }];
  }));
}
export function HistoryList({ qids, exclude }: { qids: string[]; exclude: string }) {
  const rows = historyRows(useReceipts().queries, qids, exclude);
  if (!rows.length) return <None />;
  return (
    <ul className="mb-fixes">
      {rows.map((r) => <li key={r.id}><span className="mb-fix-what"><span className="mb-tid"><EntityLink id={r.id} /></span> {r.text}</span>{r.end && <span className="mb-fix-sub">{r.end}</span>}</li>)}
    </ul>
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
/** A mismatch suggestion on the NeedsYou surface. `compact` is the short form inside the brief's summary card. */
export function Suggestion(v: Extract<Visual, { type: 'suggestion' }> & { compact?: boolean }) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className={`mb-block mb-sugg${v.compact ? ' mb-sugg-compact' : ''}`} {...useFlash(v.query_id)}>
      <div className="mb-block-head"><span className="mb-sugg-eyebrow">{humanise(v.edge.toLowerCase())}{v.compact && ` · ${v.tag}`}</span><QueryTag qid={v.query_id} /></div>
      {!v.compact && <div className="mb-sugg-tag">{v.tag}</div>}
      <StoryMarkdown text={v.text} />
      <div className="mb-sugg-acts">
        {done ? <span className="mb-did"><DrawnCheck />{done}</span> : v.actions.map((a, i) => {
          const [label, word] = actionLabel(a);
          return <Button key={a} size="sm" variant={i === 0 ? (v.compact ? 'ai' : 'primary') : a === 'dismiss' ? 'link' : 'secondary'} onClick={() => setDone(word)}>{label}</Button>;
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

export const KIND: Record<ToolCardT['kind'], string> = {
  briefing: 'Briefing', likely_cause: 'Likely cause', who_knows: 'Who knows', clusters: 'Clusters', blast_radius: 'Blast radius', similar: 'Similar tickets',
  query: 'Graph query', algorithm: 'Graph algorithm',
};
/** A tool card as tool code emitted it: title, path receipt, blocks. Its queries are the receipts. */
export function ToolCard({ card, asOf }: { card: ToolCardT; asOf?: number }) {
  return (
    <ReceiptProvider queries={card.queries} asOf={asOf}>
      <section className="mb-card" aria-label={card.title}>
        <div><div className="mb-card-kind">{KIND[card.kind]}</div><div className="mb-card-title">{card.title}</div></div>
        {card.path && <PathReceipt path={card.path} />}
        {card.blocks.map((b, i) => <BlockView key={i} v={('label' in b && b.label && card.title.startsWith(b.label) ? { ...b, label: '' } : b) as Visual} />)}
        {!card.path && card.blocks.length === 0 && <NeedsYou reason="This card came back empty." />}
      </section>
    </ReceiptProvider>
  );
}
