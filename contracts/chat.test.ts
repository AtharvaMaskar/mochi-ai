import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCard, type ToolCard } from './chat.ts';

const q = (columns: string[]) => ({
  cypher: 'MATCH (c:Customer)-[r:ON_PLAN]->(p) WHERE r.valid_from <= $as_of AND r.valid_until > $as_of RETURN c', graph: 'mochi_company',
  params: { id: 'C-1' }, columns, rows: [], ran_at: 1,
});
const briefing = (): ToolCard => ({
  kind: 'briefing', title: 'Meera Iyer · T-2',
  queries: { q_1: q(['name', 'segment', 'plan']), q_2: q(['ticket', 'resolution', 'kb']) },
  path: {
    query_id: 'q_2',
    nodes: [{ id: 'T-2', label: 'Ticket', name: 'Still not placed' }, { id: 'I-1', label: 'Issue', name: 'order not placed' }, { id: 'T-1', label: 'Ticket', name: 'Order not placed' }],
    edges: [{ type: 'ABOUT', from: 'T-2', to: 'I-1' }, { type: 'ABOUT', from: 'T-1', to: 'I-1' }],
  },
  blocks: [
    { type: 'table', query_id: 'q_1', label: 'Customer', columns: ['name', 'segment', 'plan'] },
    { type: 'table', query_id: 'q_2', label: 'What fixed similar tickets', columns: ['ticket', 'resolution', 'kb'] },
  ],
});
const errs = (c: unknown) => { const r = validateCard(c); return r.ok ? [] : r.errors; };

test('valid briefing card passes', () => assert.deepEqual(errs(briefing()), []));

test('block with a missing column fails naming it', () => {
  const c = briefing();
  c.blocks[0] = { type: 'table', query_id: 'q_1', label: 'Customer', columns: ['name', 'city'] };
  assert.match(errs(c).join(), /q_1 has no column city/);
});

test('unknown path edge type fails', () => {
  const c = briefing();
  c.path!.edges[0].type = 'CAUSED';
  assert.match(errs(c).join(), /unknown edge type CAUSED/);
});

test('dangling path endpoint fails', () => {
  const c = briefing();
  c.path!.edges[1].to = 'I-9';
  assert.match(errs(c).join(), /endpoint I-9/);
});

test('query without $as_of fails', () => {
  const c = briefing();
  c.queries.q_1 = { ...c.queries.q_1, cypher: 'MATCH (c:Customer) RETURN c' };
  assert.match(errs(c).join(), /q_1: stored query must take \$as_of/);
});
