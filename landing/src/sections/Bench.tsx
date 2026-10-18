// §8 Benchmark: rendered only when bench/results.json exists and passes validateResults (vite.config.ts).
// Every figure is read from that file; none is written here. Losses are shown beside wins.
import type { Results } from '@mochi/contracts';
import { Rolling } from '../parts/ui';

const ARMS: Record<string, string> = { A: 'Stuff everything', B: 'Vector top-k', C: 'File memory', D: 'Graph (Mochi)' };
const pct = (x: number) => (x <= 1 ? x * 100 : x).toFixed(1);

export function Bench({ results: r }: { results: Results }) {
  const arms = Object.keys(r.summary).sort() as (keyof Results['summary'])[];
  const buckets = [...new Set(arms.flatMap((a) => Object.keys(r.summary[a] ?? {})))];
  const lost = buckets.flatMap((b) => {
    const d = r.summary.D?.[b as 'multi_hop']?.accuracy;
    if (d === undefined) return [];
    return arms.filter((a) => a !== 'D' && (r.summary[a]?.[b as 'multi_hop']?.accuracy ?? -1) > d).map((a) => `${ARMS[a] ?? `Arm ${a}`} beat the graph on ${b.replace('_', ' ')} (${pct(r.summary[a]![b as 'multi_hop']!.accuracy)}% vs ${pct(d)}%).`);
  });
  return (
    <section className="bench wrap" id="bench" data-sky="bench" aria-labelledby="bench-h">
      <h2 id="bench-h" className="t-display">Measured, including losses.</h2>
      <p className="t-lead">From bench/results.json, run {new Date(r.run_at).toISOString().slice(0, 10)}, seed {r.seed}, model {r.model.id}.</p>
      <table className="ledger" data-ui>
        <caption className="t-label">Accuracy by memory design and question type</caption>
        <thead><tr><th className="t-caption" scope="col">Design</th>{buckets.map((b) => <th key={b} className="t-caption" scope="col">{b.replace('_', ' ')}</th>)}<th className="t-caption" scope="col">p95 ms</th></tr></thead>
        <tbody>
          {arms.map((a) => (
            <tr key={a}>
              <th scope="row" className="t-headline">{ARMS[a] ?? `Arm ${a}`}</th>
              {buckets.map((b) => { const s = r.summary[a]?.[b as 'multi_hop']; return <td key={b} className="t-data-strong">{s ? <><Rolling value={pct(s.accuracy)} />%</> : 'not run'}</td>; })}
              <td className="t-data-strong">{Math.max(...Object.values(r.summary[a] ?? {}).map((s) => s!.p95_ms)).toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="ledger-rows">
        {r.ledger.map((l) => <li key={l.feature}><span className="t-headline">{l.feature}</span><span className="t-body">{l.mechanism}</span><span className="t-body">{l.result}</span></li>)}
      </ul>
      {lost.length > 0 && <div className="lost"><h3 className="t-headline">Where we lost</h3>{lost.map((x) => <p key={x} className="t-lead">{x}</p>)}</div>}
    </section>
  );
}
