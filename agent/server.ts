// One process, one harness (it owns the Pi SQLite): the CopilotKit runtime at /api/copilotkit, the story API, the
// dream trigger and the live-story WebSocket, all on one node:http server. `npm run dev`.
process.env.COPILOTKIT_TELEMETRY_DISABLED = 'true';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { CopilotRuntime } from '@copilotkit/runtime/v2';
import { createCopilotNodeListener } from '@copilotkit/runtime/v2/node';
import { WebSocketServer, type WebSocket } from 'ws';
import { GRAPH, type Story } from '@mochi/contracts';
import { PiDurableAgent, PiRunner } from './agui.ts';
import { DREAM_NOT_INSTALLED, loadDream, type DreamModule } from './dream-port.ts';
import { openHarness, type Pi } from './harness.ts';
import { commitStory, getStory, parseStoryRef, rerender } from './stories.ts';
import { StoryDoc } from './story-doc.ts';
import { json, routeApi } from './api/index.ts';
import { dreamState, streamDream } from './api/overview.ts';
import { isAdmin, ipOf, overLimit, visitor, visitorId } from './api/visitor.ts';
import { serveStatic } from '../deploy/static.ts';

/** Runtime options. Hard rule: openGenerativeUI is never set; ACTIVITY.card / ACTIVITY.html are the only rich UI. */
export const runtimeOptions = (pi: Pi) => ({
  agents: { mochi: new PiDurableAgent(pi, { agentId: 'mochi' }) },
  runner: new PiRunner(pi),
});

/** Run the dream now through the port; its morning report lands in StoryDoc through `commitStory`. */
export async function runDream(pi: Pi, dream: DreamModule, as_of?: number, onStep?: (name: string) => void) {
  const model = pi.models.getModel(pi.model.provider as never, pi.model.modelId);
  if (!model) throw new Error(`unknown model ${pi.model.provider}/${pi.model.modelId}`);
  // A harness on another graph (tests) dreams there, with its own snapshot/scratch graphs and no team graphs.
  const graphs = pi.graph === GRAPH.company ? undefined : { company: pi.graph, prev: `${pi.graph}_prev`, scratch: `${pi.graph}_scratch`, teams: [] };
  return dream.runDreamNow({
    db: await pi.writer(), as_of, graphs, model: { models: pi.models, model }, onStep,
    commitStory: (story: Parameters<typeof commitStory>[1]) => commitStory(pi.harness, story),
  });
}

export async function startServer(pi: Pi, opts: { port?: number; dream?: DreamModule | null } = {}) {
  const dream = opts.dream ?? null;
  const copilot = createCopilotNodeListener({
    runtime: new CopilotRuntime(runtimeOptions(pi)),
    basePath: '/api/copilotkit',
    cors: { origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], credentials: true },
  });

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/copilotkit')) {
      // Every chat run spends the model key: cap runs per IP. Threads are scoped to this browser's visitor id.
      if (req.method === 'POST' && /\/run$/.test(url.pathname)) {
        const wait = overLimit(ipOf(req));
        if (wait) return json(res, 429, { error: `You’ve asked a lot in a short time. Try again in ${Math.ceil(wait / 60)} min.` }, { 'retry-after': String(wait) });
      }
      const vid = visitorId(req, res);
      return visitor.run(vid, () => copilot(req, res));
    }
    const story = url.pathname.match(/^\/api\/stories\/([^/]+)$/);
    if (story && req.method === 'GET') {
      const ref = parseStoryRef(decodeURIComponent(story[1]));
      const s = ref && (await getStory(pi.harness, ref.id, ref.version));
      if (!s) return json(res, 404, { error: 'story not found' });
      const asOf = url.searchParams.has('asOf') ? Number(url.searchParams.get('asOf')) : Date.now();
      if (!Number.isFinite(asOf)) return json(res, 400, { error: 'asOf must be epoch ms' });
      return json(res, 200, await rerender(await pi.reader(), s, asOf));
    }
    if (url.pathname === '/api/dream/run' && req.method === 'POST') {
      if (!dream) return json(res, 503, { error: DREAM_NOT_INSTALLED });
      if (!isAdmin(req)) return json(res, 403, { error: 'Running the dream needs the admin token.' });
      if (dreamState.running) return json(res, 409, { error: 'The dream is already running.' });
      const asOf = url.searchParams.get('asOf') ? Number(url.searchParams.get('asOf')) : undefined;
      // SSE progress for the UI (Accept: text/event-stream); plain JSON for scripts and the deploy smoke.
      if (req.headers.accept?.includes('text/event-stream')) return streamDream(res, (onStep) => runDream(pi, dream, asOf, onStep));
      dreamState.running = true;
      try { return json(res, 200, await runDream(pi, dream, asOf)); } finally { dreamState.running = false; }
    }
    if (await routeApi(req, res, url, pi)) return;
    if (serveStatic(req, res)) return;
    json(res, 404, { error: 'not found' });
  };
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error('[mochi]', req.method, req.url, e);
      if (!res.headersSent) json(res, 500, { error: 'Something went wrong on the server.' }); else res.end();
    });
  });

  // Live stories: one doc watch fans out to every socket on a story; late joiners get the current version on connect.
  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Map<string, Map<WebSocket, number>>(); // story id -> socket -> last version sent
  const send = (ws: WebSocket, story: Story) => ws.send(JSON.stringify({ type: 'story', story }));
  const watch = await pi.harness.watchDoc(StoryDoc, ctx);
  watch?.start(async (value) => {
    for (const [id, subs] of sockets) {
      const latest = value?.stories[id]?.at(-1) as Story | undefined;
      if (latest) for (const [ws, sent] of subs) if (latest.version > sent) { send(ws, latest); subs.set(ws, latest.version); }
    }
  });
  server.on('upgrade', (req, socket, head) => {
    const m = new URL(req.url ?? '/', 'http://localhost').pathname.match(/^\/api\/stories\/([A-Za-z0-9_-]{16,})\/live$/);
    if (!m) return socket.destroy();
    wss.handleUpgrade(req, socket, head, async (ws) => {
      const id = m[1];
      const subs = sockets.get(id) ?? new Map<WebSocket, number>();
      sockets.set(id, subs);
      const latest = await getStory(pi.harness, id);
      subs.set(ws, latest?.version ?? 0);
      if (latest) send(ws, latest);
      ws.on('close', () => { subs.delete(ws); if (!subs.size) sockets.delete(id); });
    });
  });

  await new Promise<void>((r) => server.listen(opts.port ?? 0, r));
  const port = (server.address() as { port: number }).port;
  return {
    server, port,
    async close() {
      await watch?.stop();
      for (const ws of wss.clients) ws.terminate();
      await new Promise((r) => server.close(r));
    },
  };
}

if (import.meta.main) {
  const dream = await loadDream();
  // MOCHI_GRAPH points the whole stack at another graph (the e2e smoke dreams on a team_* copy, which both tiers reach).
  const pi = await openHarness({ dream, graph: process.env.MOCHI_GRAPH || undefined });
  const s = await startServer(pi, { port: Number(process.env.PORT ?? 4000), dream });
  console.error(`[mochi] http://localhost:${s.port}/ · /app · /blog · /api (graph ${pi.graph}, sim ${process.env.SIM_URL ?? 'http://localhost:4010'}) · dream ${dream ? 'installed' : 'not installed'}`);
  for (const sig of ['SIGINT', 'SIGTERM'] as const)
    process.once(sig, async () => { await s.close(); await pi.close(); process.exit(0); });
}
