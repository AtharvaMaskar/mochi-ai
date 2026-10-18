import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDataset, validateEval, MISMATCH } from '@mochi/contracts';
import { generate, stable, PLANT, DEMO_START, END, DAY, HOUR, T0 } from './generate.ts';
import { rng } from './rng.ts';

const { dataset: d, eval: ev } = generate(42);
const iid = (i: number) => `I-${String(i + 1).padStart(2, '0')}`;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

test('rng is repeatable', () => {
  const a = rng(7), b = rng(7);
  assert.deepEqual([a.next(), a.int(1, 6), a.pick(['x', 'y', 'z']), a.shuffle([1, 2, 3, 4])], [b.next(), b.int(1, 6), b.pick(['x', 'y', 'z']), b.shuffle([1, 2, 3, 4])]);
  assert.notEqual(rng(7).next(), rng(8).next());
});

test('deterministic: two runs give identical bytes', () => {
  const again = generate(42);
  assert.equal(stable(again.dataset), stable(d));
  assert.equal(stable(again.eval), stable(ev));
});

test('committed data/*.json equals fresh output for seed 42', () => {
  assert.equal(readFileSync(new URL('../data/dataset.json', import.meta.url), 'utf8'), stable(d));
  assert.equal(readFileSync(new URL('../data/eval.json', import.meta.url), 'utf8'), stable(ev));
});

test('contract-valid with exact SPEC counts', () => {
  assert.ok(validateDataset(d).ok);
  assert.ok(validateEval(ev, d).ok);
  assert.equal(d.broker, 'E Corp Securities');
  const seg = (s: string) => d.customers.filter((c) => c.segment === s).length;
  assert.deepEqual([d.customers.length, seg('retail'), seg('premium'), seg('hni')], [150, 90, 45, 15]);
  assert.equal(new Set(d.customers.map((c) => c.city)).size, 8);
  assert.deepEqual([...new Set(d.customers.map((c) => c.language))].sort(), ['en', 'hi', 'mr', 'ta']);
  assert.equal(d.tickets.length, 400);
  assert.ok(d.tickets.every((t) => t.created_at >= T0 && t.created_at < END));
  assert.equal(d.issues.length, 18);
  assert.equal(new Set(d.issues.map((i) => i.area)).size, 6);
  assert.deepEqual([d.teams.length, d.agents.length, d.kb_articles.length, d.releases.length, d.plans.length, d.contradiction_events.length], [4, 6, 25, 8, 2, 10]);
  assert.equal(d.tickets.filter((t) => t.resolution_id).length, 280); // 70%
  const chained = new Set(d.tickets.flatMap((t) => (t.follows_ticket_id ? [t.id, t.follows_ticket_id] : [])));
  assert.equal(chained.size, 48); // 12%
  for (const t of d.tickets.filter((t) => t.follows_ticket_id)) {
    const p = d.tickets.find((x) => x.id === t.follows_ticket_id)!;
    assert.ok(p.customer_id === t.customer_id && p.issue_id === t.issue_id && p.created_at < t.created_at, t.id);
  }
  const res = new Map(d.resolutions.map((r) => [r.id, r]));
  for (const r of d.resolutions) if (r.kind === 'fix' || r.kind === 'info') assert.ok(r.kb_id, r.id);
  const hinglish = d.tickets.filter((t) => /nahi|kar|ho gaya|hai/.test(t.body)).length;
  assert.ok(hinglish >= 30 && hinglish <= 100, `hinglish ${hinglish}`);
  assert.ok(d.tickets.filter((t) => t.resolution_id).every((t) => res.has(t.resolution_id!) && t.resolved_at! < END));
});

test('eval: 50 questions in the right buckets, 10 after events, 5 mismatches', () => {
  const b = (x: string) => ev.questions.filter((q) => q.bucket === x).length;
  assert.deepEqual([ev.questions.length, b('single_fact'), b('multi_hop'), b('structural')], [50, 20, 20, 10]);
  assert.ok(ev.questions.every((q) => q.scoring === (q.bucket === 'single_fact' ? 'exact' : 'judge')));
  assert.deepEqual(ev.questions.flatMap((q) => q.after_event ?? []).sort(), d.contradiction_events.map((e) => e.id).sort());
  const kinds = ev.planted_mismatches.map((m) => m.kind).sort();
  assert.deepEqual(kinds, ['contradicts', 'contradicts', 'contradicts', 'undocumented', 'undocumented']);
});

test('bad releases spike at least 3x the week after shipping', () => {
  for (const k of Object.keys(PLANT.bad).map(Number)) {
    const rel = d.releases[k];
    assert.ok(rel.introduces.length >= 1 && rel.introduces.length <= 2);
    const ids = new Set(rel.introduces.map((x) => x.issue_id));
    const count = (from: number) => d.tickets.filter((t) => ids.has(t.issue_id!) && t.created_at >= from && t.created_at < from + 7 * DAY).length;
    const before = count(rel.shipped_at - 7 * DAY), after = count(rel.shipped_at);
    assert.ok(after >= 3 * before && after >= 10, `${rel.version}: ${before} -> ${after}`);
  }
});

test('stale KBs: measured median at least 2x promised, support at least 2x MIN_SUPPORT', () => {
  const kbOf = new Map(d.resolutions.map((r) => [r.id, r.kb_id]));
  const stale = PLANT.stale.map((i) => d.resolutions[i].kb_id!); // primary resolutions come first, in issue order
  assert.deepEqual(ev.planted_mismatches.filter((m) => m.kind === 'contradicts').map((m) => m.kb_id), stale);
  for (const id of stale) {
    const kb = d.kb_articles.find((k) => k.id === id)!;
    const ts = d.tickets.filter((t) => t.resolution_id && kbOf.get(t.resolution_id) === id);
    assert.ok(ts.length >= 2 * MISMATCH.MIN_SUPPORT, `${id} support ${ts.length}`);
    assert.ok(median(ts.map((t) => (t.resolved_at! - t.created_at) / HOUR)) >= 2 * kb.promised_tat_hours!, id);
  }
  const m = ev.planted_mismatches[0];
  assert.ok(m.measured! > m.promised! * (1 + MISMATCH.TAT_TOLERANCE));
});

test('each workaround on at least 2x MIN_SUPPORT tickets with no KB', () => {
  const wa = d.resolutions.filter((r) => r.kind === 'workaround');
  assert.equal(wa.length, 2);
  for (const r of wa) {
    assert.equal(r.kb_id, null);
    assert.ok(d.tickets.filter((t) => t.resolution_id === r.id).length >= 2 * MISMATCH.MIN_SUPPORT, r.id);
  }
  assert.deepEqual(ev.planted_mismatches.filter((m) => m.kind === 'undocumented').map((m) => m.area).sort(), PLANT.workaround.map((i) => d.issues[i].area).sort());
});

test('events are not pre-applied and match the live state', () => {
  const kinds = d.contradiction_events.map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === 'plan_change').length, 6);
  assert.equal(kinds.filter((k) => k === 'issue_fixed').length, 4);
  for (const e of d.contradiction_events) {
    if (e.kind === 'issue_fixed') {
      const live = d.releases.flatMap((r) => r.introduces).filter((x) => x.issue_id === e.issue_id && x.valid_until === null);
      assert.equal(live.length, 1, e.id);
    } else {
      const c = d.customers.find((c) => c.id === e.customer_id)!;
      assert.equal(c.plan_history.find((p) => p.valid_until === null)!.plan, e.from, e.id);
      assert.notEqual(e.from, e.to);
    }
  }
});

test('demo day: 12-18 tickets and every event inside the final 24h', () => {
  const demo = d.tickets.filter((t) => t.created_at >= DEMO_START);
  assert.ok(demo.length >= 12 && demo.length <= 18, `${demo.length}`);
  assert.equal(d.generated_at, END);
  assert.ok(d.contradiction_events.every((e) => e.at >= DEMO_START && e.at < END));
});

test('introduced issues reference planted releases', () => {
  const intro = d.releases.flatMap((r) => r.introduces.map((x) => x.issue_id)).sort();
  const planted = [...Object.values(PLANT.bad), ...Object.values(PLANT.mild)].flat().map(iid).sort();
  assert.deepEqual(intro, planted);
});
