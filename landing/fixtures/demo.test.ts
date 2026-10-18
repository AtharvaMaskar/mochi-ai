// Every landing fixture must pass the same contract validators the product uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCard, parseStory, checkCypherNames, validateResults } from '@mochi/contracts';
import { readBench } from '../bench.ts';

const demo = JSON.parse(readFileSync(new URL('./demo.json', import.meta.url), 'utf8'));
const cards: [string, unknown][] = [
  ...Object.entries(demo.hero.briefs).map(([id, b]: [string, any]) => [`brief ${id}`, b.card] as [string, unknown]),
  ...demo.asks.map((a: any) => [`ask ${a.id}`, a.card] as [string, unknown]),
];

for (const [name, card] of cards) test(`${name} passes validateCard`, () => {
  const r = validateCard(card);
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'));
});

test('morning report passes parseStory', () => {
  const r = parseStory(demo.night.report);
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'));
});

test('every stored Cypher uses contract labels and edges only', () => {
  const all = [...cards.map(([, c]: any) => c.queries), demo.night.report.queries, { asof: demo.asof.query, cluster: demo.night.cluster, hours: demo.awake.hours, off: demo.awake.offHours }]
    .flatMap((qs) => Object.entries(qs) as [string, any][]);
  for (const [id, q] of all) assert.deepEqual(checkCypherNames(q.cypher), [], id);
});

test('the dream changed the as-of figure', () => {
  assert.ok(demo.asof.before > demo.asof.after);
});

test('benchmark gate: absent or invalid results render nothing', () => {
  assert.equal(readBench(new URL('./missing-results.json', import.meta.url)), null);
  assert.equal(validateResults({}).ok, false);
});
