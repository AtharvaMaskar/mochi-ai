// Arm C: file memory (the open Agent Memory Repo spec, not Devin the product). An LLM dream pass
// writes MEMORY.md plus per-area notes; answering is a pick-files call, then an answer call.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { add, ZERO, type Usage } from '../llm.ts';
import { ANSWER_SYSTEM, ask, corpus, eventText, timed, type Arm, type Ctx } from './index.ts';

const FORMAT = 'Output every file as a line "=== FILE: <name>.md ===" followed by its content. Output nothing else.';
const DREAM = 'You maintain a file-based memory for a support team. From the records below, write MEMORY.md '
  + '(an index: one line per file, naming it and what it covers) and one note per product area (area-<name>.md), '
  + 'plus any other notes you need. Keep every fact needed to answer questions about customers and their plans, '
  + 'tickets, issues, releases, resolutions, KB articles, agents and teams, with their ids.\n' + FORMAT;
const MAINTAIN = 'You maintain a file-based memory for a support team. A new event happened. Rewrite every memory file '
  + 'the event affects so it reflects the event, and update MEMORY.md if needed. Output only the files you changed.\n' + FORMAT;

export function parseFiles(text: string, fallback = true): Map<string, string> {
  const files = new Map<string, string>();
  const parts = text.split(/^=== FILE: (.+?) ===\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i].trim().split('/').pop()!.replace(/[^A-Za-z0-9_.-]/g, '_');
    if (name) files.set(name.endsWith('.md') ? name : `${name}.md`, parts[i + 1].trim());
  }
  if (fallback && !files.size && text.trim()) files.set('MEMORY.md', text.trim()); // model ignored the format: keep what it wrote
  return files;
}

export const LESSONS = 'LESSONS.md';

/** o.dreamed: share one dream pass between instances (filled on first prepare). o.lessons: an append-only LESSONS.md
 *  added after the dream; the maintain pass never sees or rewrites it (bench/arms/lessons.ts). */
export function armC(ctx: Ctx, o: { dreamed?: Map<string, string>; lessons?: string; dir?: string } = {}): Arm {
  const dir = join(ctx.artifacts, o.dir ?? 'memory');
  let files = new Map<string, string>();
  const dump = (f: Map<string, string>) => f.size ? [...f].map(([n, c]) => `=== FILE: ${n} ===\n${c}`).join('\n\n') : '(empty)';
  const save = () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [n, c] of files) writeFileSync(join(dir, n), c + '\n');
  };

  return {
    arch: 'C',
    async prepare() {
      let usage = ZERO;
      if (o.dreamed?.size) files = new Map(o.dreamed);
      else {
        const r = await ctx.llm.complete('arm_c_dream', corpus(ctx.dataset), { system: DREAM, maxTokens: 32000 });
        files = parseFiles(r.text);
        usage = r.usage;
        for (const [n, c] of files) o.dreamed?.set(n, c);
      }
      if (o.lessons) {
        files.set(LESSONS, o.lessons);
        files.set('MEMORY.md', `${files.get('MEMORY.md') ?? ''}\n${LESSONS}: one lesson per resolved ticket (summary, cause, fix, KB), appended as tickets close.`.trim());
      }
      save();
      return usage;
    },
    async answer(q) {
      let usage: Usage;
      const [chosen, retrieval_ms] = await timed(async () => {
        const index = files.get('MEMORY.md') ?? [...files.keys()].join('\n');
        const pick = await ctx.llm.complete('arm_c_pick',
          `MEMORY.md:\n${index}\n\nAvailable files: ${[...files.keys()].join(', ')}\n\nQuestion: ${q.question}\n\nReply with the file names to read, one per line, nothing else.`);
        usage = pick.usage;
        const want = new Set(pick.text.split(/[\s,]+/).map((s) => s.replace(/[`*"']/g, '').split('/').pop()!));
        return new Map([...files].filter(([n]) => want.has(n) || n === 'MEMORY.md'));
      });
      const r = await ctx.llm.complete('arm_c', ask(dump(chosen), q), { system: ANSWER_SYSTEM });
      return { answer: r.text, usage: add(usage!, r.usage), retrieval_ms, reads: chosen.size };
    },
    async apply(e) {
      const [r, ms] = await timed(() => ctx.llm.complete('arm_c_maintain', `${dump(new Map([...files].filter(([n]) => n !== LESSONS)))}\n\nEvent:\n${eventText(e)}`, { system: MAINTAIN, maxTokens: 32000 }));
      for (const [n, c] of parseFiles(r.text, false)) if (n !== LESSONS) files.set(n, c);
      save();
      return { usage: r.usage, ms };
    },
  };
}
