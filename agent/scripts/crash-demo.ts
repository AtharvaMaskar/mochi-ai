// Crash demo (SPEC §4, the 15-second clip): submit a ticket with a fixed requestId, kill -9 the process after the
// first tool call starts, reopen the same SQLite, resume(), resubmit the same requestId -> the original submission
// returns and completes with one answer. Real model (MOCHI_MODEL) and the real FalkorDB, read-only.
//   npm run crash-demo -w agent
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { AssistantEntry, defineExtension, hook, ToolTask, watchEvents } from '@earendil-works/pi-durable';
import { GRAPH } from '@mochi/contracts';
import { closeAll, reader } from '../db.ts';
import { openHarness } from '../harness.ts';

const REQUEST_ID = 'crash-demo-1';
const say = (step: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ step, ...data }));

async function child(mode: 'start' | 'resume', storage: string, ticket: string) {
  // In the first process, hold every tool result for a few seconds before it commits, so the kill lands mid-tool.
  const hold = defineExtension({ name: 'crash-hold', hooks: [hook(ToolTask, { afterTool: async (_call, result) => { await sleep(5000); return result; } })] });
  const pi = await openHarness({ storage, extra: mode === 'start' ? [hold] : [] });
  const stream = await watchEvents(pi.harness, pi.root.id, ctx);
  stream.start(async (events) => {
    for (const ev of events) if (ev.type === 'tool_execution_start') say('tool_start', { tool: ev.toolName, args: ev.args });
  });
  const sub = await pi.root.submit({ type: 'input', content: `Brief me on ticket ${ticket}.`, requestId: REQUEST_ID }, ctx);
  say('submitted', { mode, submission: sub.id });
  const settled = await sub.wait(ctx);
  let answer = '';
  if (settled.status === 'done' && 'answer' in settled) {
    const e = await pi.root.commit((tx) => tx.entry(AssistantEntry, settled.answer as never), ctx);
    answer = ((e?.model?.[0] as { content?: { type: string; text?: string }[] })?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  }
  const inputs = (await pi.root.entries({ order: 'ascending' }, 500, undefined, ctx)).items.filter((e) => e.kind === 'pi.user').length;
  say('settled', { mode, submission: sub.id, status: settled.status, user_inputs: inputs, answer: answer.slice(0, 300) });
  await stream.stop();
  await pi.close();
  await closeAll();
}

type Line = { step: string; [k: string]: unknown };
function run(args: string[], onLine: (l: Line, kill: () => void) => void) {
  const p = spawn(process.execPath, [...process.execArgv, import.meta.filename, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines: Line[] = [];
  createInterface({ input: p.stdout! }).on('line', (raw) => {
    let l: Line;
    try { l = JSON.parse(raw); } catch { return console.log(raw); }
    lines.push(l);
    console.log(`  [${args[1]}] ${l.step} ${JSON.stringify({ ...l, step: undefined })}`);
    onLine(l, () => p.kill('SIGKILL'));
  });
  return new Promise<{ code: number | null; signal: string | null; lines: Line[] }>((r) => p.on('exit', (code, signal) => r({ code, signal, lines })));
}

async function main() {
  const storage = join(mkdtempSync(join(tmpdir(), 'mochi-crash-')), 'pi.sqlite');
  const ticket = process.env.MOCHI_CRASH_TICKET
    ?? String((await (await reader()).selectGraph(GRAPH.company).roQuery<{ id: string }>('MATCH (t:Ticket) RETURN t.id AS id ORDER BY t.created_at DESC, t.id LIMIT 1')).data?.[0]?.id ?? 'T-1');
  await closeAll();
  console.log(`1. submit "Brief me on ticket ${ticket}" with requestId ${REQUEST_ID} (store ${storage})`);
  const first = await run(['--child', 'start', storage, ticket], (l, kill) => {
    if (l.step === 'tool_start') { console.log('2. first tool call started -> kill -9'); kill(); }
  });
  if (first.signal !== 'SIGKILL') throw new Error(`first process was not killed (exit ${first.code}); no tool call?`);
  const submitted = first.lines.find((l) => l.step === 'submitted')!.submission;

  console.log('3. reopen the same SQLite, resume(), resubmit the same requestId');
  const second = await run(['--child', 'resume', storage, ticket], () => {});
  const settled = second.lines.find((l) => l.step === 'settled');
  if (second.code !== 0 || !settled) throw new Error('resume process failed');
  const same = settled.submission === submitted;
  console.log(`4. submission ${String(settled.submission)} ${same ? '==' : '!='} ${String(submitted)} · status ${String(settled.status)} · user inputs ${String(settled.user_inputs)}`);
  if (!same || settled.status !== 'done' || settled.user_inputs !== 1 || !settled.answer) throw new Error('crash demo failed');
  console.log('OK: the original submission returned and completed with one answer.');
}

if (process.argv[2] === '--child') await child(process.argv[3] as 'start' | 'resume', process.argv[4], process.argv[5]);
else await main();
