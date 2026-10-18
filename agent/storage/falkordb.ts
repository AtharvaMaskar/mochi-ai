// Pi Durable `Storage` on FalkorDB (graph `mochi_journal`, user `mochi_journal`): with MOCHI_STORAGE=falkordb the
// agent's execution journal lives in the same database as company memory, as a graph. Semantics mirror the upstream
// MemoryStorage. A commit validates against the stored state with reads, then writes the whole batch in ONE
// parameterised query (UNWIND inside CALL subqueries), which FalkorDB applies atomically; the Journal counter node
// hands out the commit Seq in that same query. The Session serializes commits, so read-then-write is race-free.
// Payloads are JSON strings (lone surrogates survive JSON.stringify's escaping); lookup keys are JSON strings too.
import { FalkorDB } from 'falkordb';
import { applyImmutableBatches } from '@earendil-works/chord/delta';
import {
  StorageRequestError,
  type ConversationId, type ConversationQuery, type ConversationRecord, type Cursor, type DocumentAddress, type DocumentCreate,
  type DocumentContent, type DocumentId, type DocumentPoint, type DocumentQuery, type DocumentRecord, type EntryId, type EntryQuery,
  type EntryRecord, type Id, type Page, type ScanOrder, type Seq, type Storage, type StorageWrite, type StoredDocument,
  type SubmissionId, type SubmissionQuery, type SubmissionRecord, type TaskId, type TaskQuery, type TaskRecord,
} from '@earendil-works/pi-durable';
import { ACL, JOURNAL_GRAPH } from '@mochi/contracts';

type Row = Record<string, any>;
type Graph = { query<T>(q: string, o?: { params?: Row }): Promise<{ data?: T[] }> };
type AnyTask = TaskRecord<any, any, any>;
type Content = DocumentContent;
type Action = { create?: DocumentCreate; content?: Content; retire: boolean };
type Existing = { addr: string; retired: boolean; currentOnly: boolean; lastVersion: number | null };

const MAX = Number.MAX_SAFE_INTEGER;
const J = JSON.stringify;
const parse = (s: unknown) => JSON.parse(s as string);

const SCHEMA = [
  ['Journal', 'id'], ['Conversation', 'id'], ['Entry', 'id'], ['Task', 'id'], ['Task', 'status'], ['Submission', 'id'],
  ['Submission', 'reqKey'], ['Document', 'id'], ['Document', 'addr'], ['Document', 'scope'], ['Revision', 'doc'], ['Revision', 'seq'], ['Entry', 'ref'],
].map(([l, p]) => `CREATE INDEX FOR (n:${l}) ON (n.${p})`);

const scopeKey = (s: DocumentRecord['scope']) =>
  s.kind === 'session' ? 'session' : s.kind === 'conversation' ? `conversation:${s.conversationId}` : `task:${s.taskId}`;
const addrKey = (a: DocumentAddress) => J([a.kind, scopeKey(a.scope), a.key === undefined ? null : a.key]);
const currentOnly = (r: { scope: DocumentRecord['scope']; history?: string }) => r.scope.kind !== 'conversation' || r.history === 'latest';
const alive = (alias: string, at: DocumentPoint) =>
  at === 'current' ? `${alias}.retiredAt IS NULL` : `${alias}.createdAt <= $at AND (${alias}.retiredAt IS NULL OR $at < ${alias}.retiredAt)`;

/** A scan's order and position; a cursor keeps the order it was made with (upstream storage/scan.ts). */
function scanStart(requested: ScanOrder | undefined, cursor: Cursor | undefined, fallback: ScanOrder) {
  if (requested !== undefined && requested !== 'ascending' && requested !== 'descending') throw new StorageRequestError(`Invalid scan order: ${String(requested)}`);
  if (cursor === undefined) return { order: requested ?? fallback, after: undefined };
  const { after, order: stored } = cursor;
  if (typeof after !== 'number' || !Number.isSafeInteger(after)) throw new StorageRequestError('Invalid storage cursor');
  if (stored !== undefined && stored !== 'ascending' && stored !== 'descending') throw new StorageRequestError('Invalid storage cursor');
  const order = (stored as ScanOrder | undefined) ?? fallback;
  if (requested !== undefined && requested !== order) throw new StorageRequestError(`The cursor continues a ${order} scan; the query asks for ${requested}`);
  return { order, after: after as number };
}

function page<T extends { id: number }>(rows: { rec: string }[], limit: number, order: ScanOrder, map = (r: any) => parse(r.rec) as T): Page<T, Cursor> {
  const items = rows.slice(0, limit).map(map);
  return rows.length > limit ? { items, next: { after: items.at(-1)!.id, order } } : { items };
}

function* deltas(id: DocumentId, version: number, revs: Row[]) {
  for (const r of revs) {
    if (r.kind !== 'delta' || r.version !== version) throw new Error(`Document ${id} crosses a stored version boundary without a base`);
    yield parse(r.body);
  }
}

export class FalkorStorage implements Storage {
  private closed = false;
  private known = new Set<number>(); // conversations seen to exist (they are immutable and never deleted)
  private readonly g: Graph;
  private readonly onClose: () => Promise<void>;
  private constructor(g: Graph, onClose: () => Promise<void>) { this.g = g; this.onClose = onClose; }

  /** Opens (and initialises) the journal graph. Pass `db` to share a connection; otherwise connects as `mochi_journal`. */
  static async open(opts: { db?: FalkorDB; graph?: string } = {}) {
    const db = opts.db ?? await FalkorDB.connect({
      socket: { host: process.env.FALKORDB_HOST ?? 'localhost', port: Number(process.env.FALKORDB_PORT ?? 6379) },
      username: ACL.journal.user, password: process.env[ACL.journal.passwordEnv] ?? '',
    });
    if (!opts.db) db.on('error', (e: Error) => console.error(`[journal] ${e.message}`));
    const g = db.selectGraph(opts.graph ?? JOURNAL_GRAPH) as unknown as Graph;
    for (const q of SCHEMA) await g.query(q).catch((e: Error) => { if (!/already indexed/i.test(e.message)) throw e; });
    await g.query('MERGE (m:Journal {id: 0}) ON CREATE SET m.seq = 0, m.nextId = 2');
    return new FalkorStorage(g, opts.db ? async () => {} : () => db.close());
  }

  private async q<T = Row>(cypher: string, params: Row = {}): Promise<T[]> {
    if (this.closed) throw new Error('FalkorStorage is closed');
    const ps = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v ?? null])); // the client rejects undefined
    return ((await this.g.query<T>(cypher, { params: ps })).data ?? []) as T[];
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.onClose();
  }

  async mintId<I extends Id<string>>(): Promise<I> {
    const [r] = await this.q<{ n: string }>(`MATCH (m:Journal {id: 0}) WITH m, m.nextId AS n
SET m.nextId = CASE WHEN n <= ${MAX} THEN n + 1 ELSE n END RETURN toString(n) AS n`);
    const n = Number(r.n);
    if (!Number.isSafeInteger(n)) throw new Error('ID space is exhausted');
    return n as I;
  }

  // ---- conversations ----

  async conversation(id: ConversationId) {
    const [r] = await this.q<{ rec: string }>('MATCH (c:Conversation {id: $id}) RETURN c.rec AS rec', { id });
    return r ? parse(r.rec) as ConversationRecord : undefined;
  }

  private async ensureConversation(id: number) {
    if (this.known.has(id)) return;
    if (!(await this.conversation(id as ConversationId))) throw new StorageRequestError(`Unknown conversation: ${id}`);
    this.known.add(id);
  }

  /** One ordered, filtered, cursor-paged scan over a record label (ORDER BY id + cursor bound, limit + 1 for `next`). */
  private async scan<T extends { id: number }>(label: string, where: string[], params: Row, order: ScanOrder, after: number | undefined, limit: number) {
    if (after !== undefined) where = [...where, order === 'ascending' ? 'n.id > $after' : 'n.id < $after'];
    const rows = await this.q<{ rec: string }>(`MATCH (n:${label})${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
RETURN n.rec AS rec, n.id AS id ORDER BY id ${order === 'ascending' ? 'ASC' : 'DESC'} LIMIT $n`, { ...params, after, n: limit + 1 });
    return page<T>(rows, limit, order);
  }

  async scanConversations(query: ConversationQuery, limit: number, cursor: Cursor | undefined) {
    const { order, after } = scanStart(query.order, cursor, 'ascending');
    const where = [];
    if (query.ownerConversationId !== undefined) where.push('n.ownerConv = $oc');
    if (query.ownerTaskId !== undefined) where.push('n.ownerTask = $ot');
    return this.scan<ConversationRecord>('Conversation', where, { oc: query.ownerConversationId, ot: query.ownerTaskId }, order, after, limit);
  }

  // ---- entries: visibility walks (:Conversation)-[:FORKED_FROM {at}]->(:Conversation), each hop capping the range ----

  private async visible(conversationId: number, min: number, max: number, order: ScanOrder, n: number) {
    await this.ensureConversation(conversationId);
    return this.q<{ rec: string; seq: number }>(`MATCH p = (:Conversation {id: $conv})-[:FORKED_FROM*0..]->(a:Conversation)
WITH a, reduce(u = $max, f IN relationships(p) | CASE WHEN f.at < u THEN f.at ELSE u END) AS upper
MATCH (e:Entry)-[:IN]->(a) WHERE e.id >= $min AND e.id <= upper
RETURN e.rec AS rec, e.seq AS seq, e.id AS id ORDER BY id ${order === 'ascending' ? 'ASC' : 'DESC'} LIMIT $n`,
    { conv: conversationId, min, max, n });
  }

  entry(id: EntryId): Promise<{ entry: EntryRecord; commitSeq: Seq } | undefined>;
  entry(conversationId: ConversationId, id: EntryId): Promise<{ entry: EntryRecord; commitSeq: Seq } | undefined>;
  async entry(a: number, b?: unknown, c?: unknown) {
    let r;
    if (c === undefined) [r] = await this.q<{ rec: string; seq: number }>('MATCH (e:Entry {id: $id}) RETURN e.rec AS rec, e.seq AS seq', { id: a });
    else {
      if (typeof b !== 'number') throw new StorageRequestError('Storage.entry() requires an entry ID');
      [r] = await this.visible(a, b, b, 'descending', 1);
    }
    return r ? { entry: parse(r.rec) as EntryRecord, commitSeq: r.seq as Seq } : undefined;
  }

  async findLatestHeadMarker(conversationId: ConversationId, atOrBefore: EntryId | undefined) {
    await this.ensureConversation(conversationId);
    const [r] = await this.q<{ rec: string }>(`MATCH p = (:Conversation {id: $conv})-[:FORKED_FROM*0..]->(a:Conversation)
WITH a, reduce(u = $max, f IN relationships(p) | CASE WHEN f.at < u THEN f.at ELSE u END) AS upper
MATCH (e:Entry)-[:IN]->(a) WHERE e.head IS NOT NULL AND e.id <= upper
RETURN e.rec AS rec, e.id AS id ORDER BY id DESC LIMIT 1`, { conv: conversationId, max: atOrBefore ?? MAX });
    return r ? parse(r.rec) as EntryRecord & { head: EntryId } : undefined;
  }

  async scanEntries(query: EntryQuery, limit: number, cursor: Cursor | undefined) {
    const { order, after } = scanStart(query.order, cursor, 'descending');
    let min = query.minEntryId ?? 0, max = query.maxEntryId ?? MAX;
    if (after !== undefined && order === 'descending') max = Math.min(max, after - 1);
    if (after !== undefined && order === 'ascending') min = Math.max(min, after + 1);
    return page<EntryRecord>(await this.visible(query.conversationId, min, max, order, limit + 1), limit, order);
  }

  // ---- tasks and submissions ----

  async task(id: TaskId) {
    const [r] = await this.q<{ rec: string }>('MATCH (t:Task {id: $id}) RETURN t.rec AS rec', { id });
    return r ? parse(r.rec) as AnyTask : undefined;
  }

  async scanTasks(query: TaskQuery, limit: number, cursor: Cursor | undefined) {
    const { order, after } = scanStart(query.order, cursor, 'ascending');
    const where = [];
    if (query.conversationId !== undefined) where.push('n.conv = $conv');
    if (query.kind !== undefined) where.push('n.kindKey = $kind');
    if (query.status !== undefined) where.push('n.status = $status');
    if (query.abortRequested !== undefined) where.push('n.abortRequested = $abort');
    if (query.background !== undefined) where.push('n.background = $bg');
    return this.scan<AnyTask>('Task', where, {
      conv: query.conversationId, kind: query.kind === undefined ? null : J(query.kind), status: query.status ?? null,
      abort: query.abortRequested ?? null, bg: query.background ?? null,
    }, order, after, limit);
  }

  async submission(id: SubmissionId) {
    const [r] = await this.q<{ rec: string }>('MATCH (s:Submission {id: $id}) RETURN s.rec AS rec', { id });
    return r ? parse(r.rec) as SubmissionRecord : undefined;
  }

  async scanSubmissions(query: SubmissionQuery, limit: number, cursor: Cursor | undefined) {
    const { order, after } = scanStart(query.order, cursor, 'ascending');
    const where = [];
    if (query.conversationId !== undefined) where.push('n.conv = $conv');
    if (query.status !== undefined) where.push('n.status = $status');
    return this.scan<SubmissionRecord>('Submission', where, { conv: query.conversationId ?? null, status: query.status ?? null }, order, after, limit);
  }

  async submissionByRequest(conversationId: ConversationId, requestId: string) {
    const [r] = await this.q<{ rec: string }>('MATCH (s:Submission {reqKey: $k}) RETURN s.rec AS rec', { k: J([conversationId, requestId]) });
    return r ? parse(r.rec) as SubmissionRecord : undefined;
  }

  // ---- documents: (:Document) incarnations, (:Revision)-[:OF]->(:Document) bases and deltas ----

  private static record(r: Row): DocumentRecord {
    return { ...parse(r.rec), createdAt: r.createdAt, ...(r.retiredAt === null || r.retiredAt === undefined ? {} : { retiredAt: r.retiredAt }) };
  }

  async findDocument(address: DocumentAddress, at: DocumentPoint) {
    const [r] = await this.q(`MATCH (d:Document {addr: $addr}) WHERE ${alive('d', at)}
RETURN d.rec AS rec, d.createdAt AS createdAt, d.retiredAt AS retiredAt, d.id AS id ORDER BY id LIMIT 1`, { addr: addrKey(address), at });
    return r ? FalkorStorage.record(r) : undefined;
  }

  async document(id: DocumentId, at: DocumentPoint): Promise<StoredDocument | undefined> {
    const [r] = await this.q(`MATCH (d:Document {id: $id})
OPTIONAL MATCH (b:Revision {doc: $id}) WHERE b.kind = 'base' AND b.seq <= $upto
WITH d, max(b.seq) AS base
OPTIONAL MATCH (r:Revision {doc: $id}) WHERE r.seq >= base AND r.seq <= $upto
RETURN d.rec AS rec, d.createdAt AS createdAt, d.retiredAt AS retiredAt, collect({seq: r.seq, kind: r.kind, version: r.version, body: r.body}) AS revs`,
    { id, upto: at === 'current' ? MAX : at });
    if (!r) return undefined;
    const record = FalkorStorage.record(r);
    if (at !== 'current' && currentOnly(record)) throw new StorageRequestError(`Document ${id} does not retain historical content`);
    const live = at === 'current' ? record.retiredAt === undefined : record.createdAt <= at && (record.retiredAt === undefined || at < record.retiredAt);
    if (!live) return undefined;
    const revs = (r.revs as Row[]).filter((x) => x.seq !== null).sort((x, y) => x.seq - y.seq);
    const base = revs[0];
    if (base?.kind !== 'base') throw new Error(`Document ${id} is missing a required base`);
    const value = applyImmutableBatches(parse(base.body), deltas(id, base.version, revs.slice(1)));
    return { record, version: base.version, value, deltasSinceBase: revs.length - 1 };
  }

  async scanDocuments(query: DocumentQuery, limit: number, cursor: Cursor | undefined) {
    const { after } = scanStart(undefined, cursor, 'ascending');
    const where = [`d.scope = $scope`, alive('d', query.at), ...(query.kind === undefined ? [] : ['d.kindKey = $kind']), ...(after === undefined ? [] : ['d.id > $after'])];
    const rows = await this.q<{ rec: string }>(`MATCH (d:Document) WHERE ${where.join(' AND ')}
RETURN d.rec AS rec, d.createdAt AS createdAt, d.retiredAt AS retiredAt, d.id AS id ORDER BY id LIMIT $n`,
    { scope: scopeKey(query.scope), at: query.at, kind: query.kind === undefined ? null : J(query.kind), after, n: limit + 1 });
    return page<DocumentRecord>(rows, limit, 'ascending', FalkorStorage.record);
  }

  // ---- commit ----

  async commit(input: readonly StorageWrite[]): Promise<Seq> {
    if (this.closed) throw new Error('FalkorStorage is closed');
    const writes = await this.resolveCopies(input);
    await this.checkIds(writes);
    const actions = new Map<number, Action>();
    for (const w of writes) {
      if (w.type !== 'document.create' && w.type !== 'document.change' && w.type !== 'document.retire') continue;
      const id = w.type === 'document.create' ? w.record.id : w.id;
      const a = actions.get(id) ?? { retire: false };
      actions.set(id, a);
      if (w.type === 'document.retire') {
        if (a.retire) throw new Error(`Document ${id} is retired more than once`);
        a.retire = true;
        continue;
      }
      if (a.content !== undefined) throw new Error(`Document ${id} has more than one content command`);
      if (w.type === 'document.create') a.create = w.record;
      a.content = w.content;
    }
    const existing = await this.existingDocs([...actions].filter(([, a]) => !a.create).map(([id]) => id));
    // Address occupancy, as MemoryStorage.checkDocumentActions.
    const addrs = [...new Set([...actions].map(([id, a]) => (a.create ? addrKey(a.create) : existing.get(id)?.addr)).filter((x): x is string => !!x))];
    const current = new Map((await this.q<{ addr: string; rec: string }>(`UNWIND $addrs AS a MATCH (d:Document {addr: a}) WHERE d.retiredAt IS NULL
RETURN a AS addr, d.rec AS rec`, { addrs })).map((r) => [r.addr, parse(r.rec).id as number]));
    const live = new Map<string, number>();
    for (const [id, a] of actions) {
      const old = existing.get(id);
      if (!a.create && !old) throw new Error(`Unknown document: ${id}`);
      if (old?.retired) throw new Error(`Document ${id} is retired`);
      if (a.content?.kind === 'delta') {
        if (!a.create && old!.lastVersion === null) throw new Error(`Document ${id} delta has no base`);
        if (!a.create && old!.lastVersion !== a.content.version) throw new Error(`Document ${id} version transition requires a base`);
      }
      const key = a.create ? addrKey(a.create) : old!.addr;
      let n = live.get(key) ?? (current.has(key) ? 1 : 0);
      if (a.retire && current.get(key) === id) n--;
      if (a.create && !a.retire) n++;
      live.set(key, n);
    }
    if ([...live.values()].some((n) => n > 1)) throw new Error('Document address already has a current incarnation');

    const p = { convs: [] as Row[], forks: [] as Row[], entries: [] as Row[], tasks: [] as Row[], subs: [] as Row[],
      docs: [] as Row[], retire: [] as number[], purge: [] as number[], revs: [] as Row[], links: [] as Row[] };
    let maxId = 0;
    for (const w of writes) {
      if (w.type === 'conversation') {
        const v = w.value;
        p.convs.push({ id: v.id, rec: J(v), ownerConv: v.owner?.conversationId ?? null, ownerTask: v.owner?.taskId ?? null });
        if (v.parent) p.forks.push({ id: v.id, parent: v.parent.conversationId, at: v.parent.at });
      } else if (w.type === 'entry') {
        const v = w.value;
        // A tool result names its tool, and the id it returned (build_story's story id) becomes `ref`.
        const res = v.kind === 'pi.tool-result' ? v.model?.[0] as Row | undefined : undefined;
        p.entries.push({ id: v.id, conv: v.conversationId, kind: v.kind.toWellFormed(), head: v.head ?? null, task: v.byTaskId ?? null, rec: J(v),
          tool: typeof res?.toolName === 'string' ? res.toolName.toWellFormed() : null,
          ref: typeof res?.details?.id === 'string' ? res.details.id.toWellFormed() : null });
      } else if (w.type === 'task') {
        const v = w.value;
        p.tasks.push({ id: v.id, conv: v.conversationId, kind: v.kind.toWellFormed(), kindKey: J(v.kind), status: v.state.status,
          abort: v.abortRequested, bg: v.background, owner: v.owner ?? null, rec: J(v),
          call: v.kind === 'pi.tool' && (v.input as Row)?.kind === 'model' && typeof (v.input as Row).assistant === 'number' ? (v.input as Row).assistant : null });
      } else if (w.type === 'submission') {
        const v = w.value;
        p.subs.push({ id: v.id, conv: v.conversationId, status: v.status, reqKey: v.requestId === undefined ? null : J([v.conversationId, v.requestId]),
          entry: v.entry ?? null, answer: v.answer ?? null, rec: J(v) });
      } else continue;
      maxId = Math.max(maxId, w.value.id);
    }
    for (const [id, a] of actions) {
      const only = a.create ? currentOnly(a.create) : existing.get(id)!.currentOnly;
      if (a.create) {
        maxId = Math.max(maxId, id);
        const c = a.create;
        p.docs.push({ id, addr: addrKey(c), scope: scopeKey(c.scope), kind: c.kind.toWellFormed(), kindKey: J(c.kind), key: c.key?.toWellFormed() ?? null,
          currentOnly: only, retired: a.retire, rec: J(c) });
      } else if (a.retire) p.retire.push(id);
      if (!a.create && ((a.content?.kind === 'base' && only) || (a.retire && only))) p.purge.push(id);
      if (a.content && !(a.retire && only)) p.revs.push({ doc: id, kind: a.content.kind, version: a.content.version,
        body: J(a.content.kind === 'base' ? a.content.value : a.content.ops) });
    }
    const [r] = await this.q<{ seq: string }>(COMMIT, { ...p, maxId, now: Date.now() });
    for (const c of p.convs) this.known.add(c.id);
    return Number(r.seq) as Seq;
  }

  /** ID ownership across the one global namespace (MemoryStorage.checkGlobalIds). */
  private async checkIds(writes: readonly StorageWrite[]) {
    const claims = writes.flatMap((w) => w.type === 'document.change' || w.type === 'document.retire' ? []
      : [{ id: w.type === 'document.create' || w.type === 'document.copy' ? w.record.id : w.value.id, table: w.type.startsWith('document') ? 'document' : w.type }]);
    const ids = [...new Set(claims.map((c) => c.id))];
    const found = new Map((await this.q<{ id: string; type: string | null }>(`UNWIND $ids AS id
OPTIONAL MATCH (c:Conversation {id: id}) OPTIONAL MATCH (e:Entry {id: id}) OPTIONAL MATCH (t:Task {id: id})
OPTIONAL MATCH (s:Submission {id: id}) OPTIONAL MATCH (d:Document {id: id})
RETURN toString(id) AS id, CASE WHEN c IS NOT NULL THEN 'conversation' WHEN e IS NOT NULL THEN 'entry' WHEN t IS NOT NULL THEN 'task'
  WHEN s IS NOT NULL THEN 'submission' WHEN d IS NOT NULL THEN 'document' END AS type`, { ids })).map((r) => [Number(r.id), r.type]));
    const claimed = new Map<number, string>();
    for (const { id, table } of claims) {
      const had = found.get(id), earlier = claimed.get(id);
      if (table === 'conversation' || table === 'entry' || table === 'document') {
        if (had) throw new Error(`ID ${id} already belongs to ${had}`);
        if (earlier) throw new Error(`ID ${id} is written more than once`);
      } else {
        if (had && had !== table) throw new Error(`ID ${id} already belongs to ${had}`);
        if (earlier && earlier !== table) throw new Error(`ID ${id} is written as two record types`);
      }
      claimed.set(id, table);
    }
  }

  private async existingDocs(ids: number[]) {
    const rows = await this.q(`UNWIND $ids AS id MATCH (d:Document {id: id})
OPTIONAL MATCH (r:Revision {doc: id})
WITH id, d, max(r.seq) AS last
OPTIONAL MATCH (l:Revision {doc: id}) WHERE l.seq = last
RETURN toString(id) AS id, d.addr AS addr, d.retiredAt AS retiredAt, d.currentOnly AS currentOnly, l.version AS lastVersion`, { ids });
    return new Map<number, Existing>(rows.map((r) => [Number(r.id), { addr: r.addr, retired: r.retiredAt !== null, currentOnly: r.currentOnly, lastVersion: r.lastVersion }]));
  }

  /** `document.copy` becomes a `document.create` of the source's materialized base (MemoryStorage.resolveDocumentCopies). */
  private async resolveCopies(writes: readonly StorageWrite[]): Promise<readonly StorageWrite[]> {
    if (!writes.some((w) => w.type === 'document.copy')) return writes;
    const changed = new Set(writes.flatMap((w) => w.type === 'document.create' || w.type === 'document.copy' ? [w.record.id]
      : w.type === 'document.change' || w.type === 'document.retire' ? [w.id] : []));
    const out: StorageWrite[] = [];
    for (const w of writes) {
      if (w.type !== 'document.copy') { out.push(w); continue; }
      try {
        if (changed.has(w.source.id)) throw new Error(`Fork source document ${w.source.id} is changed in the copy batch`);
        const s = await this.document(w.source.id, w.source.at);
        if (!s) throw new Error(`Fork source document ${w.source.id} cannot be read`);
        const a = s.record as Row, b = w.record as Row;
        if (a.scope.kind !== 'conversation' || b.scope.kind !== 'conversation' || a.kind !== b.kind || a.key !== b.key || a.history !== b.history || a.fork !== b.fork) {
          throw new Error(`Fork source document ${w.source.id} does not match the copied record`);
        }
        out.push({ type: 'document.create', record: w.record, content: { kind: 'base', version: s.version, value: s.value } });
      } catch (error) {
        throw new Error(`Document copy ${w.record.id} was rejected`, { cause: error });
      }
    }
    return out;
  }
}

// The whole batch, one query. Subqueries keep the single outer row, so an empty list never cuts the rest short.
// Provenance edges: Entry-[:IN]->Conversation, Entry-[:BY_TASK]->Task (the tool or run task that appended it),
// Entry-[:CALLS]->Task (the assistant entry whose tool call the pi.tool task runs), tool-result Entry-[:WROTE]->Revision
// (app documents, e.g. mochi.story / mochi.queries, revised while its tool task ran; ponytail: parallel tool calls
// in one turn share that window, so each is linked to the others' revisions too; key by task id if that matters),
// Task-[:IN]->Conversation, Task-[:OWNED_BY]->Task, Submission-[:TO]->Conversation, Submission-[:PLACED_AT|ANSWERED_BY]->Entry,
// Revision-[:OF]->Document. Edges to optional targets use MATCH, so a dangling id never creates a stub node.
const COMMIT = `MATCH (m:Journal {id: 0})
SET m.seq = m.seq + 1, m.nextId = CASE WHEN $maxId >= m.nextId THEN $maxId + 1 ELSE m.nextId END
WITH m.seq AS seq
CALL { UNWIND $purge AS id MATCH (r:Revision {doc: id}) DELETE r }
CALL { WITH seq UNWIND $convs AS x CREATE (:Conversation {id: x.id, ownerConv: x.ownerConv, ownerTask: x.ownerTask, rec: x.rec, seq: seq, at: $now}) }
CALL { UNWIND $forks AS x MATCH (c:Conversation {id: x.id}), (p:Conversation {id: x.parent}) CREATE (c)-[:FORKED_FROM {at: x.at}]->(p) }
CALL { WITH seq UNWIND $entries AS x
  CREATE (e:Entry {id: x.id, conv: x.conv, kind: x.kind, head: x.head, task: x.task, tool: x.tool, ref: x.ref, rec: x.rec, seq: seq, at: $now})
  WITH e, x MATCH (c:Conversation {id: x.conv}) CREATE (e)-[:IN]->(c) }
CALL { WITH seq UNWIND $tasks AS x MERGE (t:Task {id: x.id})
  SET t.conv = x.conv, t.kind = x.kind, t.kindKey = x.kindKey, t.status = x.status, t.abortRequested = x.abort,
      t.background = x.bg, t.owner = x.owner, t.rec = x.rec, t.seq = seq, t.at = $now, t.first = coalesce(t.first, seq)
  WITH t, x MATCH (c:Conversation {id: x.conv}) MERGE (t)-[:IN]->(c) }
CALL { UNWIND $tasks AS x MATCH (t:Task {id: x.id}), (o:Task {id: x.owner}) MERGE (t)-[:OWNED_BY]->(o) }
CALL { UNWIND $tasks AS x MATCH (t:Task {id: x.id}), (a:Entry {id: x.call}) MERGE (a)-[:CALLS]->(t) }
CALL { UNWIND $entries AS x MATCH (e:Entry {id: x.id}), (t:Task {id: x.task}) CREATE (e)-[:BY_TASK]->(t) }
CALL { WITH seq UNWIND $entries AS x MATCH (e:Entry {id: x.id})-[:BY_TASK]->(t:Task) WHERE x.tool IS NOT NULL
  MATCH (r:Revision)-[:OF]->(d:Document) WHERE r.seq >= t.first AND r.seq < seq AND NOT d.kind STARTS WITH 'pi.'
  CREATE (e)-[:WROTE]->(r) }
CALL { WITH seq UNWIND $subs AS x MERGE (s:Submission {id: x.id})
  SET s.conv = x.conv, s.status = x.status, s.reqKey = x.reqKey, s.rec = x.rec, s.seq = seq, s.at = $now
  WITH s, x MATCH (c:Conversation {id: x.conv}) MERGE (s)-[:TO]->(c) }
CALL { UNWIND $subs AS x MATCH (s:Submission {id: x.id}), (e:Entry {id: x.entry}) MERGE (s)-[:PLACED_AT]->(e) }
CALL { UNWIND $subs AS x MATCH (s:Submission {id: x.id}), (e:Entry {id: x.answer}) MERGE (s)-[:ANSWERED_BY]->(e) }
CALL { WITH seq UNWIND $docs AS x
  CREATE (:Document {id: x.id, addr: x.addr, scope: x.scope, kind: x.kind, kindKey: x.kindKey, key: x.key, currentOnly: x.currentOnly,
    rec: x.rec, createdAt: seq, retiredAt: CASE WHEN x.retired THEN seq END, at: $now}) }
CALL { WITH seq UNWIND $retire AS id MATCH (d:Document {id: id}) SET d.retiredAt = seq }
CALL { WITH seq UNWIND $revs AS x
  CREATE (r:Revision {doc: x.doc, seq: seq, kind: x.kind, version: x.version, body: x.body, at: $now})
  WITH r, x MATCH (d:Document {id: x.doc}) CREATE (r)-[:OF]->(d) }
RETURN toString(seq) AS seq`;

export const openFalkorStorage = (opts?: Parameters<typeof FalkorStorage.open>[0]) => FalkorStorage.open(opts);
