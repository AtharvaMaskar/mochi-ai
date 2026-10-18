// Scoring (spec "Scoring"): normalized exact match for `exact`, the judge for `judge`, with two
// extra votes only when the first vote disagrees with the normalized-containment heuristic.
import { readFileSync } from 'node:fs';
import type { EvalQuestion } from '@mochi/contracts';
import type { Llm } from './llm.ts';

export const JUDGE_PATH = 'bench/judge.md';
const JUDGE = readFileSync(new URL('./judge.md', import.meta.url), 'utf8');

export const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, ' ').replace(/(^|\s)\.+|\.+(\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
export const contains = (answer: string, truth: string) => ` ${normalize(answer)} `.includes(` ${normalize(truth)} `);

export type Vote = { question_id: string; arch: string; answer: string; truth: string; votes: boolean[]; heuristic: boolean; correct: boolean };

export async function score(llm: Llm, q: EvalQuestion, arch: string, answer: string, votes: Vote[]): Promise<boolean> {
  if (q.scoring === 'exact') return normalize(answer) === normalize(q.answer);
  const prompt = JUDGE.replace('{{question}}', q.question).replace('{{truth}}', q.answer).replace('{{answer}}', answer);
  const vote = async () => /^\W*correct\b/i.test((await llm.complete('judge', prompt, { model: llm.judgeModel, maxTokens: 512 })).text);
  const heuristic = contains(answer, q.answer);
  const vs = [await vote()];
  if (vs[0] !== heuristic) vs.push(await vote(), await vote());
  const correct = vs.filter(Boolean).length * 2 > vs.length;
  votes.push({ question_id: q.id, arch, answer, truth: q.answer, votes: vs, heuristic, correct });
  return correct;
}
