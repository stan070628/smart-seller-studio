/**
 * POST /api/ai/retouch-photo
 * 업로드된 실사진을 Sharp로 가볍게 보정(밝기·채도·선명도) 후 Storage에 저장, URL 반환.
 * AI·합성·배경변경 없음. 자연스러운 결정론적 보정.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { uploadToStorage } from '@/lib/supabase/server';

export const maxDuration = 60;
const RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };
// SSRF 방어: Supabase Storage URL만 허용 (cleanup-product-image 패턴)
const SUPABASE_URL_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\//;
const RequestSchema = z.object({ imageUrl: z.string().url() });

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'retouch-photo'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '이미지 URL이 올바르지 않습니다.' }, { status: 400 });
  }
  const { imageUrl } = parsed.data;
  if (!SUPABASE_URL_PATTERN.test(imageUrl)) {
    return NextResponse.json({ success: false, error: '허용되지 않은 이미지 URL입니다.' }, { status: 400 });
  }

  try {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`이미지 로드 실패 (${res.status})`);
    const inputBuf = Buffer.from(await res.arrayBuffer());

    // 보수적 자연 보정: EXIF 회전 + 밝기·채도 소폭 + 라이트 샤픈. 정규화/과보정 지양.
    const outBuf = await sharp(inputBuf)
      .rotate()
      .modulate({ brightness: 1.04, saturation: 1.06 })
      .sharpen({ sigma: 0.6 })
      .jpeg({ quality: 90 })
      .toBuffer();

    const path = `retouched/${Date.now()}.jpg`;
    const ab = outBuf.buffer.slice(outBuf.byteOffset, outBuf.byteOffset + outBuf.byteLength) as ArrayBuffer;
    const { url } = await uploadToStorage(path, ab, 'image/jpeg', outBuf.byteLength);
    return NextResponse.json({ success: true, url });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: '보정 중 오류가 발생했습니다.', _debug: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
