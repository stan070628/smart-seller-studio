/**
 * POST /api/detail-page/process-image
 *
 * 이미지를 받아 세 가지 모드 중 하나로 처리 후 Supabase Storage에 저장합니다.
 *   - original    : Sharp 리사이즈(최대 1200px) + WEBP 변환
 *   - bg_removed  : remove.bg API로 배경 제거 후 저장 (API 키 없으면 original fallback)
 *   - bg_composed : 배경 제거 후 팔레트 색상 배경에 합성
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { uploadToStorage } from '@/lib/supabase/server';
import { PALETTES, PALETTE_NAMES } from '@/lib/detail-page/palette-config';
import type { ImageProcessingMode } from '@/types/detail-page';
import { removeBackgroundTransparent } from '@/lib/ai/remove-background';
import type { ReferenceImage } from '@/lib/ai/reference-images';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const PROCESS_IMAGE_RATE_LIMIT = { windowMs: 60_000, maxRequests: 30 };

// ─────────────────────────────────────────
// 요청 검증 스키마 (Zod)
// ─────────────────────────────────────────

const RequestSchema = z
  .object({
    imageBase64: z.string().optional(),
    imageUrl: z.string().url().optional(),
    processingMode: z.enum(['original', 'bg_removed', 'bg_composed']),
    palette: z.enum(PALETTE_NAMES).optional(),
    // storagePath는 클라이언트에서 받지 않는다. 경로 트래버설 취약점 방지.
  })
  .refine((d) => d.imageBase64 || d.imageUrl, {
    message: 'imageBase64 또는 imageUrl 중 하나가 필요합니다.',
  });

type ValidatedRequest = z.infer<typeof RequestSchema>;

// 서버에서 고정된 저장 경로 — 클라이언트 입력으로 변경 불가
const STORAGE_PATH = 'detail-pages/section-images';

// ─────────────────────────────────────────
// 헬퍼 함수
// ─────────────────────────────────────────

/**
 * HEX 색상 문자열을 Sharp가 요구하는 RGBA 객체로 변환합니다.
 */
function hexToRgba(hex: string): { r: number; g: number; b: number; alpha: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    alpha: 1,
  };
}

/**
 * imageBase64를 JPEG로 변환 후 Replicate rembg로 배경 제거.
 * REPLICATE_API_TOKEN 없으면 null 반환.
 */
async function removeBgViaReplicate(imageBase64: string): Promise<Buffer | null> {
  if (!process.env.REPLICATE_API_TOKEN) return null;

  const jpegBuffer = await sharp(Buffer.from(imageBase64, 'base64'))
    .jpeg({ quality: 90 })
    .toBuffer();
  const ref: ReferenceImage = { base64: jpegBuffer.toString('base64'), mimeType: 'image/jpeg' };
  return removeBackgroundTransparent(ref);
}

// ─────────────────────────────────────────
// 처리 로직
// ─────────────────────────────────────────

/**
 * original 모드: 최대 1200px 리사이즈 후 WEBP 변환
 */
async function processOriginal(imageBase64: string): Promise<Buffer> {
  return sharp(Buffer.from(imageBase64, 'base64'))
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer();
}

/**
 * bg_removed 모드: Replicate rembg 호출 → 투명 PNG 반환
 * REPLICATE_API_TOKEN 없으면 null 반환 (호출부에서 original fallback 처리)
 */
async function processBgRemoved(
  imageBase64: string,
): Promise<{ buffer: Buffer; usedFallback: false } | null> {
  const bgRemovedBuffer = await removeBgViaReplicate(imageBase64);
  if (!bgRemovedBuffer) return null;
  return { buffer: bgRemovedBuffer, usedFallback: false };
}

/**
 * bg_composed 모드: 배경 제거 후 팔레트 색상 배경 위에 합성
 * REPLICATE_API_TOKEN 없으면 null 반환 (호출부에서 original fallback 처리)
 */
async function processBgComposed(
  imageBase64: string,
  paletteName: ValidatedRequest['palette'],
): Promise<Buffer | null> {
  // 1단계: 배경 제거
  const bgRemovedBuffer = await removeBgViaReplicate(imageBase64);
  if (!bgRemovedBuffer) return null;

  // 2단계: 팔레트 배경 생성
  const colors = PALETTES[paletteName ?? 'cool_white'];
  const bgBuffer = await sharp({
    create: {
      width: 800,
      height: 800,
      channels: 4,
      background: hexToRgba(colors.bg),
    },
  })
    .png()
    .toBuffer();

  // 3단계: 제품 이미지 리사이즈 (최대 600px)
  const productBuffer = await sharp(bgRemovedBuffer)
    .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();

  // 4단계: 합성 후 WEBP 변환
  return sharp(bgBuffer)
    .composite([{ input: productBuffer, gravity: 'center' }])
    .webp({ quality: 90 })
    .toBuffer();
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 인증 검사
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) {
    return authResult as unknown as NextResponse;
  }
  const userId = authResult.userId;

  // Rate Limit 검사
  const ip =
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    'unknown';
  const rateLimitResult = checkRateLimit(
    getRateLimitKey(ip, 'process-image'),
    PROCESS_IMAGE_RATE_LIMIT,
  );
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      {
        status: 429,
        headers: { 'X-RateLimit-Reset': rateLimitResult.resetAt.toString() },
      },
    );
  }

  // 요청 바디 파싱
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: '요청 바디를 JSON으로 파싱할 수 없습니다.' },
      { status: 400 },
    );
  }

  // Zod 검증
  const parseResult = RequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    return NextResponse.json(
      {
        error: firstIssue
          ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
          : '입력값 검증 실패',
      },
      { status: 400 },
    );
  }

  const { imageBase64, imageUrl, processingMode, palette } = parseResult.data;

  // imageUrl이 주어진 경우 서버에서 fetch → base64 변환
  let cleanBase64: string;
  if (imageUrl) {
    let fetchedBuffer: Buffer;
    try {
      const fetchRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
      if (!fetchRes.ok) {
        return NextResponse.json(
          { error: `이미지 URL fetch 실패 (${fetchRes.status})` },
          { status: 400 },
        );
      }
      fetchedBuffer = Buffer.from(await fetchRes.arrayBuffer());
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? `이미지 URL 요청 오류: ${err.message}` : '이미지 URL 요청 오류' },
        { status: 400 },
      );
    }
    cleanBase64 = fetchedBuffer.toString('base64');
  } else {
    // data URL prefix 제거 (클라이언트에서 그대로 전달한 경우 대비)
    const raw = imageBase64!;
    cleanBase64 = raw.includes(',') ? raw.split(',')[1] : raw;
  }

  // 파일 크기 검증 (base64 디코딩 후 기준 10MB)
  const estimatedBytes = Math.ceil((cleanBase64.length * 3) / 4);
  const MAX_BYTES = 10 * 1024 * 1024; // 10MB
  if (estimatedBytes > MAX_BYTES) {
    return NextResponse.json(
      { error: '이미지 크기가 10MB를 초과합니다.' },
      { status: 400 },
    );
  }

  // 실제 적용된 처리 모드 (API 키 없을 때 original로 fallback)
  let appliedMode: ImageProcessingMode = processingMode;
  let outputBuffer: Buffer;

  try {
    if (processingMode === 'original') {
      // ── original 모드 ──
      outputBuffer = await processOriginal(cleanBase64);
    } else if (processingMode === 'bg_removed') {
      // ── bg_removed 모드 ──
      const result = await processBgRemoved(cleanBase64);
      if (result === null) {
        // remove.bg API 키 없음 → original fallback
        console.warn('[process-image] REPLICATE_API_TOKEN 없음 또는 배경 제거 실패 — original 모드로 fallback');
        appliedMode = 'original';
        outputBuffer = await processOriginal(cleanBase64);
      } else {
        // PNG로 나온 결과를 WEBP로 변환하여 일관된 포맷 유지
        outputBuffer = await sharp(result.buffer)
          .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 90 })
          .toBuffer();
      }
    } else {
      // ── bg_composed 모드 ──
      const composited = await processBgComposed(cleanBase64, palette);
      if (composited === null) {
        // remove.bg API 키 없음 → original fallback
        console.warn('[process-image] REPLICATE_API_TOKEN 없음 또는 배경 제거 실패 — original 모드로 fallback');
        appliedMode = 'original';
        outputBuffer = await processOriginal(cleanBase64);
      } else {
        outputBuffer = composited;
      }
    }
  } catch (err) {
    console.error('[process-image] 이미지 처리 중 오류:', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `이미지 처리 실패: ${err.message}`
            : '이미지 처리 중 알 수 없는 오류가 발생했습니다.',
      },
      { status: 500 },
    );
  }

  // Supabase Storage 저장
  try {
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
    // STORAGE_PATH 상수를 사용하여 경로 트래버설 공격 차단
    const fullPath = `${STORAGE_PATH}/${userId}/${fileName}`;

    const arrayBuffer = outputBuffer.buffer.slice(
      outputBuffer.byteOffset,
      outputBuffer.byteOffset + outputBuffer.byteLength,
    ) as ArrayBuffer;

    const { url } = await uploadToStorage(fullPath, arrayBuffer, 'image/webp', outputBuffer.byteLength);

    return NextResponse.json(
      { url, processingMode: appliedMode },
      { status: 200 },
    );
  } catch (err) {
    console.error('[process-image] Storage 업로드 중 오류:', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `스토리지 저장 실패: ${err.message}`
            : '스토리지 저장 중 알 수 없는 오류가 발생했습니다.',
      },
      { status: 500 },
    );
  }
}
