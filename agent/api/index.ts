// The desk route table, called from agent/server.ts before its 404. Returns false when no route matches.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pi } from '../harness.ts';
import type { Db } from '../queries/index.ts';
import { SimError } from './sim.ts';
import { answerTicket, listDesk, ticketBrief, ticketDetail } from './tickets.ts';
import { overview, storyList } from './overview.ts';

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

export async function routeApi(req: IncomingMessage, res: ServerResponse, url: URL, pi: Pi): Promise<boolean> {
  const p = url.pathname, get = req.method === 'GET', post = req.method === 'POST';
  const db = async () => (await pi.reader()) as unknown as Db;
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
    return reply(async () => listDesk(await db(), pi.graph, view, order));
  }
  const m = p.match(/^\/api\/tickets\/([^/]+)(?:\/(brief|answer))?$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (get && !m[2]) return reply(async () => ticketDetail(await db(), pi.graph, id));
    if (post && m[2] === 'brief') return reply(async () => ticketBrief(await db(), pi.graph, id));
    if (post && m[2] === 'answer') return reply(async () => answerTicket(id, await readJson(req) as { requestId?: string; text?: string }));
  }
  if (get && p === '/api/overview') return reply(async () => overview(pi, await db()));
  if (get && p === '/api/stories') return reply(async () => storyList(pi));
  return false;
}
