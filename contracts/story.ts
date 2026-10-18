// Story contract (story-skill.md, SPEC §4). nao-style markdown + self-closing tags that reference
// stored query results by id. parseStory rejects any story whose numbers lack a valid receipt.
import { z } from 'zod';

export const StoredQuery = z.object({
  cypher: z.string().min(1),
  graph: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  ran_at: z.number().int(),
});
export type StoredQuery = z.infer<typeof StoredQuery>;

export const Story = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{16,}$/, 'id must be random and unguessable (16+ url-safe chars)'),
  version: z.number().int().min(1),
  title: z.string().min(1),
  generated_at: z.number().int(),
  generated_by: z.string().regex(/^(dream|user:.+)$/),
  topic: z.string(),
  queries: z.record(z.string().regex(/^q_\d+$/), StoredQuery),
  body: z.string(),
});
export type Story = z.infer<typeof Story>;

export const newStoryId = () => crypto.randomUUID().replaceAll('-', '');

export type NumRef = { query_id: string; column: string; value: string };
export type Visual =
  | { type: 'kpi'; query_id: string; label: string; column: string; unit?: string; promised?: number; bad?: boolean }
  | { type: 'bars'; query_id: string; label: string; x: string; y: string; trend?: string; hot?: string }
  | { type: 'line'; query_id: string; label: string; x: string; series: string[] }
  | { type: 'table'; query_id: string; label: string; columns: string[] }
  | { type: 'memdiff'; query_id: string }
  | { type: 'suggestion'; query_id: string; tag: string; edge: string; actions: string[]; text: string; nums: NumRef[] };
export type Segment =
  | { type: 'markdown'; text: string; nums: NumRef[] } // text keeps <num> tags for the renderer
  | Visual
  | { type: 'grid'; widths: number[]; children: Segment[] }
  | { type: 'note'; text: string };

export type ParseResult = { ok: true; story: Story; segments: Segment[] } | { ok: false; errors: string[] };

export const MAX_VISUALS = 6;
const REQUIRED: Record<string, string[]> = {
  num: ['query_id', 'column'], kpi: ['query_id', 'label', 'column'], bars: ['query_id', 'label', 'x', 'y'],
  line: ['query_id', 'label', 'x', 'series'], table: ['query_id', 'label', 'columns'], memdiff: ['query_id'],
  suggestion: ['query_id', 'tag', 'edge'], grid: ['widths'],
};
const JSON_ATTRS = new Set(['series', 'columns', 'actions']);
const TAG = /<(\/?)([a-z][a-z0-9_-]*)((?:\s+[a-z_]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR = /([a-z_]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

type Queries = Record<string, StoredQuery>;
const missingCols = (where: string, queries: Queries, qid: string, cols: (string | undefined)[]): string[] => {
  const q = queries[qid];
  if (!q) return [`${where}: unknown query_id ${qid}`];
  return cols.filter((c): c is string => c !== undefined && !q.columns.includes(c)).map((c) => `${where}: ${qid} has no column ${c}`);
};

// Query and column checks for one visual block. Shared by stories and chat tool cards.
export function checkVisual(v: Visual, queries: Queries): string[] {
  const where = `<${v.type} ${v.query_id}>`;
  switch (v.type) {
    case 'kpi': return missingCols(where, queries, v.query_id, [v.column]);
    case 'bars': return missingCols(where, queries, v.query_id, [v.x, v.y, v.trend, v.hot]);
    case 'line': return missingCols(where, queries, v.query_id, [v.x, ...v.series]);
    case 'table': return missingCols(where, queries, v.query_id, v.columns);
    case 'memdiff': return missingCols(where, queries, v.query_id, ['change', 'fact']);
    case 'suggestion': return [...missingCols(where, queries, v.query_id, []), ...v.nums.flatMap((n) => checkNum(n, queries))];
  }
}
export const checkNum = (n: NumRef, queries: Queries) => missingCols(`<num ${n.query_id}>`, queries, n.query_id, [n.column]);

export function parseStory(input: unknown): ParseResult {
  const parsed = Story.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const story = parsed.data;
  const errors: string[] = [];
  for (const [qid, q] of Object.entries(story.queries))
    if (!q.cypher.includes('$as_of')) errors.push(`${qid}: stored query must take $as_of`);

  // Tokenize into a tree: markdown text, known tags (with bodies for num/suggestion/grid), notes.
  type Frame = { tag: string; attrs: Record<string, string>; segs: Segment[]; text: string; nums: NumRef[] };
  const root: Frame = { tag: '', attrs: {}, segs: [], text: '', nums: [] };
  const stack: Frame[] = [root];
  const top = () => stack[stack.length - 1];
  const flush = (f: Frame) => { if (f.text.trim()) f.segs.push({ type: 'markdown', text: f.text, nums: f.nums }); f.text = ''; f.nums = []; };
  let visuals = 0, last = 0;

  const attrsOf = (raw: string) => Object.fromEntries([...raw.matchAll(ATTR)].map((m) => [m[1], m[2] ?? m[3]]));
  const visual = (tag: string, a: Record<string, string>, body: Frame | null): Visual | null => {
    const where = `<${tag}${a.query_id ? ` ${a.query_id}` : ''}>`;
    const missing = REQUIRED[tag].filter((k) => a[k] === undefined);
    if (missing.length) { errors.push(`${where}: missing ${missing.join(', ')}`); return null; }
    const json: Record<string, string[]> = {};
    for (const k of Object.keys(a)) if (JSON_ATTRS.has(k)) {
      try { const v = JSON.parse(a[k]); if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw 0; json[k] = v; }
      catch { errors.push(`${where}: ${k} must be a JSON array of strings`); return null; }
    }
    if (tag === 'grid') return null; // handled by caller
    visuals++;
    const q = a.query_id;
    switch (tag) {
      case 'kpi':
        return { type: 'kpi', query_id: q, label: a.label, column: a.column, unit: a.unit,
          promised: a.promised === undefined ? undefined : Number(a.promised), bad: a.bad === undefined ? undefined : a.bad === 'true' };
      case 'bars':
        return { type: 'bars', query_id: q, label: a.label, x: a.x, y: a.y, trend: a.trend, hot: a.hot };
      case 'line':
        return { type: 'line', query_id: q, label: a.label, x: a.x, series: json.series };
      case 'table':
        return { type: 'table', query_id: q, label: a.label, columns: json.columns };
      case 'memdiff':
        return { type: 'memdiff', query_id: q };
      case 'suggestion':
        return { type: 'suggestion', query_id: q, tag: a.tag, edge: a.edge, actions: json.actions ?? [],
          text: body?.text.trim() ?? '', nums: body?.nums ?? [] };
    }
    return null;
  };

  for (const m of story.body.matchAll(TAG)) {
    const [raw, closing, tag, rawAttrs, selfClose] = m;
    top().text += story.body.slice(last, m.index);
    last = m.index + raw.length;
    if (!(tag in REQUIRED)) { flush(top()); top().segs.push({ type: 'note', text: raw }); continue; }
    if (closing) {
      const f = top();
      if (f.tag !== tag) { errors.push(`unexpected </${tag}>`); continue; }
      stack.pop();
      const parent = top();
      if (tag === 'num') {
        const ref = { query_id: f.attrs.query_id, column: f.attrs.column, value: f.text.trim() };
        const missing = REQUIRED.num.filter((k) => f.attrs[k] === undefined);
        if (missing.length) errors.push(`<num>: missing ${missing.join(', ')}`);
        else errors.push(...checkNum(ref, story.queries));
        parent.nums.push(ref);
        parent.text += `<num query_id="${ref.query_id}" column="${ref.column}">${ref.value}</num>`;
      } else if (tag === 'grid') {
        flush(f);
        const widths = f.attrs.widths.split(',').map(Number);
        parent.segs.push({ type: 'grid', widths, children: f.segs });
      } else {
        const seg = visual(tag, f.attrs, f);
        if (seg) { errors.push(...checkVisual(seg, story.queries)); parent.segs.push(seg); }
      }
      continue;
    }
    const a = attrsOf(rawAttrs);
    if (selfClose || !['num', 'suggestion', 'grid'].includes(tag)) {
      flush(top());
      const seg = tag === 'num' || tag === 'grid' ? null : visual(tag, a, null);
      if (tag === 'num' || tag === 'grid') errors.push(`<${tag}> needs a body`);
      if (seg) { errors.push(...checkVisual(seg, story.queries)); top().segs.push(seg); }
      continue;
    }
    if (tag !== 'num') flush(top());
    if (tag === 'grid' && a.widths === undefined) errors.push('<grid>: missing widths');
    stack.push({ tag, attrs: a, segs: [], text: '', nums: [] });
  }
  top().text += story.body.slice(last);
  if (stack.length > 1) errors.push(`unclosed <${top().tag}>`);
  flush(root);
  if (visuals > MAX_VISUALS) errors.push(`${visuals} visual tags; max is ${MAX_VISUALS}`);
  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, story, segments: root.segs };
}
