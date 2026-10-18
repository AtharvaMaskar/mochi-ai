import { FalkorDB } from 'falkordb';
import { env } from './llm.ts'; // also loads .env

/** No username = the admin (default) user; bench uses it only for its own bench_* graphs. */
export async function connect(username?: string, passwordEnv = 'FALKORDB_PASSWORD'): Promise<FalkorDB> {
  const db = await FalkorDB.connect({
    socket: { host: process.env.FALKORDB_HOST ?? 'localhost', port: Number(process.env.FALKORDB_PORT ?? 6379) },
    ...(username ? { username } : {}), password: env(passwordEnv),
  });
  // A dropped socket fails the in-flight query (its section is recorded as not measured) instead of killing the run
  // before usage.json is written; the client reconnects.
  db.on('error', (e: Error) => console.error(`bench: FalkorDB connection error: ${e.message}`));
  return db;
}
