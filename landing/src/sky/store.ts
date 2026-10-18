// One sky for the whole page, driven by one value: the hour of day in IST (0–24), written to --sky-t.
// Sections say what they want; the section at the viewport's centre wins.
// cycle: the hero's compressed day (75 s per 24 h), advanced inside the sky's own rAF loop.
// clouds: 0..1 density. tint: a mood's agent colour var (§2b). part: clouds move aside (the brief loaded).
// meteors: streaks per second. labels: retired facts the streaks carry. constellation: the path drawn in stars.
export type SkyWant = { t: number; cycle: boolean; clouds: number; tint: string | null; part: number; meteors: number; labels: string[]; constellation: number };

export const DAY: SkyWant = { t: 12, cycle: false, clouds: 0.35, tint: null, part: 0, meteors: 0, labels: [], constellation: 0 };
export const CYCLE_S = 75;

const wants = new Map<string, Partial<SkyWant>>();
let active = 'hero';
let target: SkyWant = { ...DAY };
const subs = new Set<() => void>();

// The page is one day, read top to bottom: morning, midday, the night (dragged through on the slider), the morning
// after, afternoon, and dusk at the call to action. A section without its own hour takes its place on that clock, so
// scrolling never snaps back to a default noon. Interactive sections (hero clock, night slider, hour bars) override it.
const SECTION_HOUR: Record<string, number> = {
  hero: 9, mochi: 10, ask: 11.5, demo: 13, night: 18.6, awake: 8, receipts: 11, tiers: 14, bench: 16, built: 17, faq: 17.8, cta: 18.4, footer: 19,
};
const recompute = () => { target = { ...DAY, t: SECTION_HOUR[active] ?? DAY.t, ...wants.get(active) }; subs.forEach((f) => f()); };

export function want(section: string, w: Partial<SkyWant>) {
  wants.set(section, { ...wants.get(section), ...w });
  if (section === active) recompute();
}
export function setActive(section: string) {
  if (section === active) return;
  active = section;
  recompute();
}
export const activeSection = () => active;
export const sky = () => target;
export const onSky = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

// The hour the sky is showing, published a few times a second for the hero clock.
let hour = DAY.t;
const hourSubs = new Set<(h: number) => void>();
export const publishHour = (h: number) => { hour = h; hourSubs.forEach((f) => f(h)); };
export const currentHour = () => hour;
export const onHour = (f: (h: number) => void) => { hourSubs.add(f); return () => { hourSubs.delete(f); }; };
