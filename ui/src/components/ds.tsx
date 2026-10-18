// Design-system primitives, ported from the MochiAI reference (behaviour and measurements only).
import { useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { Inbox, Funnel, User, Check, Boxes, Archive, GitCompare, FileText, ArrowLeft, X, type LucideIcon } from 'lucide-react';

import { Mochi, type Mood } from './Mochi.tsx';
export { Mochi, MochiMood, MOOD_NAMES, type Mood } from './Mochi.tsx';

export function DrawnCheck() {
  return <svg className="mb-check" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="var(--success)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'link'; size?: 'md' | 'sm';
  /** Morph into a drawn check and this word for about a second, keeping the width. */ success?: string;
  /** Hold to confirm, in ms (about 700). Letting go early cancels. */ hold?: number;
  loading?: boolean; /** Keeps the button tappable: a tap shakes it and shows this reason. */ disabledReason?: string; haptic?: boolean;
};
/** 8 ms haptic tick where the device supports it. */
export const tick = () => { try { navigator.vibrate?.(8); } catch { /* unsupported */ } };
/** A gentle 3 px shake for a click that can't happen yet. Always pair it with words. */
export function shake(el: HTMLElement) { el.classList.remove('mb-btn-shake'); void el.offsetWidth; el.classList.add('mb-btn-shake'); }

/** Button as a keycap: sinks and springs back, light blooms from the fingertip, decisions land with a check. */
export function Button({ variant = 'secondary', size = 'md', disabledReason, success, hold, loading, haptic = true, className, onClick, onPointerDown, children, style, ...rest }: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null), holdT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [why, setWhy] = useState(0), [done, setDone] = useState(false), [holding, setHolding] = useState(false);
  const land = (e: MouseEvent<HTMLButtonElement>) => {
    if (haptic && (variant === 'primary' || success || hold)) tick();
    if (success) { setDone(true); setTimeout(() => setDone(false), 1100); }
    onClick?.(e);
  };
  const stopHold = () => { clearTimeout(holdT.current); setHolding(false); };
  const btn = (
    <button {...rest} ref={ref} disabled={rest.disabled || loading} aria-busy={loading || undefined}
      aria-disabled={disabledReason ? 'true' : undefined}
      style={hold ? { ...style, ['--hold' as string]: `${hold}ms` } : style}
      className={['mb-btn', `mb-btn-${variant}`, `mb-btn-${size}`, done && 'mb-btn-done', holding && 'mb-btn-holding', loading && 'mb-btn-loading', className].filter(Boolean).join(' ')}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
        if (hold && !disabledReason && !done) {
          setHolding(true); clearTimeout(holdT.current);
          holdT.current = setTimeout(() => { setHolding(false); land(e); }, hold);
        }
        onPointerDown?.(e);
      }}
      onPointerUp={hold ? stopHold : undefined} onPointerLeave={hold ? stopHold : undefined} onPointerCancel={hold ? stopHold : undefined}
      onClick={(e) => {
        if (disabledReason) { shake(ref.current!); setWhy(why + 1); return; }
        // a held button lands from its timer; a keyboard press (detail 0) can't hold, so it lands at once
        if ((hold && e.detail > 0) || done) { e.preventDefault(); return; }
        land(e);
      }}>
      {hold && <span className="mb-btn-fill" aria-hidden="true" />}
      {success ? (
        <span className="mb-btn-label mb-btn-stack">
          <span aria-hidden={done || undefined} style={done ? { visibility: 'hidden' } : undefined}>{children}</span>
          <span aria-hidden={!done || undefined} style={done ? undefined : { visibility: 'hidden' }}><DrawnCheck key={String(done)} />{success}</span>
        </span>
      ) : <span className="mb-btn-label">{children}</span>}
    </button>
  );
  if (!disabledReason) return btn;
  return <span className="mb-btn-wrap">{btn}{why > 0 && <span key={why} className="mb-btn-why" role="status">{disabledReason}</span>}</span>;
}

/** Digits roll like an odometer when the value changes. Screen readers get the plain value. */
export function RollingNumber({ value }: { value: number | string }) {
  const str = String(value);
  return (
    <span className="mb-roll">
      <span className="sr">{str}</span>
      {str.split('').map((ch, i) => {
        const k = str.length - i;
        if (!/[0-9]/.test(ch)) return <span key={`s${k}`} aria-hidden="true">{ch}</span>;
        return (
          <span key={`d${k}`} className="mb-roll-d" aria-hidden="true">
            <span className="mb-roll-col" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>{'0123456789'.split('').map((n) => <span key={n}>{n}</span>)}</span>
          </span>
        );
      })}
    </span>
  );
}

export function Segmented(p: { options: { id: string; label: string; count?: number }[]; value: string; onChange?: (id: string) => void; label?: string }) {
  const i = p.options.findIndex((o) => o.id === p.value);
  return (
    <div className="mb-seg" role="group" aria-label={p.label ?? 'Filter'}>
      {i >= 0 && <span className="mb-seg-ind" aria-hidden="true" style={{ ['--seg-i' as string]: i, ['--seg-n' as string]: p.options.length }} />}
      {p.options.map((o) => (
        <button key={o.id} aria-pressed={o.id === p.value} onClick={() => p.onChange?.(o.id)}>
          {o.label}{o.count !== undefined && <span className="mono">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

const SIGNAL_WORD = { alarm: 'Alarm', warning: 'Warning', clear: 'No signs' };
export function Signal(p: { level: 'alarm' | 'warning' | 'clear'; children?: ReactNode }) {
  return <span className={`mb-signal mb-signal-${p.level}`}><span className="mb-signal-dot">{p.level === 'alarm' && <i />}</span>{p.children ?? SIGNAL_WORD[p.level]}</span>;
}

/** Where a computed confidence (evidence share, or cosine similarity) turns into a word. */
export const ConfidenceBands = { likely: 0.75, possible: 0.45 } as const;
export const confidenceWord = (p: number) => (p >= ConfidenceBands.likely ? 'Likely' : p >= ConfidenceBands.possible ? 'Possible' : 'Unsure');
export function Confidence(p: { p: number; hidePct?: boolean }) {
  const on = p.p >= ConfidenceBands.likely ? 3 : p.p >= ConfidenceBands.possible ? 2 : 1;
  return (
    <span className="mb-conf">
      <span className="mb-conf-segs" aria-hidden="true">{[1, 2, 3].map((k) => <i key={k} data-on={k <= on} />)}</span>
      <span className="mb-conf-word">{confidenceWord(p.p)}</span>
      {!p.hidePct && <span className="mono">{Math.round(p.p * 100)}%</span>}
    </span>
  );
}

export function NeedsYou(p: { title?: string; reason: ReactNode; action?: string; mood?: Mood; onAction?: () => void }) {
  return (
    <div className="mb-needs" role="status">
      <Mochi size="sm" mood={p.mood ?? 'curious'} still />
      <div className="mb-needs-text">
        <span className="mb-needs-title">{p.title ?? 'This needs you'}</span>
        <div className="mb-needs-reason">{p.reason}</div>
      </div>
      {p.action && <Button size="sm" onClick={p.onAction}>{p.action}</Button>}
    </div>
  );
}

const ICONS: Record<string, LucideIcon> = { inbox: Inbox, filter: Funnel, person: User, check: Check, cluster: Boxes, retire: Archive, mismatch: GitCompare, report: FileText, back: ArrowLeft, close: X };
export type IconName = 'inbox' | 'filter' | 'person' | 'check' | 'cluster' | 'retire' | 'mismatch' | 'report' | 'back' | 'close';
export function Icon({ name }: { name: IconName }) {
  const I = ICONS[name];
  return <I className="mb-icon" size={16} strokeWidth={1.5} aria-hidden="true" />;
}
