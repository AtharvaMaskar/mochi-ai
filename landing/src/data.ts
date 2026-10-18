// Recorded fixtures (fixtures/demo.json, from the seeded demo; validated by fixtures/demo.test.ts).
import raw from '../fixtures/demo.json';
import type { ToolCard, Story, StoredQuery } from '@mochi/contracts';

export type Brief = { ticket: string; customer: string; subject: string; body: string; issue: string; card: ToolCard };
export type Ask = { id: string; ask: string; keywords: string[]; eval_id: string | null; answer: string; card: ToolCard };
type Demo = {
  recorded_from: string; broker: string; as_of: { before: number; after: number }; counts: { open: number; pending: number };
  hero: { queue: { id: string; name: string; subject: string; created_at: number; status: string }[]; ticket: string; briefs: Record<string, Brief> };
  asks: Ask[];
  night: { retired: { event: string; at: number; label: string; now: string; edge: string }[]; report: Story; cluster: StoredQuery; ingested: { id: string; subject: string; created_at: number }[] };
  awake: { hours: StoredQuery; offHours: StoredQuery };
  asof: { release: string; before_ms: number; after_ms: number; before: number; after: number; query: StoredQuery };
  tiers: { company: string; reader: string; dream: string; demoUser: string; refusal: { case: string; command: string; error: string } };
};
export const demo = raw as unknown as Demo;

const ist = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtIST = (ms: number) => `${ist.format(ms)} IST`;
export const ago = (ms: number) => {
  const m = Math.round((demo.as_of.after - ms) / 60000);
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

// Deploy wiring (SPEC §4b): `/` is this page, `/app/` the platform. In dev the landing runs on its own vite port, so
// it points at the ui's dev server; VITE_APP_URL overrides either.
const APP = import.meta.env.VITE_APP_URL || (import.meta.env.DEV ? 'http://localhost:5173/app/' : '/app/');
export const LINKS = {
  desk: APP,
  chat: (q: string) => `${APP}#/chat?q=${encodeURIComponent(q)}`,
  repo: 'https://github.com/AtharvaMaskar/mochi-ai',
  blog: '/blog',
  video: '#demo',
};
