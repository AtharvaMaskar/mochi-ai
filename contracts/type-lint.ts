// Type uniformity check: component code may only use the type scale from mochi.css.
// Usage: node contracts/type-lint.ts <dir|file>...   (exit 1 on findings; e.g. ui/src landing/src mochi-brain-blog.html)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RULES: [RegExp, string][] = [
  [/font-size\s*:(?!\s*(?:var\(--fs-|inherit|1em\b|100%))/i, 'literal font-size (use var(--fs-*) or a .t-* class)'],
  [/fontSize\s*:\s*['"]?\d/, 'literal fontSize in a style object'],
  [/font-family\s*:(?!\s*(?:var\(--(?:font|ff)-|inherit))/i, 'literal font-family (use var(--font-*) / var(--ff-*))'],
  [/font-weight\s*:\s*\d/i, 'literal font-weight (use var(--fw-*))'],
];
// Instrument Serif is only for the word "mochi" (wordmark) and Mochi's mood word.
const SERIF = /var\(--(?:font-serif|ff-mochi-)/;
const SERIF_OK = /wordmark|mochi-mood|MochiMood|-mood\b/i;

export function lintSource(src: string, file = ''): string[] {
  const out: string[] = [];
  src.split('\n').forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    for (const [re, why] of RULES) if (re.test(line)) out.push(`${at} ${why}: ${line.trim().slice(0, 100)}`);
    if (SERIF.test(line) && !SERIF_OK.test(line)) out.push(`${at} serif outside the mochi wordmark/mood: ${line.trim().slice(0, 100)}`);
  });
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(css|tsx|ts)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

if (import.meta.main) {
  const findings = process.argv.slice(2).flatMap((d) => (statSync(d).isFile() ? [d] : walk(d)).flatMap((f) => lintSource(readFileSync(f, 'utf8'), f)));
  for (const f of findings) console.error(f);
  if (findings.length) { console.error(`type-lint: ${findings.length} finding(s)`); process.exit(1); }
}
