// Local sentence embeddings shared by loader, agent vector fallback and bench vector arm.
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBED_DIM = 384;

let extractor: Promise<FeatureExtractionPipeline> | undefined;

export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  extractor ??= pipeline('feature-extraction', EMBED_MODEL, { dtype: 'fp32' }).catch((err) => {
    extractor = undefined;
    throw new Error(`could not load embedding model ${EMBED_MODEL} (first run downloads ~25 MB): ${err.message}`);
  });
  const out = await (await extractor)(texts, { pooling: 'mean', normalize: true });
  return out.tolist() as number[][];
}
