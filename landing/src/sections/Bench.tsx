// §8 Benchmark: rendered only when bench/results.json exists and passes validateResults (vite.config.ts).
// Every figure is read from that file; none is written here. Losses (accuracy and cost) are shown beside wins.
import type { Results } from '@mochi/contracts';
import { Rolling } from '../parts/ui';

const ARMS: Record<string, string> = { A: 'Stuff everything', B: 'Vector top-k', C: 'File memory', D: 'Graph (Mochi)', E: 'SQLite relational' };
const arm = (a: string) => ARMS[a] ?? `Arm ${a}`;
const pct = (x: number) => (x <= 1 ? x * 100 : x).toFixed(1);
const usd = (x: number) => `$${x.toFixed(5)}`;
const model = (id: string) => { const m = id.split('-')[1] ?? id; return m.charAt(0).toUpperCase() + m.slice(1); };

export function Bench({ results: r }: { results: Results }) {
  const arms = Object.keys(r.summary).sort() as (keyof Results['summary'])[];
  const buckets = [...new Set(arms.flatMap((a) => Object.keys(r.summary[a] ?? {})))];
  const tasks = r.per_task ?? [];
  const models = [...new Set(tasks.map((p) => p.model_id))];
  const lost = [
    ...buckets.flatMap((b) => {
      const d = r.summary.D?.[b as 'multi_hop']?.accuracy;
      if (d === undefined) return [];
      return arms.filter((a) => a !== 'D' && (r.summary[a]?.[b as 'multi_hop']?.accuracy ?? -1) > d).map((a) => `${arm(a)} beat the graph on ${b.replace('_', ' ')} (${pct(r.summary[a]![b as 'multi_hop']!.accuracy)}% vs ${pct(d)}%, ${model(r.model.id)}).`);
    }),
    ...models.flatMap((m) => {
      const rows = tasks.filter((p) => p.model_id === m), d = rows.find((p) => p.arch === 'D');
      if (!d) return [];
      const others = rows.filter((p) => p.arch !== 'D');
      return [
        ...others.filter((p) => p.accuracy > d.accuracy).map((p) => `${model(m)}: ${arm(p.arch)} beat the graph on accuracy per task (${pct(p.accuracy)}% vs ${pct(d.accuracy)}%).`),
        ...others.filter((p) => p.cost_usd_mean < d.cost_usd_mean).map((p) => `${model(m)}: ${arm(p.arch)} costs less per task than the graph (${usd(p.cost_usd_mean)} vs ${usd(d.cost_usd_mean)}).`),
      ];
    }),
  ];
  return (
    <section className="bench wrap" id="bench" data-sky="bench" aria-labelledby="bench-h">
      <h2 id="bench-h" className="t-display">Measured, including losses.</h2>
      <p className="t-lead">From bench/results.json, run {new Date(r.run_at).toISOString().slice(0, 10)}, seed {r.seed}, judge {r.judge.model_id}.</p>
      {tasks.length > 0 && (
        <table className="ledger" data-ui>
          <caption className="t-label">Per task, by model and memory design: accuracy, answer cost and end-to-end p95</caption>
          <thead><tr><th className="t-caption" scope="col">Model · design</th><th className="t-caption" scope="col">Accuracy</th><th className="t-caption" scope="col">Cost per task</th><th className="t-caption" scope="col">End-to-end p95 s</th></tr></thead>
          <tbody>
            {models.flatMap((m) => tasks.filter((p) => p.model_id === m).sort((a, b) => a.arch.localeCompare(b.arch)).map((p) => (
              <tr key={`${m}-${p.arch}`}>
                <th scope="row" className="t-headline">{model(m)} · {arm(p.arch)}</th>
                <td className="t-data-strong"><Rolling value={pct(p.accuracy)} />%</td>
                <td className="t-data-strong">{usd(p.cost_usd_mean)}</td>
                <td className="t-data-strong">{(p.p95_ms / 1000).toFixed(1)}</td>
              </tr>
            )))}
          </tbody>
        </table>
      )}
      <table className="ledger" data-ui>
        <caption className="t-label">Accuracy by question type on {r.model.id}, with retrieval time before the model answers</caption>
        <thead><tr><th className="t-caption" scope="col">Design</th>{buckets.map((b) => <th key={b} className="t-caption" scope="col">{b.replace('_', ' ')}</th>)}<th className="t-caption" scope="col">Retrieval p95 ms</th></tr></thead>
        <tbody>
          {arms.map((a) => (
            <tr key={a}>
              <th scope="row" className="t-headline">{arm(a)}</th>
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
