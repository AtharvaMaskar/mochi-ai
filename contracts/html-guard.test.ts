import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSandboxHtml, fillPlaceholders } from './html-guard.ts';

const queries = {
  q_1: { cypher: 'MATCH (t:Ticket) WHERE t.created_at <= $as_of RETURN 1', graph: 'mochi_company', params: {},
    columns: ['median_h', 'note'], rows: [{ median_h: 7.2, note: 'a<b' }, { median_h: 9.1, note: 'x' }], ran_at: 1 },
};
const ok = (html: string, css = '') => validateSandboxHtml({ html, css }, queries);
const errs = (html: string, css = '') => { const r = ok(html, css); return r.ok ? '' : r.errors.join(' | '); };

test('tokens-only CSS', () => {
  assert.match(errs('<p>Hi</p>', 'p { color: #c2410c }'), /literal colour "#c2410c"/);
  assert.equal(errs('<p>Hi</p>', 'p { color: var(--ink); font-family: var(--font-sans) }'), '');
  assert.match(errs('<p style="background:#fff">Hi</p>'), /literal colour/);
  assert.equal(errs('<style>.k { color: var(--ink-muted) }</style><p class="k">Hi</p>'), '');
  assert.match(errs('<p>Hi</p>', 'p { font-family: Arial }'), /font-family/);
  assert.match(errs('<p>Hi</p>', 'p::after { content: "7" }'), /CSS content/);
});

test('no network, no scripts', () => {
  assert.match(errs('<script src="https://cdn.example/x.js"></script>'), /disallowed element/);
  assert.match(errs('<div onclick="x()">Hi</div>'), /event handler/);
  assert.match(errs('<a href="https://evil.example">Go</a>'), /external or scheme URL/);
  assert.match(errs('<a href="javascript:alert(1)">Go</a>'), /javascript/);
  assert.equal(errs('<a href="#section">Go</a>'), '');
  assert.match(errs('<p>Hi</p>', 'p { background: url(x.png) }'), /url\(\)/);
});

test('no literal numbers; placeholders filled from the receipt', () => {
  assert.match(errs('<p>Median 7.2h</p>'), /literal numbers in text.*7\.2h/);
  const html = '<p>Median <b data-q="q_1" data-col="median_h"></b>h, then <i data-q="q_1" data-col="median_h" data-row="1">—</i></p>';
  assert.equal(errs(html), '');
  const filled = fillPlaceholders(html, queries);
  assert.match(filled, /<b data-q="q_1" data-col="median_h">7\.2<\/b>/);
  assert.match(filled, /data-row="1">9\.1<\/i>/);
});

test('placeholder errors', () => {
  assert.match(errs('<b data-q="q_9" data-col="n"></b>'), /unknown query_id q_9/);
  assert.match(errs('<b data-q="q_1" data-col="nope"></b>'), /no column nope/);
  assert.match(errs('<b data-q="q_1" data-col="median_h" data-row="5"></b>'), /row 5 out of range/);
  assert.match(errs('<b data-q="q_1" data-col="median_h">'), /closing tag/);
  assert.match(errs('<b data-q="q_1" data-col="median_h">7</b>'), /literal numbers/);
});

test('filled values are escaped as text', () => {
  assert.match(fillPlaceholders('<span data-q="q_1" data-col="note"></span>', queries), />a&lt;b</);
});
