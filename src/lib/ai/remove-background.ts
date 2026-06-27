import sharp from 'sharp';
import type { ReferenceImage } from './reference-images';

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
const POLLING_INTERVAL_MS = 500;
const POLLING_TIMEOUT_MS = 60_000;

type ReplicatePrediction = {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed';
  output?: string;
  error?: string;
};

async function removeBackground(ref: ReferenceImage): Promise<ReferenceImage> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN not set');

  const dataUrl = `data:${ref.mimeType};base64,${ref.base64}`;

  // 예측 시작 (Prefer: wait 로 동기 응답 시도)
  const startRes = await fetch(`${REPLICATE_API_BASE}/models/cjwbw/rembg/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({ input: { image: dataUrl } }),
  });

  if (!startRes.ok) throw new Error(`Replicate start error: ${startRes.status}`);

  let prediction = (await startRes.json()) as ReplicatePrediction;

  // Prefer: wait 로 즉시 완료되지 않은 경우 polling
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

  // 결과 PNG 다운로드 (15초 timeout — Replicate CDN stall 방어)
  const pngRes = await fetch(prediction.output, { signal: AbortSignal.timeout(15_000) });
  if (!pngRes.ok) throw new Error(`rembg output download error: ${pngRes.status}`);
  const pngBuffer = Buffer.from(await pngRes.arrayBuffer());

  // 흰 배경 합성 → JPEG (투명 채널 제거)
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

  const results = await Promise.allSettled(refs.map((ref) => removeBackground(ref)));

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
