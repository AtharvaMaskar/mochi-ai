import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generate, cssVar } from './gen-css.ts';

const tokens = JSON.parse(readFileSync(new URL('../docs/design-system/tokens.json', import.meta.url), 'utf8'));
const css = generate(tokens);

test('deterministic and matches the committed file', () => {
  assert.equal(generate(tokens), css);
  assert.equal(readFileSync(new URL('./mochi.css', import.meta.url), 'utf8'), css);
});

test('every token appears as a custom property', () => {
  const names = [
    ...tokens.color.tokens,
    ...['spacing', 'radius', 'shadow', 'layout', 'shape'].flatMap((f) => tokens[f]?.tokens ?? []),
  ].map((t: { name: string }) => t.name);
  for (const n of names) assert.ok(css.includes(`${cssVar(n)}:`), n);
});

test('themes: light default, dark by attribute and by system, warm by attribute', () => {
  assert.match(css, /:root \{[^}]*--bg-page: #F7F8FA;/);
  assert.match(css, /:root\[data-theme="dark"\] \{[^}]*--bg-page: #0E1116;/);
  assert.match(css, /prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme\]\) \{[^}]*--bg-page: #0E1116;/);
  assert.match(css, /:root\[data-theme="warm"\] \{[^}]*--bg-page: #FBFAF7;/);
});

test('type styles, mono data, reduced motion', () => {
  assert.match(css, /\.t-data \{\s*font-family: var\(--font-mono\);\s*font-size: 12px;/);
  assert.match(css, /\.t-mochi-mood \{[^}]*font-style: italic;/);
  assert.match(css, /fonts\.googleapis\.com[^']*IBM\+Plex\+Sans[^']*IBM|IBM\+Plex\+Mono/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
