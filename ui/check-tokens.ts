// Tokens only (ui-components spec): no colour literals in ui/src. mochi.css is the only place colours live.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/i;
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const bad = walk(join(import.meta.dirname, 'src')).flatMap((f) => readFileSync(f, 'utf8').split('\n')
  .flatMap((line, i) => (LITERAL.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : [])));
if (bad.length) { console.error('Colour literals in ui/src (use mochi.css tokens):\n' + bad.join('\n')); process.exit(1); }
console.log('tokens: no colour literals in ui/src');
