// Test-only FalkorDB connection helper (falkordb is a devDependency of contracts).
import { FalkorDB } from 'falkordb';
import { readFileSync } from 'node:fs';

export function loadEnv(path = new URL('../.env', import.meta.url)) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch { /* no .env: rely on the real environment */ }
}

export async function connect(username?: string, passwordEnv = 'FALKORDB_PASSWORD') {
  loadEnv();
  const password = process.env[passwordEnv];
  if (!password) throw new Error(`missing ${passwordEnv} (see .env.example)`);
  return FalkorDB.connect({
    socket: { host: process.env.FALKORDB_HOST ?? 'localhost', port: Number(process.env.FALKORDB_PORT ?? 6379) },
    ...(username ? { username } : {}), password,
  });
}
