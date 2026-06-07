/**
 * POST /api/detail-page/analyze-product
 *
 * 상품 이미지(최대 3장) 또는 상품명을 Gemini에 전달하여
 * 최적의 상세페이지 디자인 테마와 섹션 구성을 추천합니다.
 *
 * 요청:
 *   {
 *     images?: [{ imageBase64: string, mimeType: 'image/jpeg'|'image/png'|'image/webp' }]  // 최대 3장
 *     productName?: string   // 최대 100자
 *     categoryCode?: string  // 최대 20자
 *   }
 *   ※ images 또는 productName 중 하나는 반드시 필요
 *
 * 응답:
 *   {
 *     theme: DetailPageTheme
 *     suggestedSections: SectionType[]
 *     reasoning: string
 *     dominantColors: string[]
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getGeminiGenAI } from '@/lib/ai/gemini';
import { parseJsonFromText } from '@/lib/ai/prompts/detail-page';
import { PALETTES } from '@/lib/detail-page/palette-config';
import type { PaletteName, SectionType, DetailPageTheme } from '@/types/detail-page';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { withRetry } from '@/lib/ai/resilience';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 20 };
const MODEL = 'gemini-2.5-flash';

// 유효한 PaletteName 집합 (런타임 검증용)
const VALID_PALETTE_NAMES = new Set<string>([
  'warm_cream',
  'cool_white',
  'deep_dark',
  'nature_green',
  'tech_navy',
  'rose_soft',
  'cream_cozy',
  'sunset_warm',
  'fresh_mint',
]);

// Stage 1: 카테고리 키워드 → 후보 팔레트 축소 (결정론적)
const CATEGORY_PALETTE_CANDIDATES: Record<string, PaletteName[]> = {
  '뷰티': ['rose_soft', 'cool_white', 'deep_dark'],
  '스킨케어': ['rose_soft', 'cool_white', 'deep_dark'],
  '여성패션': ['rose_soft', 'deep_dark', 'cool_white'],
  '식품': ['cream_cozy', 'warm_cream', 'sunset_warm'],
  '홈카페': ['cream_cozy', 'warm_cream', 'sunset_warm'],
  '주방': ['sunset_warm', 'cream_cozy', 'warm_cream'],
  '건강': ['fresh_mint', 'nature_green', 'cool_white'],
  '헬스케어': ['fresh_mint', 'nature_green', 'cool_white'],
  '건기식': ['fresh_mint', 'nature_green', 'cool_white'],
  '유아': ['fresh_mint', 'cream_cozy', 'cool_white'],
  '디지털': ['tech_navy', 'cool_white', 'deep_dark'],
  'IT': ['tech_navy', 'cool_white', 'deep_dark'],
  '가전': ['tech_navy', 'cool_white', 'deep_dark'],
  '패션': ['deep_dark', 'cool_white', 'rose_soft'],
  '홈리빙': ['warm_cream', 'cream_cozy', 'cool_white'],
  '인테리어': ['warm_cream', 'cream_cozy', 'cool_white'],
  '반려동물': ['warm_cream', 'nature_green', 'cream_cozy'],
  '유기농': ['nature_green', 'fresh_mint', 'warm_cream'],
  '아웃도어': ['nature_green', 'tech_navy', 'cool_white'],
  '스포츠': ['tech_navy', 'cool_white', 'deep_dark'],
};

function getCandidatePalettes(categoryKeyword: string): PaletteName[] {
  for (const [key, candidates] of Object.entries(CATEGORY_PALETTE_CANDIDATES)) {
    if (categoryKeyword.includes(key)) {
      return candidates;
    }
  }
  return ['cool_white', 'warm_cream', 'nature_green'];
}

// 유효한 SectionType 집합 (런타임 검증용)
const VALID_SECTION_TYPES = new Set<string>([
  'hero',
  'selling_points',
  'features',
  'stats',
  'spec_table',
  'usage_steps',
  'warning',
  'cta',
]);

// ─────────────────────────────────────────
// 요청 스키마
// ─────────────────────────────────────────

const RequestSchema = z
  .object({
    // 이미지 (base64) — 선택적
    images: z
      .array(
        z.object({
          imageBase64: z.string().min(1),
          mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        }),
      )
      .max(3)
      .optional(),
    // 텍스트 컨텍스트 — 선택적
    productName: z.string().max(100).optional(),
    categoryCode: z.string().max(20).optional(),
  })
  .refine(
    (d) => (d.images && d.images.length > 0) || d.productName,
    { message: 'images 또는 productName 중 하나는 필수입니다.' },
  );

// ─────────────────────────────────────────
// AI 시스템 프롬프트
// ─────────────────────────────────────────

const ANALYZE_SYSTEM_PROMPT = `당신은 한국 이커머스 상품 이미지를 분석하여 최적의 상세페이지 디자인 테마를 추천하는 전문가입니다.

제공된 상품 이미지와 정보를 분석하여 아래 JSON만 출력하세요. 코드 블록, 마크다운, 설명 텍스트 없이 JSON만.

반환 형식:
{
  "recommendedPalette": "팔레트명",
  "dominantColors": ["hex색상1", "hex색상2"],
  "mood": "elegant" | "energetic" | "natural" | "tech" | "casual",
  "suggestedSections": ["hero", "selling_points", ...],
  "reasoning": "추천 이유 한 문장 (한국어)"
}

팔레트 선택 기준:
- warm_cream: 홈리빙, 식품, 반려동물, 인테리어 — 따뜻한 크림 계열
- cool_white: 디지털, 가전, B2B, 사무용품 — 깔끔하고 미니멀한 제품
- deep_dark: 패션, 뷰티, 주류, 명품 — 고급스러운 다크 계열
- nature_green: 유기농식품, 건강식품, 아웃도어 — 자연 그린 계열
- tech_navy: IT, 디지털, 스포츠, 자동차용품 — 테크 네이비 계열
- rose_soft: 뷰티, 스킨케어, 여성패션 — 소프트 핑크 계열
- cream_cozy: 홈카페, 식품, 유아, 반려동물 — 따뜻한 크림 계열
- sunset_warm: 식품, 주방, 라이프스타일 — 웜 오렌지 계열
- fresh_mint: 헬스케어, 건기식, 유아, 의약외품 — 민트 그린 계열

suggestedSections 순서: hero는 항상 첫 번째. 제품 특성에 맞는 3-6개 섹션.`;

// ─────────────────────────────────────────
// Gemini 응답 타입 (내부 파싱용)
// ─────────────────────────────────────────

interface GeminiAnalysisResult {
  recommendedPalette: string;
  dominantColors: string[];
  mood: string;
  suggestedSections: unknown[];
  reasoning: string;
}

// ─────────────────────────────────────────
// POST 핸들러
// ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // 1. 인증 검증
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;

    // 2. Rate limit 검증
    const ip =
      request.headers.get('x-forwarded-for') ??
      request.headers.get('x-real-ip') ??
      'unknown';
    const rl = checkRateLimit(getRateLimitKey(ip, 'analyze-product'), RATE_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        { status: 429, headers: { 'X-RateLimit-Reset': rl.resetAt.toString() } },
      );
    }

    // 3. 요청 바디 파싱
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: '요청 바디를 JSON으로 파싱할 수 없습니다.' },
        { status: 400 },
      );
    }

    // 4. Zod 검증
    const parsed = RequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join(' | ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { images, productName, categoryCode } = parsed.data;

    // 5. Gemini parts 구성
    type GeminiPart =
      | { text: string }
      | { inlineData: { data: string; mimeType: string } };

    const contents: GeminiPart[] = [];

    // 이미지가 있으면 parts에 추가
    if (images && images.length > 0) {
      for (const img of images) {
        contents.push({
          inlineData: { data: img.imageBase64, mimeType: img.mimeType },
        });
      }
    }

    // 텍스트 컨텍스트 구성
    let textPrompt: string;
    if (!images || images.length === 0) {
      // 이미지 없이 상품명만 제공된 경우
      textPrompt = `상품명: ${productName ?? ''}\n\n상품명을 바탕으로 최적의 상세페이지 테마를 추천하세요.`;
    } else {
      // 이미지가 있는 경우
      textPrompt = '위 상품 이미지를 분석하여 최적의 상세페이지 테마를 추천하세요.';
      if (productName) {
        textPrompt = `상품명: ${productName}\n\n` + textPrompt;
      }
    }
    // Stage 1: 카테고리 기반 후보 팔레트 축소
    const categoryHint = categoryCode ?? productName ?? '';
    const candidates = getCandidatePalettes(categoryHint);
    textPrompt += `\n\n다음 후보 팔레트 중에서만 선택하세요: ${candidates.join(', ')}`;

    if (categoryCode) textPrompt = `카테고리 코드: ${categoryCode}\n` + textPrompt;
    contents.push({ text: textPrompt });

    // 6. Gemini API 호출
    let rawText: string;
    try {
      const ai = getGeminiGenAI();
      const response = await withRetry(
        () => ai.models.generateContent({
          model: MODEL,
          contents: [{ role: 'user', parts: contents }],
          config: {
            systemInstruction: ANALYZE_SYSTEM_PROMPT,
            temperature: 0.3,
          },
        }),
        { label: 'analyze-product' },
      );

      const candidates = response.candidates;
      if (!candidates?.length || !candidates[0]?.content?.parts?.length) {
        throw new Error('Gemini 응답이 비어 있습니다.');
      }

      // 텍스트 파트 추출
      const textPart = candidates[0].content.parts.find(
        (p) => typeof (p as { text?: string }).text === 'string',
      ) as { text: string } | undefined;

      if (!textPart?.text) {
        throw new Error('Gemini 응답에서 텍스트를 찾을 수 없습니다.');
      }

      rawText = textPart.text;
    } catch (err) {
      console.error('[analyze-product] Gemini 호출 오류:', err);
      return NextResponse.json(
        { error: '제품 분석 중 오류가 발생했습니다.' },
        { status: 500 },
      );
    }

    // 7. JSON 파싱
    let result: GeminiAnalysisResult;
    try {
      result = parseJsonFromText(rawText) as GeminiAnalysisResult;
    } catch (err) {
      console.error('[analyze-product] JSON 파싱 오류:', err, '\nrawText:', rawText);
      return NextResponse.json(
        { error: 'AI 응답을 파싱하지 못했습니다.' },
        { status: 500 },
      );
    }

    // 8. recommendedPalette 검증 — 유효하지 않으면 기본값 사용
    const palette: PaletteName = VALID_PALETTE_NAMES.has(result.recommendedPalette)
      ? (result.recommendedPalette as PaletteName)
      : 'cool_white';

    // 9. 테마 객체 생성
    const theme: DetailPageTheme = {
      palette,
      primaryColor: PALETTES[palette].bg,
      accentColor: PALETTES[palette].accent,
      fontStyle: 'mixed',
      imageLayout: 'fullbleed',
    };

    // 10. suggestedSections 검증 및 정규화
    const suggestedSections = (
      Array.isArray(result.suggestedSections)
        ? result.suggestedSections
        : ['hero', 'selling_points', 'features', 'cta']
    )
      .filter(
        (s: unknown): s is SectionType =>
          typeof s === 'string' && VALID_SECTION_TYPES.has(s),
      ) as SectionType[];

    // hero를 항상 첫 번째 위치로 강제
    const heroIdx = suggestedSections.indexOf('hero');
    if (heroIdx > 0) {
      suggestedSections.splice(heroIdx, 1);
      suggestedSections.unshift('hero');
    } else if (heroIdx === -1) {
      suggestedSections.unshift('hero');
    }

    // 11. 성공 응답
    return NextResponse.json({
      theme,
      suggestedSections,
      reasoning: typeof result.reasoning === 'string' ? result.reasoning : '',
      dominantColors: Array.isArray(result.dominantColors) ? result.dominantColors : [],
    });
  } catch (err) {
    console.error('[analyze-product] 예상치 못한 오류:', err);
    return NextResponse.json(
      { error: '제품 분석 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
