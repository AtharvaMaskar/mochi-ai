// §8 Benchmark: rendered only when bench/results.json exists and passes validateResults (vite.config.ts).
// Every figure is read from that file at render time; none is written here. Losses sit beside wins.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Results } from '@mochi/contracts';
import '../bench.css';

type Approach = { n: number; accuracy: number; cost_usd_mean: number; p50_ms: number; staleness?: { fresh: number; of: number } };
type Traces = { spent_usd?: number; approaches?: Record<string, Approach>; approaches_run?: { spent_usd?: number; tasks?: { warm?: number } } };
type R = Results & { decision_traces?: Traces };
type Arch = 'A' | 'B' | 'C' | 'D' | 'E';

const NAME: Record<string, string> = { A: 'Everything in the prompt', B: 'Vector search', C: 'Markdown notes', D: 'Graph', E: 'SQLite' };
const name = (a: string) => NAME[a] ?? `Design ${a}`;
const lower = (a: string) => (a === 'E' ? name(a) : name(a).toLowerCase());
const pct = (x: number) => `${Math.round(x * 100)}%`;
const usd = (x: number, sig = x < 0.001 ? 2 : 3) => `$${Number(x.toPrecision(sig))}`;
const int = (x: number) => Math.round(x).toLocaleString('en-US');
const model = (id: string) => { const m = id.match(/claude-([a-z]+)-(\d+)-(\d+)/); return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id; };
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const word = (n: number) => WORDS[n] ?? String(n);
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const isHaiku = (id: string) => id.includes('haiku');
const cls = (main: boolean) => (main ? 'bx-main' : 'bx-other');
// Learning-tab rows, in the board's order; keys are decision_traces.approaches ids.
const LEARN: [string, string][] = [
  ['graph_traces_warm_replay', 'Graph decision traces'], ['D', 'Graph memory, no learning'], ['C_lessons', 'Markdown + LESSONS.md'],
  ['devin_knowledge', 'Devin-style Knowledge'], ['vector_lessons', 'Vector lessons'], ['sql_lessons', 'SQL lessons'],
];

export function Bench({ results }: { results: Results }) {
  const r = results as R;
  const tasks = r.per_task ?? [];
  const hD = tasks.find((p) => isHaiku(p.model_id) && p.arch === 'D');
  const fresh = (a: string) => r.staleness.filter((s) => s.arch === a);
  const dFresh = fresh('D');
  const ap = r.decision_traces?.approaches ?? {};
  const learn = LEARN.filter(([k]) => ap[k]);

  const tabs: { label: string; title: string; body: string; panel: ReactNode }[] = [];
  if (tasks.length) tabs.push({ label: 'Accuracy and cost', title: 'Right more often, for a tenth of a cent', body: 'Each memory design on Haiku and Sonnet. Up is more answers right, left is cheaper.', panel: <Scatter r={r} /> });
  if (Object.keys(r.summary).length) tabs.push({ label: 'Question types', title: 'Only the graph follows a path', body: 'Single facts, multi-hop and structural questions, scored separately.', panel: <Types r={r} /> });
  if (r.staleness.length) tabs.push({ label: 'Staying current', title: `${word(new Set(r.staleness.map((s) => s.event_id)).size)} facts stopped being true`, body: 'A dot per retired fact: current answer or the old one.', panel: <Fresh r={r} /> });
  if (learn.length) tabs.push({ label: 'Learning', title: 'Half the cost, and it forgets what stopped being true', body: `${word(learn.length)} ways to learn from ${r.decision_traces?.approaches_run?.tasks?.warm ?? 'the same'} resolved tickets.`, panel: <Learn r={r} rows={learn} /> });
  if (r.mismatch_ablation || r.clusters_ablation) tabs.push({ label: 'Graph against model', title: 'Same findings, nothing invented', body: 'Two nightly jobs, as Cypher and as the model alone.', panel: <Versus r={r} /> });

  const haiku = tasks.filter((p) => isHaiku(p.model_id));
  const cheaper = hD ? haiku.filter((p) => p.arch !== 'D' && p.cost_usd_mean < hD.cost_usd_mean).sort((a, b) => a.cost_usd_mean - b.cost_usd_mean) : [];
  const spend = tasks.reduce((s, p) => s + p.cost_usd_total, 0) + (r.decision_traces?.spent_usd ?? 0) + (r.decision_traces?.approaches_run?.spent_usd ?? 0);

  const [tab, setTab] = useState(0);
  const sec = useRef<HTMLElement>(null), seen = useRef(new Set<number>());
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = sec.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { el.dataset.inview = String(e.isIntersecting); if (e.isIntersecting) setInView(true); }, { threshold: 0.15 });
    io.observe(el); return () => io.disconnect();
  }, []);
  // Each tab's chart draws in the first time it is shown, never again.
  const draw = inView && !seen.current.has(tab);
  useEffect(() => { if (inView) seen.current.add(tab); }, [inView, tab]);

  return (
    <section className="bench bx wrap" id="bench" data-sky="bench" ref={sec} data-in={inView || undefined} aria-labelledby="bench-h">
      <div className="bx-head">
        <div className="bx-copy">
          <p className="t-eyebrow bx-eyebrow">Benchmark</p>
          <h2 id="bench-h" className="t-display">Measured, including where we lost.</h2>
          <p className="t-lead">Same questions, same synthetic data, five memory designs. Every number below is in bench/results.json, and one command reproduces it.</p>
        </div>
        <ul className="bx-stats">
          {hD && <li className="bx-card"><span className="t-title bx-mono">{pct(hD.accuracy)}</span><span className="t-caption">graph on Haiku</span></li>}
          {dFresh.length > 0 && <li className="bx-card"><span className="t-title bx-mono">{dFresh.filter((s) => s.answer_fresh).length}/{dFresh.length}</span><span className="t-caption">current after retirements</span></li>}
          {r.mismatch_ablation && <li className="bx-card"><span className="t-title bx-mono">{r.mismatch_ablation.graph.hallucinated}</span><span className="t-caption">invented mismatches</span></li>}
        </ul>
      </div>

      {tabs.length > 0 && <>
        <Tabs labels={tabs.map((t) => t.label)} on={tab} set={setTab} />
        <div className={`bx-panel ${draw ? 'bx-draw' : ''}`} role="tabpanel" id={`bx-p${tab}`} aria-labelledby={`bx-t${tab}`} key={tab}>
          <h3 className="t-title">{tabs[tab].title}</h3>
          <p className="t-body bx-sub">{tabs[tab].body}</p>
          {tabs[tab].panel}
        </div>
      </>}

      <div className="bx-foot">
        {hD && cheaper.length > 0 && <div className="bx-card">
          <h3 className="t-body-strong">Where the graph lost</h3>
          <p className="t-body bx-sub">Cost per answer: {list(cheaper.map((p) => `${lower(p.arch)} (${usd(p.cost_usd_mean)})`))} {cheaper.length > 1 ? 'are' : 'is'} cheaper than the graph ({usd(hD.cost_usd_mean)}).{cheaper.every((p) => p.accuracy < hD.accuracy) && ` ${cheaper.length > 1 ? 'They answer' : 'It answers'} far fewer questions right.`}</p>
        </div>}
        <div className="bx-card">
          <h3 className="t-body-strong">Reproduce it</h3>
          <p className="t-data-strong bx-mono">npm run bench · seed {r.seed} · judge {model(r.judge.model_id)}</p>
          <p className="t-label bx-muted">Answer-model spend for every run on this page: ${spend.toFixed(2)}. Judge calls not included.</p>
        </div>
      </div>
    </section>
  );
}

function Tabs({ labels, on, set }: { labels: string[]; on: number; set: (i: number) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]), list = useRef<HTMLDivElement>(null);
  const [glide, setGlide] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const place = () => { const b = refs.current[on], l = list.current; if (!b || !l) return; setGlide({ x: b.offsetLeft, w: b.offsetWidth }); if (b.offsetLeft < l.scrollLeft || b.offsetLeft + b.offsetWidth > l.scrollLeft + l.clientWidth) l.scrollLeft = b.offsetLeft - 16; };
    place(); addEventListener('resize', place); return () => removeEventListener('resize', place);
  }, [on]);
  const key = (e: KeyboardEvent) => {
    const n = labels.length, to = { ArrowRight: on + 1, ArrowLeft: on - 1 + n, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault(); const i = to % n; set(i); refs.current[i]?.focus();
  };
  return (
    <div className="bx-tabs" role="tablist" aria-label="Benchmark views" ref={list} onKeyDown={key}>
      <span className="bx-glide" aria-hidden="true" style={{ transform: `translateX(${glide.x}px)`, width: glide.w }} />
      {labels.map((l, i) => (
        <button key={l} type="button" role="tab" id={`bx-t${i}`} aria-controls={`bx-p${i}`} aria-selected={i === on} tabIndex={i === on ? 0 : -1}
          ref={(el) => { refs.current[i] = el; }} className="t-body bx-tab" onClick={() => set(i)}>{l}</button>
      ))}
    </div>
  );
}

// ---------- A: accuracy against cost, log x ----------
function useNarrow() {
  const q = '(max-width: 640px)';
  const [n, setN] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q), f = () => setN(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return n;
}

function Scatter({ r }: { r: R }) {
  const narrow = useNarrow();
  const tasks = r.per_task ?? [];
  const G = narrow ? { W: 360, H: 290, L: 40, PW: 300, T: 20, PH: 210 } : { W: 900, H: 476, L: 56, PW: 760, T: 24, PH: 400 };
  const B = G.T + G.PH;
  const lo = -4, hi = -1; // $0.0001 .. $0.1
  const x = (c: number) => G.L + ((Math.log10(c) - lo) / (hi - lo)) * G.PW;
  const y = (a: number) => G.T + (1 - a) * G.PH;
  const sonnet = tasks.filter((p) => !isHaiku(p.model_id));
  const worstS = sonnet.length ? sonnet.reduce((a, b) => (b.accuracy < a.accuracy ? b : a)) : undefined;
  const hD = tasks.find((p) => isHaiku(p.model_id) && p.arch === 'D'), sD = sonnet.find((p) => p.arch === 'D');
  const [hot, setHot] = useState<string | null>(null);

  const pts = tasks.map((p) => {
    const h = isHaiku(p.model_id), d = p.arch === 'D', k = `${p.model_id}-${p.arch}`;
    let label = '', dx = 12, dy = 4, anchor: 'start' | 'end' = 'start';
    if (h && d) { label = narrow ? `Graph · Haiku ${pct(p.accuracy)}` : `Graph · Haiku ${pct(p.accuracy)} · ${usd(p.cost_usd_mean)}`; dx = narrow ? -9 : 14; dy = narrow ? 26 : 22; }
    else if (!h && d) { label = narrow ? `Sonnet ${pct(p.accuracy)}` : `Graph · Sonnet ${pct(p.accuracy)} · ${usd(p.cost_usd_mean)}`; if (narrow) { dx = -12; anchor = 'end'; } dy = narrow ? -8 : -4; }
    else if (!narrow && h) label = `${name(p.arch)} ${pct(p.accuracy)}`;
    else if (!narrow && p === worstS) label = `Sonnet · ${lower(p.arch)} ${pct(p.accuracy)}`;
    return { p, h, d, k, cx: x(p.cost_usd_mean), cy: y(p.accuracy), rad: d ? (h ? 9 : 8) : h ? 7 : 6.5, label, dx, dy, anchor };
  });
  const hp = pts.find((q) => q.k === hot);
  const ticks = [-4, -3, -2, -1];

  return (
    <div className="bx-a">
      <div className="bx-chart">
        <svg viewBox={`0 0 ${G.W} ${G.H}`} role="img" aria-label="Accuracy against cost per answer for each memory design on Haiku and Sonnet">
          <g className="bx-axis">
            {[1, 0.75, 0.5, 0.25, 0].map((a) => <g key={a}><line x1={G.L} x2={G.L + G.PW + 20} y1={y(a)} y2={y(a)} className={a ? 'bx-grid' : 'bx-base'} /><text x={G.L - 8} y={y(a) + 4} textAnchor="end">{pct(a)}</text></g>)}
            {ticks.map((t, i) => <text key={t} x={x(10 ** t)} y={B + 22} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>${String(10 ** t)}</text>)}
            <text x={G.L + G.PW / 2} y={B + 44} textAnchor="middle">cost per answer (log scale) →</text>
          </g>
          {hD && sD && <line className="bx-link" x1={x(hD.cost_usd_mean)} y1={y(hD.accuracy)} x2={x(sD.cost_usd_mean)} y2={y(sD.accuracy)} />}
          {pts.map((q, i) => (
            <circle key={q.k} className={`bx-dot ${cls(q.d)} ${q.h ? 'bx-fill' : 'bx-hollow'}`} style={{ animationDelay: `${i * 40}ms` }} cx={q.cx} cy={q.cy} r={q.rad}
              tabIndex={0} aria-label={`${name(q.p.arch)} on ${model(q.p.model_id)}: ${pct(q.p.accuracy)} correct, ${usd(q.p.cost_usd_mean, 3)} per answer, p50 ${(q.p.p50_ms / 1000).toFixed(1)} s`}
              onMouseEnter={() => setHot(q.k)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(q.k)} onBlur={() => setHot(null)} />
          ))}
          {pts.filter((q) => q.label).map((q) => (
            <text key={q.k} className={`bx-lbl ${q.d && q.h ? 'bx-lbl-main' : ''}`} x={q.cx + q.dx} y={q.cy + q.dy} textAnchor={q.anchor}>{q.label}</text>
          ))}
        </svg>
        {hp && (
          <div className="bx-tip" role="presentation" style={{ left: `${(hp.cx / G.W) * 100}%`, top: `${(hp.cy / G.H) * 100}%` }}>
            <span className="t-label">{name(hp.p.arch)} · {model(hp.p.model_id)}</span>
            <span className="t-data bx-mono">{pct(hp.p.accuracy)} correct · {usd(hp.p.cost_usd_mean, 3)} · p50 {(hp.p.p50_ms / 1000).toFixed(1)} s</span>
          </div>
        )}
      </div>
      <div className="bx-side t-body">
        {hD && <p className="bx-key"><span className="bx-sw bx-sw-fill" aria-hidden="true" />{model(hD.model_id)}</p>}
        {sD && <p className="bx-key"><span className="bx-sw bx-sw-hollow" aria-hidden="true" />{model(sD.model_id)}</p>}
        <hr className="bx-rule" />
        {hD && worstS && hD.accuracy > worstS.accuracy && <p>A small model on a graph beats a big model on {lower(worstS.arch)}: {pct(hD.accuracy)} at {usd(hD.cost_usd_mean)} against {pct(worstS.accuracy)} at {usd(worstS.cost_usd_mean)}.</p>}
        {hD && (() => { const c = tasks.filter((p) => isHaiku(p.model_id) && p.arch !== 'D' && p.cost_usd_mean < hD.cost_usd_mean).map((p) => lower(p.arch)); return c.length > 0 && <p><b className="bx-strong">Where we lost:</b> {list(c)} each cost less per answer than the graph.</p>; })()}
        <p className="t-data bx-mono bx-muted">bench/results.json · seed {r.seed} · judge {model(r.judge.model_id)}</p>
      </div>
    </div>
  );
}

// ---------- B: accuracy by kind of question ----------
const BUCKETS = [
  { k: 'single_fact', title: 'Single fact', ex: 'What plan is C-0588 on?' },
  { k: 'multi_hop', title: 'Multi-hop', ex: 'Who fixed tickets like this one, and in which team?' },
  { k: 'structural', title: 'Structural', ex: 'Which issues did release 3.2.0 introduce?' },
] as const;
const ORDER: Arch[] = ['D', 'E', 'A', 'C', 'B'];

function Bar({ v, main, delay = 0 }: { v: number; main: boolean; delay?: number }) {
  return <span className="bx-track"><span className={`bx-bar ${cls(main)}`} style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%`, animationDelay: `${delay}ms` }} /></span>;
}

function Types({ r }: { r: R }) {
  const arches = ORDER.filter((a) => r.summary[a]);
  return (
    <>
      <div className="bx-b">
        {BUCKETS.filter((b) => arches.some((a) => r.summary[a]?.[b.k])).map((b) => (
          <div key={b.k} className="bx-card bx-b-card">
            <div><h4 className="t-headline">{b.title}</h4><p className="t-label bx-muted">{b.ex}</p></div>
            {arches.map((a, i) => { const s = r.summary[a]?.[b.k]; return s && (
              <div key={a} className={`bx-row t-label ${cls(a === 'D')}`}><span>{name(a)}</span><Bar v={s.accuracy} main={a === 'D'} delay={i * 50} /><span className="bx-mono bx-num">{pct(s.accuracy)}</span></div>
            ); })}
          </div>
        ))}
      </div>
      <p className="t-label bx-muted">{model(r.model.id)} answers, {model(r.judge.model_id)} judge. Structural means questions about the shape of the data, such as "which issues share a release".</p>
    </>
  );
}

// ---------- C: a dot per retired fact ----------
function Fresh({ r }: { r: R }) {
  const events = [...new Set(r.staleness.map((s) => s.event_id))].sort();
  const per = (['D', 'E', 'C'] as Arch[]).filter((a) => r.staleness.some((s) => s.arch === a)).map((a) => ({
    k: a, name: name(a), main: a === 'D', bits: events.map((e) => r.staleness.find((s) => s.arch === a && s.event_id === e)?.answer_fresh ?? false),
  }));
  const ap = r.decision_traces?.approaches ?? {};
  const tot = LEARN.filter(([k]) => k !== 'D' && ap[k]?.staleness).map(([k, n]) => {
    const s = ap[k].staleness!; return { k, name: n, main: k.startsWith('graph'), bits: events.map((_, i) => i < s.fresh) };
  });
  const rows = [...per, ...tot];
  const grid = { gridTemplateColumns: `minmax(120px, 240px) repeat(${events.length}, minmax(0, 36px)) minmax(48px, 1fr)` };
  return (
    <>
      <div className="bx-card bx-c">
        <div className="bx-c-row t-data-xs bx-mono bx-muted" style={grid} aria-hidden="true"><span />{events.map((e) => <span key={e}>{e.replace(/-0?/, '')}</span>)}<span className="bx-num">current</span></div>
        {rows.map((row, ri) => (
          <div key={row.k} className={`bx-c-row ${cls(row.main)}`} style={grid}>
            <span className="t-body">{row.name}</span>
            {row.bits.map((b, i) => <span key={i} className="bx-cell"><i className={`bx-pip ${b ? 'on' : ''}`} style={{ animationDelay: `${ri * 40 + i * 25}ms` }} aria-hidden="true" /></span>)}
            <span className="t-data-strong bx-mono bx-num">{row.bits.filter(Boolean).length}/{row.bits.length}</span>
          </div>
        ))}
      </div>
      <div className="bx-notes">
        <p className="t-body bx-sub">The graph closes a fact with an end date instead of deleting it, and every query asks "as of when". Notes that only grow have no way to retire anything.</p>
        <p className="t-data bx-mono bx-muted">{list(per.map((p) => p.name))}: per-event results from the main benchmark. Decision traces and lesson rows: totals only, so their dot order is not per event.</p>
      </div>
    </>
  );
}

// ---------- D: learning from past tickets ----------
function Learn({ r, rows }: { r: R; rows: [string, string][] }) {
  const ap = r.decision_traces!.approaches!;
  const max = Math.max(...rows.map(([k]) => ap[k].cost_usd_mean));
  return (
    <>
      <div className="bx-card bx-d" role="table" aria-label="Learning approaches: cost per answer, correct answers and freshness after retirements">
        <div className="bx-d-row bx-d-head t-caption bx-muted" role="row"><span role="columnheader">Approach</span><span role="columnheader">Cost per answer</span><span role="columnheader" className="bx-num">Correct</span><span role="columnheader" className="bx-num">After facts retired</span></div>
        {rows.map(([k, n], i) => { const a = ap[k], main = k.startsWith('graph'), s = a.staleness; return (
          <div key={k} className={`bx-d-row ${cls(main)}`} role="row">
            <span className="t-body" role="cell">{n}</span>
            <span className="bx-d-cost" role="cell"><span className={`bx-bar bx-solo ${cls(main)}`} style={{ width: `calc((100% - 96px) * ${Math.max(0.02, a.cost_usd_mean / max)})`, animationDelay: `${i * 50}ms` }} /><span className="t-data bx-mono bx-muted">{usd(a.cost_usd_mean, 3)}</span></span>
            <span className="t-data-strong bx-mono bx-num" role="cell">{Math.round(a.accuracy * a.n)}/{a.n}</span>
            <span className="bx-num" role="cell">{s ? <span className={`t-data bx-mono bx-chip ${s.fresh ? 'ok' : 'bad'}`}>{s.fresh}/{s.of} current</span> : <span className="t-data bx-muted">not measured</span>}</span>
          </div>
        ); })}
      </div>
      <p className="t-label bx-muted">{model(r.model.id)}, {model(r.judge.model_id)} judge. Devin-style Knowledge is modelled on Devin's documented Knowledge feature, not Devin itself. The markdown row's one-off summary read the test tickets' issue links, so its accuracy is not a fair headline.</p>
    </>
  );
}

// ---------- E: graph against the model alone ----------
function Versus({ r }: { r: R }) {
  const m = r.mismatch_ablation, c = r.clusters_ablation;
  const pairs = [
    m && { title: 'Docs against practice', sub: 'Find help articles whose promised turnaround the tickets no longer meet.', g: m.graph.hallucinated, l: m.llm.hallucinated, bad: 'invented mismatches', gt: m.graph.tokens, lt: m.llm.tokens,
      found: m.graph.found === m.llm.found && !m.graph.missed && !m.llm.missed ? `Both found all ${m.graph.found} planted mismatches.` : `Graph found ${m.graph.found} of ${m.graph.found + m.graph.missed}; the model alone found ${m.llm.found} of ${m.llm.found + m.llm.missed}.` },
    c && { title: 'Emerging clusters', sub: 'Group the day’s tickets and flag the spikes.', g: c.graph.spurious, l: c.llm.spurious, bad: 'spurious clusters', gt: c.graph.tokens, lt: c.llm.tokens,
      found: c.graph.matched_spikes === c.llm.matched_spikes ? `Both matched ${c.graph.matched_spikes} of the ${c.graph.matched_spikes + c.graph.missed_spikes} planted spikes.` : `Graph matched ${c.graph.matched_spikes} of ${c.graph.matched_spikes + c.graph.missed_spikes}; the model alone ${c.llm.matched_spikes}.` },
  ].filter((p) => !!p);
  const top = Math.log10(Math.max(...pairs.flatMap((p) => [p.gt, p.lt])));
  const w = (t: number) => Math.max(0.02, (Math.log10(Math.max(t, 10)) - 3) / (top - 3));
  const tiers = r.tier_isolation?.cases ?? [];
  const runs = r.concurrency?.runs ?? [], peak = runs.length ? runs.reduce((a, b) => (b.n > a.n ? b : a)) : undefined;
  return (
    <>
      <div className="bx-e">
        {pairs.map((p) => (
          <div key={p.title} className="bx-card bx-e-card">
            <div><h4 className="t-headline">{p.title}</h4><p className="t-label bx-muted">{p.sub}</p></div>
            <div className="bx-e-nums">
              <div><span className="t-caption bx-muted">Graph</span><span className="bx-big bx-mono">{p.g}</span><span className="t-label bx-sub">{p.bad}</span></div>
              <div><span className="t-caption bx-muted">Model alone</span><span className={`bx-big bx-mono ${p.l > p.g ? 'bx-bad' : ''}`}>{p.l}</span><span className="t-label bx-sub">{p.bad}</span></div>
            </div>
            <div className="bx-e-tok">
              <span className="t-caption bx-muted">Tokens read (log scale)</span>
              <div className="bx-row t-label bx-main"><span>Graph</span><span className="bx-track bx-bare"><span className="bx-bar bx-main" style={{ width: `${w(p.gt) * 100}%` }} /></span><span className="bx-mono bx-num">{int(p.gt)}</span></div>
              <div className="bx-row t-label bx-other"><span>Model alone</span><span className="bx-track bx-bare"><span className="bx-bar bx-other" style={{ width: `${w(p.lt) * 100}%`, animationDelay: '80ms' }} /></span><span className="bx-mono bx-num">{int(p.lt)}</span></div>
            </div>
            <p className="t-label bx-sub">{p.found}</p>
          </div>
        ))}
      </div>
      <div className="bx-pills">
        {tiers.length > 0 && <span className="t-data bx-mono bx-pill">{tiers.filter((t) => t.refused).length}/{tiers.length} forbidden writes refused by the database</span>}
        {peak && <span className="t-data bx-mono bx-pill">{runs.reduce((s, x) => s + x.torn_reads, 0)} torn reads · {peak.n} parallel clients · {int(peak.throughput_per_s)} reads/s</span>}
      </div>
    </>
  );
}
