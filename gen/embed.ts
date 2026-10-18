// Sentence embeddings shared by loader, agent vector fallback and bench vector arm.
// Product and bench use OpenAI (OPENAI_API_KEY); the local model is an offline fallback for
// tests (EMBED_PROVIDER=local). The two have different sizes, so one graph uses one provider.
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

const provider = () => process.env.EMBED_PROVIDER ?? (process.env.OPENAI_API_KEY ? 'openai' : 'local');
const OPENAI_MODEL = 'text-embedding-3-small';
const LOCAL_MODEL = 'Xenova/all-MiniLM-L6-v2';

export const EMBED_MODEL = provider() === 'openai' ? OPENAI_MODEL : LOCAL_MODEL;
export const EMBED_DIM = provider() === 'openai' ? 1536 : 384;

export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  return provider() === 'openai' ? embedOpenAI(texts) : embedLocal(texts);
}

async function embedOpenAI(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 256) { // ponytail: sequential batches; parallelise if loads get slow
    const input = texts.slice(i, i + 256).map((t) => t.slice(0, 8000) || ' ');
    for (let attempt = 0; ; attempt++) {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: OPENAI_MODEL, input }),
      });
      if (res.ok) {
        const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
        out.push(...body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
        break;
      }
      const msg = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < 4 && !/spend limit|quota/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw new Error(`OpenAI embeddings failed (${res.status}): ${msg.slice(0, 200)}`);
    }
  }
  return out;
}

let extractor: Promise<FeatureExtractionPipeline> | undefined;
async function embedLocal(texts: string[]): Promise<number[][]> {
  extractor ??= pipeline('feature-extraction', LOCAL_MODEL, { dtype: 'fp32' }).catch((err) => {
    extractor = undefined;
    throw new Error(`could not load embedding model ${LOCAL_MODEL} (first run downloads ~25 MB): ${err.message}`);
  });
  const res = await (await extractor)(texts, { pooling: 'mean', normalize: true });
  return res.tolist() as number[][];
}
