// Desk API: the queue and threads come from the sim; Mochi's guess, its confidence, the brief and the customer's
// history come from the graph through mochi_reader, each with the stored query that produced it.
import { validateCard, type StoredQuery } from '@mochi/contracts';
import { CYPHER, briefing, customerProfile, runStored, type Db } from '../queries/index.ts';
import {
  FD_STATUS_NAME, agents, fdId, getTicket, graphId, isDone, isReady, listTickets, ms, sim, simNow, SimError, type FdTicket,
} from './sim.ts';

export type Guess = { issue: string | null; p: number | null; basis: 'graph' | 'vector' | 'none'; query_id: string | null; resolution?: string | null };
type Guesses = { byId: Map<string, Guess & { ingested: boolean }>; queries: Record<string, StoredQuery> };

const VECTOR_LIMIT = 20; // one vector query per un-linked ticket; the rest show "Can't tell" until the dream links them

/** Guess + confidence for graph tickets. ABOUT edge: resolution evidence (deskGuess). No edge: top cosine match. */
export async function guesses(db: Db, graph: string, ids: string[], as_of: number): Promise<Guesses> {
  const queries: Record<string, StoredQuery> = {};
  const byId: Guesses['byId'] = new Map();
  if (!ids.length) return { byId, queries };
  const q_1 = await runStored(db, graph, CYPHER.deskGuess, { ids }, as_of);
  queries.q_1 = q_1;
  for (const r of q_1.rows) {
    const id = String(r.ticket);
    if (byId.get(id)?.issue) continue; // several issues in one email: the first linked one leads
    byId.set(id, r.issue_id
      ? { issue: String(r.issue), p: r.confidence as number | null, basis: 'graph', query_id: 'q_1', resolution: r.resolution as string | null, ingested: !!r.ingested }
      : { issue: null, p: null, basis: 'none', query_id: null, ingested: !!r.ingested });
  }
  let n = 1;
  for (const [id, g] of byId) {
    if (g.basis !== 'none' || n > VECTOR_LIMIT) continue;
    const q = await runStored(db, graph, CYPHER.briefing.similarVector, { ticketId: id, k: 25 }, as_of).catch(() => null);
    const top = q?.rows[0];
    if (!q || !top) continue;
    const qid = `q_${++n}`;
    queries[qid] = q;
    // FalkorDB returns cosine distance; similarity = 1 - distance. The UI maps it through ConfidenceBands.
    byId.set(id, { ...g, issue: top.issue ? String(top.issue) : null, p: Math.min(1, Math.max(0, 1 - Number(top.score))), basis: 'vector', query_id: qid, resolution: top.resolution as string | null });
  }
  return { byId, queries };
}

const istDay = (t: number) => new Date(t + 19_800_000).toISOString().slice(0, 10);

export async function listDesk(db: Db, graph: string, view: string, order: string) {
  const [all, now] = await Promise.all([listTickets(), simNow()]);
  const doneToday = (t: FdTicket) => isDone(t) && istDay(ms(t.updated_at)) === istDay(now);
  const test = view === 'ready' ? isReady : view === 'done' ? doneToday : () => true;
  const shown = all.filter(test).sort((a, b) => (ms(b.created_at) - ms(a.created_at)) * (order === 'oldest' ? -1 : 1));
  const g = await guesses(db, graph, shown.map((t) => graphId(t.id)), Date.now());
  const counts = { ready: all.filter(isReady).length, done: all.filter(doneToday).length, all: all.length };
  // The counts come from the helpdesk, not the graph; q_0 is their receipt: the request and the filters, verbatim.
  const q_0: StoredQuery = {
    cypher: [
      '// Helpdesk REST, not Cypher (agent/api/tickets.ts listDesk)',
      'GET /api/v2/tickets?include=requester&per_page=100&order_by=created_at&order_type=desc  (pages to 300, spam dropped)',
      'ready = count(status = 2)                                  // open',
      'done  = count(status IN [4, 5] AND IST day(updated_at) = IST day(sim_now))',
      'all   = count(*)',
    ].join('\n'),
    graph: 'helpdesk', params: { sim_now: now }, columns: ['ready', 'done', 'all'], rows: [counts], ran_at: Date.now(),
  };
  return {
    view, order, sim_now: now, counts,
    queries: { q_0, ...g.queries },
    rows: shown.map((t) => {
      const id = graphId(t.id), guess = g.byId.get(id);
      return {
        id, fd_id: t.id, name: t.requester?.name ?? `Contact ${t.requester_id}`, created_at: ms(t.created_at), subject: t.subject,
        status: FD_STATUS_NAME[t.status] ?? String(t.status), state: isReady(t) ? 'todo' : isDone(t) ? 'done' : 'left',
        reading: !guess?.ingested, // not in memory yet, or not yet read by the dream
        guess: guess ? { issue: guess.issue, p: guess.p, basis: guess.basis, query_id: guess.query_id } : { issue: null, p: null, basis: 'none', query_id: null },
      };
    }),
  };
}

const quoteSplit = (text: string) => {
  const i = text.search(/\n\s*(On .{4,120}wrote:|-{3,} ?Forwarded message|From: )/);
  return i > 0 ? { text: text.slice(0, i).trim(), quoted: text.slice(i).trim() } : { text: text.trim(), quoted: undefined };
};
const nameOf = (email: string) => email.replace(/<.*>/, '').replace(/"/g, '').trim() || email;

export async function ticketDetail(db: Db, graph: string, rawId: string) {
  const id = fdId(rawId) ?? Number(rawId);
  if (!Number.isInteger(id)) throw new SimError(404, `No ticket ${rawId}.`);
  const [t, names] = await Promise.all([getTicket(id), agents().catch(() => new Map<number, string>())]);
  const gid = graphId(t.id);
  const requester = t.requester?.name ?? `Contact ${t.requester_id}`;
  const thread = [
    { kind: 'customer' as const, author: requester, at: ms(t.created_at), ...quoteSplit(t.description_text ?? '') },
    ...(t.conversations ?? []).map((c) => ({
      kind: c.private ? 'note' as const : c.incoming ? 'customer' as const : 'reply' as const,
      author: c.incoming ? nameOf(c.from_email) : names.get(c.user_id ?? -1) ?? nameOf(c.from_email),
      at: ms(c.created_at), ...quoteSplit(c.body_text ?? ''),
    })),
  ].sort((a, b) => a.at - b.at);
  const customerId = t.custom_fields?.cf_client_code ?? t.requester?.unique_external_id ?? null;
  const as_of = Date.now();
  const [g, profile] = await Promise.all([
    guesses(db, graph, [gid], as_of),
    customerId ? customerProfile(db, { customerId }, as_of, graph) : Promise.resolve(null),
  ]);
  const guess = g.byId.get(gid);
  return {
    id: gid, fd_id: t.id, subject: t.subject, status: FD_STATUS_NAME[t.status] ?? String(t.status),
    state: isReady(t) ? 'todo' : isDone(t) ? 'done' : 'left', created_at: ms(t.created_at),
    requester: { name: requester, email: t.requester?.email ?? null }, customer_id: customerId,
    merged_into: t.merged_into ? graphId(t.merged_into) : null,
    in_memory: !!guess, ingested: !!guess?.ingested,
    guess: guess ? { issue: guess.issue, p: guess.p, basis: guess.basis, query_id: guess.query_id, resolution: guess.resolution ?? null } : null,
    guess_queries: g.queries,
    customer: profile?.card.queries.q_1.rows.length ? profile.card : null,
    thread,
  };
}

export async function ticketBrief(db: Db, graph: string, rawId: string) {
  const id = fdId(rawId) ? rawId : graphId(Number(rawId));
  const { card } = await briefing(db, { ticketId: id }, Date.now(), graph);
  if (!card.queries.q_1.rows.length) throw new SimError(404, `I haven't read ${id} yet, so there is no brief.`);
  const v = validateCard(card);
  if (!v.ok) throw new Error(`brief failed validateCard: ${v.errors.join('; ')}`);
  return card;
}

// Idempotent per request id: a retried POST returns the first outcome and posts nothing twice.
// ponytail: in-process map; a restart forgets ids (the sim's status is then already resolved, so a retry is harmless).
const answered = new Map<string, Promise<unknown>>();
export function answerTicket(rawId: string, body: { requestId?: string; text?: string }) {
  const id = fdId(rawId) ?? Number(rawId);
  if (!Number.isInteger(id)) throw new SimError(404, `No ticket ${rawId}.`);
  if (!body.requestId) throw new SimError(400, 'requestId is required.');
  const key = `${id}:${body.requestId}`;
  if (!answered.has(key)) {
    const p = (async () => {
      const reply = await sim<{ id: number }>(`/api/v2/tickets/${id}/reply`, { method: 'POST', body: { body: body.text?.trim() || 'Answered from the Mochi desk.' } });
      await sim(`/api/v2/tickets/${id}`, { method: 'PUT', body: { status: 4 } });
      return { ticket: graphId(id), reply_id: reply.body.id, status: 'resolved' };
    })();
    answered.set(key, p);
    p.catch(() => answered.delete(key));
  }
  return answered.get(key)!;
}
