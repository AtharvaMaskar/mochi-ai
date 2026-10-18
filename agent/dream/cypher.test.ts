import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCypherNames } from '@mochi/contracts';
import { Q, R } from './cypher.ts';

test('every dream query uses only contract labels and edge types', () => {
  for (const [name, cypher] of Object.entries({ ...Q, ...R })) assert.deepEqual(checkCypherNames(cypher), [], name);
});

test('every morning-report query takes $as_of', () => {
  for (const [name, cypher] of Object.entries(R)) assert.match(cypher, /\$as_of/, name);
});
