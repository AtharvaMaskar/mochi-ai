import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStory, newStoryId, type Story } from './story.ts';

const q = (columns: string[], extra = '') => ({
  cypher: `MATCH (t:Ticket) WHERE t.created_at <= $as_of ${extra} RETURN 1`, graph: 'mochi_company',
  params: {}, columns, rows: [], ran_at: 1,
});
const story = (body: string, queries: Story['queries'] = {
  q_1: q(['median_h']), q_2: q(['cluster', 'tickets', 'trend']), q_3: q(['change', 'fact']),
}): Story => ({ id: newStoryId(), version: 1, title: 'T', generated_at: 1, generated_by: 'dream', topic: 't', queries, body });
const errs = (r: ReturnType<typeof parseStory>) => (r.ok ? [] : r.errors);

test('segments keep order, nest grids, parse JSON attributes and inline nums', () => {
  const r = parseStory(story(`Median is <num query_id="q_1" column="median_h">7.2</num>h.
<kpi query_id="q_1" label="Median resolution" column="median_h" unit="h" promised="4" bad="true"/>
<grid widths="2,1"><bars query_id="q_2" label="A" x="cluster" y="tickets" trend="trend"/><bars query_id="q_2" label="B" x="cluster" y="tickets"/></grid>
<suggestion query_id="q_3" tag="Docs disagree" edge="CONTRADICTS" actions='["dismiss"]'>Fix KB-12, seen <num query_id="q_2" column="tickets">40</num> times.</suggestion>`));
  assert.ok(r.ok, errs(r).join('\n'));
  assert.deepEqual(r.segments.map((s) => s.type), ['markdown', 'kpi', 'grid', 'suggestion']);
  const [md, kpi, grid, sugg] = r.segments as any[];
  assert.deepEqual(md.nums, [{ query_id: 'q_1', column: 'median_h', value: '7.2' }]);
  assert.match(md.text, /<num query_id="q_1" column="median_h">7\.2<\/num>/);
  assert.equal(kpi.promised, 4); assert.equal(kpi.bad, true);
  assert.deepEqual(grid.widths, [2, 1]);
  assert.deepEqual(grid.children.map((c: any) => c.label), ['A', 'B']);
  assert.deepEqual(sugg.actions, ['dismiss']);
  assert.equal(sugg.nums[0].value, '40');
});

test('missing query_id is rejected', () => {
  assert.match(errs(parseStory(story('<kpi label="x" column="median_h"/>'))).join(), /missing query_id/);
});

test('unknown query id is rejected', () => {
  assert.match(errs(parseStory(story('<num query_id="q_9" column="n">4</num>'))).join(), /unknown query_id q_9/);
});

test('missing column is rejected', () => {
  const r = parseStory(story('<bars query_id="q_1" label="x" x="cluster" y="tickets"/>', { q_1: q(['cluster', 'count']) }));
  assert.match(errs(r).join(), /no column tickets/);
});

test('more than 6 visual tags is rejected', () => {
  const body = Array.from({ length: 7 }, () => '<kpi query_id="q_1" label="x" column="median_h"/>').join('\n');
  assert.match(errs(parseStory(story(body))).join(), /7 visual tags/);
});

test('unknown tag becomes a note, rest still parses', () => {
  const r = parseStory(story('Hello <pie query_id="q_1"/> <kpi query_id="q_1" label="x" column="median_h"/>'));
  assert.ok(r.ok, errs(r).join());
  assert.deepEqual(r.segments.map((s) => s.type), ['markdown', 'note', 'kpi']);
});

test('bad JSON attribute is rejected', () => {
  assert.match(errs(parseStory(story(`<table query_id="q_2" label="x" columns='cluster'/>`))).join(), /JSON array/);
});

test('stored query without $as_of is rejected', () => {
  const r = parseStory(story('Plain.', { q_1: { ...q(['n']), cypher: 'MATCH (t:Ticket) RETURN count(t) AS n' } }));
  assert.match(errs(r).join(), /q_1: stored query must take \$as_of/);
});

test('story ids are random and unguessable', () => {
  assert.notEqual(newStoryId(), newStoryId());
  assert.match(errs(parseStory({ ...story('x'), id: 'abc' })).join(), /unguessable/);
});
