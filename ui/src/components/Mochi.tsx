// Mochi, ported exactly from the design system (MOODS table, sizes, ring, satellite, shine, squish).
// Self-contained: exported as `@mochi/ui/mochi` for the landing page. Needs mochi.css tokens on the page.
import { useState } from 'react';
import './mochi.css';

export type Mood = 'idle' | 'listening' | 'thinking' | 'curious' | 'speaking' | 'done' | 'sorry' | 'handover';
type MoodDef = { label: string; flavour: string; core: string; ink: string; op: number; anim: string; origin: string; ring?: boolean; sat?: boolean };

export const MOODS: Record<Mood, MoodDef> = {
  idle:      { label: 'Idle',      flavour: 'sakura',  core: 'var(--agent-sakura)',  ink: 'var(--mochi-ink-sakura)',  op: 0.72, anim: 'mb-idle 9s ease-in-out infinite', origin: '50% 50%' },
  listening: { label: 'Listening', flavour: 'sakura',  core: 'var(--agent-sakura)',  ink: 'var(--mochi-ink-sakura)',  op: 0.95, anim: 'mb-listen 1.8s ease-in-out infinite', origin: '50% 50%', ring: true },
  curious:   { label: 'Curious',   flavour: 'yuzu',    core: 'var(--agent-yuzu)',    ink: 'var(--mochi-ink-yuzu)',    op: 0.85, anim: 'mb-curious 2.6s ease-in-out infinite', origin: '50% 100%' },
  thinking:  { label: 'Thinking',  flavour: 'ube',     core: 'var(--agent-ube)',     ink: 'var(--mochi-ink-ube)',     op: 0.9,  anim: 'mb-think 2.4s ease-in-out infinite', origin: '50% 50%', sat: true },
  speaking:  { label: 'Speaking',  flavour: 'sakura',  core: 'var(--agent-sakura)',  ink: 'var(--mochi-ink-sakura)',  op: 0.85, anim: 'mb-speak 0.9s ease-in-out infinite', origin: '50% 50%' },
  done:      { label: 'Done',      flavour: 'matcha',  core: 'var(--agent-matcha)',  ink: 'var(--mochi-ink-matcha)',  op: 0.9,  anim: 'mb-done 1s cubic-bezier(0.34,1.4,0.64,1) 1 both, mb-idle 9s ease-in-out 1s infinite', origin: '50% 100%' },
  sorry:     { label: 'Sorry',     flavour: 'hojicha', core: 'var(--agent-hojicha)', ink: 'var(--mochi-ink-hojicha)', op: 0.6,  anim: 'mb-sorry 4s ease-in-out infinite', origin: '50% 100%' },
  handover:  { label: 'Handover',  flavour: 'anzu',    core: 'var(--agent-anzu)',    ink: 'var(--mochi-ink-anzu)',    op: 0.85, anim: 'mb-wave 1.2s ease-in-out infinite', origin: '50% 100%' },
};
export const MOOD_NAMES = Object.keys(MOODS) as Mood[];

export type MochiProps = {
  mood?: Mood; size?: 'xs' | 'sm' | 'md' | 'lg'; tone?: 'desk' | 'mood'; label?: string; still?: boolean;
  /** Default true: every Mochi squishes when tapped. false opts out. */ squishable?: boolean;
  onClick?: () => void; className?: string;
};

/** On the desk (xs–md) the calm moods (idle, listening, speaking) glow sky; every other mood keeps its own core.
 *  At lg or with tone="mood", every mood keeps its own. */
export function Mochi(p: MochiProps) {
  const mood: Mood = p.mood && MOODS[p.mood] ? p.mood : 'idle';
  const m = MOODS[mood], size = p.size ?? 'sm', big = size === 'lg';
  const core = !big && p.tone !== 'mood' && (mood === 'idle' || mood === 'listening' || mood === 'speaking') ? 'var(--agent-sky)' : m.core;
  const [n, setN] = useState(0);
  const press = p.squishable !== false;
  const cls = ['mb-mochi', `mb-mochi-${size}`, press && 'mb-mochi-press', n ? (n % 2 ? 'mb-squish-a' : 'mb-squish-b') : null, p.className].filter(Boolean).join(' ');
  return (
    <span className={cls} data-mood={mood} role={p.onClick ? 'button' : 'img'} aria-label={p.label ?? `Mochi, ${m.label.toLowerCase()}`}
      tabIndex={p.onClick ? 0 : undefined}
      onPointerDown={press ? () => setN(n + 1) : undefined}
      onClick={p.onClick}
      onKeyDown={p.onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setN(n + 1); p.onClick!(); } } : undefined}>
      {m.ring && big && <span className="mb-mochi-ring" style={{ borderColor: core }} />}
      <span className="mb-mochi-body" style={{ animation: p.still ? 'none' : m.anim, transformOrigin: m.origin }}>
        <span className="mb-mochi-core" style={{ background: core, opacity: m.op }} />
        {big && <span className="mb-mochi-shine" />}
      </span>
      {m.sat && big && <span className="mb-mochi-sat" />}
    </span>
  );
}

/** The mood as words: the state label in DM Sans caps, the flavour in Instrument Serif italic, in its mochi-ink. */
export function MochiMood({ mood = 'idle' }: { mood?: Mood }) {
  const m = MOODS[mood] ?? MOODS.idle;
  return <span className="mb-mochi-mood"><span className="mb-mochi-state">{m.label}</span><span className="mb-mochi-flavour" style={{ color: m.ink }}>{m.flavour}</span></span>;
}
