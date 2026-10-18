// Server artifacts: config, graph size, memory and the slowlog of the graph the bench answered on.
import type { FalkorDB } from 'falkordb';
import type { Results } from '@mochi/contracts';
import { META_STATS } from '../cypher.ts';

const num = (x: unknown) => Number(Array.isArray(x) ? x[1] : x) || 0;

export async function resetSlowlog(db: FalkorDB, graph: string) {
  const c = await db.connection;
  await c.sendCommand(['GRAPH.SLOWLOG', graph, 'RESET']).catch(() => {}); // graph may not exist yet
}

export async function runServer(db: FalkorDB, graph: string): Promise<Pick<Results, 'server'>> {
  const g = db.selectGraph(graph);
  const stats = (await g.roQuery<{ nodeCount: number; relCount: number }>(META_STATS)).data?.[0];
  const mem = await g.memoryUsage();
  const slow = await g.slowLog();
  return {
    server: {
      thread_count: num(await db.configGet('THREAD_COUNT')),
      max_queued_queries: num(await db.configGet('MAX_QUEUED_QUERIES')),
      node_count: stats?.nodeCount ?? 0, edge_count: stats?.relCount ?? 0,
      memory_mb: Number(mem[mem.indexOf('total_graph_sz_mb') + 1]) || 0,
      slowlog_top: slow.sort((a, b) => b.took - a.took).slice(0, 5).map((s) => `${s.took}ms ${s.command} ${s.query}`),
    },
  };
}
