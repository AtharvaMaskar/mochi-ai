// Who is calling the public endpoints. Chat threads are scoped to a random per-browser id (cookie), so a threadId alone
// can't read or replay another visitor's chat; chat runs are capped per IP; the dream trigger needs the admin token.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** The current request's visitor id, for agui.ts to scope AG-UI threads. */
export const visitor = new AsyncLocalStorage<string>();
export const scopedThread = (threadId: string) => `${visitor.getStore() ?? 'local'}:${threadId}`;

const COOKIE = 'mochi_vid';
/** The visitor id from the cookie, minting (and setting) one when absent. */
export function visitorId(req: IncomingMessage, res: ServerResponse): string {
  const m = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9-]{36})`));
  if (m) return m[1];
  const id = randomUUID();
  res.setHeader('set-cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  return id;
}

// ponytail: in-memory fixed window per IP; one process serves the app. Move to a shared store if it ever scales out.
const WINDOW_MS = 10 * 60_000;
const hits = new Map<string, { start: number; n: number }>();
export const ipOf = (req: IncomingMessage) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?';
/** Count one chat run; returns the seconds to wait when the IP is over its limit. */
export function overLimit(ip: string, limit = Number(process.env.MOCHI_CHAT_LIMIT ?? 20), now = Date.now()): number {
  let h = hits.get(ip);
  if (!h || now - h.start >= WINDOW_MS) hits.set(ip, (h = { start: now, n: 0 }));
  if (h.n >= limit) return Math.ceil((h.start + WINDOW_MS - now) / 1000);
  h.n++;
  return 0;
}

/** The dream trigger: allowed only with x-mochi-admin equal to MOCHI_ADMIN_TOKEN (unset token = trigger disabled). */
export const isAdmin = (req: IncomingMessage) => {
  const t = process.env.MOCHI_ADMIN_TOKEN;
  return !!t && req.headers['x-mochi-admin'] === t;
};
