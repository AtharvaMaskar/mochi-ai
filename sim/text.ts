// Text layer (design decision 2): skeletons carry {{PLACEHOLDERS}}, code decides every fact,
// Haiku may reword tone only, and a deterministic noise layer adds what real mail carries.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import type { Rng } from '../gen/rng.ts';

export const SUPPORT = 'support@ecorp-securities.example';
export const PROMPT_VERSION = 'v1';
export const PARAPHRASE_MODEL = 'claude-haiku-5-5';
export type Lang = 'en' | 'hinglish';

const IST = 5.5 * 3_600_000;
export const istDate = (t: number) => new Date(t + IST).toUTCString().slice(5, 16); // "14 Sep 2026"

// Language tag of a text, used to reject a paraphrase that switched language.
const HINGLISH = /\b(hai|nahi|kar|karo|kya|mera|mujhe|raha|rahi|gaya|kab|abhi|bhi|ho|kyun|paisa)\b/i;
export const detectLang = (s: string): Lang => (HINGLISH.test(s) ? 'hinglish' : 'en');
const placeholders = (s: string) => (s.match(/\{\{[A-Z_]+\}\}/g) ?? []).sort().join(',');

/** A reworded skeleton is usable only if it keeps every placeholder and the language, and stays plain text. */
export function validParaphrase(skeleton: string, lang: Lang, out: unknown): out is string {
  return typeof out === 'string' && out.trim().length > 0 && out.length < skeleton.length * 3 + 80
    && placeholders(out) === placeholders(skeleton) && detectLang(out) === lang && !/[<>]/.test(out);
}

export const fill = (s: string, slots: Record<string, string>) => s.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => slots[k] ?? `{{${k}}}`);

// ---- Customer skeletons ----
export const NUDGES = ['Any update on this?', 'Hello, is anyone looking into this?', 'Still waiting for a response on this.', 'Please update me on ticket #{{TICKET_ID}}.', 'Can someone please reply? It has been a while.'];
export const NUDGES_HI = ['Koi update hai kya?', 'Abhi tak reply nahi aaya, please check karo.', 'Ticket #{{TICKET_ID}} ka kya hua?'];
export const ESCALATION = ['This is the third time I am writing about this.', 'I will complain to the exchange if this is not fixed today.', 'NOBODY IS RESPONDING. This is unacceptable.', 'I am going to escalate this to the ombudsman.', 'Very poor service, I expected better from E Corp Securities.'];
export const WAIT_REPLY = ['PFA the screenshot you asked for.', 'Please find attached the document.', 'Sharing the details you asked for. My client code is {{CLIENT_CODE}}.', 'Attached the bank statement for {{DATE}}.'];
export const WAIT_REPLY_HI = ['Screenshot attach kar diya hai.', 'Jo document manga tha woh bhej diya hai.'];
export const REOPEN = ['This happened again today.', 'The same problem is back since {{DATE}}.', 'It worked for a day, now it is broken again.'];
export const THANKS = ['Thanks, it works now.', 'Thank you, resolved.', 'Got it, thanks a lot.', 'Thanks for the quick help.', 'Dhanyavaad, ho gaya.'];
export const SPAM = [
  ['Boost your website ranking in 7 days', 'We offer guaranteed first-page SEO for your domain. Reply for a free audit.'],
  ['Crypto opportunity: 40% monthly returns', 'Join our private trading signals group. Limited seats. Visit hxxp://quick-gains.example.'],
  ['Verify your account immediately', 'Your mailbox will be suspended. Verify your password at hxxp://mail-verify.example within 24 hours.'],
  ['Business proposal', 'Dear Sir, I have a confidential business proposal worth USD 4.5 million. Kindly reply.'],
  ['Cheap backlinks', 'High DA backlinks at low price. Bulk discounts available.'],
] as const;

// ---- Agent canned responses (template replies, research §7 #13) ----
export const CANNED = [
  'Hi {{NAME}}, thank you for writing to E Corp Securities. We have noted your concern under ticket #{{TICKET_ID}} and will update you shortly.',
  'Dear {{NAME}}, we regret the inconvenience caused. Our team is looking into ticket #{{TICKET_ID}}.',
  'Hi {{NAME}}, thanks for reaching out. Your request #{{TICKET_ID}} has been assigned to the concerned team.',
  'Hello {{NAME}}, we have received your email and are checking this on priority.',
  'Dear {{NAME}}, thank you for your patience. We are working on ticket #{{TICKET_ID}} and will revert within the committed timeline.',
  'Hi {{NAME}}, we understand this is frustrating. We are checking with the team and will get back to you.',
];
export const ASK = ['Hi {{NAME}}, could you please share a screenshot of the error?', 'Dear {{NAME}}, please share your registered mobile number and a screenshot of the issue.', 'Hi {{NAME}}, could you share the bank statement showing the debit?', 'Hi {{NAME}}, please confirm the date and time when this happened.'];
export const THIRD_PARTY = ['Hi {{NAME}}, we have raised this with our banking partner and are awaiting their confirmation.', 'Dear {{NAME}}, this is pending with the KYC registration agency. We will update you once they respond.'];
export const NOTES = ['Checked with payments team, UTR matches.', 'Customer called in as well, same issue.', 'Handing over to L2, see logs above.', '@{{AGENT}} can you take this one?', 'Verified identity on call.', 'Looks related to the latest release, flagging.', 'Gateway report pulled, attaching to the ticket.'];
export const SIGNOFF = ['Regards,\nE Corp Securities Support', 'Warm regards,\n{{AGENT}}\nE Corp Securities Support', 'Thanks,\n{{AGENT}} | Customer Care'];

// ---- Noise layer ----
const GREET = ['', '', 'Hi team,\n\n', 'Hello,\n\n', 'Dear support,\n\n', 'Namaste,\n\n', 'Hi,\n\n'];
const REGIONAL: Record<string, string[]> = { ta: ['வணக்கம்,\n\n'], mr: ['नमस्कार,\n\n'], hi: ['नमस्ते,\n\n'] };
export const DEVANAGARI = ['कृपया जल्दी मदद करें।', 'मेरी समस्या अभी तक हल नहीं हुई है।'];
const DISCLAIMER = '\n\nThis e-mail and any attachments are confidential and intended only for the addressee. If you received it in error, please delete it.';
const MOBILE = ['\n\nSent from my iPhone', '\n\nSent from my Android phone', '\n\nGet Outlook for Android'];

export type Noise = { greeting: boolean; regional: string | null; signature: boolean; disclaimer: boolean; mobile: boolean };
export function drawNoise(r: Rng, language: string): Noise {
  return {
    greeting: r.next() < 0.7,
    regional: REGIONAL[language] && r.next() < 0.25 ? language : null,
    signature: r.next() < 0.8, disclaimer: r.next() < 0.22, mobile: r.next() < 0.25,
  };
}
export function addNoise(core: string, n: Noise, name: string, pick: <T>(xs: readonly T[]) => T): string {
  const greet = n.regional ? REGIONAL[n.regional][0] : n.greeting ? pick(GREET) : '';
  const sig = n.signature ? `\n\n${pick(['Regards', 'Thanks', 'Thanks & regards', 'Best'])},\n${name}` : '';
  return `${greet}${core}${sig}${n.disclaimer ? DISCLAIMER : ''}${n.mobile ? pick(MOBILE) : ''}`;
}
export const quote = (body: string, at: number, who: string) =>
  `\n\nOn ${istDate(at)}, ${who} wrote:\n${body.split('\n').slice(0, 4).map((l) => `> ${l}`).join('\n')}`;
export const forwardWrap = (body: string, at: number, fromName: string, fromEmail: string, subject: string) =>
  `Forwarding my earlier mail, please check.\n\n---------- Forwarded message ---------\nFrom: ${fromName} <${fromEmail}>\nDate: ${istDate(at)}\nSubject: ${subject}\nTo: ${SUPPORT}\n\n${body}`;

// ---- Paraphrase (Haiku), cached ----
const STYLES = ['terse', 'polite', 'frustrated', 'rambling', 'formal'] as const;
export type Para = { skeleton: string; lang: Lang; style: string };
export const drawStyle = (r: Rng) => r.pick(STYLES);
const keyOf = (p: Para) => createHash('sha256').update(`${createHash('sha256').update(p.skeleton).digest('hex')}|${p.style}|${PROMPT_VERSION}`).digest('hex');

const SYSTEM = `You reword customer support emails written to an Indian stock broker. For each input, write the same message in the requested tone.
Rules: keep every {{PLACEHOLDER}} exactly as written (same spelling, braces, count). Do not add any fact, number, name, date, amount or id.
Keep the language: English stays English; Hinglish (Hindi in Latin script) stays Hinglish. Plain text only, no HTML, no greeting or signature. Keep each rewrite about as long as the input (never more than twice as long).
Reply with a JSON array of strings, one per input, same order, nothing else.`;

export type ParaStats = { cached: number; called: number; calls: number; rejected: number; input: number; output: number; cost: number };

/** Returns the reworded text per item (template when the cache/LLM result fails validation). Never calls the LLM when `offline`. */
export async function paraphraseAll(items: Para[], cacheFile: URL, { offline = false } = {}): Promise<{ texts: string[]; stats: ParaStats }> {
  const cache = new Map<string, string>();
  if (existsSync(cacheFile)) for (const line of readFileSync(cacheFile, 'utf8').split('\n').filter(Boolean)) { const x = JSON.parse(line); cache.set(x.key, x.text); }
  const stats: ParaStats = { cached: 0, called: 0, calls: 0, rejected: 0, input: 0, output: 0, cost: 0 };
  const missing = [...new Map(items.map((p) => [keyOf(p), p])).entries()].filter(([k]) => !cache.has(k));
  if (missing.length && !offline) {
    const complete = await llm();
    const BATCH = 10, PAR = 6;
    const batches: [string, Para][][] = [];
    for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));
    for (let i = 0; i < batches.length; i += PAR) {
      await Promise.all(batches.slice(i, i + PAR).map(async (b) => {
        const prompt = JSON.stringify(b.map(([, p]) => ({ tone: p.style, language: p.lang === 'en' ? 'English' : 'Hinglish', text: p.skeleton })));
        let out: unknown[] = [];
        try {
          const res = await complete(SYSTEM, prompt);
          stats.calls++; stats.input += res.input; stats.output += res.output; stats.cost += res.cost;
          out = JSON.parse(res.text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
        } catch (e) { console.warn(`paraphrase batch failed, using templates: ${(e as Error).message}`); }
        // A failed batch is not cached, so the next run retries it; a bad item is cached and falls back to the template.
        if (out.length === b.length) b.forEach(([k], j) => { cache.set(k, typeof out[j] === 'string' ? (out[j] as string) : ''); stats.called++; });
      }));
    }
    mkdirSync(new URL('.', cacheFile), { recursive: true });
    writeFileSync(cacheFile, [...cache].sort(([a], [b]) => a.localeCompare(b)).map(([key, text]) => JSON.stringify({ key, text })).join('\n') + '\n');
  }
  const texts = items.map((p) => {
    const k = keyOf(p);
    if (cache.has(k)) stats.cached++;
    const t = cache.get(k);
    if (t !== undefined && validParaphrase(p.skeleton, p.lang, t)) return t;
    if (t !== undefined) stats.rejected++;
    return p.skeleton;
  });
  return { texts, stats };
}

async function llm() {
  const { createModels } = await import('@earendil-works/pi-ai');
  const { anthropicProvider } = await import('@earendil-works/pi-ai/providers/anthropic');
  try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* real environment */ }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('missing ANTHROPIC_API_KEY: cannot fill the paraphrase cache (run with --templates-only)');
  const models = createModels();
  models.setProvider(anthropicProvider());
  const model = models.getModel('anthropic', PARAPHRASE_MODEL);
  if (!model) throw new Error(`${PARAPHRASE_MODEL} not in the pi-ai catalog`);
  return async (systemPrompt: string, content: string) => {
    const msg = await models.complete(model, { systemPrompt, messages: [{ role: 'user', content, timestamp: 0 }] }, { maxTokens: 4096 });
    if (msg.stopReason === 'error' || msg.stopReason === 'aborted') throw new Error(msg.errorMessage ?? msg.stopReason);
    const text = msg.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('').trim();
    return { text, input: msg.usage.input + msg.usage.cacheRead + msg.usage.cacheWrite, output: msg.usage.output, cost: msg.usage.cost.total };
  };
}
