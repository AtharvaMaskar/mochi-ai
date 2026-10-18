// The desk route table, called from agent/server.ts before its 404. Returns false when no route matches.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pi } from '../harness.ts';
import type { Db } from '../queries/index.ts';
import { SimError } from './sim.ts';
import { answerTicket, claimTicket, draftTicket, listDesk, prewarmDrafts, ticketBrief, ticketDetail, type Complete } from './tickets.ts';
import { overview, storyList } from './overview.ts';
import { cookieVid, ipOf, overLimit } from './visitor.ts';
import { entityCard } from './entity.ts';

/** One plain completion on MOCHI_MODEL (no tools, no thinking). */
const completeWith = (pi: Pi): Complete => async (systemPrompt, user) => {
  const model = pi.models.getModel(pi.model.provider as never, pi.model.modelId);
  if (!model) throw new Error(`unknown model ${pi.model.provider}/${pi.model.modelId}`);
  const msg = await pi.models.complete(model, { systemPrompt, messages: [{ role: 'user', content: user, timestamp: Date.now() }] },
    { maxTokens: 400, thinkingEnabled: false } as never);
  if (msg.stopReason === 'error') throw new SimError(502, 'The model didn’t answer. Try again.');
  return msg.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('').trim();
};

// Same-origin only: no CORS headers (the deploy serves the ui from this process; dev proxies /api through Vite).
export const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 100_000) throw new SimError(413, 'body too large'); }
  try { return s ? JSON.parse(s) : {}; } catch { throw new SimError(400, 'body must be JSON'); }
}

/** Start background drafting for the desk (see prewarmDrafts). Returns its stop function. */
export const startDraftPrewarm = (pi: Pi) => prewarmDrafts(async () => (await pi.reader()) as unknown as Db, pi.graph, completeWith(pi));

export async function routeApi(req: IncomingMessage, res: ServerResponse, url: URL, pi: Pi): Promise<boolean> {
  const p = url.pathname, get = req.method === 'GET', post = req.method === 'POST';
  const db = async () => (await pi.reader()) as unknown as Db;
  const mem = { db: pi.memDb, user: pi.defaultCaller.user, userGraph: pi.userGraph };
  const reply = async (f: () => Promise<unknown>) => {
    try { json(res, 200, await f()); } catch (e) {
      if (e instanceof SimError) json(res, e.status, { error: e.message });
      else throw e;
    }
    return true;
  };
  if (get && p === '/api/tickets') {
    const view = url.searchParams.get('view') ?? 'ready', order = url.searchParams.get('order') ?? 'newest';
    if (!['ready', 'done', 'all'].includes(view) || !['newest', 'oldest'].includes(order)) return reply(async () => { throw new SimError(400, 'view is ready|done|all, order is newest|oldest'); });
    return reply(async () => listDesk(await db(), pi.graph, view, order, mem.user));
  }
  const m = p.match(/^\/api\/tickets\/([^/]+)(?:\/(brief|answer|draft|claim))?$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (get && !m[2]) return reply(async () => ticketDetail(await db(), pi.graph, id, mem.user));
    if (post && m[2] === 'draft') {
      // Every draft spends the model key: it counts against the same per-IP cap as a chat run.
      const wait = overLimit(ipOf(req));
      if (wait) { json(res, 429, { error: `You’ve asked a lot in a short time. Try again in ${Math.ceil(wait / 60)} min.` }, { 'retry-after': String(wait) }); return true; }
      return reply(async () => draftTicket(await db(), pi.graph, id, await readJson(req), completeWith(pi)));
    }
    if (post && m[2] === 'claim') return reply(async () => claimTicket(await db(), pi.graph, id, mem.user));
    if (post && m[2] === 'brief') return reply(async () => ticketBrief(await db(), pi.graph, id, mem));
    if (post && m[2] === 'answer') return reply(async () => answerTicket(id, await readJson(req) as { requestId?: string; text?: string }, mem));
  }
  const ent = get && p.match(/^\/api\/entity\/([^/]+)$/);
  if (ent) {
    // Hover cards fire on pointer intent: their own per-IP budget, so they never eat the chat-run budget.
    const wait = overLimit(`entity:${ipOf(req)}`, Number(process.env.MOCHI_ENTITY_LIMIT ?? 600));
    if (wait) { json(res, 429, { error: `Too many previews in a short time. Try again in ${Math.ceil(wait / 60)} min.` }, { 'retry-after': String(wait) }); return true; }
    return reply(async () => entityCard(await db(), pi.graph, decodeURIComponent(ent[1])));
  }
  if (get && p === '/api/overview') return reply(async () => overview(pi, await db()));
  if (get && p === '/api/stories') return reply(async () => storyList(pi, cookieVid(req)));
  return false;
}
