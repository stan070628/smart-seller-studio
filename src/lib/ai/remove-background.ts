import sharp from 'sharp';
import type { ReferenceImage } from './reference-images';

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
const REMBG_VERSION = 'fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003';
const POLLING_INTERVAL_MS = 500;
const POLLING_TIMEOUT_MS = 60_000;

type ReplicatePrediction = {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed';
  output?: string;
  error?: string;
};

async function fetchRembgPng(ref: ReferenceImage): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN not set');

  const dataUrl = `data:${ref.mimeType};base64,${ref.base64}`;

  const startRes = await fetch(`${REPLICATE_API_BASE}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({ version: REMBG_VERSION, input: { image: dataUrl } }),
  });

  if (!startRes.ok) throw new Error(`Replicate start error: ${startRes.status}`);

  let prediction = (await startRes.json()) as ReplicatePrediction;

  const deadline = Date.now() + POLLING_TIMEOUT_MS;
  while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
    if (Date.now() > deadline) throw new Error('Replicate polling timeout');
    await new Promise<void>((r) => setTimeout(r, POLLING_INTERVAL_MS));

    const pollRes = await fetch(`${REPLICATE_API_BASE}/predictions/${prediction.id}`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!pollRes.ok) throw new Error(`Replicate poll error: ${pollRes.status}`);
    prediction = (await pollRes.json()) as ReplicatePrediction;
  }

  if (prediction.status === 'failed' || !prediction.output) {
    throw new Error(prediction.error ?? 'Replicate prediction failed');
  }

  const pngRes = await fetch(prediction.output, { signal: AbortSignal.timeout(15_000) });
  if (!pngRes.ok) throw new Error(`rembg output download error: ${pngRes.status}`);
  return Buffer.from(await pngRes.arrayBuffer());
}

/**
 * 합성용: 투명 배경 PNG Buffer 반환. 실패 시 null.
 */
export async function removeBackgroundTransparent(
  ref: ReferenceImage,
): Promise<Buffer | null> {
  try {
    return await fetchRembgPng(ref);
  } catch (err) {
    console.warn('[remove-background] transparent removal failed:', err);
    return null;
  }
}

async function removeBackground(ref: ReferenceImage): Promise<ReferenceImage> {
  const pngBuffer = await fetchRembgPng(ref);

  const jpegBuffer = await sharp(pngBuffer)
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { base64: jpegBuffer.toString('base64'), mimeType: 'image/jpeg' };
}

export async function removeImageBackgrounds(
  refs: ReferenceImage[],
): Promise<{ refs: ReferenceImage[]; anyRemoved: boolean }> {
  if (!process.env.REPLICATE_API_TOKEN) {
    return { refs, anyRemoved: false };
  }

  const results: PromiseSettledResult<ReferenceImage>[] = [];
  for (const ref of refs) {
    const [result] = await Promise.allSettled([removeBackground(ref)]);
    results.push(result!);
  }

  let anyRemoved = false;
  const newRefs = results.map((result, i) => {
    if (result.status === 'fulfilled') {
      anyRemoved = true;
      return result.value;
    }
    console.warn(`[remove-background] 이미지 ${i} 배경 제거 실패:`, (result as PromiseRejectedResult).reason);
    return refs[i]!;
  });

  return { refs: newRefs, anyRemoved };
}
