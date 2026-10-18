// Tier isolation (SPEC §1 ledger row): the database, not the tool loadout, refuses reader writes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACL, GRAPH } from './graph.ts';
import { connect } from './testdb.ts';
import { REFUSAL_CASES } from './isolation.ts';


test('compose declares exactly the contract ACL rules', () => {
  const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  for (const { user, rules } of Object.values(ACL)) assert.ok(compose.includes(`--user ${user} on >`) && compose.includes(rules), user);
});

const admin = await connect();
const reader = await connect(ACL.reader.user, ACL.reader.passwordEnv);
const dream = await connect(ACL.dream.user, ACL.dream.passwordEnv);
await admin.selectGraph(GRAPH.company).query("MERGE (:Ticket {id:'T-acl-probe', created_at:0, source:'seed'})");
after(async () => {
  await admin.selectGraph(GRAPH.company).query("MATCH (t:Ticket) WHERE t.id IN ['T-acl-probe','T-acl-dream'] DELETE t");
  await Promise.all([admin.close(), reader.close(), dream.close()]);
});

test('reader can read company', async () => {
  const r = await reader.selectGraph(GRAPH.company).roQuery<{ n: number }>("MATCH (t:Ticket {id:'T-acl-probe'}) RETURN count(t) AS n");
  assert.equal(r.data?.[0].n, 1);
});

for (const c of REFUSAL_CASES) test(`reader refused: ${c.case}`, async () => {
  await assert.rejects(c.run(reader));
});

test('graph unchanged after refused writes', async () => {
  const r = await admin.selectGraph(GRAPH.company).roQuery<{ n: number }>("MATCH (t:Ticket {id:'evil'}) RETURN count(t) AS n");
  assert.equal(r.data?.[0].n, 0);
});

test('user tier writes team memory, refused on company', async () => {
  const user = await connect(ACL.demoUser.user, ACL.demoUser.passwordEnv);
  try {
    await user.selectGraph(GRAPH.team('acltest')).query("CREATE (:DoctrineCandidate {id:'D-acl', created_at:0, source:'teach'})");
    await assert.rejects(user.selectGraph(GRAPH.company).query("CREATE (:Policy {id:'evil'})"));
  } finally {
    await admin.selectGraph(GRAPH.team('acltest')).delete().catch(() => {});
    await user.close();
  }
});

test('dream can write company', async () => {
  await dream.selectGraph(GRAPH.company).query("CREATE (:Ticket {id:'T-acl-dream', created_at:0, source:'dream'})");
});
