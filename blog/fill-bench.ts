// Injects bench/results.json into the blog's BENCH block: `node blog/fill-bench.ts [results.json]`.
// Refuses (exit 1, page untouched) on invalid results or a leftover TODO/placeholder marker.
// A results file that passes validateResults has a non-null run_at, so the block can't stay unfilled.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateResults } from '../contracts/results.ts';

const BLOCK = /(<script type="application\/json" id="bench">)([\s\S]*?)(<\/script>)/;
const MARKERS = /TODO|PLACEHOLDER|class="todo"/;

export function fill(html: string, json: string): { ok: true; html: string } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!BLOCK.test(html)) errors.push('page: no <script type="application/json" id="bench"> block');
  try {
    const v = validateResults(JSON.parse(json));
    if (!v.ok) errors.push(...v.errors.map((e) => `results: ${e}`));
  } catch (e) {
    errors.push(`results: not JSON (${(e as Error).message})`);
  }
  // Raw text keeps BENCH byte-identical to results.json; only "</" is escaped so the script tag can't close early.
  const out = html.replace(BLOCK, (_m, open: string, _old: string, close: string) => open + json.trim().replaceAll('</', '<\\/') + close);
  const marker = out.replace(BLOCK, '').match(MARKERS);
  if (marker) errors.push(`page: marker "${marker[0]}" remains`);
  return errors.length ? { ok: false, errors } : { ok: true, html: out };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const page = fileURLToPath(new URL('../mochi-brain-blog.html', import.meta.url));
  const results = process.argv[2] ?? fileURLToPath(new URL('../bench/results.json', import.meta.url));
  const r = fill(readFileSync(page, 'utf8'), readFileSync(results, 'utf8'));
  if (!r.ok) {
    console.error(`fill-bench: refused, page unchanged\n  ${r.errors.join('\n  ')}`);
    process.exit(1);
  }
  writeFileSync(page, r.html);
  console.log(`fill-bench: BENCH filled from ${results}`);
}
