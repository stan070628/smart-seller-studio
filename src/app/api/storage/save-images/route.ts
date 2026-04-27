/**
 * POST /api/storage/save-images
 *
 * 외부 이미지 URL 배열(또는 base64 data URL)을 받아
 * Supabase Storage에 업로드하고 영구 public URL을 반환합니다.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';

import { requireAuth } from '@/lib/supabase/auth';
import { uploadToStorage } from '@/lib/supabase/server';

const COUPANG_MIN_PX = 500;
const COUPANG_MAX_PX = 5000;
const COUPANG_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

/** 병렬 처리할 이미지 최대 개수 */
const MAX_IMAGE_COUNT = 30;

/** 외부 URL fetch 타임아웃 (15초) */
const FETCH_TIMEOUT_MS = 15_000;

/** MIME 타입 → 확장자 매핑 */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

// ─────────────────────────────────────────
// 입력 스키마
// ─────────────────────────────────────────

const RequestBodySchema = z.object({
  /** 외부 URL 또는 base64 data URL 목록 (1~30개) */
  imageUrls: z
    .array(z.string().min(1))
    .min(1, '이미지 URL을 1개 이상 입력해주세요.')
    .max(MAX_IMAGE_COUNT, `이미지는 최대 ${MAX_IMAGE_COUNT}개까지 처리 가능합니다.`),
  /** Supabase Storage 저장 폴더 (기본값: listing-images) */
  folder: z.string().optional(),
});

// ─────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────

interface SaveResult {
  originalUrl: string;
  savedUrl: string;
}

interface SaveError {
  url: string;
  error: string;
}

// ─────────────────────────────────────────
// 헬퍼: MIME 타입에서 확장자 추출
// ─────────────────────────────────────────

function getExtFromMime(mimeType: string): string {
  return MIME_TO_EXT[mimeType.toLowerCase()] ?? 'jpg';
}

// ─────────────────────────────────────────
// 헬퍼: base64 data URL → ArrayBuffer
// ─────────────────────────────────────────

function decodeBase64DataUrl(dataUrl: string): { buffer: ArrayBuffer; mimeType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('유효하지 않은 base64 data URL 형식입니다.');
  }

  const mimeType = match[1];
  const base64Data = match[2];

  const buf = Buffer.from(base64Data, 'base64');
  // Buffer → ArrayBuffer (zero-copy slice)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  return { buffer: ab, mimeType };
}

// ─────────────────────────────────────────
// 헬퍼: 외부 URL → ArrayBuffer
// ─────────────────────────────────────────

async function fetchExternalImage(url: string): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`이미지 fetch 실패 (HTTP ${response.status}): ${url}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  // content-type이 "image/jpeg; charset=..." 형태일 수 있으므로 앞부분만 추출
  const mimeType = contentType.split(';')[0].trim() || 'image/jpeg';
  const buffer = await response.arrayBuffer();

  return { buffer, mimeType };
}

// ─────────────────────────────────────────
// 헬퍼: 단일 이미지 처리
// ─────────────────────────────────────────

/** 쿠팡 이미지 규격(min 500×500, max 5000×5000, max 10MB) 적용 후 Buffer 반환 */
async function applyImageConstraints(
  inputBuf: Buffer,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const metadata = await sharp(inputBuf).metadata();
  const w = metadata.width ?? 0;
  const h = metadata.height ?? 0;

  const tooSmall = w < COUPANG_MIN_PX || h < COUPANG_MIN_PX;
  const tooBig = w > COUPANG_MAX_PX || h > COUPANG_MAX_PX;
  const tooHeavy = inputBuf.length > COUPANG_MAX_BYTES;

  if (!tooSmall && !tooBig && !tooHeavy) {
    return { buffer: inputBuf, mimeType: 'image/jpeg' };
  }

  let pipeline = sharp(inputBuf);

  if (tooSmall) {
    const scale = Math.max(COUPANG_MIN_PX / Math.max(w, 1), COUPANG_MIN_PX / Math.max(h, 1));
    const newW = Math.min(Math.round(w * scale), COUPANG_MAX_PX);
    const newH = Math.min(Math.round(h * scale), COUPANG_MAX_PX);
    pipeline = pipeline.resize(newW, newH, { fit: 'fill' });
  } else if (tooBig) {
    pipeline = pipeline.resize(COUPANG_MAX_PX, COUPANG_MAX_PX, { fit: 'inside', withoutEnlargement: true });
  }

  const quality = tooHeavy ? 72 : 85;
  let processed = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();

  if (processed.length > COUPANG_MAX_BYTES) {
    processed = await sharp(processed).jpeg({ quality: 55, mozjpeg: true }).toBuffer();
  }

  return { buffer: processed, mimeType: 'image/jpeg' };
}

async function processImage(
  url: string,
  idx: number,
  folder: string
): Promise<SaveResult> {
  let buffer: ArrayBuffer;
  let mimeType: string;

  // base64 data URL vs 외부 URL 분기
  if (url.startsWith('data:')) {
    ({ buffer, mimeType } = decodeBase64DataUrl(url));
  } else {
    ({ buffer, mimeType } = await fetchExternalImage(url));
  }

  // 쿠팡 이미지 규격 적용
  const inputBuf = Buffer.from(buffer);
  const { buffer: finalBuf, mimeType: finalMime } = await applyImageConstraints(inputBuf);

  const ext = getExtFromMime(finalMime);
  const storagePath = `${folder}/${Date.now()}-${idx}.${ext}`;

  const ab = finalBuf.buffer.slice(finalBuf.byteOffset, finalBuf.byteOffset + finalBuf.byteLength) as ArrayBuffer;
  const result = await uploadToStorage(storagePath, ab, finalMime, finalBuf.length);

  return { originalUrl: url, savedUrl: result.url };
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. 인증 확인
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  // 2. 요청 body 파싱
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: '요청 body가 유효한 JSON이 아닙니다.' }, { status: 400 });
  }

  // 3. Zod 입력 검증
  const parseResult = RequestBodySchema.safeParse(rawBody);
  if (!parseResult.success) {
    return Response.json(
      { error: '입력 검증 오류', details: parseResult.error.flatten() },
      { status: 400 }
    );
  }

  const { imageUrls, folder = 'listing-images' } = parseResult.data;

  // 4. 이미지 병렬 처리
  const results: SaveResult[] = [];
  const errors: SaveError[] = [];

  await Promise.all(
    imageUrls.map(async (url, idx) => {
      try {
        const saved = await processImage(url, idx, folder);
        results.push(saved);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ url, error: message });
      }
    })
  );

  // 5. 항상 200으로 반환 (부분 실패 포함)
  return Response.json({ success: true, results, errors }, { status: 200 });
}
