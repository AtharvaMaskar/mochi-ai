// The simulated helpdesk (add-sim): a Freshdesk-shaped REST API over sim/data/inbox.json, a replay clock,
// and webhooks. Every read is a view as of sim_now. truth.json is never loaded here.
// `npm run sim` → http://localhost:4010/api/v2/... (Basic auth: SIM_API_KEY:X).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { FD_STATUS } from '@mochi/contracts';
import type { Inbox } from './generate.ts';

type T = Inbox['tickets'][number];
type C = Inbox['conversations'][number];
export type SimEvent = { at: number; event: 'ticket_created' | 'conversation_created' | 'status_changed' | 'merged' | 'sla_breached' | 'day_closed'; ticket_id: number | null; conversation_id?: number };
export type SimOpts = { speed?: number; start?: number; paused?: boolean; webhookUrl?: string; apiKey?: string; rateLimit?: number; retryMs?: number; retries?: number; tickMs?: number };

const DAY = 86_400_000, IST_MIDNIGHT_UTC = 18.5 * 3_600_000;
const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString().replace('.000Z', 'Z'));
const html = (s: string) => s.split('\n\n').map((p) => `<div>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`).join('');
const STATUS_LABEL: Record<number, [string, string]> = { 2: ['Open', 'Being Processed'], 3: ['Pending', 'Awaiting your Reply'], 4: ['Resolved', 'This ticket has been Resolved'], 5: ['Closed', 'This ticket has been Closed'], 6: ['Waiting on Customer', 'Awaiting your Reply'], 7: ['Waiting on Third Party', 'Being Processed'] };

/** The precomputed event log, sorted by time (design decision 4). */
export function eventLog(inbox: Inbox): SimEvent[] {
  const ev: SimEvent[] = [];
  const convs = Map.groupBy(inbox.conversations, (c) => c.ticket_id);
  for (const t of inbox.tickets) {
    ev.push({ at: t.created_at, event: 'ticket_created', ticket_id: t.id });
    for (const h of t.status_history.slice(1)) ev.push({ at: h.at, event: 'status_changed', ticket_id: t.id });
    const cs = convs.get(t.id) ?? [];
    for (const c of cs) ev.push({ at: c.created_at, event: /^Merged into ticket #/.test(c.body_text) ? 'merged' : 'conversation_created', ticket_id: t.id, conversation_id: c.id });
    const fr = cs.find((c) => !c.incoming && !c.private)?.created_at;
    if (t.fr_due_by && (fr === undefined || fr > t.fr_due_by) && !t.status_history.some((h) => h.status === FD_STATUS.closed && h.at <= t.fr_due_by!)) ev.push({ at: t.fr_due_by, event: 'sla_breached', ticket_id: t.id });
  }
  const first = Math.min(...inbox.tickets.map((t) => t.created_at));
  for (let d = Math.floor(first / DAY) * DAY + IST_MIDNIGHT_UTC; d <= inbox.generated_at + DAY; d += DAY) ev.push({ at: d, event: 'day_closed', ticket_id: null });
  const order = ['ticket_created', 'conversation_created', 'merged', 'status_changed', 'sla_breached', 'day_closed'];
  return ev.sort((a, b) => a.at - b.at || order.indexOf(a.event) - order.indexOf(b.event) || (a.ticket_id ?? 0) - (b.ticket_id ?? 0) || (a.conversation_id ?? 0) - (b.conversation_id ?? 0));
}

export function createSim(inbox: Inbox, o: SimOpts = {}) {
  const apiKey = o.apiKey ?? 'sim-key', rateLimit = o.rateLimit ?? 400, retryMs = o.retryMs ?? 30_000, retries = o.retries ?? 5;
  const tickets = new Map(inbox.tickets.map((t) => [t.id, { ...t, status_history: [...t.status_history] }]));
  const convs = Map.groupBy(inbox.conversations.map((c) => ({ ...c })), (c) => c.ticket_id);
  const contacts = new Map(inbox.contacts.map((c) => [c.id, c]));
  const log = eventLog(inbox);
  let nextConv = Math.max(...inbox.conversations.map((c) => c.id)) + 1;

  // ---- Replay clock: sim_now = t0 + (wall_now − wall_start) × speed ----
  const clock = { t0: o.start ?? inbox.replay_start, wall: Date.now(), speed: o.speed ?? 60, paused: o.paused ?? false };
  const simNow = () => Math.floor(clock.paused ? clock.t0 : clock.t0 + (Date.now() - clock.wall) * clock.speed);
  const rebase = () => { clock.t0 = simNow(); clock.wall = Date.now(); };
  let cursor = log.findIndex((e) => e.at > clock.t0); if (cursor < 0) cursor = log.length;
  const seek = (t: number) => { cursor = log.findIndex((e) => e.at > t); if (cursor < 0) cursor = log.length; };
  const clockView = () => ({ sim_now: iso(simNow()), sim_now_ms: simNow(), speed: clock.speed, paused: clock.paused, replay_start: iso(inbox.replay_start), generated_at: iso(inbox.generated_at), next_event: iso(log[cursor]?.at) });

  // ---- Webhooks: at least once, retry every retryMs up to `retries` times ----
  const delivered: SimEvent[] = [];
  const pending = new Set<ReturnType<typeof setTimeout>>();
  async function deliver(e: SimEvent, attempt = 0): Promise<void> {
    if (!o.webhookUrl) return;
    const body = JSON.stringify({ event: e.event, ticket_id: e.ticket_id, ...(e.conversation_id ? { conversation_id: e.conversation_id } : {}), sim_time: iso(e.at) });
    try {
      const res = await fetch(o.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      delivered.push(e);
    } catch (err) {
      if (attempt >= retries) { console.warn(`webhook ${e.event} #${e.ticket_id} gave up after ${attempt + 1} tries: ${(err as Error).message}`); return; }
      const h = setTimeout(() => { pending.delete(h); void deliver(e, attempt + 1); }, retryMs);
      pending.add(h);
    }
  }
  const tick = () => {
    if (clock.paused) return;
    const now = simNow();
    while (cursor < log.length && log[cursor].at <= now) void deliver(log[cursor++]);
  };
  const timer = setInterval(tick, o.tickMs ?? 200);
  const fire = (e: Omit<SimEvent, 'at'>) => void deliver({ ...e, at: simNow() });

  // ---- Views as of sim_now ----
  const visible = (t: T | undefined, now: number): t is T => !!t && t.created_at <= now;
  function view(t: T, now: number, include: Set<string>, list = false) {
    const hist = t.status_history.filter((h) => h.at <= now);
    const cs = (convs.get(t.id) ?? []).filter((c) => c.created_at <= now);
    const fr = cs.find((c) => !c.incoming && !c.private)?.created_at ?? null;
    const last = (s: number) => hist.findLast((h) => h.status === s)?.at ?? null;
    const status = hist.at(-1)!.status, resolved = status === 4 || status === 5 ? last(4) : null;
    const frEsc = !!t.fr_due_by && now > t.fr_due_by && (fr === null || fr > t.fr_due_by) && status !== 5;
    const isEsc = frEsc || (!!t.due_by && now > t.due_by && !(resolved !== null && resolved <= t.due_by) && status !== 5);
    const updated = Math.max(t.created_at, hist.at(-1)!.at, ...cs.map((c) => c.created_at));
    const out: Record<string, unknown> = {
      id: t.id, subject: t.subject, status, priority: t.priority, source: t.source, source_info: null, type: t.type,
      requester_id: t.requester_id, responder_id: t.responder_id, group_id: t.group_id, company_id: null, product_id: null, email_config_id: 60000000001,
      to_emails: t.to_emails, cc_emails: t.cc_emails, reply_cc_emails: t.cc_emails, fwd_emails: t.fwd_emails, tags: t.tags, custom_fields: t.custom_fields,
      fr_escalated: frEsc, is_escalated: isEsc, spam: t.spam, deleted: false, association_type: null,
      fr_due_by: iso(t.fr_due_by), due_by: iso(t.due_by), created_at: iso(t.created_at), updated_at: iso(updated),
      attachments: t.attachments.map((a, k) => ({ id: t.id * 100 + k, ...a, attachment_url: `http://sim.ecorp-securities.example/attachments/${t.id}/${a.name}` })),
      headers: t.headers,
    };
    if (!list || include.has('description')) Object.assign(out, { description: html(t.description_text), description_text: t.description_text });
    if (include.has('requester')) { const c = contacts.get(t.requester_id)!; out.requester = { id: c.id, name: c.name, email: c.email, mobile: null, phone: null, unique_external_id: c.unique_external_id }; }
    if (include.has('stats')) out.stats = { first_responded_at: iso(fr), resolved_at: iso(resolved), closed_at: iso(status === 5 ? last(5) : null), status_updated_at: iso(hist.at(-1)!.at) };
    if (include.has('conversations') && !list) out.conversations = cs.slice(0, 10).map(conv);
    return { out, updated };
  }
  const conv = (c: C) => ({ id: c.id, ticket_id: c.ticket_id, user_id: c.user_id, incoming: c.incoming, private: c.private, source: c.source, support_email: c.support_email,
    from_email: c.from_email, to_emails: c.to_emails, cc_emails: c.cc_emails, bcc_emails: c.bcc_emails, body: html(c.body_text), body_text: c.body_text,
    attachments: c.attachments, headers: c.headers, created_at: iso(c.created_at), updated_at: iso(c.created_at), last_edited_at: null, last_edited_user_id: null });

  // ---- HTTP ----
  let window = { start: Date.now(), used: 0 };
  const send = (res: ServerResponse, code: number, body?: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(code, { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  const readBody = async (req: IncomingMessage) => { let s = ''; for await (const ch of req) s += ch; try { return s ? JSON.parse(s) : {}; } catch { return null; } };
  const paging = (q: URLSearchParams) => {
    const page = Number(q.get('page') ?? 1), per = Number(q.get('per_page') ?? 30);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(per) || per < 1 || per > 100) return null;
    return { page, per };
  };
  const pageOf = <X>(res: ServerResponse, url: URL, xs: X[], p: { page: number; per: number }, rl: Record<string, string>) => {
    const slice = xs.slice((p.page - 1) * p.per, p.page * p.per);
    const headers = { ...rl };
    if (p.page * p.per < xs.length) { const next = new URL(url); next.searchParams.set('page', String(p.page + 1)); headers.Link = `<${next.pathname}${next.search}>; rel="next"`; }
    send(res, 200, slice, headers);
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://sim.local');
    const path = url.pathname.replace(/\/+$/, '');
    if (/truth/i.test(path)) return send(res, 404, { code: 'not_found' }); // the hidden truth has no route, ever
    const [user] = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString().split(':');
    if (user !== apiKey) return send(res, 401, { code: 'invalid_credentials', message: 'You have to be logged in to perform this action.' });

    if (path === '/sim/clock') {
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (!b) return send(res, 400, { code: 'invalid_json' });
        rebase();
        if (b.speed !== undefined) { if (!(Number(b.speed) > 0)) return send(res, 400, { code: 'invalid_value', field: 'speed' }); clock.speed = Number(b.speed); }
        if (b.pause !== undefined) { tick(); clock.paused = !!b.pause; }
        if (b.jump_to !== undefined) { // a jump moves the clock without replaying the skipped events
          const t = typeof b.jump_to === 'number' ? b.jump_to : Date.parse(b.jump_to);
          if (!Number.isFinite(t)) return send(res, 400, { code: 'invalid_value', field: 'jump_to' });
          clock.t0 = t; clock.wall = Date.now(); seek(t);
        }
      }
      return send(res, 200, clockView());
    }
    if (!path.startsWith('/api/v2/')) return send(res, 404, { code: 'not_found' });

    // Rate limit per wall-clock minute; invalid requests count too.
    if (Date.now() - window.start >= 60_000) window = { start: Date.now(), used: 0 };
    window.used++;
    const remaining = rateLimit - window.used;
    const rl = { 'X-RateLimit-Total': String(rateLimit), 'X-RateLimit-Remaining': String(Math.max(0, remaining)), 'X-RateLimit-Used-CurrentRequest': '1' };
    if (remaining < 0) return send(res, 429, { code: 'rate_limit_exceeded' }, { ...rl, 'Retry-After': String(Math.ceil((window.start + 60_000 - Date.now()) / 1000)) });

    const now = simNow();
    const include = new Set((url.searchParams.get('include') ?? '').split(',').filter(Boolean));
    const seg = path.slice('/api/v2/'.length).split('/');
    const notFound = () => send(res, 404, { code: 'not_found' }, rl);

    if (req.method === 'GET' && seg[0] === 'tickets' && seg.length === 1) {
      const p = paging(url.searchParams);
      if (!p) return send(res, 400, { description: 'Validation failed', errors: [{ field: 'per_page', message: 'Has to be a number between 1 and 100', code: 'invalid_value' }] }, rl);
      const since = url.searchParams.get('updated_since'), filter = url.searchParams.get('filter');
      const sinceMs = since ? Date.parse(since) : null;
      if (since && !Number.isFinite(sinceMs)) return send(res, 400, { description: 'Validation failed', errors: [{ field: 'updated_since', code: 'invalid_value' }] }, rl);
      const by = url.searchParams.get('order_by') ?? 'created_at', dir = url.searchParams.get('order_type') === 'asc' ? 1 : -1;
      const rows = [...tickets.values()].filter((t) => visible(t, now) && (filter === 'spam' ? t.spam : !t.spam))
        .map((t) => ({ t, ...view(t, now, include, true) }))
        .filter((x) => (sinceMs !== null ? x.updated >= sinceMs! : x.t.created_at >= now - 30 * DAY)); // Freshdesk's default 30-day window
      const key = (x: (typeof rows)[number]) => (by === 'updated_at' ? x.updated : by === 'due_by' ? x.t.due_by ?? 0 : by === 'status' ? (x.out.status as number) : x.t.created_at);
      rows.sort((a, b) => dir * (key(a) - key(b)) || dir * (a.t.id - b.t.id));
      return pageOf(res, url, rows.map((x) => x.out), p, rl);
    }
    if (seg[0] === 'tickets' && seg[1] === 'merge' && req.method === 'PUT') {
      const b = await readBody(req);
      const primary = tickets.get(Number(b?.primary_id));
      const ids: number[] = Array.isArray(b?.ticket_ids) ? b.ticket_ids.map(Number) : [];
      if (!visible(primary, now) || !ids.length || ids.some((i) => !visible(tickets.get(i), now))) return send(res, 400, { description: 'Validation failed', errors: [{ field: 'ticket_ids', code: 'invalid_value' }] }, rl);
      for (const id of ids.filter((i) => i !== primary.id)) {
        tickets.get(id)!.status_history.push({ status: FD_STATUS.closed, at: now });
        addConv(id, `Merged into ticket #${primary.id}.`, { private: true, incoming: false, source: 2 });
        addConv(primary.id, `Merged ticket #${id} into this ticket.`, { private: true, incoming: false, source: 2 }, 'conversation_created');
        fire({ event: 'merged', ticket_id: id });
      }
      return send(res, 204, undefined, rl);
    }
    if (seg[0] === 'tickets' && seg.length >= 2) {
      const t = tickets.get(Number(seg[1]));
      if (!visible(t, now)) return notFound();
      if (seg.length === 2 && req.method === 'GET') return send(res, 200, view(t, now, include).out, rl);
      if (seg.length === 2 && req.method === 'PUT') {
        const b = await readBody(req);
        if (!b || !Object.values(FD_STATUS).includes(b.status)) return send(res, 400, { description: 'Validation failed', errors: [{ field: 'status', code: 'invalid_value' }] }, rl);
        t.status_history.push({ status: b.status, at: now });
        fire({ event: 'status_changed', ticket_id: t.id });
        return send(res, 200, view(t, now, include).out, rl);
      }
      if (seg[2] === 'conversations' && req.method === 'GET') {
        const p = paging(url.searchParams);
        if (!p) return send(res, 400, { code: 'invalid_value', field: 'per_page' }, rl);
        return pageOf(res, url, (convs.get(t.id) ?? []).filter((c) => c.created_at <= now).map(conv), p, rl);
      }
      if ((seg[2] === 'reply' || seg[2] === 'notes') && req.method === 'POST') {
        const b = await readBody(req);
        if (!b || typeof b.body !== 'string' || !b.body.trim()) return send(res, 400, { description: 'Validation failed', errors: [{ field: 'body', code: 'missing_field' }] }, rl);
        const c = addConv(t.id, b.body.replace(/<[^>]+>/g, ''), seg[2] === 'reply' ? { private: false, incoming: false, source: 0 } : { private: b.private !== false, incoming: false, source: 2 }, 'conversation_created');
        return send(res, 201, conv(c), rl);
      }
      return notFound();
    }
    if (req.method !== 'GET') return notFound();
    if (path === '/api/v2/ticket_fields') return send(res, 200, [
      { id: 1, name: 'status', label: 'Status', type: 'default_status', choices: STATUS_LABEL },
      { id: 2, name: 'priority', label: 'Priority', type: 'default_priority', choices: { Low: 1, Medium: 2, High: 3, Urgent: 4 } },
      { id: 3, name: 'source', label: 'Source', type: 'default_source', choices: { Email: 1, Portal: 2, Phone: 3, Chat: 7, 'Feedback Widget': 9, 'Outbound Email': 10 } },
      { id: 4, name: 'cf_client_code', label: 'Client code', type: 'custom_text', choices: null },
    ], rl);
    if (path === '/api/v2/agents') return send(res, 200, inbox.agents.map((a) => ({ id: a.id, occasional: false, available: true, ticket_scope: 1, type: 'support_agent', group_ids: a.group_ids, contact: { name: a.name, email: a.email, language: 'en', time_zone: 'Chennai' } })), rl);
    if (path === '/api/v2/groups') return send(res, 200, inbox.groups.map((g) => ({ id: g.id, name: g.name, description: `${g.name} team`, agent_ids: g.agent_ids, auto_ticket_assign: 1 })), rl);
    if (seg[0] === 'contacts') {
      const shown = (c: Inbox['contacts'][number]) => ({ id: c.id, name: c.name, email: c.email, language: c.language, unique_external_id: c.unique_external_id, active: true, created_at: iso(c.created_at) });
      if (seg.length === 2) { const c = contacts.get(Number(seg[1])); return c && c.created_at <= now ? send(res, 200, shown(c), rl) : notFound(); }
      const p = paging(url.searchParams);
      if (!p) return send(res, 400, { code: 'invalid_value', field: 'per_page' }, rl);
      return pageOf(res, url, inbox.contacts.filter((c) => c.created_at <= now).map(shown), p, rl);
    }
    return notFound();
  }

  function addConv(ticketId: number, body: string, kind: { private: boolean; incoming: boolean; source: number }, event?: SimEvent['event']): C {
    const t = tickets.get(ticketId)!, requester = contacts.get(t.requester_id)!;
    const c: C = { id: nextConv++, ticket_id: ticketId, user_id: inbox.agents[0].id, ...kind, support_email: kind.private ? null : 'support@ecorp-securities.example',
      from_email: 'support@ecorp-securities.example', to_emails: kind.private ? [] : [requester.email], cc_emails: [], bcc_emails: [], body_text: body, attachments: [], created_at: simNow(), headers: null };
    convs.set(ticketId, [...(convs.get(ticketId) ?? []), c]);
    if (event) fire({ event, ticket_id: ticketId, conversation_id: c.id });
    return c;
  }

  const server = createServer((req, res) => { handle(req, res).catch((e) => { console.error(e); send(res, 500, { code: 'internal_error' }); }); });
  return {
    server, clock: clockView, delivered, log,
    close: () => { clearInterval(timer); for (const h of pending) clearTimeout(h); server.closeAllConnections(); return new Promise<void>((r) => server.close(() => r())); },
  };
}

export async function readInbox(): Promise<Inbox> {
  const file = new URL('./data/inbox.json', import.meta.url);
  if (!existsSync(file)) { // generate from the committed paraphrase cache: deterministic, zero LLM calls
    const { writeSim } = await import('./generate.ts');
    await writeSim(42, { offline: true });
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

if (import.meta.main) {
  try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* real environment */ }
  const e = process.env;
  const start = e.SIM_START ? (/^\d+$/.test(e.SIM_START) ? Number(e.SIM_START) : Date.parse(e.SIM_START)) : undefined;
  const sim = createSim(await readInbox(), {
    speed: e.SIM_SPEED ? Number(e.SIM_SPEED) : undefined, start, paused: e.SIM_PAUSED === 'true',
    webhookUrl: e.SIM_WEBHOOK_URL ?? 'http://localhost:4011/webhook', apiKey: e.SIM_API_KEY, rateLimit: e.SIM_RATE_LIMIT ? Number(e.SIM_RATE_LIMIT) : undefined,
  });
  const port = Number(e.SIM_PORT ?? 4010);
  sim.server.listen(port, () => {
    const c = sim.clock();
    console.log(`sim helpdesk on http://localhost:${port}/api/v2 (Basic ${e.SIM_API_KEY ?? 'sim-key'}:X); clock ${c.sim_now} ×${c.speed}${c.paused ? ' paused' : ''}; webhooks → ${e.SIM_WEBHOOK_URL ?? 'http://localhost:4011/webhook'}`);
  });
}
