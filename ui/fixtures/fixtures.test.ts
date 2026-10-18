// Every ui fixture passes the contract validators, so the screens render only contract-valid data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStory, validateCard, validateSandboxHtml, type Segment, type StoredQuery } from '@mochi/contracts';
import { morningReport, morningReportV1, brokenStory, chatStory, chatTranscript, tickets, briefingCard, dreamRun,
  sandboxPass, sandboxReject, sandboxQueriesFixture } from './index.ts';

const errs = (r: { ok: boolean; errors?: string[] }) => (r.ok ? '' : (r.errors ?? []).join('\n'));

// ui-level drift: every <num> value must be one of its column's stored values.
function numDrift(segs: Segment[], queries: Record<string, StoredQuery>): string[] {
  return segs.flatMap((s) => {
    if (s.type === 'grid') return numDrift(s.children, queries);
    const nums = s.type === 'markdown' || s.type === 'suggestion' ? s.nums : [];
    return nums.filter((n) => !queries[n.query_id].rows.some((r) => String(r[n.column]) === n.value))
      .map((n) => `<num ${n.query_id}.${n.column}> shows ${n.value}, not in the stored rows`);
  });
}

for (const story of [morningReport, morningReportV1, chatStory]) {
  test(`story ${story.id}@${story.version} parses and its numbers match their rows`, () => {
    const r = parseStory(story);
    assert.ok(r.ok, errs(r));
    assert.deepEqual(numDrift(r.segments, story.queries), []);
  });
}

test('the broken story is rejected with its reasons', () => {
  const r = parseStory(brokenStory);
  assert.ok(!r.ok);
  assert.match(errs(r), /has no column tickets_total/);
  assert.match(errs(r), /unknown query_id q_9/);
});

test('briefing and chat cards are valid', () => {
  const cards = [briefingCard, ...tickets.flatMap((t) => (t.briefing ? [t.briefing] : [])),
    ...chatTranscript.flatMap((m) => (m.role === 'assistant' ? m.cards ?? [] : []))];
  for (const c of cards) { const r = validateCard(c); assert.ok(r.ok, errs(r)); }
});

test('sandbox fixtures: the pass fragment passes, the reject fragment says why', () => {
  const ok = validateSandboxHtml(sandboxPass, sandboxQueriesFixture);
  assert.ok(ok.ok, errs(ok));
  for (const m of chatTranscript) if (m.role === 'assistant' && m.html) {
    const r = validateSandboxHtml(m.html.value, m.html.queries); assert.ok(r.ok, errs(r));
  }
  const bad = validateSandboxHtml(sandboxReject, {});
  assert.ok(!bad.ok);
  assert.match(errs(bad), /literal colour "#ff0000"/);
});

test('dream-run queries take $as_of', () => {
  for (const q of Object.values(dreamRun)) assert.match(q.cypher, /\$as_of/);
});
