// §7 Memory tiers: an isometric stack of four graphs (CSS 3D, the cube idea from aceternity.md §7, no WebGL).
// Hover or focus a tier: its cubes light and the panel shows its database rule. A recorded NOPERM refusal plays on demand.
import { useRef, useState } from 'react';
import { demo } from '../data';
import { Button, useInView, still } from '../parts/ui';

const T = demo.tiers;
const TIERS = [
  { id: 'cust', graph: 'cust_*', name: 'Customer memory', tint: '--agent-sakura', line: 'What a session learned about one customer.', reads: 'Agents (user_*)', writes: 'Agents, during a session' },
  { id: 'user', graph: 'user_*', name: 'Agent memory', tint: '--agent-ube', line: 'One agent’s own notes. Nobody else reads them.', reads: 'That agent only', writes: 'That agent only' },
  { id: 'team', graph: 'team_*', name: 'Team memory', tint: '--agent-sky', line: 'What a team taught Mochi, waiting for the dream to promote it.', reads: `${T.reader}, ${T.dream}, agents`, writes: `${T.dream}, agents` },
  { id: 'company', graph: T.company, name: 'The company brain', tint: '--ink-faint', line: 'Customers, tickets, issues, fixes, teams. Everyone reads it.', reads: `${T.reader}, agents`, writes: `${T.dream} only` },
];

export function Tiers() {
  const [sel, setSel] = useState('company'), [term, setTerm] = useState(0), sec = useRef<HTMLElement>(null);
  const t = TIERS.find((x) => x.id === sel)!;
  useInView(sec);
  return (
    <section className="tiers wrap" id="tiers" data-sky="tiers" ref={sec} aria-labelledby="tiers-h">
      <div className="tiers-copy">
        <h2 id="tiers-h" className="t-display">One brain, many memories.</h2>
        <p className="t-lead">Four kinds of graph in one FalkorDB. Redis ACL users enforce who may write each one, so a prompt cannot talk its way past them.</p>
      </div>
      <div className="tiers-grid">
        <div className="stack-wrap" aria-hidden="true">
          <div className="stack">
            {[...TIERS].reverse().map((x, i) => (
              <div key={x.id} className={`slab ${x.id === sel ? 'on' : ''}`} style={{ ['--z' as string]: i, ['--tint' as string]: `var(${x.tint})` }} onPointerEnter={() => setSel(x.id)}>
                {Array.from({ length: 25 }, (_, k) => <i key={k} style={{ ['--k' as string]: (k % 5) + Math.floor(k / 5) }} />)}
              </div>
            ))}
          </div>
        </div>
        <div className="tier-panel">
          <ul className="tier-list" aria-label="Memory tiers">
            {TIERS.map((x) => (
              <li key={x.id}>
                <button type="button" className={`tier ${x.id === sel ? 'on' : ''}`} aria-pressed={x.id === sel} onClick={() => setSel(x.id)} onPointerEnter={() => setSel(x.id)} onFocus={() => setSel(x.id)}>
                  <span className="t-headline">{x.name}</span><span className="t-data-strong">{x.graph}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="rule" key={sel} data-ui>
            <p className="t-noticed">{t.line}</p>
            <dl className="t-body">
              <dt>Reads</dt><dd>{t.reads}</dd>
              <dt>Writes</dt><dd>{t.writes}</dd>
            </dl>
          </div>
          <Button onClick={() => setTerm((n) => n + 1)}>Try to write as a reader</Button>
          {term > 0 && (
            <div className="term" data-ui key={term} role="log" aria-label="Recorded refusal">
              <span className="t-data tl"><b>$</b> redis-cli --user {T.reader}</span>
              <span className="t-data tl" style={{ ['--d' as string]: still() ? 0 : 1 }}><b>&gt;</b> {T.refusal.command}</span>
              <span className="t-data tl err" style={{ ['--d' as string]: still() ? 0 : 2 }}>{T.refusal.error}</span>
              <span className="t-caption tl note" style={{ ['--d' as string]: still() ? 0 : 3 }}>FalkorDB refused it. The graph is unchanged.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
