/**
 * POST /api/ai/suggest-thumbnail-prompts
 *
 * context='thumbnail' → 썸네일 이미지 편집 프롬프트 3개
 * context='detail'    → 상세페이지 이미지 편집 프롬프트 3개
 * context='detail-html' → 상세페이지 HTML 편집 지시문 3개
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { callClaude } from '@/lib/ai/claude-cli';
import { withRetry } from '@/lib/ai/resilience';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { COUPANG_IMAGE_GUIDE_KR } from '@/lib/ai/prompts/coupang-image-guide';

const SUGGEST_PROMPTS_RATE_LIMIT = { windowMs: 60_000, maxRequests: 20 };

const OptionValueSchema = z.object({ label: z.string() });
const OptionSchema = z.object({
  typeName: z.string(),
  values: z.array(OptionValueSchema),
});

const RequestSchema = z.object({
  title: z.string().min(1).max(300),
  categoryHint: z.string().max(100).optional(),
  description: z.string().max(3000).optional(),
  options: z.array(OptionSchema).optional(),
  context: z.enum(['thumbnail', 'detail', 'detail-html']).default('thumbnail'),
});

export function buildThumbnailSystemPrompt(): string {
  return `당신은 한국 이커머스 전문 썸네일 기획자입니다.
상품 정보를 분석해서 쿠팡 썸네일 AI 편집에 사용할 프롬프트 3가지를 제안하세요.

${COUPANG_IMAGE_GUIDE_KR}

## 프롬프트 작성 규칙
- 각 프롬프트는 AI 이미지 편집 도구에 바로 입력 가능한 한국어 지시문
- 구체적이고 실행 가능한 표현 사용 (예: "흰 배경으로 교체하고 상품을 중앙에 85% 이상 차지하도록 배치" O, "예쁘게" X)
- 위 쿠팡 가이드라인을 항상 따른다. 가이드라인 위반 행동(텍스트 추가, 가격 표시, 모델 추가(패션 외), 컬러 배경(예외 카테고리 외), 콜라주 분할 등)은 절대 제안하지 않는다.

## 3가지 프롬프트 방향
1. **기본형** — 흰 배경(#FFFFFF), 상품을 중앙에 배치하고 높이/너비의 85% 이상 차지하도록 (반드시 포함)
2. **연출형(카테고리 허용 시에만)** — 신선식품·패션·반려동물·생활/주방 일부 등 연출컷 허용 카테고리일 때만 자연스러운 연출 컷 제안. 그 외 카테고리에서는 흰 배경 유지하면서 그림자/반사 등으로 입체감을 더하는 방향으로 제안.
3. **멀티샷형** — 컬러 옵션이 2가지 이상이면 "색상별 N개 상품을 흰 배경 위에 가로로 나란히 배치, 전체가 이미지의 85% 이상 차지" 형태로 제안. 단일 색상이면 상품의 주요 기능/구성품을 함께 보여주는 구도(텍스트·화살표 없이 구도만으로) 제안.

## 출력 형식 (JSON만 반환, 설명 없음)
{"prompts":["프롬프트1","프롬프트2","프롬프트3"]}`;
}

export function buildDetailSystemPrompt(): string {
  return `당신은 한국 이커머스 전문 상세페이지 기획자입니다.
상품 정보를 분석해서 쿠팡 상세페이지 이미지 AI 편집에 사용할 프롬프트 3가지를 제안하세요.

${COUPANG_IMAGE_GUIDE_KR}

## 프롬프트 작성 규칙
- 각 프롬프트는 AI 이미지 편집 도구에 바로 입력 가능한 한국어 지시문
- 구체적이고 실행 가능한 표현 (예: "배경을 #FFFFFF 흰색으로 교체하고 상품 아래 작은 그림자 추가" O, "예쁘게" X)
- 상세페이지 이미지도 위 가이드라인을 준수해야 함. 텍스트·로고·홍보 문구·콜라주·모델(패션 외) 추가 제안 금지
- 상세페이지는 썸네일과 달리 상품 특징·기능·사용감 전달이 목적이므로, 텍스트가 아닌 **구도와 클로즈업**으로 강조

## 3가지 프롬프트 방향
1. **배경정리형** — 배경을 #FFFFFF로 정돈, 상품을 중앙에 85% 이상 차지하게 배치, 작은 그림자로 입체감 부여
2. **특징강조형** — 핵심 부위·기능을 클로즈업하는 구도. 단 판매상품 자체가 잘리지 않아야 하고 화살표/텍스트 추가는 금지
3. **연출형(카테고리 허용 시)** — 카테고리가 연출컷을 허용하는 경우에만 자연스러운 사용 환경 제안 (예: 신선식품 → 도마/접시, 캠핑텐트 → 야외, 인형 → 자연 배경). 허용되지 않는 카테고리(일반식품·음료·자전거·냉장고·프라이팬+요리·보드게임 등)는 흰 배경 유지

## 출력 형식 (JSON만 반환, 설명 없음)
{"prompts":["프롬프트1","프롬프트2","프롬프트3"]}`;
}

export function buildDetailHtmlSystemPrompt(): string {
  return `당신은 한국 이커머스 전문 상세페이지 HTML 편집 기획자입니다.
상품 정보를 분석해서 기존 HTML을 개선하는 데 사용할 편집 지시문 3가지를 제안하세요.

## 지시문 작성 규칙
- 각 지시문은 HTML 편집 AI에게 바로 전달할 수 있는 구체적인 한국어 지시문
- 결과가 명확한 표현 사용 (예: "상품의 핵심 기능 3가지를 불릿 리스트로 강조해줘" O, "잘 만들어줘" X)
- HTML 구조와 이미지 태그를 유지하는 수준의 변경을 지시할 것

## 3가지 지시문 방향
1. **설명강화형** - 상품 설명 텍스트를 더 구체적이고 설득력 있게 다시 작성
2. **레이아웃정리형** - 이미지와 텍스트 배치를 모바일 친화적으로 재구성, 여백 및 폰트 정리
3. **특징부각형** - 이 상품 카테고리에서 구매 결정에 영향을 주는 핵심 특징/사양을 강조

## 출력 형식 (JSON만 반환, 설명 없음)
{"prompts":["지시문1","지시문2","지시문3"]}`;
}

function buildUserPrompt(
  title: string,
  categoryHint: string | undefined,
  description: string | undefined,
  options: z.infer<typeof OptionSchema>[] | undefined,
  context: 'thumbnail' | 'detail' | 'detail-html',
): string {
  const colorOption = options?.find((o) =>
    /컬러|색상|색|color/i.test(o.typeName),
  );
  const colorCount = colorOption?.values.length ?? 0;
  const colorLabels = colorOption?.values.map((v) => v.label).join(', ') ?? '';

  const optionSummary =
    options && options.length > 0
      ? options
          .map((o) => `  - ${o.typeName}: ${o.values.map((v) => v.label).join(', ')}`)
          .join('\n')
      : '  없음';

  const thumbnailNote =
    context === 'thumbnail' && colorCount >= 2
      ? `\n⚠️ 컬러 옵션이 ${colorCount}가지(${colorLabels})입니다. 멀티샷형에서는 ${colorCount}개의 상품을 색상별로 나란히 배치하는 구도를 제안하세요.`
      : '';

  return `상품명: ${title}
카테고리: ${categoryHint ?? '미분류'}
${description ? `상품 설명: ${description.slice(0, 800)}` : ''}
옵션:
${optionSummary}${thumbnailNote}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 인증 검사
  const auth = await requireAuth(req);
  if (auth instanceof Response) {
    return NextResponse.json({ success: false, error: '인증이 필요합니다.' }, { status: 401 });
  }

  // Rate Limit 검사
  const ip =
    req.headers.get('x-forwarded-for') ??
    req.headers.get('x-real-ip') ??
    'unknown';
  const rateLimitResult = checkRateLimit(
    getRateLimitKey(ip, 'suggest-thumbnail-prompts'),
    SUGGEST_PROMPTS_RATE_LIMIT,
  );
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rateLimitResult.resetAt.toString() } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: '잘못된 요청 형식' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '유효하지 않은 입력' },
      { status: 400 },
    );
  }

  const { title, categoryHint, description, options, context } = parsed.data;

  let systemPrompt: string;
  if (context === 'detail-html') {
    systemPrompt = buildDetailHtmlSystemPrompt();
  } else if (context === 'detail') {
    systemPrompt = buildDetailSystemPrompt();
  } else {
    systemPrompt = buildThumbnailSystemPrompt();
  }
  const userPrompt = buildUserPrompt(title, categoryHint, description, options, context);

  try {
    const raw = await withRetry(() => callClaude(systemPrompt, userPrompt, 'haiku', 600));
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');

    const parsed2 = JSON.parse(jsonMatch[0]) as { prompts?: unknown };
    if (!Array.isArray(parsed2.prompts) || parsed2.prompts.length === 0) {
      throw new Error('prompts 배열 없음');
    }

    const prompts = (parsed2.prompts as unknown[])
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .slice(0, 3);

    return NextResponse.json({ success: true, data: { prompts } });
  } catch (err) {
    console.error('[suggest-thumbnail-prompts]', err);
    return NextResponse.json(
      { success: false, error: '프롬프트 생성 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
