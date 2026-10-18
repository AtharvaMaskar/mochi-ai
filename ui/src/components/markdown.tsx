// Story markdown: <num> tags become NumPills. No raw HTML reaches the renderer: each <num> is swapped for
// an inline-code token first, and the code renderer maps the token back to its pill.
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { NumPill } from './receipts.tsx';

const NUM = /<num query_id="([^"]*)" column="([^"]*)">([^<]*)<\/num>/g;
const TOKEN = /^§num(\d+)$/;

export function StoryMarkdown({ text }: { text: string }) {
  const nums: { query_id: string; column: string; value: string }[] = [];
  const md = text.replace(NUM, (_m, query_id: string, column: string, value: string) => {
    nums.push({ query_id, column, value: value.trim() });
    return `\`§num${nums.length - 1}\``;
  });
  return (
    <div className="mb-md">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
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
