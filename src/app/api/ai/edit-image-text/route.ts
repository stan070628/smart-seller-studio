/**
 * POST /api/ai/edit-image-text
 *
 * 상세페이지 이미지 안의 텍스트·표를 한국어 정확히 편집한다.
 * Gemini 한국어 렌더링 한계를 우회하기 위해 다음 파이프라인을 사용:
 *
 * 1. fetchImagesFromUrls → resizeForClaude (이미지 다운로드 + 크기 보정)
 * 2. extractTextRegions — Claude Vision OCR (텍스트 영역 + bbox + 색상/크기 추정)
 * 3. parseEditIntent — Claude Haiku (사용자 지시 → 영역별 새 텍스트 결정)
 * 4. composeTextOnImage — Sharp + @resvg/resvg-js + Pretendard로 합성
 * 5. Supabase Storage 업로드 → 공개 URL 반환
 *
 * 디자인: ~/.claude/plans/quiet-baking-fox.md
 *
 * - 인증: requireAuth
 * - Rate Limit: 분당 5회 (Vision 2회 호출 비용 보호)
 */

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { fetchImagesFromUrls, resizeForClaude } from '@/lib/ai/claude-vision';
import {
  extractTextRegions,
  parseEditIntent,
  composeTextOnImage,
  ensureFontAvailable,
} from '@/lib/ai/image-text-edit';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 5 };
const LISTING_IMAGES_BUCKET = 'smart-seller-studio';
const STORAGE_PATH_PREFIX = 'ai-edited-text';

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

export const RequestSchema = z.object({
  imageUrl: z.string().min(1, 'imageUrl은 비어있을 수 없습니다.'),
  instruction: z
    .string()
    .min(1, 'instruction은 비어있을 수 없습니다.')
    .max(500, 'instruction은 500자 이내여야 합니다.'),
  productName: z.string().max(200).optional(),
});

interface ApiSuccess {
  success: true;
  data: { editedUrl: string };
}
interface ApiError {
  success: false;
  error: string;
}

// ─────────────────────────────────────────
// Supabase 서비스 클라이언트
// ─────────────────────────────────────────

function createSupabaseServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) throw new Error('[Supabase] NEXT_PUBLIC_SUPABASE_URL 미설정');
  if (!serviceRoleKey) throw new Error('[Supabase] SUPABASE_SERVICE_ROLE_KEY 미설정');
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  // 인증
  const auth = await requireAuth(request);
  if (auth instanceof Response) {
    return Response.json(
      { success: false, error: '인증이 필요합니다. 로그인 후 다시 시도해주세요.' } satisfies ApiError,
      { status: 401 },
    );
  }

  // Rate Limit
  const ip =
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'edit-image-text'), RATE_LIMIT);
  if (!rl.allowed) {
    return Response.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' } satisfies ApiError,
      { status: 429, headers: { 'X-RateLimit-Reset': rl.resetAt.toString() } },
    );
  }

  // 바디 파싱
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json(
      { success: false, error: '요청 바디를 JSON으로 파싱할 수 없습니다.' } satisfies ApiError,
      { status: 400 },
    );
  }
  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return Response.json(
      {
        success: false,
        error: first ? `${first.path.join('.')}: ${first.message}` : '입력 검증 실패',
      } satisfies ApiError,
      { status: 400 },
    );
  }
  const { imageUrl, instruction, productName } = parsed.data;

  // 폰트 자산 검증
  try {
    await ensureFontAvailable();
  } catch {
    return Response.json(
      {
        success: false,
        error: '서버 설정 오류: Pretendard 폰트 자산을 찾을 수 없습니다.',
      } satisfies ApiError,
      { status: 503 },
    );
  }

  // 1) 이미지 다운로드 + 리사이즈
  let imageBuffer: Buffer;
  let mimeType;
  try {
    const downloaded = await fetchImagesFromUrls([imageUrl]);
    const safe = await resizeForClaude(downloaded[0].imageBase64, downloaded[0].mimeType);
    imageBuffer = Buffer.from(safe.imageBase64, 'base64');
    mimeType = safe.mimeType;
  } catch (err) {
    console.error('[edit-image-text] 이미지 처리 실패:', err);
    return Response.json(
      {
        success: false,
        error: err instanceof Error ? `이미지 처리 실패: ${err.message}` : '이미지 처리 오류',
      } satisfies ApiError,
      { status: 400 },
    );
  }

  // 2) OCR
  let regions;
  try {
    regions = await extractTextRegions(imageBuffer.toString('base64'), mimeType);
  } catch (err) {
    console.error('[edit-image-text] OCR 실패:', err);
    return Response.json(
      {
        success: false,
        error: 'AI가 이미지의 텍스트를 인식하지 못했습니다. 다시 시도해주세요.',
      } satisfies ApiError,
      { status: 502 },
    );
  }

  if (regions.length === 0) {
    return Response.json(
      {
        success: false,
        error: '이미지에서 편집할 텍스트를 찾지 못했습니다. 텍스트가 명확한 이미지를 사용해주세요.',
      } satisfies ApiError,
      { status: 422 },
    );
  }

  // 3) 의도 파싱
  let operations;
  try {
    operations = await parseEditIntent(regions, instruction, productName);
  } catch (err) {
    console.error('[edit-image-text] 의도 파싱 실패:', err);
    return Response.json(
      {
        success: false,
        error: 'AI가 편집 지시를 해석하지 못했습니다. 더 구체적으로 지시해주세요.',
      } satisfies ApiError,
      { status: 502 },
    );
  }

  if (operations.length === 0) {
    return Response.json(
      {
        success: false,
        error: '편집할 텍스트 영역을 결정하지 못했습니다. 어떤 텍스트를 어떻게 바꿀지 명시해주세요.',
      } satisfies ApiError,
      { status: 422 },
    );
  }

  // 4) 합성
  let composed: Buffer;
  try {
    composed = await composeTextOnImage(imageBuffer, operations);
  } catch (err) {
    console.error('[edit-image-text] 합성 실패:', err);
    return Response.json(
      {
        success: false,
        error: err instanceof Error ? `텍스트 합성 실패: ${err.message}` : '텍스트 합성 오류',
      } satisfies ApiError,
      { status: 500 },
    );
  }

  // 5) Supabase Storage 업로드
  let editedUrl: string;
  try {
    const supabase = createSupabaseServiceClient();
    const uuid = crypto.randomUUID();
    const storagePath = `${STORAGE_PATH_PREFIX}/${uuid}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(LISTING_IMAGES_BUCKET)
      .upload(storagePath, composed, { contentType: 'image/jpeg', upsert: false });
    if (uploadError) throw new Error(`[Supabase Storage] 업로드 실패: ${uploadError.message}`);
    const { data: urlData } = supabase.storage.from(LISTING_IMAGES_BUCKET).getPublicUrl(storagePath);
    editedUrl = urlData.publicUrl;
  } catch (err) {
    console.error('[edit-image-text] Storage 업로드 실패:', err);
    return Response.json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : '편집된 이미지를 저장하는 중 오류가 발생했습니다.',
      } satisfies ApiError,
      { status: 500 },
    );
  }

  return Response.json({ success: true, data: { editedUrl } } satisfies ApiSuccess, {
    status: 200,
  });
}
