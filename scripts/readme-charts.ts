// Benchmark charts and figures for the README, from bench/results.json only, so no number is hand-typed.
//   node scripts/readme-charts.ts          rewrite the README `bench:*` blocks and docs/img/*.svg
//   node scripts/readme-charts.ts --check  exit 1 if either drifted from bench/results.json
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { validateResults } from '@mochi/contracts';

const README = new URL('../README.md', import.meta.url);
const IMG = new URL('../docs/img/', import.meta.url);
const raw = JSON.parse(readFileSync(new URL('../bench/results.json', import.meta.url), 'utf8'));
const parsed = validateResults(raw);
if (!parsed.ok) throw new Error(`bench/results.json is invalid: ${parsed.errors.slice(0, 3).join('; ')}`);
const r = parsed.value;
if (!raw.decision_traces?.approaches) throw new Error('bench/results.json: decision_traces.approaches missing');

type Arm = 'A' | 'B' | 'C' | 'D' | 'E';
const ARM: Record<Arm, string> = { D: 'Graph (D)', E: 'SQLite, same tools (E)', A: 'Everything in prompt (A)', C: 'Markdown notes (C)', B: 'Vector search (B)' };
const PROSE: Record<Arm, string> = { D: 'the graph', E: 'SQLite with the same tools', A: 'the full prompt', C: 'markdown notes', B: 'vector search' };
const SHORT: Record<Arm, string> = { D: 'Graph', E: 'SQLite', A: 'Full prompt', C: 'Markdown', B: 'Vector' };
const HAIKU = r.model.id, SONNET = r.per_task!.map((p) => p.model_id).find((m) => m !== HAIKU)!;
const modelName = (id: string) => (id.includes('haiku') ? 'Haiku' : id.includes('sonnet') ? 'Sonnet' : id);
const task = (model: string, arch: Arm) => {
  const t = r.per_task!.find((p) => p.model_id === model && p.arch === arch);
  if (!t) throw new Error(`per_task: no row for ${model} ${arch}`);
  return t;
};
const ORDER = (['D', 'E', 'A', 'C', 'B'] as Arm[]).sort((a, b) => task(HAIKU, b).accuracy - task(HAIKU, a).accuracy);

const pct = (x: number) => `${Math.round(x * 100)}%`;
const usd = (x: number) => `$${Number(x.toPrecision(2))}`;
const k1 = (x: number) => Math.round(x / 100) / 10; // thousands, one decimal
const int = (x: number) => Math.round(x).toLocaleString('en-US');
const ceilTo = (x: number, step: number) => Number((Math.ceil(x / step) * step).toPrecision(6));
const mermaid = (body: string) => '```mermaid\n' + body + '\n```';
const bars = (title: string, cats: string[], y: string, max: number, vals: number[], horizontal = false) =>
  mermaid([`xychart-beta${horizontal ? ' horizontal' : ''}`, `  title "${title}"`,
    `  x-axis [${cats.map((c) => `"${c}"`).join(', ')}]`, `  y-axis "${y}" 0 --> ${max}`, `  bar [${vals.join(', ')}]`].join('\n'));
const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((x) => `| ${x.join(' | ')} |`)].join('\n');

// ---- figures --------------------------------------------------------------------------------------------------
const dh = task(HAIKU, 'D'), cs = task(SONNET, 'C'), ds = task(SONNET, 'D');
const m = r.mismatch_ablation!, cl = r.clusters_ablation!, conc = r.concurrency!, tier = r.tier_isolation!;
const fresh = (a: Arm) => r.staleness.filter((s) => s.arch === a && s.answer_fresh).length;
const events = (a: Arm) => r.staleness.filter((s) => s.arch === a).length;
const STALE: Arm[] = (['D', 'E', 'C'] as Arm[]).filter((a) => events(a) > 0);
const upkeep = (a: Arm) => { const s = r.staleness.filter((x) => x.arch === a); return s.reduce((n, x) => n + x.maintenance_tokens, 0) / s.length; };
const dt = raw.decision_traces; // outside the zod contract (decision-traces change), read raw
const AP: [string, string][] = [['graph_traces_warm_replay', 'Graph decision traces (replay)'], ['D', 'Graph memory, no learning'],
  ['C_lessons', 'Markdown + LESSONS.md'], ['devin_knowledge', 'Devin-style Knowledge (modelled)'], ['vector_lessons', 'Vector lessons'], ['sql_lessons', 'SQL lessons']];
const ap = (key: string) => { const a = dt.approaches[key]; if (!a) throw new Error(`decision_traces.approaches.${key} missing`); return a; };
const apFresh = (key: string) => { const s = ap(key).staleness; return s ? `${s.fresh}/${s.of}` : 'not measured'; };
const top = conc.runs.at(-1)!;
const torn = conc.runs.reduce((s, x) => s + x.torn_reads, 0);
const refused = tier.cases.filter((c) => c.refused).length;
const tr = ap('graph_traces_warm_replay'), trD = ap('D');

const glance = table(['', 'claim', 'number (bench/results.json)', 'where to see it'], [
  ['B3', 'A small model on a graph beats a bigger model on notes', `${modelName(HAIKU)} + graph **${pct(dh.accuracy)}** at ${usd(dh.cost_usd_mean)}/answer; ${modelName(SONNET)} + markdown notes **${pct(cs.accuracy)}**`, 'Landing → Benchmark → Accuracy and cost'],
  ['B5', 'Decision traces: reuse the path that worked, drop it when its facts retire', `${Math.round(tr.accuracy * tr.n)}/${tr.n} at ${usd(tr.cost_usd_mean)}/answer vs ${usd(trD.cost_usd_mean)} without; current after retirements ${apFresh('graph_traces_warm_replay')} vs ${apFresh('C_lessons')} for LESSONS.md`, 'Landing → Benchmark → Learning'],
  ['B1', 'Answers cannot make up a number', `invented findings: graph ${m.graph.hallucinated}, model alone ${m.llm.hallucinated}`, 'any brief → click a receipt pill'],
  ['B2', 'Memory knows when a fact stopped being true', `current after ${events('D')} retired facts: graph ${fresh('D')}/${events('D')}, SQLite ${fresh('E')}/${events('E')}, markdown ${fresh('C')}/${events('C')}`, 'morning report → "What changed in memory"; `?asOf=`'],
  ['B4', 'Docs checked against practice with arithmetic, not a guess', `${m.graph.found}/${m.graph.found + m.graph.missed} planted mismatches, ${m.graph.hallucinated} invented, ${int(m.graph.tokens)} tokens vs ${int(m.llm.tokens)} for the model alone`, 'morning report → suggestion card'],
  ['B8', 'Graph algorithms on structure that means something', `${cl.graph.matched_spikes}/${cl.graph.matched_spikes + cl.graph.missed_spikes} spikes, ${cl.graph.spurious} spurious, ${int(cl.graph.tokens)} tokens vs ${cl.llm.spurious} spurious, ${int(cl.llm.tokens)} tokens`, 'chat → `graph_algorithm` (communities over SIMILAR_TO); the morning report\'s clusters group by issue'],
  ['B7', 'Tenant safety enforced by the database, not the prompt', `${refused}/${tier.cases.length} forbidden ops refused; ${torn} torn reads; N=${top.n}: ${int(top.throughput_per_s)} reads/s, p95 ${top.p95_ms} ms`, 'Landing → Try to write as a reader'],
  ['B6', "The agent's own history lives in FalkorDB too", 'crash resume: demonstrated, not benchmarked', '`npm run crash-demo -w agent`'],
]);

const mainTable = table(['memory design', `${modelName(HAIKU)} correct`, `${modelName(HAIKU)} $/answer`, `${modelName(SONNET)} correct`, `${modelName(SONNET)} $/answer`],
  ORDER.map((a) => [ARM[a], pct(task(HAIKU, a).accuracy), usd(task(HAIKU, a).cost_usd_mean), pct(task(SONNET, a).accuracy), usd(task(SONNET, a).cost_usd_mean)]));

const accuracy = bars(`Correct answers out of ${dh.n} (${modelName(HAIKU)} and ${modelName(SONNET)})`,
  ORDER.flatMap((a) => [`${SHORT[a]} · ${modelName(HAIKU)}`, `${SHORT[a]} · ${modelName(SONNET)}`]), 'correct (%)', 100,
  ORDER.flatMap((a) => [Math.round(task(HAIKU, a).accuracy * 100), Math.round(task(SONNET, a).accuracy * 100)]), true) + '\n\n' + mainTable;

const costVals = ORDER.map((a) => Math.round(task(HAIKU, a).cost_usd_mean * 1000 * 100) / 100);
const cost = bars(`Cost per 1,000 answers on ${modelName(HAIKU)} (USD)`, ORDER.map((a) => SHORT[a]), 'USD per 1,000 answers', ceilTo(Math.max(...costVals), 2), costVals);

const staleness = bars(`Current answers after ${events('D')} retired facts`, STALE.map((a) => SHORT[a]), `current (of ${events('D')})`, events('D'), STALE.map(fresh))
  + `\n\nMean upkeep per change: ${STALE.map((a) => `${PROSE[a]} ${int(upkeep(a))} tokens`).join(', ')}. The graph retires an edge with one Cypher write; markdown notes are rewritten by the model.`;

const apCost = AP.map(([key]) => Math.round(ap(key).cost_usd_mean * 1000 * 100) / 100);
const traces = bars(`Learning from past tickets: cost per 1,000 answers on ${dt.model.includes('haiku') ? 'Haiku' : dt.model} (USD)`,
  AP.map(([, label]) => label.replace(' (modelled)', '').replace('Graph decision traces (replay)', 'Traces (replay)').replace('Graph memory, no learning', 'Graph, no learning').replace('Markdown + LESSONS.md', 'LESSONS.md')),
  'USD per 1,000 answers', ceilTo(Math.max(...apCost), 0.2), apCost)
  + '\n\n' + table(['approach', `correct (of ${tr.n})`, '$/answer', 'p50', 'current after retirements'],
    AP.map(([key, label]) => { const a = ap(key); return [label, Math.round(a.accuracy * a.n), usd(a.cost_usd_mean), `${(a.p50_ms / 1000).toFixed(2)} s`, apFresh(key)]; }));

const ablation = bars('Invented findings (lower is better)', ['Mismatch · graph', 'Mismatch · model alone', 'Clusters · graph', 'Clusters · model alone'],
  'invented', ceilTo(Math.max(m.llm.hallucinated, cl.llm.spurious), 5), [m.graph.hallucinated, m.llm.hallucinated, cl.graph.spurious, cl.llm.spurious])
  + '\n\n' + bars('Tokens read (thousands)', ['Mismatch · graph', 'Mismatch · model alone', 'Clusters · graph', 'Clusters · model alone'],
    'thousand tokens', ceilTo(k1(Math.max(m.llm.tokens, cl.llm.tokens)), 50), [k1(m.graph.tokens), k1(m.llm.tokens), k1(cl.graph.tokens), k1(cl.llm.tokens)])
  + `\n\nBoth found ${m.graph.found}/${m.graph.found + m.graph.missed} planted mismatches and ${cl.graph.matched_spikes}/${cl.graph.matched_spikes + cl.graph.missed_spikes} planted spikes. The difference is what else they reported and what they read.`;

const cheaper = ORDER.filter((a) => a !== 'D' && task(HAIKU, a).cost_usd_mean < dh.cost_usd_mean);
if (cheaper.some((a) => task(HAIKU, a).accuracy >= dh.accuracy)) throw new Error('a cheaper arm matched the graph: rewrite "Where the graph lost"');
const lostBy = (a: number, b: number, what: string) => (a === b ? `no ${what}` : `${b - a} ${what}${b - a === 1 ? '' : 's'}`);
const lost = [
  `Per answer on ${modelName(HAIKU)}, ${cheaper.map((a) => `${PROSE[a]} (${usd(task(HAIKU, a).cost_usd_mean)})`).join(', ')} ${cheaper.length === 1 ? 'is' : 'are'} cheaper than the graph (${usd(dh.cost_usd_mean)}). ${cheaper.length === 1 ? 'It answers' : 'They answer'} fewer questions right.`,
  `${modelName(SONNET)} on the graph scored ${pct(ds.accuracy)} against ${modelName(HAIKU)}'s ${pct(dh.accuracy)}, at ${usd(ds.cost_usd_mean)} per answer.`,
  `Decision traces gave up ${lostBy(Math.round(tr.accuracy * tr.n), Math.round(trD.accuracy * trD.n), 'answer')} (${Math.round(tr.accuracy * tr.n)}/${tr.n} against ${Math.round(trD.accuracy * trD.n)}/${trD.n}) and ${lostBy(ap('graph_traces_warm_replay').staleness.fresh, ap('D').staleness.fresh, 'fresh answer')} (${apFresh('graph_traces_warm_replay')} against ${apFresh('D')}).`,
  `The graph and the model alone each missed ${cl.graph.missed_spikes} of ${cl.graph.matched_spikes + cl.graph.missed_spikes} planted spikes.`,
  `Concurrency is one container on one machine with synthetic load, not a production cluster.`,
].join(' ');

const buckets = ['single_fact', 'multi_hop', 'structural'] as const;
const method = `**Method.** ${dh.n} questions (${buckets.map((b) => `${r.records.filter((x) => x.arch === 'D' && (!x.model_id || x.model_id === HAIKU) && x.bucket === b).length} ${b.replace('_', '-')}`).join(', ')}), seed ${r.seed}, ${r.records.length} answers on ${modelName(HAIKU)} plus the same ${dh.n} per arm on ${modelName(SONNET)} in \`per_task\`. Judge: ${r.judge.model_id} (\`${r.judge.prompt_path}\`, not the answer model). Run at ${new Date(r.run_at).toISOString()}.`;

const blocks: Record<string, string> = { glance, accuracy, cost, staleness, traces, ablation, lost, method };

// ---- SVGs (light card with its own background, so they read on GitHub in both themes) --------------------------
const INK = '#101828', BODY = '#1D2939', MUTED = '#5D6675', GRID = '#E4E7EC', BLUE = '#2a78d6', ORANGE = '#eb6834';
const FONT = `font-family="IBM Plex Sans, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const svg = (w: number, h: number, title: string, body: string[]) => [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" ${FONT}>`,
  `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="#FFFFFF" stroke="${GRID}"/>`, ...body, '</svg>', ''].join('\n');
const text = (x: number, y: number, s: string, o: { size?: number; fill?: string; anchor?: string; weight?: number } = {}) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size ?? 12}" fill="${o.fill ?? BODY}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;

function frontier(): string {
  const W = 780, H = 460, L = 70, R = 40, T = 70, B = 60, pw = W - L - R, ph = H - T - B;
  const lo = -4, hi = -1; // log10 USD
  const X = (c: number) => L + ((Math.log10(c) - lo) / (hi - lo)) * pw, Y = (a: number) => T + (1 - a) * ph;
  const out = [text(24, 32, 'Accuracy against cost per answer', { size: 16, fill: INK, weight: 600 }),
    text(24, 52, `${dh.n} questions, seed ${r.seed}. Up and to the left is better. Cost axis is logarithmic.`, { fill: MUTED })];
  for (let a = 0; a <= 1.001; a += 0.25) out.push(`<line x1="${L}" x2="${W - R}" y1="${Y(a)}" y2="${Y(a)}" stroke="${GRID}"/>`, text(L - 8, Y(a) + 4, pct(a), { anchor: 'end', fill: MUTED }));
  for (let e = lo; e <= hi; e++) out.push(`<line x1="${X(10 ** e)}" x2="${X(10 ** e)}" y1="${T}" y2="${T + ph}" stroke="${GRID}"/>`, text(X(10 ** e), T + ph + 18, `$${Number((10 ** e).toPrecision(1))}`, { anchor: e === hi ? 'end' : e === lo ? 'start' : 'middle', fill: MUTED }));
  out.push(text(L + pw / 2, H - 14, 'USD per answer', { anchor: 'middle', fill: MUTED }));
  for (const [model, color, shape] of [[HAIKU, BLUE, 'circle'], [SONNET, ORANGE, 'square']] as const)
    for (const a of ORDER) {
      const t = task(model, a), x = X(t.cost_usd_mean), y = Y(t.accuracy), left = x > L + pw * 0.8;
      out.push(shape === 'circle' ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${color}" stroke="#FFFFFF" stroke-width="2"/>`
        : `<rect x="${(x - 6).toFixed(1)}" y="${(y - 6).toFixed(1)}" width="12" height="12" rx="2" fill="${color}" stroke="#FFFFFF" stroke-width="2"/>`);
      out.push(text(left ? x - 11 : x + 11, y + 4, `${SHORT[a]} · ${modelName(model)} ${pct(t.accuracy)}`, { anchor: left ? 'end' : undefined, weight: a === 'D' ? 600 : undefined, fill: a === 'D' ? INK : BODY }));
    }
  out.push(text(W - R, 32, `circle = ${modelName(HAIKU)}, square = ${modelName(SONNET)}`, { anchor: 'end', fill: MUTED }));
  return svg(W, H, 'Accuracy against cost per answer for five memory designs on two models', out);
}

function bucketChart(): string {
  const names = { single_fact: 'Single fact', multi_hop: 'Multi-hop', structural: 'Structural' } as const;
  const W = 780, rowH = 30, T = 96, labelW = 170, gap = 24, pw = (W - 24 - labelW - gap * 2 - 24) / 3, H = T + ORDER.length * rowH + 30;
  const out = [text(24, 32, `Accuracy by question type (${modelName(HAIKU)})`, { size: 16, fill: INK, weight: 600 }),
    text(24, 52, `${dh.n} questions split across three types. Bars run 0 to 100%.`, { fill: MUTED })];
  ORDER.forEach((a, i) => out.push(text(24, T + i * rowH + 19, ARM[a], { fill: a === 'D' ? INK : BODY, weight: a === 'D' ? 600 : undefined })));
  buckets.forEach((b, j) => {
    const x0 = 24 + labelW + j * (pw + gap);
    out.push(text(x0, T - 14, names[b], { fill: INK, weight: 600 }), `<line x1="${x0}" x2="${x0}" y1="${T - 4}" y2="${T + ORDER.length * rowH}" stroke="${GRID}"/>`);
    ORDER.forEach((a, i) => {
      const acc = (r.summary as any)[a]?.[b]?.accuracy ?? 0, w = Math.max(acc * (pw - 40), 0);
      out.push(`<rect x="${x0}" y="${T + i * rowH + 6}" width="${w.toFixed(1)}" height="18" rx="4" fill="${BLUE}"/>`, text(x0 + w + 6, T + i * rowH + 19, pct(acc), { fill: BODY }));
    });
  });
  return svg(W, H, 'Accuracy by question type for five memory designs', out);
}

const svgs: Record<string, string> = { 'bench-frontier.svg': frontier(), 'bench-buckets.svg': bucketChart() };

// ---- write / check --------------------------------------------------------------------------------------------
function replace(t: string, name: string, body: string): string {
  const start = `<!-- bench:${name} (generated by scripts/readme-charts.ts, do not edit) -->`, end = `<!-- /bench:${name} -->`;
  const i = t.indexOf(start), j = t.indexOf(end);
  if (i < 0 || j < i) throw new Error(`README.md: missing markers for "bench:${name}"`);
  return `${t.slice(0, i + start.length)}\n${body}\n${t.slice(j)}`;
}
const old = readFileSync(README, 'utf8');
let next = old;
for (const [name, body] of Object.entries(blocks)) next = replace(next, name, body);

if (process.argv.includes('--check')) {
  const drift = Object.entries(blocks).filter(([n, b]) => replace(old, n, b) !== old).map(([n]) => `bench:${n}`);
  for (const [f, s] of Object.entries(svgs)) { const u = new URL(f, IMG); if (!existsSync(u) || readFileSync(u, 'utf8') !== s) drift.push(`docs/img/${f}`); }
  if (drift.length) { console.error(`Drifted from bench/results.json: ${drift.join(', ')}. Run: node scripts/readme-charts.ts`); process.exit(1); }
  console.log('README charts match bench/results.json.');
} else {
  mkdirSync(IMG, { recursive: true });
  for (const [f, s] of Object.entries(svgs)) writeFileSync(new URL(f, IMG), s);
  if (next !== old) writeFileSync(README, next);
  console.log('README charts and docs/img written.');
}
