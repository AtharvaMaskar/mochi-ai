// Who is calling the public endpoints. Chat threads are scoped to a random per-browser id (cookie), so a threadId alone
// can't read or replay another visitor's chat; chat runs are capped per IP; the dream trigger needs the admin token.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SIGNED_IN } from '../stories.ts';

/** The current request's visitor id, for agui.ts to scope AG-UI threads. */
export const visitor = new AsyncLocalStorage<string>();
export const scopedThread = (threadId: string) => `${visitor.getStore() ?? 'local'}:${threadId}`;

const COOKIE = 'mochi_vid';
/** The visitor id from the cookie, minting (and setting) one when absent. */
/** The visitor id from the cookie, or null (read-only: story reads and publish never mint one). */
export const cookieVid = (req: IncomingMessage) => (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9-]{36})`))?.[1] ?? null;
export function visitorId(req: IncomingMessage, res: ServerResponse): string {
  const known = cookieVid(req);
  if (known) return known;
  const id = randomUUID();
  res.setHeader('set-cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  return id;
}

// ponytail: in-memory fixed window per IP; one process serves the app. Move to a shared store if it ever scales out.
const WINDOW_MS = 10 * 60_000;
const hits = new Map<string, { start: number; n: number }>();
export const ipOf = (req: IncomingMessage) => String(req.headers['x-real-ip'] ?? '').trim() || String(req.headers['x-forwarded-for'] ?? '').split(',').pop()!.trim() || req.socket.remoteAddress || '?'; // leftmost XFF is client-controlled
/** Count one chat run; returns the seconds to wait when the IP is over its limit. */
export function overLimit(ip: string, limit = Number(process.env.MOCHI_CHAT_LIMIT ?? 20), now = Date.now()): number {
  let h = hits.get(ip);
  if (!h || now - h.start >= WINDOW_MS) hits.set(ip, (h = { start: now, n: 0 }));
  if (h.n >= limit) return Math.ceil((h.start + WINDOW_MS - now) / 1000);
  h.n++;
  return 0;
}

/** Constant-time string compare: both sides hashed first, so the buffers are always equal length. */
const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** The dream trigger for scripts: x-mochi-admin equal to MOCHI_ADMIN_TOKEN (unset token = disabled). */
export const isAdmin = (req: IncomingMessage) => {
  const t = process.env.MOCHI_ADMIN_TOKEN, h = req.headers['x-mochi-admin'];
  return !!t && typeof h === 'string' && same(h, t);
};

// ---------- Sign-in (demo credentials; change them in deploy) ----------
const SESSION = 'mochi_session', TTL_S = 12 * 3600;
const SECRET = process.env.MOCHI_SESSION_SECRET || randomBytes(32).toString('hex'); // random at boot: a restart signs everyone out
const sig = (exp: string) => createHmac('sha256', SECRET).update(exp).digest('base64url');

/** Both compares always run, so timing says nothing about which field was wrong. */
export function checkLogin(user: unknown, password: unknown): boolean {
  if (typeof user !== 'string' || typeof password !== 'string') return false;
  const u = same(user, process.env.MOCHI_LOGIN_USER || 'admin'), p = same(password, process.env.MOCHI_LOGIN_PASSWORD || 'admin@1234');
  return u && p;
}

const https = (req: IncomingMessage) => 'encrypted' in req.socket || String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
const cookie = (req: IncomingMessage, value: string, maxAge: number) =>
  `${SESSION}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https(req) ? '; Secure' : ''}`;
/** A signed `<expiry>.<hmac>` session, 12 h. */
export const sessionCookie = (req: IncomingMessage, now = Date.now()) => { const exp = String(Math.floor(now / 1000) + TTL_S); return cookie(req, `${exp}.${sig(exp)}`, TTL_S); };
export const clearSession = (req: IncomingMessage) => cookie(req, '', 0);
export function hasSession(req: IncomingMessage, now = Date.now()): boolean {
  const m = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${SESSION}=(\\d+)\\.([A-Za-z0-9_-]+)`));
  return !!m && Number(m[1]) * 1000 > now && same(m[2], sig(m[1]));
}

/** /api routes open without a session: sign-in, health, and reads of a story or dashboard (the visibility rules in
 *  stories.ts decide what a stranger sees: published versions only). The live socket is an upgrade, outside `handle`. */
export const publicApi = (method: string | undefined, path: string) =>
  (method === 'POST' && (path === '/api/login' || path === '/api/logout')) ||
  (method === 'GET' && (path === '/api/health' || /^\/api\/stories\/[^/]+$/.test(path)));

/** Who reads stories: a signed-in session sees every story, drafts included; otherwise the visitor cookie (or nobody). */
export const viewer = (req: IncomingMessage) => (hasSession(req) ? SIGNED_IN : cookieVid(req));
