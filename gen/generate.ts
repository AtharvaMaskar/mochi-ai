// Seeded world generator (SPEC §2): the planted facts. The sim renders it as a helpdesk and
// derive.ts turns the sim's truth into data/dataset.json, data/bench/dataset.json and data/eval.json.
import { validateDataset, validateEval, MISMATCH, type Dataset, type Eval, type Customer, type Ticket, type ContradictionEvent } from '@mochi/contracts';
import { rng } from './rng.ts';
import { BROKER, TEAMS, AREA_TEAM, AGENTS, CITIES, FIRST, LAST, ISSUES, SECOND_KB, WORKAROUNDS, NOISE_PRE, NOISE_POST, RELEASE_NOTES, type Area } from './catalog.ts';
import { buildEval } from './eval.ts';

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const T0 = Date.UTC(2026, 6, 20); // window start
export const END = T0 + 90 * DAY; // generated_at, 2026-10-18 00:00 UTC
export const DEMO_START = END - DAY; // demo day: the dream's real day to ingest

const iid = (i: number) => `I-${String(i + 1).padStart(2, '0')}`;
// Planted structure, by issue index. Exported so tests can check the plant, not just the output.
export const PLANT = {
  bad: { 2: [7, 10], 5: [16, 17] } as Record<number, number[]>, // release index → issues it introduced (spike)
  mild: { 1: [2], 3: [5], 6: [14] } as Record<number, number[]>, // release index → introduced, no spike
  stale: [3, 6, 12], // issues whose primary KB is stale
  workaround: [0, 15], // issues with an undocumented workaround
  demoTickets: 15,
  resolved: 280,
};
const BAD_COUNT = 22, SPIKE = 14, STALE_COUNT = 30, WA_COUNT = 28, MILD_COUNT = 15;
const OTHER_COUNTS = [18, 18, 18, 18, 17, 17];
const CHAINS = [5, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]; // 48 tickets in FOLLOWS chains

// World size. `small` is the original 400-ticket world; `sim` is the add-sim scale (the sim adds duplicates on top).
// Every planted rule is the same at both sizes; per-issue counts, chains and resolutions scale by `scale`.
export const WORLD = {
  small: { customers: 150, scale: 1, agents: 6, demoTickets: PLANT.demoTickets },
  sim: { customers: 1000, scale: 7.5, agents: 12, demoTickets: 40 },
} as const;
export type WorldSize = (typeof WORLD)[keyof typeof WORLD];

export function generate(seed = 42, size: WorldSize = WORLD.small): { dataset: Dataset; eval: Eval } {
  const r = rng(seed);
  const n = (x: number) => Math.round(x * size.scale);
  const hours = (h: number) => Math.round(h * HOUR / 1000) * 1000;
  const at = (lo: number, hi: number) => Math.floor((lo + r.next() * (hi - lo)) / 1000) * 1000;

  // Teams, areas, agents.
  const teams = TEAMS.map((name) => ({ name }));
  const product_areas = (Object.keys(AREA_TEAM) as Area[]).map((name) => ({ name, team: AREA_TEAM[name] }));
  const agents = AGENTS.slice(0, size.agents).map((a) => ({ ...a }));

  // Releases: 8, roughly every 11 days.
  const releases = RELEASE_NOTES.map((notes, k) => ({
    version: `3.${k}.0`, shipped_at: T0 + (4 + 11 * k) * DAY + r.int(9, 18) * HOUR, notes,
    introduces: [...(PLANT.bad[k] ?? []), ...(PLANT.mild[k] ?? [])].map((i) => ({ issue_id: iid(i), valid_from: 0, valid_until: null as number | null })),
  }));
  for (const rel of releases) for (const x of rel.introduces) x.valid_from = rel.shipped_at;
  const introducedBy = new Map<number, number>(); // issue → release index
  releases.forEach((rel, k) => rel.introduces.forEach((x) => introducedBy.set(Number(x.issue_id.slice(2)) - 1, k)));

  // KBs + resolutions. Primary KB per issue, seven second KBs, escalation per area, two workarounds.
  const kb_articles: Dataset['kb_articles'] = [];
  const resolutions: Dataset['resolutions'] = [];
  const primary: string[] = [], second: (string | null)[] = [], workaround: (string | null)[] = [];
  const kbTat = new Map<string, number>();
  const staleKb = new Set<string>();
  const rid = () => `R-${String(resolutions.length + 1).padStart(2, '0')}`;
  const addKb = (i: number, title: string, steps: string[], stale: boolean) => {
    const id = `KB-${String(kb_articles.length + 1).padStart(2, '0')}`;
    const rel = introducedBy.get(i);
    const updated_at = stale ? T0 - r.int(180, 400) * DAY : rel !== undefined ? releases[rel].shipped_at : T0 - r.int(10, 120) * DAY;
    const promised = stale ? 24 : r.pick([4, 8, 24, 48]);
    kb_articles.push({ id, title, area: ISSUES[i].area, updated_at, promised_tat_hours: promised, steps });
    kbTat.set(id, promised);
    if (stale) staleKb.add(id);
    return id;
  };
  ISSUES.forEach((def, i) => {
    const kb = addKb(i, def.kb.title, def.kb.steps, PLANT.stale.includes(i));
    primary[i] = rid();
    resolutions.push({ id: primary[i], kind: def.fix.kind, summary: def.fix.summary, kb_id: kb });
  });
  ISSUES.forEach((_, i) => {
    second[i] = null;
    const s = SECOND_KB[i];
    if (!s) return;
    const kb = addKb(i, s.title, s.steps, false);
    second[i] = rid();
    resolutions.push({ id: second[i]!, kind: 'info', summary: s.summary, kb_id: kb });
  });
  const escalation = new Map<string, string>();
  for (const a of product_areas) {
    escalation.set(a.name, rid());
    resolutions.push({ id: escalation.get(a.name)!, kind: 'escalation', summary: `Escalated to ${a.team} L2`, kb_id: null });
  }
  ISSUES.forEach((_, i) => {
    workaround[i] = null;
    if (!WORKAROUNDS[i]) return;
    workaround[i] = rid();
    resolutions.push({ id: workaround[i]!, kind: 'workaround', summary: WORKAROUNDS[i], kb_id: null });
  });

  // Customers: 60% retail / 30% premium / 10% HNI.
  const nc = size.customers;
  const segments = r.shuffle([...Array(nc * 0.6).fill('retail'), ...Array(nc * 0.3).fill('premium'), ...Array(nc * 0.1).fill('hni')]) as Customer['segment'][];
  const customers: Customer[] = segments.map((segment, k) => {
    const city = r.pick(CITIES);
    const language = city === 'Chennai' && r.next() < 0.6 ? 'ta' : (city === 'Pune' || city === 'Mumbai') && r.next() < 0.3 ? 'mr' : r.weighted([['en', 6], ['hi', 4]] as const);
    const joined_at = T0 - r.int(30, 900) * DAY - r.int(0, 23) * HOUR;
    const plan = segment === 'retail' && r.next() < 0.85 ? 'basic' : 'premium';
    const other = plan === 'basic' ? 'premium' : 'basic';
    const plan_history = r.next() < 0.2
      ? (() => { const ch = at(joined_at + DAY, END - 10 * DAY); return [{ plan: other, valid_from: joined_at, valid_until: ch }, { plan, valid_from: ch, valid_until: null }]; })()
      : [{ plan, valid_from: joined_at, valid_until: null }];
    return { id: `C-${String(k + 1).padStart(String(nc).length, '0')}`, name: `${r.pick(FIRST)} ${r.pick(LAST)}`, segment, city, language, joined_at, plan_history } as Customer;
  });
  const activity = customers.map((c) => [c, r.next() < 0.1 ? 5 : 1] as const);

  // Ticket times per issue (structure first).
  type Draft = { issue: number; created_at: number };
  const drafts: Draft[] = [];
  const spread = (issue: number, n: number, lo: number, hi: number) => { for (let k = 0; k < n; k++) drafts.push({ issue, created_at: at(lo, hi) }); };
  let other = 0;
  ISSUES.forEach((_, i) => {
    const rel = introducedBy.get(i);
    const ship = rel !== undefined ? releases[rel].shipped_at : T0;
    if (rel !== undefined && PLANT.bad[rel]) { spread(i, n(SPIKE), ship, ship + 7 * DAY); spread(i, n(BAD_COUNT - SPIKE), ship + 7 * DAY, DEMO_START); }
    else if (rel !== undefined) spread(i, n(MILD_COUNT), ship, DEMO_START);
    else if (PLANT.stale.includes(i)) spread(i, n(STALE_COUNT), T0, DEMO_START);
    else if (PLANT.workaround.includes(i)) spread(i, n(WA_COUNT), T0, DEMO_START);
    else spread(i, n(OTHER_COUNTS[other++]), T0, DEMO_START);
  });
  for (let k = 0; k < size.demoTickets; k++) drafts.push({ issue: r.int(0, ISSUES.length - 1), created_at: at(DEMO_START, END - HOUR) });
  drafts.sort((a, b) => a.created_at - b.created_at || a.issue - b.issue);

  const tickets: Ticket[] = drafts.map((d, k) => ({
    id: `T-${String(k + 1).padStart(4, '0')}`, customer_id: r.weighted(activity).id, subject: '', body: '',
    channel: r.weighted([['app', 5], ['email', 3], ['chat', 2]] as const), status: 'open', priority: r.weighted([['low', 2], ['medium', 4.5], ['high', 2.5], ['urgent', 1]] as const),
    created_at: d.created_at, resolved_at: null, issue_id: iid(d.issue), resolution_id: null, solved_by: null, follows_ticket_id: null,
  }));
  const issueOf = (t: Ticket) => Number(t.issue_id!.slice(2)) - 1;

  // FOLLOWS chains: same customer + issue, each linking to the previous ticket.
  const used = new Set<string>();
  for (const len of Array.from({ length: Math.ceil(size.scale) }, () => CHAINS).flat().slice(0, n(CHAINS.length))) {
    const pool = r.shuffle(ISSUES.map((_, i) => i)).map((i) => tickets.filter((t) => issueOf(t) === i && !used.has(t.id))).find((xs) => xs.length >= len)!;
    const chain = r.shuffle(pool).slice(0, len).sort((a, b) => a.created_at - b.created_at);
    chain.forEach((t, k) => { used.add(t.id); t.customer_id = chain[0].customer_id; if (k) t.follows_ticket_id = chain[k - 1].id; });
  }

  // Text: templated per issue with noise; Hindi-speaking customers write Hinglish about half the time.
  const byId = new Map(customers.map((c) => [c.id, c]));
  for (const t of tickets) {
    const def = ISSUES[issueOf(t)];
    const hinglish = byId.get(t.customer_id)!.language === 'hi' && r.next() < 0.45;
    t.subject = r.pick(def.subjects);
    t.body = hinglish ? `${def.hinglish}${r.pick(['', ' Jaldi help karo.', ' Kya ho raha hai?'])}` : `${r.pick(NOISE_PRE)}${r.pick(def.bodies)}${r.pick(NOISE_POST)}`;
    if (t.follows_ticket_id) t.body += hinglish ? ` Pehle bhi ${t.follows_ticket_id} raise kiya tha.` : ` Following up on ${t.follows_ticket_id}.`;
    if (byId.get(t.customer_id)!.segment === 'hni' && t.priority === 'low') t.priority = 'medium';
  }

  // Resolutions: demo-day tickets stay open; the last 5 days before it are backlog; the rest are drawn to hit 70%.
  const older = tickets.filter((t) => t.created_at < DEMO_START - 5 * DAY);
  const unresolvedNeeded = tickets.length - size.demoTickets - n(PLANT.resolved) - tickets.filter((t) => t.created_at >= DEMO_START - 5 * DAY && t.created_at < DEMO_START).length;
  const resolvedSet = new Set(r.shuffle(older).slice(unresolvedNeeded).map((t) => t.id));
  const expert = ISSUES.map((def) => r.pick(agents.filter((a) => a.team === AREA_TEAM[def.area])).id);
  for (const t of tickets) {
    if (!resolvedSet.has(t.id)) { t.status = t.created_at >= DEMO_START ? 'open' : r.pick(['open', 'pending']); continue; }
    const i = issueOf(t), area = ISSUES[i].area;
    const choice = workaround[i]
      ? r.weighted([[workaround[i]!, 75], [primary[i], 15], [escalation.get(area)!, 10]] as const)
      : r.weighted([[primary[i], 75], ...(second[i] ? [[second[i]!, 15] as const] : []), [escalation.get(area)!, 10]] as const);
    const kb = resolutions.find((x) => x.id === choice)!.kb_id;
    const tat = kb ? kbTat.get(kb)! * (staleKb.has(kb) ? 2.6 + r.next() * 0.8 : 0.3 + r.next() * 0.65)
      : choice === workaround[i] ? 1 + r.next() * 5 : 48 + r.next() * 72;
    t.resolution_id = choice;
    t.resolved_at = t.created_at + hours(tat);
    t.status = t.resolved_at < DEMO_START - 7 * DAY && r.next() < 0.5 ? 'closed' : 'resolved';
    t.solved_by = r.weighted(agents.map((a) => [a.id, a.id === expert[i] ? 5 : a.team === AREA_TEAM[area] ? 2 : 0.5] as const));
  }

  const issues = ISSUES.map((def, i) => ({
    id: iid(i), name: def.name, area: def.area,
    first_seen: Math.min(...tickets.filter((t) => issueOf(t) === i).map((t) => t.created_at)),
  }));

  // Contradiction events: all on demo day, none pre-applied.
  const demoCustomers = [...new Set(tickets.filter((t) => t.created_at >= DEMO_START).map((t) => t.customer_id))];
  const planCustomers = [...demoCustomers, ...r.shuffle(customers.map((c) => c.id))].filter((v, k, xs) => xs.indexOf(v) === k).slice(0, 6);
  const fixed = r.shuffle([...introducedBy.keys()].sort((a, b) => a - b)).slice(0, 4);
  const kinds = r.shuffle([...planCustomers.map((c) => ({ c })), ...fixed.map((i) => ({ i }))]);
  const contradiction_events: ContradictionEvent[] = kinds.map((x, k) => {
    const id = `E-${String(k + 1).padStart(2, '0')}`, when = DEMO_START + (k + 1) * 2 * HOUR + r.int(0, 59) * 60_000;
    if ('i' in x) return { id, at: when, kind: 'issue_fixed', issue_id: iid(x.i), fixed_in: releases[releases.length - 1].version };
    const live = byId.get(x.c)!.plan_history.at(-1)!.plan;
    return { id, at: when, kind: 'plan_change', customer_id: x.c, from: live, to: live === 'basic' ? 'premium' : 'basic' };
  });

  const dataset: Dataset = {
    seed, generated_at: END, broker: BROKER, customers, tickets, issues, product_areas, teams, agents,
    resolutions, kb_articles, releases, plans: [{ name: 'basic' }, { name: 'premium' }], contradiction_events,
  };
  const dv = validateDataset(dataset);
  if (!dv.ok) throw new Error(`generated dataset invalid:\n${dv.errors.join('\n')}`);
  const ev = buildEval(dataset, seed);
  const evv = validateEval(ev, dataset);
  if (!evv.ok) throw new Error(`generated eval invalid:\n${evv.errors.join('\n')}`);
  // Planted mismatches must clear the contract thresholds with margin (design decision 10).
  for (const m of ev.planted_mismatches) {
    if (m.ticket_ids.length < 2 * MISMATCH.MIN_SUPPORT) throw new Error(`${m.id}: support ${m.ticket_ids.length} < ${2 * MISMATCH.MIN_SUPPORT}`);
    if (m.kind === 'contradicts' && m.measured! < 2 * m.promised!) throw new Error(`${m.id}: measured ${m.measured} < 2× promised ${m.promised}`);
  }
  return { dataset, eval: ev };
}

export const stable = (x: unknown) => JSON.stringify(x, null, 2) + '\n';
