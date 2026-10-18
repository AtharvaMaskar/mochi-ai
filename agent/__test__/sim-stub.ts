// Tiny Freshdesk-shaped stand-in for sim/ (add-sim), built to its spec: the routes the desk uses, Basic auth, Link
// pagination, integer status codes. It serves a contract Dataset (default data/dataset.json, the graph's own seed),
// keeping posted replies and status changes in memory. Delete when add-sim's real sim lands.
//   node --env-file=../.env __test__/sim-stub.ts      (SIM_PORT, default 4010)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { FD_PRIORITY, FD_SOURCE, FD_STATUS, type Dataset } from '@mochi/contracts';

type Conv = { id: number; ticket_id: number; user_id: number | null; incoming: boolean; private: boolean; source: number; from_email: string; body_text: string; created_at: string };

export async function startSimStub(opts: { port?: number; dataset?: Dataset; apiKey?: string } = {}) {
  const d = opts.dataset ?? (JSON.parse(readFileSync(new URL('../../data/dataset.json', import.meta.url), 'utf8')) as Dataset);
  const key = opts.apiKey ?? process.env.SIM_API_KEY ?? 'mochi-sim';
  const iso = (t: number) => new Date(t).toISOString();
  const num = (id: string) => Number(id.replace(/\D/g, ''));
  const contacts = d.customers.map((c, i) => ({ id: 5001 + i, name: c.name, email: c.email ?? `${c.id.toLowerCase()}@mail.example`, unique_external_id: c.id }));
  const contactOf = new Map(d.customers.map((c, i) => [c.id, contacts[i]]));
  const agents = d.agents.map((a, i) => ({ id: 7001 + i, name: a.name, graph: a.id }));
  const agentOf = new Map(agents.map((a) => [a.graph, a]));
  const tickets = new Map(d.tickets.map((t) => [num(t.id), {
    id: num(t.id), subject: t.subject, description_text: t.body, status: FD_STATUS[t.status], priority: FD_PRIORITY[t.priority],
    source: FD_SOURCE[t.channel], requester_id: contactOf.get(t.customer_id)!.id, responder_id: t.solved_by ? agentOf.get(t.solved_by)?.id ?? null : null,
    spam: false, cc_emails: t.cc_emails ?? [], custom_fields: { cf_client_code: t.customer_id },
    merged_into: t.merged_into ? num(t.merged_into) : null,
    created_at: iso(t.created_at), updated_at: iso(t.resolved_at ?? t.created_at),
  }]));
  const convs = new Map<number, Conv[]>();
  let nextConv = 9_000_001;
  for (const c of d.conversations ?? []) {
    const list = convs.get(num(c.ticket_id)) ?? [];
    list.push({ id: nextConv++, ticket_id: num(c.ticket_id), user_id: null, incoming: c.incoming, private: c.private, source: c.source, from_email: c.from_email, body_text: c.body, created_at: iso(c.created_at) });
    convs.set(num(c.ticket_id), list);
  }

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const body = async (req: IncomingMessage) => { let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; };
  const withRequester = (t: ReturnType<typeof tickets.get> & {}) => ({ ...t, requester: contacts.find((c) => c.id === t.requester_id) });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://sim');
    if (url.pathname.includes('truth')) return send(res, 404, { code: 'not_found' });
    if (url.pathname === '/sim/clock') return send(res, 200, { sim_now: iso(Date.now()), speed: 1, paused: false });
    if (req.headers.authorization !== `Basic ${Buffer.from(`${key}:X`).toString('base64')}`) return send(res, 401, { code: 'invalid_credentials' });
    const p = url.pathname;
    if (req.method === 'GET' && p === '/api/v2/tickets') {
      const per = Math.min(100, Number(url.searchParams.get('per_page') ?? 30)), page = Number(url.searchParams.get('page') ?? 1);
      const asc = url.searchParams.get('order_type') === 'asc';
      const all = [...tickets.values()].sort((a, b) => (Date.parse(a.created_at) - Date.parse(b.created_at)) * (asc ? 1 : -1) || a.id - b.id);
      const rows = all.slice((page - 1) * per, page * per).map((t) => (url.searchParams.get('include')?.includes('requester') ? withRequester(t) : t));
      const next: Record<string, string> = page * per < all.length ? { link: `<${url.origin}${p}?per_page=${per}&page=${page + 1}>; rel="next"` } : {};
      return send(res, 200, rows, next);
    }
    if (req.method === 'GET' && p === '/api/v2/agents') return send(res, 200, agents.map(({ id, name }) => ({ id, name, contact: { name } })));
    const m = p.match(/^\/api\/v2\/tickets\/(\d+)(\/reply)?$/);
    const t = m && tickets.get(Number(m[1]));
    if (!m || !t) return send(res, 404, { code: 'not_found' });
    if (req.method === 'GET' && !m[2]) {
      const inc = url.searchParams.get('include') ?? '';
      return send(res, 200, { ...(inc.includes('requester') ? withRequester(t) : t), ...(inc.includes('conversations') ? { conversations: convs.get(t.id) ?? [] } : {}) });
    }
    if (req.method === 'POST' && m[2]) {
      const b = await body(req);
      const c: Conv = { id: nextConv++, ticket_id: t.id, user_id: agents[0]?.id ?? null, incoming: false, private: false, source: 0, from_email: 'support@ecorp-securities.example', body_text: String(b.body ?? ''), created_at: iso(Date.now()) };
      convs.set(t.id, [...(convs.get(t.id) ?? []), c]);
      t.updated_at = c.created_at;
      return send(res, 201, c);
    }
    if (req.method === 'PUT' && !m[2]) {
      const b = await body(req);
      if (b.status) { t.status = Number(b.status) as typeof t.status; t.updated_at = iso(Date.now()); }
      return send(res, 200, t);
    }
    send(res, 405, { code: 'method_not_allowed' });
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, r));
  const port = (server.address() as { port: number }).port;
  return { port, url: `http://localhost:${port}`, close: () => new Promise((r) => server.close(r)) };
}

if (import.meta.main) {
  const s = await startSimStub({ port: Number(process.env.SIM_PORT ?? 4010) });
  console.error(`[sim-stub] ${s.url}/api/v2/tickets (Freshdesk-shaped stand-in for sim/)`);
}
