// Test double of agent-core's agent/db.ts writer(). Tests use the admin connection on throwaway graphs.
import { connect } from '../../../contracts/testdb.ts';

let db: Awaited<ReturnType<typeof connect>> | undefined;
export async function writer() { return (db ??= await connect()); }
export async function closeWriter() { await db?.close(); db = undefined; }
