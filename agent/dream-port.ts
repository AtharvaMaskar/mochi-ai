// The only way agent-core reaches agent/dream/ (owned by the add-dream change). The specifier is a variable, so tsc
// never resolves it and the agent builds and runs without the dream installed.
import type { AnyTask } from '@earendil-works/pi-durable';

export type DreamModule = {
  DreamTask?: AnyTask;
  useDb?(f: () => Promise<unknown>): void;
  runDreamNow(args: Record<string, unknown>): Promise<Record<string, unknown>>;
};

export async function loadDream(spec = './dream/index.ts'): Promise<DreamModule | null> {
  const url = new URL(spec, import.meta.url).href;
  try {
    return (await import(url)) as DreamModule;
  } catch (e) {
    const err = e as { code?: string; message?: string; url?: string };
    // Only the dream module itself missing means "not installed"; a broken dependency inside it must surface.
    if (err.code === 'ERR_MODULE_NOT_FOUND' && (err.url === url || err.message?.includes(url))) return null;
    throw e;
  }
}

export const DREAM_NOT_INSTALLED = 'dream not installed';
