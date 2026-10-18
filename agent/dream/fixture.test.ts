import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './__test__/fixture.ts';

test('fixture helper loads tinyDataset plus planted rows into a throwaway graph', async () => {
  const f = await fixture('smoke');
  try {
    const byLabel = await f.rows<{ l: string; n: number }>('MATCH (n) RETURN labels(n)[0] AS l, count(n) AS n ORDER BY l');
    const n = Object.fromEntries(byLabel.map((r) => [r.l, r.n]));
    assert.equal(n.Ticket, 2 + 6 + 5 + 2);
    assert.equal(n.Customer, 1);
    assert.equal(n.ProductArea, 3);
    const [{ pending }] = await f.rows('MATCH (t:Ticket) WHERE t.ingested_at IS NULL RETURN count(t) AS pending');
    assert.equal(pending, 2);
    const [{ plan }] = await f.rows('MATCH (:Customer {id:"C-1"})-[e:ON_PLAN]->(p:Plan) WHERE e.valid_from <= $as_of AND e.valid_until > $as_of RETURN p.name AS plan', { as_of: Date.now() });
    assert.equal(plan, 'basic');
  } finally { await f.cleanup(); }
});
