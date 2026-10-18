import { FalkorDB } from 'falkordb';
import { env } from './llm.ts'; // also loads .env

/** No username = the admin (default) user; bench uses it only for its own bench_* graphs. */
export function connect(username?: string, passwordEnv = 'FALKORDB_PASSWORD'): Promise<FalkorDB> {
  return FalkorDB.connect({
    socket: { host: process.env.FALKORDB_HOST ?? 'localhost', port: Number(process.env.FALKORDB_PORT ?? 6379) },
    ...(username ? { username } : {}), password: env(passwordEnv),
  });
}
