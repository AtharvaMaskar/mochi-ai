// Build-time gate for the benchmark section (SPEC §3): bench/results.json or nothing. Never placeholder numbers.
import { existsSync, readFileSync } from 'node:fs';
import { validateResults, type Results } from '@mochi/contracts';

export function readBench(file: URL | string): Results | null {
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const r = validateResults(raw);
  if (!r.ok) { console.warn(`[landing] ${String(file)} fails validateResults; benchmark section hidden:\n  ${r.errors.join('\n  ')}`); return null; }
  // decision_traces is outside the contract (zod strips it); the Learning tab reads its approaches as-is.
  return { ...r.value, decision_traces: raw.decision_traces } as Results;
}
