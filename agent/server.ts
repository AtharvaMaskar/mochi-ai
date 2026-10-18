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

/** Runtime options. Hard rule: openGenerativeUI is never set; ACTIVITY.card / ACTIVITY.html are the only rich UI. */
export const runtimeOptions = (pi: Pi) => ({
  agents: { mochi: new PiDurableAgent(pi, { agentId: 'mochi' }) },
  runner: new PiRunner(pi),
});

/** Run the dream now through the port; its morning report lands in StoryDoc through `commitStory`. */
export async function runDream(pi: Pi, dream: DreamModule, as_of?: number) {
  const model = pi.models.getModel(pi.model.provider as never, pi.model.modelId);
  if (!model) throw new Error(`unknown model ${pi.model.provider}/${pi.model.modelId}`);
  // A harness on another graph (tests) dreams there, with its own snapshot/scratch graphs and no team graphs.
  const graphs = pi.graph === GRAPH.company ? undefined : { company: pi.graph, prev: `${pi.graph}_prev`, scratch: `${pi.graph}_scratch`, teams: [] };
  return dream.runDreamNow({
    db: await pi.writer(), as_of, graphs, model: { models: pi.models, model },
    commitStory: (story: Parameters<typeof commitStory>[1]) => commitStory(pi.harness, story),
  });
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};

export async function startServer(pi: Pi, opts: { port?: number; dream?: DreamModule | null } = {}) {
  const dream = opts.dream ?? null;
  const copilot = createCopilotNodeListener({
    runtime: new CopilotRuntime(runtimeOptions(pi)),
    basePath: '/api/copilotkit',
    cors: { origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], credentials: true },
  });

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/copilotkit')) return copilot(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type' });
      return res.end();
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
      const asOf = url.searchParams.get('asOf');
      return json(res, 200, await runDream(pi, dream, asOf ? Number(asOf) : undefined));
    }
    json(res, 404, { error: 'not found' });
  };
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => { if (!res.headersSent) json(res, 500, { error: (e as Error).message }); else res.end(); });
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
  const pi = await openHarness({ dream });
  const s = await startServer(pi, { port: Number(process.env.PORT ?? 4000), dream });
  console.error(`[mochi] http://localhost:${s.port}/api/copilotkit · stories /api/stories/:id · dream ${dream ? 'installed' : 'not installed'}`);
  for (const sig of ['SIGINT', 'SIGTERM'] as const)
    process.once(sig, async () => { await s.close(); await pi.close(); process.exit(0); });
}
