// Test-only: a dry ctx on throwaway test_bench_<tag>_* graphs, and their cleanup.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tinyDataset } from '@mochi/contracts';
import { createLlm, type Reply } from './llm.ts';
import { connect } from './db.ts';
import { names, type Ctx } from './arms/index.ts';

export async function testCtx(tag: string, reply?: Reply): Promise<Ctx & { cleanup(): Promise<void> }> {
  const dataset = tinyDataset(); // arm and run tests stay on the contract fixture; deps.test covers the seed data
  const db = await connect();
  const prefix = `test_bench_${tag}`;
  const ctx = { llm: createLlm({ dry: true, maxUsd: 5, reply }), db, dataset, names: names(prefix), artifacts: mkdtempSync(join(tmpdir(), 'bench-')) };
  return {
    ...ctx,
    async cleanup() {
      for (const g of await db.list()) if (g.startsWith(`${prefix}_`)) await db.selectGraph(g).delete();
      await db.close();
    },
  };
}
