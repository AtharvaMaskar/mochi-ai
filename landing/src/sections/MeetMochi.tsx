// §2b Meet Mochi: the one place a visitor picks a mood (a showcase). The sky tints to the mood's agent colour.
import { useEffect, useRef, useState } from 'react';
import { Mochi, MochiMood, MOODS, type Mood } from '@mochi/ui/mochi';
import { Sparkles, useInView } from '../parts/ui';
import { want } from '../sky/store';

const LINES: Record<Mood, string> = {
  idle: 'Nothing new. I’m watching the queue.',
  listening: 'You’re typing. I’m taking it in.',
  thinking: 'I’m walking the graph.',
  curious: 'Something here doesn’t match the docs.',
  speaking: 'Your brief is ready.',
  done: 'The dream finished. The report is in.',
  sorry: 'I couldn’t reach the graph.',
  handover: 'This one needs a person.',
};
const ORDER: Mood[] = ['idle', 'listening', 'thinking', 'curious', 'speaking', 'done', 'sorry', 'handover'];

export function MeetMochi() {
  const [mood, setMood] = useState<Mood>('thinking'), [burst, setBurst] = useState(0), ref = useRef<HTMLElement>(null);
  const colour = `--agent-${MOODS[mood].flavour}`;
  useInView(ref);
  useEffect(() => { want('mochi', { tint: colour, clouds: 0.5 }); }, [colour]);
  const pick = (m: Mood) => { setMood(m); setBurst((n) => n + 1); };

  return (
    <section className="meet wrap" id="mochi" data-sky="mochi" ref={ref}>
      <div className="meet-copy">
        <h2 className="t-display">Mochi’s mood is the work.</h2>
        <p className="t-lead">Its colour and motion say what the system is doing, so you can read the desk at a glance. Tap a mood to see it. In the product, the work sets it.</p>
      </div>
      <div className="meet-stage">
        <div className="meet-big">
          <Mochi size="lg" mood={mood} tone="mood" key={mood} />
          <Sparkles color={colour} active={false} burst={burst} key={burst} />
        </div>
        <div className="meet-now"><MochiMood mood={mood} /><p className="t-lead">{LINES[mood]}</p></div>
      </div>
      <ul className="moods" aria-label="Mochi's moods, a showcase">
        {ORDER.map((m) => (
          <li key={m}>
            <button type="button" className={`mood ${m === mood ? 'on' : ''}`} aria-pressed={m === mood} onClick={() => pick(m)}>
              <Mochi size="md" mood={m} tone="mood" still={m !== mood} />
              <span className="mood-txt"><span className="t-headline">{MOODS[m].label}</span><span className="t-body">{LINES[m]}</span></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
