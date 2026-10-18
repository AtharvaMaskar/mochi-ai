// Integration sweep: every Cypher literal in agent/ and bench/ uses only contract labels and edge types.
// Scans source text, so inline queries (harness tools) are covered as well as the named constants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCypherNames } from '@mochi/contracts';

const ROOT = new URL('..', import.meta.url).pathname;
const CYPHER = /\b(MATCH|MERGE|CREATE|UNWIND|CALL)\b/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name === 'node_modules' || e.name.startsWith('.') ? [] : e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []);
}

test('checkCypherNames finds zero drift in agent/ and bench/', () => {
  const drift: string[] = [];
  let scanned = 0;
  for (const f of [...files(join(ROOT, 'agent')), ...files(join(ROOT, 'bench'))]) {
    if (f.endsWith('.test.ts') || f.includes('__test__')) continue; // test fixtures plant bad names on purpose
    for (const m of readFileSync(f, 'utf8').matchAll(/`([^`]*)`/g)) {
      if (!CYPHER.test(m[1])) continue;
      scanned++;
      // ${…} interpolations become a contract label (interpolated labels come from VECTOR_LABELS, checked in deps.test.ts).
      const bad = checkCypherNames(m[1].replace(/(\[\w*:)\$\{[^}]*\}/g, '$1ABOUT').replace(/\$\{[^}]*\}/g, 'Ticket')); // edge-position interpolations become a contract edge
      if (bad.length) drift.push(`${f.slice(ROOT.length)}: ${bad.join(', ')}`);
    }
  }
  assert.ok(scanned > 50, `scanned ${scanned} Cypher literals`);
  assert.deepEqual(drift, []);
});
