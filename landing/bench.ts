// Build-time gate for the benchmark section (SPEC §3): bench/results.json or nothing. Never placeholder numbers.
import { existsSync, readFileSync } from 'node:fs';
import { validateResults, type Results } from '@mochi/contracts';

export function readBench(file: URL | string): Results | null {
  if (!existsSync(file)) return null;
  const r = validateResults(JSON.parse(readFileSync(file, 'utf8')));
  if (!r.ok) { console.warn(`[landing] ${String(file)} fails validateResults; benchmark section hidden:\n  ${r.errors.join('\n  ')}`); return null; }
  return r.value;
}
