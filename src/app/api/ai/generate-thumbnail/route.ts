/**
 * POST /api/ai/generate-thumbnail
 *
 * 참조 사진 1~3장 + 연출 방향 텍스트를 Gemini에 전달하여
 * 1:1 정사각형 썸네일 이미지를 생성합니다.
 *
 * 요청 (refImages 또는 refImageUrls 중 최소 하나 필요):
 *   {
 *     refImages?: [{ imageBase64: string, mimeType: string }]  // 하위호환(에디터): base64 1~3장
 *     refImageUrls?: string[]                                   // assets 탭: 서버가 fetch, 1~3장
 *     direction: string   // 예: "스튜디오 조명, 화이트 배경으로 합성해줘"
 *   }
 * 응답:
 *   { success: true, data: { imageBase64: string, mimeType: string } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getGeminiGenAI } from '@/lib/ai/gemini';
import { loadReferenceImages } from '@/lib/ai/reference-images';

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };
const MODEL = 'gemini-2.5-flash-image';

const MimeTypeEnum = z.enum(['image/jpeg', 'image/png', 'image/webp']);

const RequestSchema = z.object({
  // 하위호환: 에디터(ThumbnailGenerateSection)의 base64 입력
  refImages: z
    .array(
      z.object({
        imageBase64: z.string().min(1),
        mimeType: MimeTypeEnum,
      }),
    )
    .max(3, '참조 사진은 최대 3장까지 가능합니다')
    .optional(),
  // 신규: assets 탭의 URL 입력 (서버가 fetch)
  refImageUrls: z.array(z.string().url()).max(3, '참조 사진은 최대 3장까지 가능합니다').optional(),
  direction: z
    .string()
    .min(5, '연출 방향을 입력해주세요 (5자 이상)')
    .max(300),
});

export async function POST(request: NextRequest) {
  try {
    // 인증
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    // Rate limit
    const ip =
      request.headers.get('x-forwarded-for') ??
      request.headers.get('x-real-ip') ??
      'unknown';
    const rl = checkRateLimit(getRateLimitKey(ip, 'generate-thumbnail'), RATE_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        { status: 429, headers: { 'X-RateLimit-Reset': rl.resetAt.toString() } },
      );
    }

    // 요청 파싱
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: '요청 바디를 JSON으로 파싱할 수 없습니다.' },
        { status: 400 },
      );
    }

    const parsed = RequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join(' | ');
      return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }

    const { refImages, refImageUrls, direction } = parsed.data;

    // 두 소스 모두 비어있으면 400
    if ((!refImages || refImages.length === 0) && (!refImageUrls || refImageUrls.length === 0)) {
      return NextResponse.json(
        { success: false, error: '참조 사진이 최소 1장 필요합니다' },
        { status: 400 },
      );
    }

    // 참조 이미지 정규화 (URL fetch + Sharp 리사이즈 + base64, 최대 3장)
    const referenceImages = await loadReferenceImages({
      referenceImages: refImages?.map((r) => ({ base64: r.imageBase64, mimeType: r.mimeType })),
      productImageUrls: refImageUrls,
    });

    if (referenceImages.length === 0) {
      return NextResponse.json(
        { success: false, error: '참조 사진을 불러오지 못했습니다' },
        { status: 400 },
      );
    }

    // Gemini parts 구성: 참조 이미지들 → 텍스트 프롬프트
    type GeminiPart =
      | { text: string }
      | { inlineData: { data: string; mimeType: string } };

    const parts: GeminiPart[] = [];

    for (const ref of referenceImages) {
      parts.push({
        inlineData: { data: ref.base64, mimeType: ref.mimeType },
      });
    }

    // 썸네일 생성 전용 프롬프트
    const prompt =
      `Create a single professional e-commerce product thumbnail image (square 1:1 ratio, 780×780). ` +
      `Reference images are provided above. ` +
      `Direction from user: "${direction}". ` +
      `Requirements: clean composition, high-quality product photography style, ` +
      `suitable for Korean e-commerce platforms (Coupang, Naver Shopping). ` +
      `Output only the final thumbnail image, no text overlays.`;

    parts.push({ text: prompt });

    const ai = getGeminiGenAI();
    const response = await ai.models.generateContent({
      model: MODEL,
      config: { responseModalities: ['Text', 'Image'] },
      contents: [{ role: 'user', parts }],
    });

    const candidates = response.candidates;
    if (!candidates?.length) {
      throw new Error('이미지 생성에 실패했습니다.');
    }

    const contentParts = candidates[0]?.content?.parts;
    const imagePart = contentParts?.find(
      (p) => p.inlineData && p.inlineData.data,
    );

    if (!imagePart?.inlineData) {
      throw new Error('이미지 생성에 실패했습니다. 다른 사진이나 방향으로 다시 시도해주세요.');
    }

    // 호출 측 upload-ai는 jpeg/png/webp만 허용한다. Gemini가 통상 image/png를
    // 반환하지만, 그 외(또는 누락) 타입이면 png로 폴백하여 업로드 400을 막는다.
    const rawMime = imagePart.inlineData.mimeType;
    const mimeType =
      typeof rawMime === 'string' && MimeTypeEnum.options.includes(rawMime as never)
        ? rawMime
        : 'image/png';

    return NextResponse.json({
      success: true,
      data: {
        imageBase64: imagePart.inlineData.data as string,
        mimeType,
      },
    });
  } catch (err) {
    console.error('[generate-thumbnail]', err);

    if (err instanceof Error && err.message.includes('GOOGLE_AI_API_KEY')) {
      return NextResponse.json(
        { success: false, error: '서버 설정 오류: AI API 키가 구성되지 않았습니다.' },
        { status: 503 },
      );
    }
    if (
      err instanceof Error &&
      (err.message.includes('overloaded') ||
        err.message.includes('quota') ||
        err.message.includes('RESOURCE_EXHAUSTED'))
    ) {
      return NextResponse.json(
        { success: false, error: 'AI 서비스가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.' },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : '썸네일 생성 중 오류가 발생했습니다.',
      },
      { status: 500 },
    );
  }
}
