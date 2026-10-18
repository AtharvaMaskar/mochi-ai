import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { Harness, MemoryStorage, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { AS_OF, fauxModel, fixture, fixtureDataset } from './__test__/fixture.ts';
import { connect } from '../../contracts/testdb.ts';

import { latestDreamStory } from '../stories.ts';

const { runDreamNow, DreamTask, useDb } = await import('./index.ts');
const H = 3_600_000;

/** The fixture plus n pending tickets P-001… (demo-day volume). */
function withPending(n: number) {
  const d = fixtureDataset();
  for (let k = 1; k <= n; k++) {
    const id = `P-${String(k).padStart(3, '0')}`;
    d.dataset.tickets.push({ ...d.dataset.tickets.find((t) => t.id === 'D-1')!, id, subject: k % 2 ? 'Cannot log in after OTP' : 'Order not placed', created_at: AS_OF - 4 * H + k });
    d.pending.push(id);
  }
  return d;
}

const shape = (f: Awaited<ReturnType<typeof fixture>>) => f.rows(`MATCH (n) WITH labels(n)[0] AS l, count(n) AS c RETURN l, c ORDER BY l
  UNION ALL MATCH ()-[e]->() WITH type(e) AS l, count(e) AS c RETURN l, c ORDER BY l`);

test('3.2 readers polling during 10 batches never see a torn batch', async (t) => {
  const f = await fixture('torn', withPending(200));
  t.after(f.cleanup);
  const reader = await connect();
  t.after(() => reader.close());
  const g = reader.selectGraph(f.graphs.company);
  let done = false, polls = 0;
  const seen = new Map<string, number>();
  const poll = (async () => {
    while (!done) {
      const [{ torn }] = (await g.roQuery<any>('MATCH (t:Ticket) WHERE t.ingested_at IS NOT NULL AND NOT (t)-[:ABOUT]->() RETURN count(t) AS torn')).data!;
      assert.equal(torn, 0, 'ingested without ABOUT');
      for (const r of (await g.roQuery<any>('MATCH (t:Ticket) WHERE t.batch_id IS NOT NULL RETURN t.batch_id AS id, t.batch_size AS size, count(t) AS n')).data!) {
        assert.equal(r.n, r.size, `batch ${r.id} visible with ${r.n} of ${r.size}`);
        seen.set(r.id, r.size);
      }
      polls++;
    }
  })();
  const report = await runDreamNow({ db: f.db, as_of: AS_OF, model: fauxModel(), graphs: f.graphs, events: [] });
  done = true;
  await poll;
  assert.equal(report.batches.length, 11); // 202 pending: 200 valid + D-1, D-2 (dropped)
  assert.ok(polls > 1, `readers polled ${polls}×`);
  for (const [id, size] of seen) assert.deepEqual(report.batches.find((b) => b.id === id), { id, size });
});

test('6.2 killed mid-ingestion and re-run: no batch extracted twice, same final graph as a clean run', async (t) => {
  const clean = await fixture('clean', withPending(45));
  const crash = await fixture('crash', withPending(45));
  t.after(async () => { await clean.cleanup(); await crash.cleanup(); });
  const cleanModel = fauxModel();
  await runDreamNow({ db: clean.db, as_of: AS_OF, model: cleanModel, graphs: clean.graphs, events: [] });

  const memo = new Map<string, unknown>(); // runtime.memo stand-in: survives the "process"
  const durable = async <T>(k: string, f: () => Promise<T>) => (memo.has(k) ? memo.get(k) as T : (memo.set(k, await f()), memo.get(k) as T));
  const model = fauxModel();
  await assert.rejects(runDreamNow({ db: crash.db, as_of: AS_OF, model, graphs: crash.graphs, events: [], memo: durable,
    onStep: (s) => { if (s === 'extracted:1') throw new Error('kill -9'); } }), /kill -9/);
  const [{ partial }] = await crash.rows('MATCH (t:Ticket) WHERE t.batch_id IS NOT NULL RETURN count(t) AS partial');
  assert.equal(partial, 19, 'batch 0 written (D-2 dropped), batch 1 extracted but not written');
  const r = await runDreamNow({ db: crash.db, as_of: AS_OF, model, graphs: crash.graphs, events: [], memo: durable });

  const extractCalls = (m: typeof model) => m.faux.state.callCount - 2; // minus the two suggestion-prose calls of the finishing run
  assert.equal(extractCalls(model), extractCalls(cleanModel), 'no batch extracted twice');
  assert.equal(r.usage.extract.calls, 1, 'the resumed run paid only for the batch never extracted');
  assert.deepEqual(await shape(crash), await shape(clean));
});

test('6.2 DreamTask: background task sleeps until next, runs, commits the story and the next run time', { timeout: 30_000 }, async (t) => {
  const f = await fixture('task');
  t.after(f.cleanup);
  useDb(async () => f.db); // what openHarness does with its writer
  const { models, model } = fauxModel();
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'mochi-dream-test', tasks: [DreamTask] }));
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);
  let id: any;
  t.after(async () => { if (id !== undefined) await harness.abortTask(id, ctx).catch(() => {}); await harness.close(ctx); });
  harness.resume();
  const root = await harness.root(ctx);
  await root.commit(async (tx: any) => {
    id = await tx.createTask(DreamTask, { every: 3_600_000, first: 50, graphs: f.graphs, model: { provider: model.provider, id: model.id } },
      { ownership: { kind: 'conversation' }, background: true });
  }, ctx);

  let story;
  for (let i = 0; i < 200 && !story; i++) {
    story = await latestDreamStory(harness);
    if (!story) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(story, 'the task committed a morning report');
  let rec: any;
  for (let i = 0; i < 100 && rec?.state?.checkpoint?.phase !== 'wait'; i++) {
    rec = await harness.getTask(id, ctx);
    if (rec?.state?.checkpoint?.phase !== 'wait') await new Promise((r) => setTimeout(r, 20));
  }
  const cp = rec.state.checkpoint;
  assert.equal(cp.phase, 'wait');
  assert.equal(cp.last.story_id, story.id);
  assert.ok(cp.next > Date.now() + 3_500_000, 'next run an `every` later');
  const [{ ingested }] = await f.rows('MATCH (t:Ticket) WHERE t.batch_id IS NOT NULL RETURN count(t) AS ingested');
  assert.equal(ingested, 1);
});
