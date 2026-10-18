// Production entry: agent/server.ts's own startup, with the static sites in front of its API handler.
// Interim until wire-ui adds `if (serveStatic(req, res)) return;` to agent/server.ts; then `npm start` runs
// agent/server.ts and this file is deleted.
import type { RequestListener } from 'node:http';
import { loadDream } from '../agent/dream-port.ts';
import { openHarness } from '../agent/harness.ts';
import { startServer } from '../agent/server.ts';
import { serveStatic } from './static.ts';

const dream = await loadDream();
const pi = await openHarness({ dream });
const s = await startServer(pi, { port: Number(process.env.PORT ?? 4000), dream });
const [api] = s.server.listeners('request') as RequestListener[];
s.server.removeAllListeners('request');
s.server.on('request', (req, res) => { if (!serveStatic(req, res)) api(req, res); });
console.error(`[mochi] http://localhost:${s.port}/ · /app · /blog · /api · dream ${dream ? 'installed' : 'not installed'}`);
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.once(sig, async () => { await s.close(); await pi.close(); process.exit(0); });
