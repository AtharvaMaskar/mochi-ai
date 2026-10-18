// Conformance for FalkorStorage: the upstream Pi Durable storage suite (createStorageConformance, the cases
// memory-storage.test.ts and sqlite-storage.test.ts register), once fresh and once reopened after every commit, plus
// the portable SQLite-specific cases. Runs against a PRIVATE FalkorDB: JOURNAL_TEST_PORT (default 6392), admin user,
// one throwaway graph per case. Never the shared :6379. Without that container the file is skipped, loudly.
import { describe as nodeDescribe, test as nodeTest, after } from 'node:test';
import { connect as connectTcp } from 'node:net';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FalkorDB } from 'falkordb';
import type { Context } from '@earendil-works/chord';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createStorageConformance } from '@earendil-works/pi-durable/testing';
import {
  ROOT_CONVERSATION_ID, StorageRequestError,
  type ConversationId, type DocumentCreate, type DocumentId, type EntryId, type EntryRecord, type Id, type Seq,
  type Storage, type StorageWrite, type TaskId, type TaskRecord,
} from '@earendil-works/pi-durable';
import { loadEnv } from '../../contracts/testdb.ts';
import { FalkorStorage } from './falkordb.ts';

loadEnv();
const PORT = Number(process.env.JOURNAL_TEST_PORT ?? 6392);
const up = await new Promise<boolean>((r) => { const s = connectTcp(PORT, 'localhost').once('connect', () => { s.destroy(); r(true); }).once('error', () => r(false)); });
if (!up) console.warn(`falkordb.test.ts: no private FalkorDB on :${PORT}; every case is SKIPPED (JOURNAL_TEST_PORT)`);
const describe = up ? nodeDescribe : nodeDescribe.skip;
const test = up ? nodeTest : nodeTest.skip;
const db = up ? await FalkorDB.connect({ socket: { host: 'localhost', port: PORT }, password: process.env.FALKORDB_PASSWORD }) : (null as never);
let n = 0;
const graphs: string[] = [];
const fresh = async () => {
  const name = `journal_test_${process.pid}_${++n}`;
  graphs.push(name);
  await db.selectGraph(name).delete().catch(() => {});
  return name;
};
const open = (graph: string) => FalkorStorage.open({ db, graph });
const q = async <T = Record<string, any>>(graph: string, cypher: string, params = {}) => ((await db.selectGraph(graph).query<T>(cypher, { params })).data ?? []) as T[];
after(async () => {
  if (!up) return;
  for (const g of graphs) await db.selectGraph(g).delete().catch(() => {});
  await db.close();
});

// node:assert with Vitest's toEqual/toMatchObject/toThrow semantics, which the upstream cases were written against.
const plain = (v: unknown) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
function subset(actual: any, expected: any, path = '$'): void {
  if (expected === null || typeof expected !== 'object') return assert.deepStrictEqual(actual, expected, path);
  assert.ok(actual !== null && typeof actual === 'object', `${path}: expected an object`);
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, `${path}: length`);
    expected.forEach((v, i) => subset(actual[i], v, `${path}[${i}]`));
  } else for (const k of Object.keys(expected)) subset(actual[k], expected[k], `${path}.${k}`);
}
const assertions = {
  ok: (v: unknown, m?: string) => assert.ok(v, m),
  strictEqual: (a: unknown, e: unknown) => assert.strictEqual(a, e),
  deepEqual: (a: unknown, e: unknown) => assert.deepStrictEqual(plain(a), plain(e)),
  partialDeepEqual: (a: unknown, e: unknown) => subset(a, e),
  greaterThan: (a: number, e: number) => assert.ok(a > e, `${a} > ${e}`),
  rejects: (p: Promise<unknown>, msg: string) => assert.rejects(p, (e: Error) => { assert.ok(String(e?.message).includes(msg), `"${e?.message}" lacks "${msg}"`); return true; }),
};

/** Upstream ReopeningStorage (sqlite-storage.test.ts): closes and reopens the backend after every commit. */
class Reopening implements Storage {
  private closed = false;
  private current: FalkorStorage;
  private readonly graph: string;
  constructor(current: FalkorStorage, graph: string) { this.current = current; this.graph = graph; }
  async commit(writes: readonly StorageWrite[], c: Context): Promise<Seq> {
    if (this.closed) return this.current.commit(writes);
    try { return await this.current.commit(writes); } finally {
      await this.current.close();
      this.current = await open(this.graph);
    }
  }
  mintId<I extends Id<string>>() { return this.current.mintId<I>(); }
  conversation: Storage['conversation'] = (id) => this.current.conversation(id);
  scanConversations: Storage['scanConversations'] = (a, b, c) => this.current.scanConversations(a, b, c);
  entry(id: EntryId, c: Context): ReturnType<Storage['entry']>;
  entry(conv: ConversationId, id: EntryId, c: Context): ReturnType<Storage['entry']>;
  entry(a: any, b: any, c?: any) { return c === undefined ? this.current.entry(a) : (this.current.entry as any)(a, b, c); }
  findLatestHeadMarker: Storage['findLatestHeadMarker'] = (a, b) => this.current.findLatestHeadMarker(a, b);
  scanEntries: Storage['scanEntries'] = (a, b, c) => this.current.scanEntries(a, b, c);
  task: Storage['task'] = (id) => this.current.task(id);
  scanTasks: Storage['scanTasks'] = (a, b, c) => this.current.scanTasks(a, b, c);
  submission: Storage['submission'] = (id) => this.current.submission(id);
  scanSubmissions: Storage['scanSubmissions'] = (a, b, c) => this.current.scanSubmissions(a, b, c);
  submissionByRequest: Storage['submissionByRequest'] = (a, b) => this.current.submissionByRequest(a, b);
  findDocument: Storage['findDocument'] = (a, b) => this.current.findDocument(a, b);
  document: Storage['document'] = (a, b) => this.current.document(a, b);
  scanDocuments: Storage['scanDocuments'] = (a, b, c) => this.current.scanDocuments(a, b, c);
  async close() { if (!this.closed) { this.closed = true; await this.current.close(); } }
}

const suites: [string, (use: (s: Storage) => Promise<void>) => Promise<void>][] = [
  ['FalkorStorage', async (use) => { const s = await open(await fresh()); try { await use(s); } finally { await s.close(); } }],
  ['FalkorStorage across reopen', async (use) => {
    const g = await fresh();
    await (await open(g)).close();
    const s = new Reopening(await open(g), g);
    try { await use(s); } finally { await s.close(); }
  }],
];
for (const [name, withStorage] of suites) {
  describe(name, () => {
    for (const c of createStorageConformance({ assertions, withStorage })) test(c.name, () => c.run());
  });
}

// ---- the portable cases of upstream sqlite-storage.test.ts, on the graph instead of SQL rows ----

const entry = (id: EntryId, conversationId: ConversationId, data?: unknown): EntryRecord =>
  ({ id, conversationId, kind: 'message', ...(data === undefined ? {} : { data }) }) as EntryRecord;
const createRoot = (s: Storage) => s.commit([{ type: 'conversation', value: { id: ROOT_CONVERSATION_ID } }], context);
const pendingTask = (id: TaskId<any>): TaskRecord<any, any, any> => ({
  id, conversationId: ROOT_CONVERSATION_ID, kind: 'test.task', version: 1, input: null,
  state: { status: 'pending', checkpoint: { phase: 'ready' } }, background: false, abortRequested: false,
});
const revisionCount = async (g: string, id: DocumentId) => (await q<{ n: number }>(g, 'MATCH (r:Revision {doc: $id}) RETURN count(r) AS n', { id }))[0].n;

describe('FalkorStorage (ported sqlite-storage cases)', () => {
  test('persists records, sequence allocation, and global ID allocation across reopen', async () => {
    const g = await fresh();
    const s = await open(g);
    assert.equal(await createRoot(s), 1);
    const entryId = await s.mintId<EntryId>();
    assert.equal(await s.commit([{ type: 'entry', value: entry(entryId, ROOT_CONVERSATION_ID) }]), 2);
    await s.close();
    const r = await open(g);
    assert.deepEqual(await r.entry(entryId), { entry: entry(entryId, ROOT_CONVERSATION_ID), commitSeq: 2 });
    assert.equal(await r.mintId<EntryId>(), entryId + 1);
    assert.equal(await r.commit([{ type: 'task', value: pendingTask(await r.mintId<TaskId<any>>()) }]), 3);
    await r.close();
  });

  test('rejects a document whose required base is missing', async () => {
    const g = await fresh();
    const s = await open(g);
    await createRoot(s);
    const id = await s.mintId<DocumentId>();
    await s.commit([{ type: 'document.create', record: { id, kind: 'corrupt', scope: { kind: 'session' } }, content: { kind: 'base', version: 1, value: { retained: true } } }]);
    await q(g, 'MATCH (r:Revision {doc: $id}) DELETE r', { id });
    await assert.rejects(s.document(id, 'current'), new RegExp(`Document ${id} is missing a required base`));
    await s.close();
  });

  test('replays detached root replacements and follow-up edits while rejecting corrupt operations', async () => {
    const g = await fresh();
    const s = await open(g);
    await createRoot(s);
    const id = await s.mintId<DocumentId>();
    await s.commit([{ type: 'document.create', record: { id, kind: 'replay', scope: { kind: 'session' } }, content: { kind: 'base', version: 1, value: { nested: { value: 1 }, rows: [] } } }]);
    await s.commit([{ type: 'document.change', id, content: { kind: 'delta', version: 1, ops: [['r', { nested: { value: 2 }, rows: [{ id: 1 }] }]] } }]);
    await s.commit([{ type: 'document.change', id, content: { kind: 'delta', version: 1, ops: [['s', ['nested', 'value'], 3], ['p', ['rows'], 1, 0, [{ id: 2 }]], ['m', ['rows'], [1, 0]]] as never } }]);
    await s.commit([{ type: 'document.change', id, content: { kind: 'delta', version: 1, ops: [['s', ['nested', 'value'], 4]] } }]);
    const expected = { nested: { value: 4 }, rows: [{ id: 2 }, { id: 1 }] };
    const first = (await s.document(id, 'current'))!;
    assert.deepEqual(first.value, expected);
    (first.value.nested as { value: number }).value = 99;
    assert.deepEqual((await s.document(id, 'current'))?.value, expected);
    await q(g, `MATCH (r:Revision {doc: $id}) WITH max(r.seq) AS last MATCH (r:Revision {doc: $id}) WHERE r.seq = last SET r.body = '[["unknown"]]'`, { id });
    await assert.rejects(s.document(id, 'current'), /unknown op verb/);
    await s.close();
  });

  test('rolls graph writes and sequence allocation back as one transaction', async () => {
    const g = await fresh();
    const s = await open(g);
    await createRoot(s);
    const transientId = await s.mintId<EntryId>();
    const transientTaskId = await s.mintId<TaskId<any>>();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    await assert.rejects(s.commit([
      { type: 'entry', value: entry(transientId, ROOT_CONVERSATION_ID) },
      { type: 'task', value: { ...pendingTask(transientTaskId), input: circular as never } },
    ]), /circular structure/);
    assert.equal(await s.entry(transientId), undefined);
    assert.equal(await s.task(transientTaskId), undefined);
    const committedId = await s.mintId<EntryId>();
    assert.equal(await s.commit([{ type: 'entry', value: entry(committedId, ROOT_CONVERSATION_ID) }]), 2);
    assert.equal((await q<{ n: number }>(g, 'MATCH (e:Entry) RETURN count(e) AS n'))[0].n, 1);
    assert.equal((await q<{ n: number }>(g, 'MATCH (m:Journal) RETURN m.seq AS n'))[0].n, 2);
    await s.close();
  });

  test('reconstructs recent and ancient rewindable points after reopen', async () => {
    const g = await fresh();
    const s = await open(g);
    await createRoot(s);
    const id = await s.mintId<DocumentId>();
    const record = { id, kind: 'history', scope: { kind: 'conversation', conversationId: ROOT_CONVERSATION_ID }, history: 'rewindable', fork: 'asOf' } satisfies DocumentCreate;
    let ancientAt = await s.commit([{ type: 'document.create', record, content: { kind: 'base', version: 1, value: { count: 0 } } }]);
    let recentAt = ancientAt;
    for (let count = 1; count <= 40; count++) {
      recentAt = await s.commit([{ type: 'document.change', id, content: count === 20 ? { kind: 'base', version: 1, value: { count } } : { kind: 'delta', version: 1, ops: [['s', ['count'], count]] } }]);
      if (count === 5) ancientAt = recentAt;
    }
    await s.close();
    const r = await open(g);
    assert.deepEqual((await r.document(id, ancientAt))?.value, { count: 5 });
    assert.deepEqual((await r.document(id, recentAt))?.value, { count: 40 });
    await r.close();
  });

  test('indexes exact addresses, exact scopes, entry ids, task status and revision tails', async () => {
    const g = await fresh();
    await (await open(g)).close();
    const idx = (await q<{ label: string; properties: string[] }>(g, 'CALL db.indexes() YIELD label, properties RETURN label, properties'))
      .flatMap((r) => r.properties.map((p) => `${r.label}.${p}`));
    for (const want of ['Document.addr', 'Document.scope', 'Entry.id', 'Task.status', 'Revision.doc', 'Submission.reqKey']) assert.ok(idx.includes(want), want);
  });

  test('reclaims current-only revisions only after a base or retirement', async () => {
    const g = await fresh();
    const s = await open(g);
    await createRoot(s);
    const id = await s.mintId<DocumentId>();
    await s.commit([{ type: 'document.create', record: { id, kind: 'latest', scope: { kind: 'session' } }, content: { kind: 'base', version: 1, value: { count: 0 } } }]);
    for (let count = 1; count <= 10; count++) await s.commit([{ type: 'document.change', id, content: { kind: 'delta', version: 1, ops: [['s', ['count'], count]] } }]);
    assert.equal(await revisionCount(g, id), 11);
    await s.commit([{ type: 'document.change', id, content: { kind: 'base', version: 1, value: { count: 11 } } }]);
    assert.equal(await revisionCount(g, id), 1);
    await s.commit([{ type: 'document.change', id, content: { kind: 'delta', version: 1, ops: [['r', { count: 12 }]] } }]);
    assert.equal(await revisionCount(g, id), 2);
    await s.commit([{ type: 'document.retire', id }]);
    assert.equal(await revisionCount(g, id), 0);
    await s.close();
  });
});

// ---- the storage-side contract harness-storage-failure.test.ts relies on ----

describe('FalkorStorage failure semantics', () => {
  test('an invalid request is a StorageRequestError with no durable effect', async () => {
    const g = await fresh();
    const s = await open(g);
    await createRoot(s);
    const before = await q(g, 'MATCH (m:Journal) RETURN m.seq AS seq, m.nextId AS next');
    await assert.rejects(s.scanEntries({ conversationId: 999_999 as ConversationId }, 10, undefined), StorageRequestError);
    await assert.rejects(s.scanTasks({}, 10, { after: 'x' }), StorageRequestError);
    assert.deepEqual(await q(g, 'MATCH (m:Journal) RETURN m.seq AS seq, m.nextId AS next'), before);
    await s.close();
  });

  test('a batch FalkorDB refuses mid-query rolls back whole', async () => {
    const g = await fresh();
    const s = await open(g);
    await createRoot(s);
    // A MANDATORY constraint the adapter's own checks know nothing about: the entry passes validation, the DB refuses it.
    await db.selectGraph(g).constraintCreate('MANDATORY' as never, 'NODE' as never, 'Entry', 'head');
    while ((await q<{ s: string }>(g, 'CALL db.constraints() YIELD status RETURN status AS s'))[0]?.s !== 'OPERATIONAL') await new Promise((r) => setTimeout(r, 50));
    const conv = await s.mintId<ConversationId>();
    const id = await s.mintId<EntryId>();
    await assert.rejects(s.commit([{ type: 'conversation', value: { id: conv } }, { type: 'entry', value: entry(id, ROOT_CONVERSATION_ID) }]));
    assert.equal(await s.conversation(conv), undefined);
    assert.equal(await s.entry(id), undefined);
    assert.equal((await q<{ n: number }>(g, 'MATCH (m:Journal) RETURN m.seq AS n'))[0].n, 1);
    await s.close();
  });
});

// ---- storage-runtime-boundary.test.ts: the adapter loads no other backend ----

test('the FalkorDB adapter imports no other storage backend', () => {
  const src = readFileSync(new URL('./falkordb.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /storage\/(sqlite|jsonl)|node:sqlite/);
});
