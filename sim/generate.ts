// Sim generator (add-sim). `npm run sim:gen -- --seed 42` writes sim/data/inbox.json (Freshdesk-shaped,
// served by the API) and sim/data/truth.json (the dataset + every catalogue flag; never served).
// Truth first, surface second: gen's planted world decides the facts, this file renders the helpdesk.
import { writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { FD_PRIORITY, FD_SOURCE, FD_STATUS, validateDataset, type Dataset, type Ticket, type Conversation, type SlaPolicy, type Customer } from '@mochi/contracts';
import { generate, WORLD, DAY, HOUR, END, DEMO_START } from '../gen/generate.ts';
import { ISSUES, FIRST, LAST } from '../gen/catalog.ts';
import { rng } from '../gen/rng.ts';
import * as X from './text.ts';

const MIN = 60_000;
export const REPLAY_START = DEMO_START; // the loader stops here; the replay clock releases the rest

// Research §7 targets (midpoints of the estimates), and what each frequency is measured over.
export const CATALOGUE = {
  follow_up: { target: 0.35, of: 'inbound messages' },
  duplicate: { target: 0.045, of: 'customer tickets' },
  already_merged: { target: 0.045, of: 'customer tickets' },
  new_ticket_not_reply: { target: 0.06, of: 'customer tickets' },
  quoted_history: { target: 0.7, of: 'customer replies' },
  forwarded: { target: 0.035, of: 'customer tickets' },
  cc_third_party: { target: 0.075, of: 'customer tickets' },
  auto_reply: { target: 0.035, of: 'inbound messages' },
  ooo_loop: { target: null, of: 'tickets (at least one)' },
  bounce: { target: 0.0125, of: 'outbound messages' },
  spam: { target: 0.055, of: 'all tickets' },
  mixed_language: { target: 0.15, of: 'customer tickets' },
  attachment_missing: { target: 0.04, of: 'inbound messages' },
  escalation_tone: { target: 0.115, of: 'customer tickets' },
  template_reply: { target: 0.6, of: 'agent replies' },
  internal_note: { target: 0.4, of: 'customer tickets' },
  reopened: { target: 0.075, of: 'customer tickets' },
  thanks_no_reopen: { target: 0.2, of: 'resolved tickets' },
  multi_issue: { target: 0.075, of: 'customer tickets' },
  on_behalf_of: { target: 0.02, of: 'customer tickets' },
  signature: { target: 0.8, of: 'customer messages' },
  disclaimer: { target: 0.22, of: 'customer messages' },
  mobile_footer: { target: 0.25, of: 'customer messages' },
  waiting_status: { target: 0.25, of: 'customer tickets' },
  fr_breach: { target: 0.1, of: 'customer tickets' },
} as const;
export type Flag = keyof typeof CATALOGUE;

type Kind = 'description' | 'follow_up' | 'wait_reply' | 'reopen' | 'thanks' | 'cc_reply' | 'auto_reply' | 'agent' | 'note';
type Msg = {
  kind: Kind; at: number; author: Conversation['author']; author_id: string | null; incoming: boolean; private: boolean; source: number;
  from: string; to: string[]; cc: string[]; core: string; lang: X.Lang | null; slots: Record<string, string>;
  noise: X.Noise | null; name: string; quoteOf: Msg | null; attachments: Conversation['attachments']; headers?: Record<string, string>;
  template?: boolean; para?: X.Para; prefix?: string; suffix?: string; copyOf?: Msg; text?: string;
};
type Noisy = 'spam' | 'bounce' | 'auto_reply';
type Draft = {
  key: string; t: Ticket; desc: Msg; msgs: Msg[]; noise: Noisy | null; requester: number; responder: number | null; group: number | null;
  fwd: boolean; spam: boolean; headers?: Record<string, string>; flags: Set<Flag>; issue_ids: string[]; dupOf: string | null; lang: string;
};

type Att = Conversation['attachments'];
export type Inbox = {
  broker: string; generated_at: number; replay_start: number;
  groups: { id: number; name: string; agent_ids: number[] }[];
  agents: { id: number; name: string; email: string; group_ids: number[] }[];
  contacts: { id: number; name: string; email: string; language: string; unique_external_id: string | null; created_at: number }[];
  tickets: {
    id: number; subject: string; description_text: string; source: number; priority: number; type: string | null;
    requester_id: number; responder_id: number | null; group_id: number | null; to_emails: string[]; cc_emails: string[]; fwd_emails: string[]; tags: string[];
    spam: boolean; headers: Record<string, string> | null; custom_fields: { cf_client_code: string | null }; attachments: Att;
    fr_due_by: number | null; due_by: number | null; created_at: number; status_history: { status: number; at: number }[];
  }[];
  conversations: {
    id: number; ticket_id: number; user_id: number | null; incoming: boolean; private: boolean; source: number; support_email: string | null;
    from_email: string; to_emails: string[]; cc_emails: string[]; bcc_emails: string[]; body_text: string; attachments: Att; created_at: number; headers: Record<string, string> | null;
  }[];
};
export type Truth = Awaited<ReturnType<typeof simulate>>['truth'];

export async function simulate(seed = 42, { templatesOnly = false, offline = false, cache = new URL('./cache/paraphrase.jsonl', import.meta.url) } = {}) {
  const { dataset: w } = generate(seed, WORLD.sim);
  const r = rng(seed ^ 0x51a7);
  const at = (lo: number, hi: number) => Math.floor((lo + r.next() * (hi - lo)) / 1000) * 1000;
  const chance = (p: number) => r.next() < p;

  // People: customer contacts, agents, groups.
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '.');
  const customers: Customer[] = w.customers.map((c, k) => ({ ...c, email: `${slug(c.name)}.${k + 1}@mail.example` }));
  const cust = new Map(customers.map((c) => [c.id, c]));
  type Contact = { id: number; name: string; email: string; language: string; unique_external_id: string | null; created_at: number };
  const contacts: Contact[] = customers.map((c, k) => ({ id: 5001 + k, name: c.name, email: c.email!, language: c.language, unique_external_id: c.id, created_at: c.joined_at }));
  const contactOf = new Map(customers.map((c, k) => [c.id, contacts[k]]));
  const newContact = (name: string, email: string, created_at: number, language = 'en') => {
    const c = { id: 5001 + contacts.length, name, email, language, unique_external_id: null, created_at };
    contacts.push(c);
    return c;
  };
  const agents = w.agents.map((a, k) => ({ ...a, fd: 7001 + k, email: `${slug(a.name)}@ecorp-securities.example` }));
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const groups = w.teams.map((t, k) => ({ id: 8001 + k, name: t.name, agent_ids: agents.filter((a) => a.team === t.name).map((a) => a.fd) }));
  const groupOf = new Map(groups.map((g) => [g.name, g.id]));
  const teamOfArea = new Map(w.product_areas.map((a) => [a.name, a.team]));
  const issueIdx = (id: string) => Number(id.slice(2)) - 1;

  // SLA: one policy per segment × priority (hours, scaled by segment).
  const RESPOND = { urgent: 1, high: 2, medium: 4, low: 8 }, RESOLVE = { urgent: 12, high: 24, medium: 48, low: 72 };
  const FACTOR = { hni: 0.5, premium: 0.75, retail: 1 };
  const sla_policies: SlaPolicy[] = (['retail', 'premium', 'hni'] as const).flatMap((segment) => (['low', 'medium', 'high', 'urgent'] as const).map((priority) => ({
    id: `SLA-${segment}-${priority}`, segment, priority,
    respond_within_ms: RESPOND[priority] * FACTOR[segment] * HOUR, resolve_within_ms: RESOLVE[priority] * FACTOR[segment] * HOUR,
  })));
  const slaOf = (t: Ticket) => sla_policies.find((p) => p.segment === cust.get(t.customer_id)!.segment && p.priority === t.priority)!;

  const resolution = new Map(w.resolutions.map((x) => [x.id, x]));
  const drafts: Draft[] = [];
  const outbound: { d: Draft; m: Msg }[] = [];

  const customerMsg = (d: Draft, kind: Kind, when: number, core: string, lang: X.Lang, extra: Partial<Msg> = {}): Msg => {
    const c = cust.get(d.t.customer_id)!, req = contacts.find((x) => x.id === d.requester)!;
    return {
      kind, at: when, author: 'customer', author_id: req.unique_external_id ? c.id : null, incoming: true, private: false, source: 0,
      from: req.email, to: [X.SUPPORT], cc: d.t.cc_emails ?? [], core, lang, slots: { CLIENT_CODE: c.id, DATE: X.istDate(when), TICKET_ID: `@${d.key}`, HOLDER: c.name },
      noise: X.drawNoise(r, cust.get(d.t.customer_id)!.language), name: req.name.split(' ')[0], quoteOf: null, attachments: [], ...extra,
    };
  };
  const agentMsg = (d: Draft, when: number, core: string, agentId: string, template: boolean, priv = false): Msg => {
    const a = agentById.get(agentId)!, c = cust.get(d.t.customer_id)!;
    return {
      kind: priv ? 'note' : 'agent', at: when, author: 'agent', author_id: agentId, incoming: false, private: priv, source: priv ? 2 : 0,
      from: priv ? a.email : X.SUPPORT, to: priv ? [] : [contacts.find((x) => x.id === d.requester)!.email], cc: priv ? [] : d.t.cc_emails ?? [],
      core: priv ? core : `${core}\n\n${r.pick(X.SIGNOFF)}`, lang: null, slots: { NAME: c.name.split(' ')[0], TICKET_ID: `@${d.key}`, AGENT: a.name },
      noise: null, name: a.name, quoteOf: null, attachments: [], template,
    };
  };
  const attach = (missing: boolean): Conversation['attachments'] => (missing ? [] : [{ name: r.pick(['screenshot.png', 'statement.pdf', 'error.jpg', 'contract-note.pdf']), content_type: 'application/octet-stream', size: r.int(20_000, 900_000) }]);

  // ---- Customer tickets from the world ----
  const base = w.tickets.map((t0) => {
    const t: Ticket = { ...t0 };
    const c = cust.get(t.customer_id)!, def = ISSUES[issueIdx(t.issue_id!)];
    if (t.channel === 'app' && chance(0.12)) t.channel = 'portal';
    if (t.channel === 'email' && chance(0.06)) t.channel = 'phone';
    const d: Draft = { key: t.id, t, desc: null!, msgs: [], noise: null, requester: contactOf.get(c.id)!.id, responder: null, group: groupOf.get(teamOfArea.get(def.area)!)!, fwd: false, spam: false, flags: new Set(), issue_ids: [t.issue_id!], dupOf: null, lang: 'en' };
    if (chance(0.02)) { // wrong requester: a relative writes for the account holder
      const rel = newContact(`${r.pick(FIRST)} ${c.name.split(' ')[1]}`, `${slug(c.name.split(' ')[1])}.family.${contacts.length}@mail.example`, t.created_at);
      d.requester = rel.id; t.on_behalf_of = c.id; d.flags.add('on_behalf_of');
    }
    t.requester_email = contacts.find((x) => x.id === d.requester)!.email;
    t.cc_emails = [];
    if (chance(0.075)) { t.cc_emails = [`${r.pick(['ca.', 'advisor.', 'spouse.', 'son.'])}${slug(c.name.split(' ')[1])}.${r.int(10, 99)}@mail.example`]; d.flags.add('cc_third_party'); }
    const responderAgent = t.solved_by ?? r.pick(agents.filter((a) => a.team === teamOfArea.get(def.area))).id;
    d.responder = agentById.get(responderAgent)!.fd;

    // Description skeleton.
    const hinglish = c.language === 'hi' && chance(0.3);
    const lang: X.Lang = hinglish ? 'hinglish' : 'en';
    let core = hinglish ? def.hinglish : r.pick(def.bodies);
    if (t.on_behalf_of) core = `${hinglish ? 'Main apne father {{HOLDER}} ke liye likh raha hoon, client code {{CLIENT_CODE}}.' : 'I am writing on behalf of my father {{HOLDER}}, client code {{CLIENT_CODE}}.'} ${core}`;
    else if (chance(0.4)) core += hinglish ? ' Mera client code {{CLIENT_CODE}} hai.' : ' My client code is {{CLIENT_CODE}}.';
    if (chance(0.3)) core += hinglish ? ' Yeh {{DATE}} se ho raha hai.' : ' This started on {{DATE}}.';
    if ((def.area === 'funds' || def.area === 'charges') && chance(0.7)) { core += hinglish ? ' Amount {{AMOUNT}} hai.' : ' The amount is {{AMOUNT}}.'; }
    if (chance(0.075)) {
      const j = (issueIdx(t.issue_id!) + r.int(3, 15)) % ISSUES.length;
      core += hinglish ? ` Aur ek baat, ${ISSUES[j].hinglish}` : ` Also, ${r.pick(ISSUES[j].bodies).replace(/^./, (s) => s.toLowerCase())}`;
      d.issue_ids.push(`I-${String(j + 1).padStart(2, '0')}`); d.flags.add('multi_issue');
    }
    if (t.follows_ticket_id) { core += chance(0.5) ? (hinglish ? ' Pehle bhi ticket #{{PREV_ID}} raise kiya tha.' : ' This is about my earlier ticket #{{PREV_ID}}.') : (hinglish ? ' Pehle bhi complaint kiya tha.' : ' I wrote about this earlier as well.'); d.flags.add('new_ticket_not_reply'); }
    const escalation = chance(0.115);
    if (escalation) { core += ` ${r.pick(X.ESCALATION)}`; d.flags.add('escalation_tone'); if (t.priority === 'low' || t.priority === 'medium') t.priority = 'high'; }
    const mentions = chance(0.15), missing = mentions && chance(0.3);
    if (mentions) core += hinglish ? ' Screenshot attach kiya hai.' : ' PFA the screenshot.';
    d.lang = c.language !== 'en' && (hinglish || c.language !== 'hi') ? c.language : hinglish ? 'hi' : 'en';
    const desc = customerMsg(d, 'description', t.created_at, core, lang, { attachments: mentions ? attach(missing) : [] });
    desc.slots.AMOUNT = `₹${(r.int(5, 2000) * 50).toLocaleString('en-IN')}`;
    if (t.follows_ticket_id) desc.slots.PREV_ID = `@${t.follows_ticket_id}`;
    if (c.language === 'hi' && !hinglish && chance(0.1)) desc.suffix = ` ${r.pick(X.DEVANAGARI)}`;
    if (hinglish || desc.suffix || desc.noise!.regional) d.flags.add('mixed_language');
    if (t.channel === 'email' && chance(0.12)) { d.fwd = true; d.flags.add('forwarded'); }
    d.desc = desc;
    t.subject = d.fwd ? `Fwd: ${r.pick(def.subjects)}` : r.pick(def.subjects);
    drafts.push(d);
    return d;
  });

  // ---- Timelines ----
  for (const d of base) {
    const t = d.t, def = ISSUES[issueIdx(t.issue_id!)], sla = slaOf(t);
    const agentId = t.solved_by ?? agents.find((a) => a.fd === d.responder)!.id;
    const hist: { status: Ticket['status']; at: number }[] = [{ status: 'open', at: t.created_at }];
    t.fr_due_by = t.created_at + sla.respond_within_ms;
    t.due_by = t.created_at + sla.resolve_within_ms;
    const horizon = t.resolved_at ?? END;
    const lang = d.desc.lang!;
    const reply = (m: Msg) => { d.msgs.push(m); if (!m.private) outbound.push({ d, m }); return m; };
    let last: Msg = d.desc;
    const breach = chance(0.1);
    const fr = t.created_at + Math.round(sla.respond_within_ms * (breach ? 1.2 + r.next() * 2.8 : 0.05 + r.next() * 0.85) / 1000) * 1000;
    if (fr < horizon - 10 * MIN) {
      const waiting = chance(0.25) && fr + 3 * HOUR < horizon;
      const third = waiting && (def.area === 'funds' || def.area === 'kyc') && chance(0.35);
      const template = chance(0.6);
      const body = waiting ? r.pick(third ? X.THIRD_PARTY : X.ASK) : template ? r.pick(X.CANNED) : `Hi {{NAME}}, we are checking the ${def.name} issue with the ${teamOfArea.get(def.area)} team and will update you.`;
      last = reply(agentMsg(d, fr, body, agentId, waiting || template));
      if (waiting) {
        d.flags.add('waiting_status');
        hist.push({ status: third ? 'waiting_on_third_party' : 'waiting_on_customer', at: fr });
        const back = at(fr + HOUR, Math.min(fr + 20 * HOUR, horizon - MIN));
        if (third) { d.msgs.push(agentMsg(d, back, 'Partner confirmed, resuming the ticket.', agentId, false, true)); }
        else {
          const miss = chance(0.15);
          last = d.msgs[d.msgs.push(customerMsg(d, 'wait_reply', back, lang === 'hinglish' ? r.pick(X.WAIT_REPLY_HI) : r.pick(X.WAIT_REPLY), lang, { attachments: attach(miss), quoteOf: last })) - 1];
          if (miss) last.slots.MISSING = '1';
        }
        hist.push({ status: 'open', at: back });
      }
      // Nudges: "any update?" 24–72 h after the last message.
      for (let k = 0, n = r.weighted([[0, 20], [1, 40], [2, 40]] as const); k < n; k++) {
        const when = last.at + at(20 * HOUR, 60 * HOUR);
        if (when >= horizon - MIN) break;
        const esc = d.flags.has('escalation_tone') && chance(0.6);
        last = d.msgs[d.msgs.push(customerMsg(d, 'follow_up', when, esc ? r.pick(X.ESCALATION) : lang === 'hinglish' ? r.pick(X.NUDGES_HI) : r.pick(X.NUDGES), lang, { quoteOf: last })) - 1];
      }
    }
    if (chance(0.4)) { d.flags.add('internal_note'); const n = chance(0.3) ? 2 : 1; for (let k = 0; k < n; k++) d.msgs.push(agentMsg(d, at(t.created_at + MIN, horizon - MIN), r.pick(X.NOTES), agentId, false, true)); }
    if (d.flags.has('cc_third_party')) {
      const when = at(t.created_at + HOUR, horizon - MIN);
      if (when > t.created_at) d.msgs.push({ ...customerMsg(d, 'cc_reply', when, 'Adding to this: I help {{HOLDER}} with the account. Please keep me copied on the resolution.', 'en'), from: t.cc_emails![0], author_id: null, cc: [], name: 'Advisor' });
    }
    if (t.resolved_at !== null) {
      const res = resolution.get(t.resolution_id!)!;
      const kb = res.kb_id ? w.kb_articles.find((k) => k.id === res.kb_id) : null;
      const template = chance(0.6);
      const body = template ? `Dear {{NAME}}, update on your request: ${res.summary.replace(/^Workaround: /, '')}. We are marking ticket #{{TICKET_ID}} as resolved.`
        : `Hi {{NAME}}, I looked into this. ${res.summary}.${kb ? ` Steps we followed: ${kb.steps.join('; ')}.` : ''}`;
      last = reply(agentMsg(d, t.resolved_at, body, agentId, template));
      hist.push({ status: 'resolved', at: t.resolved_at });
      let resolvedAt = t.resolved_at;
      if (chance(0.1) && t.resolved_at + 9 * DAY < END) {
        d.flags.add('reopened');
        const when = at(t.resolved_at + DAY, t.resolved_at + 5 * DAY);
        last = d.msgs[d.msgs.push(customerMsg(d, 'reopen', when, r.pick(X.REOPEN), 'en', { quoteOf: last })) - 1];
        hist.push({ status: 'open', at: when });
        resolvedAt = when + at(HOUR, 10 * HOUR);
        last = reply(agentMsg(d, resolvedAt, `Hi {{NAME}}, sorry about that. ${res.summary.replace(/^Workaround: /, '')} again.`, agentId, false));
        hist.push({ status: 'resolved', at: resolvedAt });
      }
      if (chance(0.2) && resolvedAt + 12 * HOUR < END) { d.flags.add('thanks_no_reopen'); d.msgs.push(customerMsg(d, 'thanks', at(resolvedAt + 10 * MIN, resolvedAt + 12 * HOUR), r.pick(X.THANKS), 'en', { quoteOf: last })); }
      if (t.status === 'closed') {
        if (resolvedAt + 72 * HOUR < END) { t.closed_at = resolvedAt + 72 * HOUR; hist.push({ status: 'closed', at: t.closed_at }); }
        else t.status = 'resolved';
      }
    } else if (t.status === 'pending') {
      const when = Math.max(...d.msgs.map((m) => m.at), t.created_at) + HOUR;
      if (when < END) hist.push({ status: 'pending', at: when }); else t.status = 'open';
    }
    d.msgs.sort((a, b) => a.at - b.at);
    const firstReply = d.msgs.find((m) => m.author === 'agent' && !m.private);
    t.first_responded_at = firstReply?.at ?? null;
    if (d.msgs.some((m) => m.quoteOf)) for (const m of d.msgs) if (m.quoteOf && !chance(0.7)) m.quoteOf = null;
    t.status_history = hist.sort((a, b) => a.at - b.at);
    if (t.status !== t.status_history.at(-1)!.status) throw new Error(`${t.id}: status ${t.status} != history ${t.status_history.at(-1)!.status}`);
  }

  // Auto-replies and bounces on outbound agent mail; one capped ack↔OOO loop.
  const noiseDrafts: Draft[] = [];
  const noiseDraft = (kind: Noisy, created: number, from: { name: string; email: string }, subject: string, body: string, headers?: Record<string, string>) => {
    const ct = newContact(from.name, from.email, created);
    const t: Ticket = { id: `N-${noiseDrafts.length + 1}`, customer_id: '', subject, body, channel: 'email', status: kind === 'spam' ? 'closed' : 'open', priority: 'low', created_at: created, resolved_at: null, issue_id: null, resolution_id: null, solved_by: null, follows_ticket_id: null, status_history: [{ status: 'open', at: created }] };
    const desc: Msg = { kind: 'description', at: created, author: 'system', author_id: null, incoming: true, private: false, source: 0, from: from.email, to: [X.SUPPORT], cc: [], core: body, lang: null, slots: {}, noise: null, name: from.name, quoteOf: null, attachments: [], headers };
    const d: Draft = { key: t.id, t, desc, msgs: [], noise: kind, requester: ct.id, responder: null, group: null, fwd: false, spam: kind === 'spam', headers, flags: new Set([kind === 'auto_reply' ? 'auto_reply' : kind]), issue_ids: [], dupOf: null, lang: 'en' };
    noiseDrafts.push(d);
    return d;
  };
  const loopAt = base.findIndex((d) => d.msgs.filter((m) => m.kind === 'agent').length >= 2 && d.t.resolved_at && d.t.created_at < DEMO_START);
  for (const { d, m } of outbound) {
    const ooo = d === base[loopAt] && m === d.msgs.find((x) => x.kind === 'agent') ? 3 : chance(0.035) ? 1 : 0;
    for (let k = 0; k < ooo; k++) {
      const when = m.at + (k + 1) * at(MIN, 3 * MIN);
      if (when >= END) break;
      d.msgs.push({ ...customerMsg(d, 'auto_reply', when, `I am out of office until ${X.istDate(when + 3 * DAY)} with limited access to email. I will reply when I am back.`, 'en'), noise: null, author: 'system', headers: { 'Auto-Submitted': 'auto-replied', 'X-Autoreply': 'yes' } });
      d.flags.add(ooo === 3 ? 'ooo_loop' : 'auto_reply');
    }
    if (chance(0.0125) && m.at + 5 * MIN < END) {
      const nd = noiseDraft('bounce', m.at + at(MIN, 5 * MIN), { name: 'Mail Delivery Subsystem', email: 'mailer-daemon@mail.example' }, 'Delivery Status Notification (Failure)',
        `Delivery to the following recipient failed permanently:\n\n    ${m.to[0]}\n\nThe recipient's mailbox is full or no longer exists.\n\nOriginal subject: Re: [#{{TICKET_ID}}] ${d.t.subject}`, { 'Auto-Submitted': 'auto-generated', 'X-Failed-Recipients': m.to[0] });
      nd.desc.slots.TICKET_ID = `@${d.key}`;
    }
  }
  for (const d of base) d.msgs.sort((a, b) => a.at - b.at);

  // Duplicates merged into their primary (not chat: chat tickets cannot be merged).
  const dups: Draft[] = [];
  for (const p of base) {
    if (p.t.channel === 'chat' || p.t.created_at + 16 * HOUR >= END || !chance(0.047)) continue;
    const created = at(p.t.created_at + 15 * MIN, p.t.created_at + 6 * HOUR), merged = at(created + HOUR, created + 8 * HOUR);
    const t: Ticket = {
      ...p.t, id: `D-${dups.length + 1}`, subject: chance(0.6) ? p.t.subject : `Re-sending: ${p.t.subject}`, created_at: created, status: 'closed', resolved_at: null,
      issue_id: null, resolution_id: null, solved_by: null, follows_ticket_id: null, merged_into: p.key, on_behalf_of: p.t.on_behalf_of, cc_emails: [],
      status_history: [{ status: 'open', at: created }, { status: 'closed', at: merged }], closed_at: merged, first_responded_at: null,
      fr_due_by: created + slaOf(p.t).respond_within_ms, due_by: created + slaOf(p.t).resolve_within_ms,
    };
    const d: Draft = { ...p, key: t.id, t, msgs: [], flags: new Set(['duplicate', 'already_merged']), dupOf: p.key, issue_ids: [...p.issue_ids] };
    d.desc = { ...customerMsg(d, 'description', created, '', p.desc.lang!), copyOf: p.desc, prefix: r.pick(['Sending this again as I got no reply.\n\n', 'Resending in case my last mail was missed.\n\n', '']) };
    const agentId = agents.find((a) => a.fd === p.responder)!.id;
    d.msgs.push(agentMsg(d, merged, 'Merged into ticket #{{PRIMARY_ID}}.', agentId, false, true));
    d.msgs[0].slots.PRIMARY_ID = `@${p.key}`;
    const note = agentMsg(p, merged, 'Merged ticket #{{DUP_ID}} into this ticket.', agentId, false, true);
    note.slots.DUP_ID = `@${d.key}`;
    p.msgs.push(note); p.msgs.sort((a, b) => a.at - b.at);
    p.flags.add('duplicate');
    dups.push(d);
  }
  // Spam and stray autoresponder tickets.
  const nSpam = Math.round((base.length + dups.length) * 0.055 / (1 - 0.055));
  for (let k = 0; k < nSpam; k++) {
    const [subject, body] = r.pick(X.SPAM);
    noiseDraft('spam', at(w.generated_at - 90 * DAY, END - MIN), { name: r.pick(['Growth Team', 'Mark Davis', 'Account Security', 'SEO Expert']), email: `promo${k}@bulk-mail.example` }, subject, body);
  }
  for (let k = 0; k < Math.max(3, Math.round(base.length * 0.003)); k++) {
    const c = r.pick(customers);
    noiseDraft('auto_reply', at(w.generated_at - 90 * DAY, END - MIN), { name: c.name, email: `${c.email!.replace('@', '.alt@')}` }, 'Automatic reply: E Corp Securities monthly statement',
      'Thank you for your email. I am currently out of the office and will respond on my return.', { 'Auto-Submitted': 'auto-replied' });
  }

  // ---- Paraphrase (about 1 in 3 customer emails) ----
  const all = [...base, ...dups, ...noiseDrafts];
  const customerMsgs = base.flatMap((d) => [d.desc, ...d.msgs]).filter((m) => m.author === 'customer' && m.lang && m.kind !== 'cc_reply');
  const paras = customerMsgs.filter(() => chance(1 / 3));
  for (const m of paras) m.para = { skeleton: m.core, lang: m.lang!, style: X.drawStyle(r) };
  let stats: X.ParaStats | null = null;
  if (!templatesOnly) {
    const out = await X.paraphraseAll(paras.map((m) => m.para!), cache, { offline });
    paras.forEach((m, k) => { m.core = out.texts[k]; });
    stats = out.stats;
  }

  // ---- Freshdesk ids by creation order, then render text ----
  all.sort((a, b) => a.t.created_at - b.t.created_at || a.key.localeCompare(b.key));
  const fdId = new Map(all.map((d, k) => [d.key, 1001 + k]));
  const newId = (key: string) => `T-${fdId.get(key)}`;
  const resolve = (slots: Record<string, string>) => Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, v.startsWith('@') ? String(fdId.get(v.slice(1))) : v]));
  const render = (m: Msg): string => {
    if (m.text !== undefined) return m.text;
    let core = m.copyOf ? `${m.prefix}${render(m.copyOf).split('\n\n').find((p) => p.length > 30) ?? render(m.copyOf)}` : X.fill(m.core, resolve(m.slots)) + (m.suffix ?? '');
    let body = m.noise ? X.addNoise(core, m.noise, m.name, r.pick) : core;
    if (m.quoteOf) body += X.quote(render(m.quoteOf), m.quoteOf.at, m.quoteOf.author === 'agent' ? `E Corp Securities Support <${X.SUPPORT}>` : `${m.quoteOf.name} <${m.quoteOf.from}>`);
    return (m.text = body);
  };
  for (const d of all) {
    let body = render(d.desc);
    if (d.fwd) body = X.forwardWrap(body, d.t.created_at - at(DAY, 10 * DAY), contacts.find((x) => x.id === d.requester)!.name, d.t.requester_email!, d.t.subject.replace(/^Fwd: /, ''));
    d.desc.text = body;
    d.t.body = body;
    d.msgs.forEach(render);
  }

  // ---- Flags measured from the rendered mail ----
  const custTickets = [...base, ...dups];
  const inbound = custTickets.flatMap((d) => [d.desc, ...d.msgs]).filter((m) => m.incoming);
  const custWritten = inbound.filter((m) => m.author === 'customer');
  const agentReplies = base.flatMap((d) => d.msgs).filter((m) => m.kind === 'agent');
  for (const d of base) {
    if (d.msgs.some((m) => m.kind === 'agent' && m.at > d.t.fr_due_by!) && (d.t.first_responded_at ?? Infinity) > d.t.fr_due_by!) d.flags.add('fr_breach');
  }
  const count = (f: Flag) => [...custTickets, ...noiseDrafts].filter((d) => d.flags.has(f)).length;
  const N = { 'customer tickets': custTickets.length, 'all tickets': all.length, 'resolved tickets': base.filter((d) => d.t.resolved_at !== null).length,
    'inbound messages': inbound.length, 'customer replies': custWritten.filter((m) => m.kind !== 'description').length, 'customer messages': custWritten.length,
    'outbound messages': outbound.length, 'agent replies': agentReplies.length, 'tickets (at least one)': all.length } as const;
  const counts: Record<Flag, number> = {
    follow_up: inbound.filter((m) => m.kind === 'follow_up').length,
    duplicate: dups.length, already_merged: dups.length, new_ticket_not_reply: count('new_ticket_not_reply'),
    quoted_history: custWritten.filter((m) => m.kind !== 'description' && m.quoteOf).length,
    forwarded: count('forwarded'), cc_third_party: count('cc_third_party'),
    auto_reply: inbound.filter((m) => m.kind === 'auto_reply').length, ooo_loop: count('ooo_loop'),
    bounce: noiseDrafts.filter((d) => d.noise === 'bounce').length, spam: noiseDrafts.filter((d) => d.noise === 'spam').length,
    mixed_language: count('mixed_language'), attachment_missing: inbound.filter((m) => /PFA|attach/i.test(m.core) && !m.attachments.length).length,
    escalation_tone: count('escalation_tone'), template_reply: agentReplies.filter((m) => m.template).length,
    internal_note: count('internal_note'), reopened: count('reopened'), thanks_no_reopen: count('thanks_no_reopen'),
    multi_issue: count('multi_issue'), on_behalf_of: count('on_behalf_of'),
    signature: custWritten.filter((m) => m.noise?.signature).length, disclaimer: custWritten.filter((m) => m.noise?.disclaimer).length,
    mobile_footer: custWritten.filter((m) => m.noise?.mobile).length, waiting_status: count('waiting_status'), fr_breach: count('fr_breach'),
  };
  const catalogue = Object.fromEntries((Object.keys(CATALOGUE) as Flag[]).map((f) => [f, { count: counts[f], of: N[CATALOGUE[f].of], freq: Math.round((counts[f] / N[CATALOGUE[f].of]) * 1000) / 1000, target: CATALOGUE[f].target }]));

  // ---- Contract records (the dataset) ----
  let cv = 0;
  const convId = new Map<Msg, string>();
  for (const d of all) for (const m of d.msgs) convId.set(m, String(100001 + cv++));
  const tickets: Ticket[] = custTickets.sort((a, b) => fdId.get(a.key)! - fdId.get(b.key)!).map((d) => {
    const t = d.t;
    const frBreached = (t.first_responded_at ?? Infinity) > t.fr_due_by! && END > t.fr_due_by!;
    const resolvedBy = t.resolved_at ?? Infinity;
    return {
      ...t, id: newId(d.key), follows_ticket_id: t.follows_ticket_id ? newId(t.follows_ticket_id) : null, merged_into: t.merged_into ? newId(t.merged_into) : null,
      fr_escalated: !t.merged_into && frBreached, is_escalated: !t.merged_into && (frBreached || (resolvedBy > t.due_by! && END > t.due_by!)),
    };
  });
  const conversations: Conversation[] = custTickets.flatMap((d) => d.msgs.filter((m) => m.kind !== 'auto_reply').map((m) => ({
    id: `CV-${convId.get(m)}`, ticket_id: newId(d.key), author: m.author, author_id: m.author_id, incoming: m.incoming, private: m.private, source: m.source,
    from_email: m.from, to_emails: m.to, cc_emails: m.cc, bcc_emails: [], body: m.text!, created_at: m.at, attachments: m.attachments,
  }))).sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  const dataset: Dataset = { ...w, customers, tickets, conversations, sla_policies };
  const v = validateDataset(dataset);
  if (!v.ok) throw new Error(`sim dataset invalid:\n${v.errors.slice(0, 20).join('\n')}`);

  const flags = Object.fromEntries(all.map((d) => [newId(d.key), {
    kind: d.noise ?? (d.dupOf ? 'duplicate' : 'customer'), true_customer_id: d.noise ? null : d.t.customer_id, issue_ids: d.issue_ids,
    duplicate_of: d.dupOf ? newId(d.dupOf) : null, follows_ticket_id: d.t.follows_ticket_id ? newId(d.t.follows_ticket_id) : null,
    on_behalf_of: d.t.on_behalf_of ?? null, language: d.lang, phenomena: [...d.flags].sort(),
  }]));
  const messageFlags = Object.fromEntries(all.flatMap((d) => d.msgs.map((m) => [convId.get(m)!, { kind: m.kind, ticket_id: newId(d.key), reopen: m.kind === 'reopen', paraphrased: !!m.para && !templatesOnly && m.core !== m.para.skeleton }])));
  const truth = { seed, broker: w.broker, generated_at: w.generated_at, replay_start: REPLAY_START, catalogue, tickets: flags, messages: messageFlags, dataset };
  const inbox = buildInbox({ all, fdId, convId, contacts, agents, groups, generated_at: w.generated_at });
  return { inbox, truth, stats };

  function buildInbox(x: { all: Draft[]; fdId: Map<string, number>; convId: Map<Msg, string>; contacts: Contact[]; agents: typeof agents; groups: typeof groups; generated_at: number }): Inbox {
    return {
      broker: w.broker, generated_at: x.generated_at, replay_start: REPLAY_START,
      groups: x.groups, agents: x.agents.map((a) => ({ id: a.fd, name: a.name, email: a.email, group_ids: [groupOf.get(a.team)!] })),
      contacts: x.contacts,
      tickets: x.all.map((d) => ({
        id: x.fdId.get(d.key)!, subject: d.t.subject, description_text: d.t.body, source: d.noise ? FD_SOURCE.email : FD_SOURCE[d.t.channel as keyof typeof FD_SOURCE],
        priority: FD_PRIORITY[d.t.priority], type: d.noise ? null : 'Incident', requester_id: d.requester, responder_id: d.responder, group_id: d.group,
        to_emails: [X.SUPPORT], cc_emails: d.t.cc_emails ?? [], fwd_emails: [], tags: [], spam: d.spam, headers: d.desc.headers ?? null,
        custom_fields: { cf_client_code: d.noise ? null : d.t.customer_id }, attachments: d.desc.attachments,
        fr_due_by: d.t.fr_due_by ?? null, due_by: d.t.due_by ?? null, created_at: d.t.created_at,
        status_history: (d.t.status_history ?? []).map((h) => ({ status: FD_STATUS[h.status], at: h.at })),
      })).sort((a, b) => a.id - b.id),
      conversations: x.all.flatMap((d) => d.msgs.map((m) => ({
        id: Number(x.convId.get(m)), ticket_id: x.fdId.get(d.key)!, user_id: m.author === 'agent' ? agentById.get(m.author_id!)!.fd : contacts.find((c) => c.email === m.from)?.id ?? null,
        incoming: m.incoming, private: m.private, source: m.source, support_email: m.private ? null : X.SUPPORT,
        from_email: m.from, to_emails: m.to, cc_emails: m.cc, bcc_emails: [], body_text: m.text!, attachments: m.attachments, created_at: m.at, headers: m.headers ?? null,
      }))).sort((a, b) => a.created_at - b.created_at || a.id - b.id),
    };
  }
}

export const stable = (x: unknown) => JSON.stringify(x) + '\n';

/** Generate and write sim/data/{inbox,truth}.json. */
export async function writeSim(seed = 42, opts: { templatesOnly?: boolean; offline?: boolean } = {}) {
  const { inbox, truth, stats } = await simulate(seed, opts);
  const dir = new URL('./data/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('inbox.json', dir), stable(inbox));
  writeFileSync(new URL('truth.json', dir), stable(truth));
  const d = truth.dataset;
  console.log(`sim seed ${seed}: ${d.customers.length} customers, ${d.tickets.length} customer tickets (+${inbox.tickets.length - d.tickets.length} noise), ${d.conversations!.length} conversations, ${d.agents.length} agents`);
  if (stats) console.log(`paraphrase: ${stats.cached} cached, ${stats.called} new via ${stats.calls} calls, ${stats.rejected} rejected → template; ${stats.input} in / ${stats.output} out tokens, $${stats.cost.toFixed(4)}`);
  return { inbox, truth };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ options: { seed: { type: 'string' }, 'templates-only': { type: 'boolean', default: false }, offline: { type: 'boolean', default: false } }, allowPositionals: true });
  await writeSim(Number(values.seed ?? positionals[0] ?? 42), { templatesOnly: values['templates-only'], offline: values.offline });
}
