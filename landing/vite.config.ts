import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readBench } from './bench.ts';

// bench/results.json at build time, validated, or null (the section and its nav link then stay hidden).
// LANDING_BENCH points at a dry fixture in dev only; `vite build` ignores it.
const bench = (serve: boolean): Plugin => ({
  name: 'bench-results',
  resolveId: (id) => (id === 'virtual:bench' ? '\0virtual:bench' : null),
  load(id) {
    if (id !== '\0virtual:bench') return null;
    const file = serve && process.env.LANDING_BENCH ? resolve(process.env.LANDING_BENCH) : fileURLToPath(new URL('../bench/results.json', import.meta.url));
    return `export default ${JSON.stringify(readBench(file))};`;
  },
});

export default defineConfig(({ command }) => ({ plugins: [bench(command === 'serve'), react()] }));
