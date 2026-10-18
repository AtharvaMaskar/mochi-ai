// Story markdown: <num> tags become NumPills. No raw HTML reaches the renderer: each <num> is swapped for
// an inline-code token first, and the code renderer maps the token back to its pill.
import { createContext, useContext, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { NumPill } from './receipts.tsx';

const NUM = /<num query_id="([^"]*)" column="([^"]*)">([^<]*)<\/num>/g;
const TOKEN = /^§num(\d+)$/;

/** true inside a chat turn that arrived live: its words blur in once (40 ms stagger, each batch capped at 600 ms). */
export const RevealWords = createContext(false);
type Hast = { type: string; tagName?: string; value?: string; children?: Hast[]; properties?: Record<string, unknown> };
/** Splits text into word spans. A word keeps the delay it got when it first appeared, so streamed text never replays. */
function revealPlugin(delays: number[]) {
  return () => (tree: Hast) => {
    let i = 0;
    const start = delays.length;
    const walk = (n: Hast) => {
      if (!n.children || n.tagName === 'code' || n.tagName === 'pre') return;
      n.children = n.children.flatMap((c): Hast[] => {
        if (c.type !== 'text') { walk(c); return [c]; }
        return (c.value ?? '').split(/(\s+)/).filter(Boolean).map((w) => {
          if (/^\s+$/.test(w)) return { type: 'text', value: w };
          const k = i++;
          delays[k] ??= Math.min((k - start) * 40, 600);
          return { type: 'element', tagName: 'span', properties: { className: ['mb-chat-word'], style: `animation-delay:${delays[k]}ms` }, children: [{ type: 'text', value: w }] };
        });
      });
    };
    walk(tree);
  };
}

export function StoryMarkdown({ text }: { text: string }) {
  const reveal = useContext(RevealWords), delays = useRef<number[]>([]);
  const nums: { query_id: string; column: string; value: string }[] = [];
  const md = text.replace(NUM, (_m, query_id: string, column: string, value: string) => {
    nums.push({ query_id, column, value: value.trim() });
    return `\`§num${nums.length - 1}\``;
  });
  return (
    <div className="mb-md">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={reveal ? [revealPlugin(delays.current)] : []} skipHtml components={{
        code: ({ children }) => {
          const m = String(children).match(TOKEN);
          return m ? <NumPill {...nums[Number(m[1])]} /> : <code>{children}</code>;
        },
        table: ({ children }) => <div className="mb-table-wrap"><table className="mb-table">{children}</table></div>,
        a: ({ children, href }) => <a href={href} rel="noreferrer">{children}</a>,
      }}>{md}</Markdown>
    </div>
  );
}
