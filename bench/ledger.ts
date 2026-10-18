// Feature Ledger (SPEC §1), built from the sections, never from prose. A null/empty section
// writes an honest "not measured" row; crash resume is demonstrated, not benchmarked.
import type { Results } from '@mochi/contracts';

type Row = Results['ledger'][number];
const NOT = 'not measured';

export function buildLedger(r: Omit<Results, 'ledger'>): Row[] {
  const row = (feature: string, mechanism: string, measured_against: string, result: string | null): Row =>
    ({ feature, mechanism, measured_against, result: result ?? NOT, status: result === null ? 'not_measured' : 'measured' });

  const arches = (['D', 'C', 'B', 'A'] as const).filter((a) => r.records.some((x) => x.arch === a));
  const briefing = arches.length
    ? arches.map((a) => { const rs = r.records.filter((x) => x.arch === a); return `${a} ${rs.filter((x) => x.correct).length}/${rs.length}`; }).join(' vs ')
    : null;

  const m = r.mismatch_ablation;
  const side = (s: { found: number; missed: number; hallucinated: number; tokens: number }) =>
    `found ${s.found}/${s.found + s.missed}, ${s.hallucinated} hallucinated, ${s.tokens} tokens`;
  const mismatch = m ? `graph ${side(m.graph)} vs LLM ${side(m.llm)}${m.llm.found > m.graph.found ? ' (graph lost)' : ''}` : null;

  const c = r.clusters_ablation;
  const cside = (s: NonNullable<typeof c>['graph']) =>
    `${s.matched_spikes}/${s.matched_spikes + s.missed_spikes} spikes, ${s.spurious} spurious, ${s.tokens} tokens`;
  const clusters = c ? `graph ${cside(c.graph)} vs LLM ${cside(c.llm)}${c.llm.matched_spikes > c.graph.matched_spikes ? ' (graph lost)' : ''}` : null;

  const t = r.tier_isolation;
  const tier = t ? `${t.cases.filter((x) => x.refused).length}/${t.cases.length} refused as mochi_reader` : null;

  const k = r.concurrency;
  const top = k?.runs.at(-1);
  const conc = k && top
    ? `N=${top.n}: p50 ${top.p50_ms}ms, p95 ${top.p95_ms}ms, ${top.throughput_per_s}/s; torn reads ${k.runs.reduce((s, x) => s + x.torn_reads, 0)} across N=${k.runs.map((x) => x.n).join('/')}`
      + (k.isolation ? `; readers p95 one graph ${k.isolation.one_graph.p95_ms}ms vs per-user ${k.isolation.per_user.p95_ms}ms` : '')
      + ' (single container, admin user on a scratch copy)'
    : null;

  return [
    row('briefing retrieval', 'multi-hop Cypher', 'arms A/B/C (main benchmark)', briefing),
    row('mismatch detection', 'deterministic CONTRADICTS/UNDOCUMENTED rules', 'LLM given all docs+tickets as text; 5 planted mismatches', mismatch),
    row('emerging clusters', 'community detection (CDLP)', 'LLM clustering of the same week\'s raw ticket text vs planted bad-release spikes', clusters),
    { feature: 'crash resume', mechanism: 'Pi Durable checkpoints', measured_against: 'demonstrated, not benchmarked', result: 'demonstrated (crash-demo clip), not benchmarked', status: 'demonstrated' },
    row('tier isolation', 'Redis ACL users per tier', 'refusal cases as mochi_reader', tier),
    row('multi-agent concurrency', 'N parallel briefings while the dream writes; multigraph isolation', 'latency p50/p95 vs N, torn-read assertion, one graph vs per-user graphs', conc),
  ];
}
