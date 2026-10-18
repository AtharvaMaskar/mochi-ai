// Client for the simulated helpdesk (sim/, Freshdesk-shaped). The desk's queue, threads, requesters, merges and
// statuses come from here; the graph supplies what Mochi knows. SIM_URL / SIM_API_KEY, Basic auth `apikey:X`.
export type FdContact = { id: number; name: string; email: string; unique_external_id?: string | null };
export type FdConversation = {
  id: number; ticket_id: number; user_id: number | null; incoming: boolean; private: boolean; source: number;
  from_email: string; body_text: string; created_at: string | number;
};
export type FdTicket = {
  id: number; subject: string; description_text?: string; status: number; priority: number; source: number;
  requester_id: number; responder_id: number | null; spam?: boolean; cc_emails?: string[];
  custom_fields?: { cf_client_code?: string | null }; merged_into?: number | null; association_type?: number | null;
  created_at: string | number; updated_at: string | number; requester?: FdContact; conversations?: FdConversation[];
};
export type FdAgent = { id: number; name?: string; contact?: { name: string } };

export const simUrl = () => (process.env.SIM_URL ?? 'http://localhost:4010').replace(/\/$/, '');
const auth = () => `Basic ${Buffer.from(`${process.env.SIM_API_KEY ?? 'sim-key'}:X`).toString('base64')}`;

export class SimError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** One sim call. Unreachable or 5xx becomes SimError 502 with the reason; 404 stays 404. */
export async function sim<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ body: T; headers: Headers }> {
  let r: Response;
  try {
    r = await fetch(`${simUrl()}${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: auth(), 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new SimError(502, `The helpdesk is not reachable at ${simUrl()} (${(e as Error).message}).`);
  }
  if (r.status === 404) throw new SimError(404, 'The helpdesk has no such ticket.');
  if (r.status === 429) throw new SimError(503, `The helpdesk is rate limiting us; retry in ${r.headers.get('retry-after') ?? '?'} s.`);
  if (!r.ok) throw new SimError(502, `The helpdesk answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { body: (await r.json()) as T, headers: r.headers };
}

/** Freshdesk id -> graph Ticket id (the sim names graph tickets `T-<id>`; the seed dataset pads to 4 digits). */
export const graphId = (fdId: number) => `T-${String(fdId).padStart(4, '0')}`;
export const fdId = (graphTicketId: string) => {
  const m = graphTicketId.match(/^T-(\d+)$/);
  return m ? Number(m[1]) : null;
};
export const ms = (t: string | number) => (typeof t === 'number' ? t : Date.parse(t));

export const FD_STATUS_NAME: Record<number, string> = {
  2: 'open', 3: 'pending', 4: 'resolved', 5: 'closed', 6: 'waiting_on_customer', 7: 'waiting_on_third_party',
};
/** Ready = waiting for a person (Open); done = Resolved or Closed. */
export const isReady = (t: FdTicket) => t.status === 2;
export const isDone = (t: FdTicket) => t.status === 4 || t.status === 5;

/** The newest tickets (up to `max`), following the Link header. */
export async function listTickets(max = 300): Promise<FdTicket[]> {
  const out: FdTicket[] = [];
  for (let page = 1; out.length < max; page++) {
    const { body, headers } = await sim<FdTicket[]>(`/api/v2/tickets?include=requester&per_page=100&page=${page}&order_by=created_at&order_type=desc`);
    out.push(...body);
    if (!headers.get('link')?.includes('rel="next"') || !body.length) break;
  }
  return out.filter((t) => !t.spam).slice(0, max);
}

export async function getTicket(id: number) {
  return (await sim<FdTicket>(`/api/v2/tickets/${id}?include=conversations,requester,stats`)).body;
}

let agentNames: Promise<Map<number, string>> | null = null;
export function agents(): Promise<Map<number, string>> {
  agentNames ??= sim<FdAgent[]>('/api/v2/agents').then(({ body }) => new Map(body.map((a) => [a.id, a.name ?? a.contact?.name ?? `Agent ${a.id}`])))
    .catch((e) => { agentNames = null; throw e; });
  return agentNames;
}

/** The sim's replay clock; wall time when the sim has no clock route. */
export async function simNow(): Promise<number> {
  try { return ms((await sim<{ sim_now: string | number }>('/sim/clock')).body.sim_now); } catch { return Date.now(); }
}
