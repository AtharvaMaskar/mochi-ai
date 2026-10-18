// Sandboxed HTML (SPEC §4 last resort): guard first, then fill placeholders, then an iframe with the
// contract CSP, mochi.css variables and sandbox="" (no scripts, forms or same-origin).
import { validateSandboxHtml, fillPlaceholders, SANDBOX_CSP, type SandboxHtml, type StoredQuery } from '@mochi/contracts';
import mochiCss from '@mochi/contracts/mochi.css?raw';
import { ReceiptProvider, QueryTag } from './receipts.tsx';
import { NeedsYou } from './ds.tsx';

// every plain :root block: the colour tokens and the type scale variables
const ROOT_VARS = (mochiCss.match(/:root\s*\{[^}]*\}/g) ?? []).join('\n');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export function SandboxFrame({ value, queries, height = 320 }: { value: SandboxHtml; queries: Record<string, StoredQuery>; height?: number }) {
  const r = validateSandboxHtml(value, queries);
  if (!r.ok) {
    return <NeedsYou mood="sorry" title="I didn't render this layout"
      reason={<>It broke the sandbox rules:<ul>{r.errors.map((e) => <li key={e}>{e}</li>)}</ul></>} />;
  }
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(SANDBOX_CSP)}">
<style>${ROOT_VARS} body { margin: 0; padding: var(--space-4); font-family: var(--font-sans); font-size: var(--fs-body); line-height: var(--lh-body); color: var(--ink); background: var(--bg-surface); }</style>
<style>${value.css}</style></head><body>${fillPlaceholders(value.html, queries)}</body></html>`;
  const used = [...new Set([...value.html.matchAll(/data-q\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]))];
  return (
    <ReceiptProvider queries={queries}>
      <div className="mb-sandbox">
        <iframe title="Mochi's layout" sandbox="" srcDoc={srcDoc} style={{ height }} />
        <div className="mb-sandbox-foot">Figures filled from {used.map((q) => <QueryTag key={q} qid={q} />)}</div>
      </div>
    </ReceiptProvider>
  );
}
