// Live ingest from the sim helpdesk (add-sim decision 5): webhook → fetch → idempotent upsert as pending.
// `npm run listen` connects as mochi_dream and listens on SIM_LISTEN_PORT (4011) for POST /webhook.
// Tickets land without ingested_at, so the dream does the extraction (ABOUT, RESOLVED_BY).
import { createServer } from 'node:http';
import { FalkorDB, type Graph } from 'falkordb';
import { GRAPH, ACL, FD_STATUS, FD_PRIORITY, FD_SOURCE } from '@mochi/contracts';
import { embed } from './embed.ts';

type Hook = { event: string; ticket_id: number | null; conversation_id?: number; sim_time: string };
const invert = <K extends string>(m: Record<K, number>) => new Map(Object.entries(m).map(([k, v]) => [v as number, k as K]));
const STATUS = invert(FD_STATUS), PRIORITY = invert(FD_PRIORITY), SOURCE = invert(FD_SOURCE);
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : null);
const sleep = (n: number) => new Promise((r) => setTimeout(r, n));

/** Noise never becomes a ticket in the graph: spam flag, auto-reply headers, mailer-daemon. */
export function noiseKind(t: any): 'spam' | 'auto_reply' | 'bounce' | null {
  if (t.spam) return 'spam';
  const h = t.headers ?? {};
  if (/mailer-daemon|postmaster/i.test(t.requester?.email ?? '') || h['X-Failed-Recipients']) return 'bounce';
  if (h['Auto-Submitted'] && h['Auto-Submitted'] !== 'no') return 'auto_reply';
  return null;
}

const UPSERT = `MERGE (t:Ticket {id: $id})
ON CREATE SET t.created_at = $created_at, t.source = 'seed'
SET t += $props
MERGE (c:Customer {id: $cid})
ON CREATE SET c.name = $cname, c.email = $cemail, c.created_at = $created_at, c.source = 'seed'
MERGE (c)-[:RAISED]->(t)
WITH t
SET t.embedding = vecf32($vec)
RETURN t.id AS id`;
const MERGE_EDGE = `MATCH (a:Ticket {id: $id}), (b:Ticket {id: $into}) MERGE (a)-[:MERGED_INTO]->(b)`;

export function createListener(o: { simUrl: string; apiKey: string; graph: Graph; sweepMs?: number }) {
  const auth = { authorization: `Basic ${Buffer.from(`${o.apiKey}:X`).toString('base64')}` };
  const seen = new Set<string>();
  const stats = { webhooks: 0, duplicates: 0, written: 0, dropped: { spam: 0, auto_reply: 0, bounce: 0, no_account: 0 } as Record<string, number>, rateLimited: 0, errors: 0 };
  let since: number | null = null;
  let queue = Promise.resolve();
  const enqueue = (fn: () => Promise<void>) => (queue = queue.then(fn).catch((e) => { stats.errors++; console.warn(`listen: ${(e as Error).message}`); }));

  async function get(path: string): Promise<any> {
    for (;;) {
      const r = await fetch(o.simUrl + path, { headers: auth });
      if (r.status === 429) { stats.rateLimited++; await sleep(Number(r.headers.get('retry-after') ?? 1) * 1000); continue; } // honour Retry-After
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`GET ${path}: HTTP ${r.status}`);
      return { body: await r.json(), link: r.headers.get('link') };
    }
  }

  async function ingest(id: number) {
    const res = await get(`/api/v2/tickets/${id}?include=conversations,requester,stats`);
    if (!res) return;
    const t = res.body;
    const kind = noiseKind(t);
    if (kind) { stats.dropped[kind]++; return; }
    let convs: any[] = t.conversations;
    if (convs.length >= 10) convs = (await get(`/api/v2/tickets/${id}/conversations?per_page=100`)).body; // include= returns the first 10 only
    const thread = convs.filter((c) => !(c.headers?.['Auto-Submitted'] && c.headers['Auto-Submitted'] !== 'no'));
    const into = thread.map((c) => /^Merged into ticket #(\d+)/.exec(c.body_text)?.[1]).find(Boolean);
    const holder = t.custom_fields?.cf_client_code ?? t.requester.unique_external_id;
    if (!holder) { stats.dropped.no_account++; return; } // no account behind it: nothing to brief on
    const body = [t.description_text, ...thread.map((c) => c.body_text)].join('\n\n');
    const props = Object.fromEntries(Object.entries({
      subject: t.subject, body, channel: SOURCE.get(t.source) ?? 'email', status: STATUS.get(t.status) ?? 'open', priority: PRIORITY.get(t.priority) ?? 'medium',
      resolved_at: ms(t.stats?.resolved_at), requester_email: t.requester.email, cc_emails: t.cc_emails,
      on_behalf_of: t.requester.unique_external_id === holder ? null : holder, merged_into: into ? `T-${into}` : null,
      fr_due_by: ms(t.fr_due_by), due_by: ms(t.due_by), first_responded_at: ms(t.stats?.first_responded_at), closed_at: ms(t.stats?.closed_at),
      fr_escalated: t.fr_escalated, is_escalated: t.is_escalated,
    }).filter(([, v]) => v !== null && v !== undefined)); // FalkorDB stores no nulls
    const [vec] = await embed([`${t.subject}\n${body}`]);
    await o.graph.query(UPSERT, { params: { id: `T-${t.id}`, created_at: Date.parse(t.created_at), props, cid: holder, cname: props.on_behalf_of ? holder : t.requester.name, cemail: props.on_behalf_of ? '' : t.requester.email, vec } as any });
    if (into) await o.graph.query(MERGE_EDGE, { params: { id: `T-${t.id}`, into: `T-${into}` } });
    stats.written++;
    since = Math.max(since ?? 0, Date.parse(t.updated_at));
  }

  function onHook(h: Hook) {
    stats.webhooks++;
    const key = `${h.event}|${h.ticket_id}|${h.conversation_id ?? ''}|${h.sim_time}`; // a retry repeats sim_time; a second status change does not
    if (seen.has(key)) { stats.duplicates++; return; } // at-least-once delivery: write once
    seen.add(key);
    if (h.ticket_id === null) return; // day_closed: the dream's scheduler, not ours
    enqueue(() => ingest(h.ticket_id!));
  }

  /** Catch anything a webhook missed: every ticket updated since the last one we wrote. */
  async function sweep() {
    if (since === null) since = (await get('/sim/clock'))?.body?.sim_now_ms ?? 0;
    let path: string | null = `/api/v2/tickets?updated_since=${new Date(since!).toISOString()}&order_by=updated_at&order_type=asc&per_page=100`;
    const ids: number[] = [];
    while (path) {
      const res = await get(path);
      if (!res) break;
      ids.push(...res.body.map((t: any) => t.id));
      path = /<([^>]+)>; rel="next"/.exec(res.link ?? '')?.[1] ?? null;
    }
    for (const id of ids) await enqueue(() => ingest(id));
    await queue;
  }

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/webhook')) { res.writeHead(404).end(); return; }
    let s = ''; for await (const c of req) s += c;
    try { onHook(JSON.parse(s)); res.writeHead(200).end(); } catch { res.writeHead(400).end(); }
  });
  const timer = setInterval(() => { void sweep().catch(() => stats.errors++); }, o.sweepMs ?? 30_000);
  return { server, stats, sweep, drain: () => queue, close: () => { clearInterval(timer); return new Promise<void>((r) => server.close(() => r())); } };
}

if (import.meta.main) {
  try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* real environment */ }
  const password = process.env[ACL.dream.passwordEnv];
  if (!password) throw new Error(`missing ${ACL.dream.passwordEnv} (see .env.example)`);
  const db = await FalkorDB.connect({ socket: { host: process.env.FALKORDB_HOST ?? 'localhost', port: Number(process.env.FALKORDB_PORT ?? 6379) }, username: ACL.dream.user, password });
  const l = createListener({ simUrl: process.env.SIM_URL ?? 'http://localhost:4010', apiKey: process.env.SIM_API_KEY ?? 'sim-key', graph: db.selectGraph(GRAPH.company) });
  const port = Number(process.env.SIM_LISTEN_PORT ?? 4011);
  l.server.listen(port, () => console.log(`listening for sim webhooks on http://localhost:${port}/webhook → ${GRAPH.company}`));
  setInterval(() => console.log(`listen: ${JSON.stringify(l.stats)}`), 60_000).unref();
}
