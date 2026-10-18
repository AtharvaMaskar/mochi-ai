// Tokens only: no colour literals in landing/src. Colours live in mochi.css.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RULES: [string, RegExp][] = [['colour literal', /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/i]]; // type is checked by contracts/type-lint.ts
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const bad = walk(join(import.meta.dirname, 'src')).flatMap((f) =>
  readFileSync(f, 'utf8').split('\n').flatMap((line, i) => RULES.filter(([, re]) => re.test(line)).map(([name]) => `${f}:${i + 1}: ${name}: ${line.trim()}`)));
if (bad.length) { console.error('Use mochi.css tokens and .t-* classes:\n' + bad.join('\n')); process.exit(1); }
console.log('tokens: no colour literals in landing/src');
