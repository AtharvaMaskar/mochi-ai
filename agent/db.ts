// The three tier connections (SPEC §1 memory tiers, design decision 2). The database enforces the tier even if a
// tool is mis-wired: reader can only RO_QUERY, dream is the only company writer, user_demo writes team_*/user_*/cust_*.
import { FalkorDB } from 'falkordb';
import { ACL } from '@mochi/contracts';

export type Db = Pick<FalkorDB, 'selectGraph' | 'list' | 'close'>;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name} (see .env.example)`);
  return v;
}

export function connect(username: string | undefined, passwordEnv: string): Promise<FalkorDB> {
  return FalkorDB.connect({
    socket: { host: process.env.FALKORDB_HOST ?? 'localhost', port: Number(process.env.FALKORDB_PORT ?? 6379) },
    ...(username ? { username } : {}),
    password: env(passwordEnv),
  }).then((db) => {
    // A dropped socket reconnects on its own; without a listener the 'error' event would crash the process.
    db.on('error', (e: Error) => console.error(`[db] ${username ?? 'default'}: ${e.message}`));
    return db;
  });
}

const pool = new Map<string, Promise<FalkorDB>>();
const cached = (u: { user: string; passwordEnv: string }) => {
  if (!pool.has(u.user)) {
    const p = connect(u.user, u.passwordEnv);
    p.catch(() => pool.delete(u.user)); // a failed connect is retried on the next call, not cached
    pool.set(u.user, p);
  }
  return pool.get(u.user)!;
};

/** `mochi_reader`: every read tool and every story re-render. */
export const reader = () => cached(ACL.reader);
/** `mochi_dream`: the dream, the loader and the root-only `record_resolution`. */
export const writer = () => cached(ACL.dream);
/** `user_demo`: teach and feedback, into the caller's `team_*` graph. */
export const userDb = () => cached(ACL.demoUser);

export async function closeAll() {
  const all = [...pool.values()];
  pool.clear();
  await Promise.all(all.map(async (p) => (await p).close()));
}
