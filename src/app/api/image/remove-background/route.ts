import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { uploadToStorage } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';

export const maxDuration = 60;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };

const RequestSchema = z.object({
  imageUrl: z.string().url('유효한 이미지 URL이 아닙니다.'),
});

export async function POST(req: NextRequest) {
  // 인증 검사
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  // Rate Limit 검사
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'remove-background'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rl.resetAt.toString() } },
    );
  }

  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'STABILITY_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' },
      { status: 400 },
    );
  }

  const { imageUrl } = parsed.data;

  // 30초 타임아웃으로 이미지 fetch
  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!imgRes.ok) {
    return NextResponse.json({ success: false, error: '이미지를 가져오지 못했습니다.' }, { status: 400 });
  }
  const imgBuffer = await imgRes.arrayBuffer();

  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(imgBuffer)], { type: 'image/png' }), 'image.png');
  form.append('output_format', 'png');

  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(30_000)
      : undefined;

  const stabilityRes = await fetch(
    'https://api.stability.ai/v2beta/stable-image/edit/remove-background',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'image/*' },
      body: form,
      ...(signal ? { signal } : {}),
    },
  );

  if (!stabilityRes.ok) {
    const text = await stabilityRes.text().catch(() => '');
    return NextResponse.json(
      { success: false, error: `배경 제거 실패 (${stabilityRes.status}): ${text.slice(0, 120)}` },
      { status: 502 },
    );
  }

  const pngBuffer = await stabilityRes.arrayBuffer();
  const path = `ai-detail/${Date.now()}-bg-removed.png`;

  // Storage 업로드 — 실패 시 500 반환
  let uploadResult: { url: string };
  try {
    uploadResult = await uploadToStorage(path, pngBuffer, 'image/png', pngBuffer.byteLength);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Storage 업로드 실패';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { transparentImageUrl: uploadResult.url } });
}
