// A dream Suggestion as a receipt-bearing story/card block. Shared by the morning report (agent/dream/report.ts) and
// the per-ticket briefing (agent/queries/index.ts), so the agent never imports dream/ statically (dream-port rule).
const clean = (s: string) => s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
export const num = (q: string, col: string, v: unknown) => `<num query_id="${q}" column="${col}">${v}</num>`;
const attr = (s: string) => s.replace(/["'<>]/g, '');

/** Wrap each number in model prose that equals a stored column value; leave the rest as text. */
function receipt(text: string, qid: string, row: Record<string, unknown>): string {
  return clean(text).replace(/\d+(?:\.\d+)?/g, (m) => {
    const col = Object.keys(row).find((k) => typeof row[k] === 'number' && String(row[k]) === m);
    return col ? num(qid, col, m) : m;
  });
}

/** One suggestion block from a stored suggestion row (edge, target, team, text, support, measured, promised): the
 *  model's prose with its digits wrapped, then the facts, every number a <num> on `qid`. Report and briefing share it. */
export function suggestionBlock(qid: string, row: Record<string, unknown>) {
  const contradicts = row.edge === 'CONTRADICTS';
  const facts = contradicts
    ? `Measured ${num(qid, 'measured', row.measured)}h against a promised ${num(qid, 'promised', row.promised)}h, over ${num(qid, 'support', row.support)} tickets.`
    : `Seen on ${num(qid, 'support', row.support)} tickets, and in no document.`;
  const text = `${receipt(String(row.text ?? ''), qid, row)} ${facts}`.trim();
  const nums = [...text.matchAll(/<num query_id="(q_\d+)" column="(\w+)">([^<]*)<\/num>/g)].map(([, query_id, column, value]) => ({ query_id, column, value }));
  return {
    type: 'suggestion' as const, query_id: qid, edge: String(row.edge),
    // Name the thing: three identical headlines in a report read as boilerplate. No digits here (they'd need receipts).
    tag: contradicts ? `${attr(String(row.target))} no longer matches practice` : `A workaround the ${attr(String(row.team))} team uses, undocumented`,
    actions: [`send_to_team:${attr(String(row.team))}`, ...(contradicts ? [`draft_kb:${attr(String(row.target))}`] : []), 'dismiss'],
    text, nums,
  };
}
