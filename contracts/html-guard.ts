// Sandboxed-HTML guard (SPEC §4 last resort; CLAUDE.md chat exception). The model may lay out
// HTML, but styling is tokens-only, nothing loads or runs, and every figure is a placeholder
// filled from a stored query. Run by agent before emitting and by ui before rendering.
import type { StoredQuery } from './story.ts';

export const SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

type Queries = Record<string, StoredQuery>;
export type SandboxHtml = { html: string; css: string };

const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\s*\(/i;
const CSS_RULES: [RegExp, string][] = [
  [/font-family\s*:(?!\s*var\(--font-)/i, 'font-family must be var(--font-…)'],
  [/(^|[;{\s])font\s*:(?![^;}]*var\(--font-)/i, 'font shorthand must use var(--font-…)'],
  [/url\s*\(/i, 'url() is not allowed'],
  [/@import/i, '@import is not allowed'],
  [/expression\s*\(/i, 'expression() is not allowed'],
  [/counters?\s*\(/i, 'counter() would render numbers'],
  [/content\s*:[^;}]*\d/i, 'CSS content may not contain digits'],
];
const HTML_RULES: [RegExp, string][] = [
  [/<\s*(script|link|iframe|object|embed|meta|base|form|style\s[^>]*src)\b/i, 'disallowed element'],
  [/\son[a-z]+\s*=/i, 'event handler attribute'],
  [/javascript\s*:/i, 'javascript: URL'],
  [/\s(?:src|href|srcset|action|formaction|poster|data|xlink:href)\s*=\s*["']?\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i, 'external or scheme URL'],
];
const PLACEHOLDER = /<([a-z][a-z0-9]*)\b([^>]*\bdata-q\s*=\s*["'][^"']*["'][^>]*)>([\s\S]*?)<\/\1\s*>/gi;
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];

function cssSources(h: SandboxHtml): string[] {
  const blocks = [...h.html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1]);
  const inline = [...h.html.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2]);
  return [h.css, ...blocks, ...inline];
}

export function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
}

export function validateSandboxHtml(h: SandboxHtml, queries: Queries): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  for (const css of cssSources(h)) {
    const c = css.match(LITERAL_COLOR);
    if (c) errors.push(`literal colour "${c[0]}": use var(--…) from mochi.css`);
    for (const [re, why] of CSS_RULES) if (re.test(css)) errors.push(why);
  }
  for (const [re, why] of HTML_RULES) { const m = h.html.match(re); if (m) errors.push(`${why}: ${m[0].trim()}`); }

  const digits = visibleText(h.html).match(/[^\s]*\d[^\s]*/g);
  if (digits) errors.push(`literal numbers in text (use data-q/data-col placeholders): ${digits.slice(0, 5).join(' ')}`);

  const opened = (h.html.match(/\bdata-q\s*=/gi) ?? []).length;
  let closed = 0;
  for (const m of h.html.matchAll(PLACEHOLDER)) {
    closed++;
    const q = attr(m[2], 'data-q')!, col = attr(m[2], 'data-col'), row = Number(attr(m[2], 'data-row') ?? 0);
    const stored = queries[q];
    if (!stored) { errors.push(`placeholder: unknown query_id ${q}`); continue; }
    if (!col) { errors.push(`placeholder ${q}: missing data-col`); continue; }
    if (!stored.columns.includes(col)) errors.push(`placeholder ${q}: no column ${col}`);
    if (!Number.isInteger(row) || row < 0 || row >= stored.rows.length) errors.push(`placeholder ${q}.${col}: row ${row} out of range`);
  }
  if (closed !== opened) errors.push('every data-q placeholder needs a closing tag');
  return errors.length ? { ok: false, errors } : { ok: true };
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function fillPlaceholders(html: string, queries: Queries): string {
  return html.replace(PLACEHOLDER, (_all, tag: string, attrs: string) => {
    const q = queries[attr(attrs, 'data-q')!];
    const v = q?.rows[Number(attr(attrs, 'data-row') ?? 0)]?.[attr(attrs, 'data-col') ?? ''];
    return `<${tag}${attrs}>${escape(v === null || v === undefined ? '—' : String(v))}</${tag}>`;
  });
}
