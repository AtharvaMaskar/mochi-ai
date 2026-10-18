// 6.4: the dream's every step is allowed for mochi_dream. A full run as mochi_dream goes to
// throwaway graphs inside its key patterns (team_test_dream_*), never mochi_company; the real
// graph names are checked with ACL DRYRUN, which evaluates permissions without executing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACL, GRAPH } from '@mochi/contracts';
import { AS_OF, fauxModel, loadFixture, fixtureDataset } from './__test__/fixture.ts';
import { connect } from '../../contracts/testdb.ts';

const { runDreamNow } = await import('./index.ts');

test('ACL DRYRUN: mochi_dream may run every command the dream sends on the real graph names', async (t) => {
  const admin = await connect();
  t.after(() => admin.close());
  const conn: any = await admin.connection;
  const user = ACL.dream.user;
  const cmds = [
    ['GRAPH.DELETE', GRAPH.companyPrev], ['GRAPH.COPY', GRAPH.company, GRAPH.companyPrev],
    ['GRAPH.QUERY', GRAPH.company, 'RETURN 1'], ['GRAPH.RO_QUERY', GRAPH.company, 'RETURN 1'],
    ['GRAPH.DELETE', GRAPH.scratch], ['GRAPH.QUERY', GRAPH.scratch, 'RETURN 1'],
    ['GRAPH.QUERY', GRAPH.team('funds'), 'RETURN 1'], ['GRAPH.LIST'],
  ];
  for (const c of cmds) assert.equal(String(await conn.sendCommand(['ACL', 'DRYRUN', user, ...c])), 'OK', c.join(' '));
  // and the reader may not write: the tier rule the dream relies on
  assert.notEqual(String(await conn.sendCommand(['ACL', 'DRYRUN', ACL.reader.user, 'GRAPH.QUERY', GRAPH.company, 'RETURN 1'])), 'OK');
});

test('a full runDreamNow connected as mochi_dream succeeds on graphs inside its ACL', async (t) => {
  const admin = await connect();
  const dream = await connect(ACL.dream.user, ACL.dream.passwordEnv);
  const p = `team_test_dream_acl_${process.pid}`;
  const graphs = { company: `${p}_company`, prev: `${p}_prev`, scratch: `${p}_scratch`, teams: [`${p}_team`] };
  t.after(async () => {
    for (const g of Object.values(graphs).flat()) await admin.selectGraph(g).delete().catch(() => {});
    await admin.close(); await dream.close();
  });
  const d = fixtureDataset();
  await loadFixture(admin, graphs.company, d.dataset, d.pending);
  await admin.selectGraph(graphs.teams[0]).query(`MERGE (:ProductArea {name:'funds'})`);
  const r = await runDreamNow({ db: dream, as_of: AS_OF, model: fauxModel(), graphs, events: d.dataset.contradiction_events });
  assert.equal(r.ingested, 1);
  assert.equal(r.retired_by.events, 2);
  assert.ok(r.story_id);
});
