/**
 * POST /api/image/upload-ai
 *
 * Gemini AI 생성 이미지(base64)를 Supabase Storage에 업로드하고 공개 URL을 반환합니다.
 * 워터마크 제거(STABILITY_API_KEY 설정 시)를 거쳐 업로드합니다.
 * imageUrl 필드로 외부 URL에서 fetch 후 업로드도 지원합니다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { uploadToStorage } from '@/lib/supabase/server';
import { removeGeminiWatermark } from '@/lib/image/watermark-removal';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

/** Vercel Serverless 최대 실행 시간 (초) */
export const maxDuration = 60;

/** 분당 최대 요청 수 */
const RATE_LIMIT_MAX = 20;

/** Rate Limit 윈도우 (밀리초) */
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Rate Limit 키 접두사 */
const RATE_LIMIT_PREFIX = 'upload-ai';

/** 허용 MIME 타입 */
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** MIME 타입 → 파일 확장자 매핑 */
const MIME_TO_EXT: Record<AllowedMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// ─────────────────────────────────────────
// 요청 스키마
// ─────────────────────────────────────────

const roleEnum = z.enum(['hero', 'lifestyle', 'detail', 'feature']).optional();

/** 스키마 A: base64 직접 업로드 */
const SchemaBase64 = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  role: roleEnum,
});

/** 스키마 B: 외부 URL fetch 후 업로드 */
const SchemaUrl = z.object({
  imageUrl: z.string().url(),
  role: roleEnum,
});

/** 두 스키마 중 하나를 수용 */
const RequestSchema = z.union([SchemaBase64, SchemaUrl]);

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 인증 검사
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult as NextResponse;

  // Rate Limit 검사
  const ip =
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    'unknown';
  const rateLimitResult = checkRateLimit(getRateLimitKey(ip, RATE_LIMIT_PREFIX), {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: RATE_LIMIT_MAX,
  });
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      {
        status: 429,
        headers: { 'X-RateLimit-Reset': rateLimitResult.resetAt.toString() },
      }
    );
  }

  // 요청 바디 파싱
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '요청 바디를 JSON으로 파싱할 수 없습니다.' },
      { status: 400 }
    );
  }

  // Zod 검증
  const parsed = RequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '요청 형식이 올바르지 않습니다.' },
      { status: 400 }
    );
  }

  const data = parsed.data;

  try {
    let buffer: Buffer;
    let mimeType: AllowedMimeType;

    if ('imageBase64' in data) {
      // 스키마 A: base64 경로
      const rawBase64 = data.imageBase64.includes(';base64,')
        ? data.imageBase64.split(';base64,')[1]
        : data.imageBase64;
      buffer = Buffer.from(rawBase64, 'base64');
      mimeType = data.mimeType;
    } else {
      // 스키마 B: URL fetch 경로
      const fetchRes = await fetch(data.imageUrl, { signal: AbortSignal.timeout(30_000) });
      if (!fetchRes.ok) {
        return NextResponse.json(
          { success: false, error: `이미지 fetch 실패 (${fetchRes.status})` },
          { status: 502 }
        );
      }

      // Content-Type 헤더로 MIME 타입 결정 (허용 타입으로 제한)
      const contentType = fetchRes.headers.get('content-type') ?? 'image/jpeg';
      const detectedMime = contentType.split(';')[0].trim();
      mimeType = (ALLOWED_MIME_TYPES as readonly string[]).includes(detectedMime)
        ? (detectedMime as AllowedMimeType)
        : 'image/jpeg';

      buffer = Buffer.from(await fetchRes.arrayBuffer());
    }

    // 워터마크 제거 (STABILITY_API_KEY 미설정 시 원본 반환)
    buffer = await removeGeminiWatermark(buffer);

    // 파일 확장자 결정 및 Storage 경로 생성
    const ext = MIME_TO_EXT[mimeType];
    const role = data.role ?? 'img';
    const path = `ai-detail/${Date.now()}-${role}.${ext}`;

    // Buffer → ArrayBuffer 변환 (uploadToStorage 시그니처에 맞게)
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;

    // Supabase Storage 업로드
    const result = await uploadToStorage(path, arrayBuffer, mimeType, buffer.byteLength);

    return NextResponse.json({ success: true, url: result.url }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : '이미지 업로드 중 알 수 없는 오류가 발생했습니다.';
    console.error('[/api/image/upload-ai] 처리 중 오류:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
