import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { uploadToStorage } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

export const maxDuration = 60;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 20 };

const RequestSchema = z.object({
  productImageUrl: z.string().url('유효한 제품 이미지 URL이 아닙니다.'),
  backgroundImageUrl: z.string().url('유효한 배경 이미지 URL이 아닙니다.'),
  placement: z.enum(['center', 'bottom-center']).optional().default('bottom-center'),
});

export async function POST(req: NextRequest) {
  // 인증 검사
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;

  // Rate Limit 검사
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'composite'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rl.resetAt.toString() } },
    );
  }

  // 요청 바디 검증
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' },
      { status: 400 },
    );
  }

  const { productImageUrl, backgroundImageUrl, placement } = parsed.data;

  // 배경 이미지와 제품 이미지를 병렬로 fetch (각각 30초 타임아웃)
  const [bgRes, productRes] = await Promise.all([
    fetch(backgroundImageUrl, { signal: AbortSignal.timeout(30_000) }),
    fetch(productImageUrl, { signal: AbortSignal.timeout(30_000) }),
  ]);

  if (!bgRes.ok || !productRes.ok) {
    return NextResponse.json({ success: false, error: '이미지를 가져오지 못했습니다.' }, { status: 400 });
  }

  const [bgBuffer, productBuffer] = await Promise.all([
    bgRes.arrayBuffer().then(ab => Buffer.from(ab)),
    productRes.arrayBuffer().then(ab => Buffer.from(ab)),
  ]);

  // 제품 이미지를 1024의 68% 크기(695×695)로 리사이즈
  const productResized = await sharp(productBuffer)
    .resize({
      height: Math.round(1024 * 0.68),
      width: Math.round(1024 * 0.68),
      fit: 'inside',
      withoutEnlargement: false,
    })
    .toBuffer();

  // 배경(1024×1024)에 제품 이미지를 합성 후 JPEG 변환
  const resultBuffer = await sharp(bgBuffer)
    .resize(1024, 1024, { fit: 'cover' })
    .composite([{
      input: productResized,
      gravity: placement === 'bottom-center' ? 'south' : 'centre',
    }])
    .jpeg({ quality: 90 })
    .toBuffer();

  // Buffer를 ArrayBuffer로 변환 (uploadToStorage 시그니처에 맞춤)
  const resultArrayBuffer = resultBuffer.buffer.slice(
    resultBuffer.byteOffset,
    resultBuffer.byteOffset + resultBuffer.byteLength,
  );
  const path = `ai-detail/${Date.now()}-composite.jpg`;

  // Storage 업로드 — 실패 시 500 반환
  let uploadResult: { url: string };
  try {
    uploadResult = await uploadToStorage(path, resultArrayBuffer, 'image/jpeg', resultBuffer.byteLength);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Storage 업로드 실패';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { url: uploadResult.url } });
}
