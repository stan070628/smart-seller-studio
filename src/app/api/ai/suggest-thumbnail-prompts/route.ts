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

## 프롬프트 작성 규칙
- 각 프롬프트는 AI 이미지 편집 도구에 바로 입력 가능한 한국어 지시문
- 구체적이고 실행 가능한 표현 사용 (예: "흰 배경으로 교체" O, "예쁘게" X)
- 쿠팡 썸네일 가이드라인: 흰 배경 또는 단색 배경, 상품이 화면 70% 이상 차지, 텍스트 없음

## 3가지 프롬프트 방향
1. **기본형** - 흰 배경, 상품 중앙 크게 배치 (반드시 포함)
2. **스타일형** - 카테고리/상품 특성에 맞는 분위기 배경 또는 구도
3. **멀티샷형** - 컬러 옵션이 2가지 이상이면 "색상별로 N개의 상품을 나란히 배치" 구성;
   단일 색상이면 상품의 주요 기능/특징을 강조하는 구도

## 출력 형식 (JSON만 반환, 설명 없음)
{"prompts":["프롬프트1","프롬프트2","프롬프트3"]}`;
}

export function buildDetailSystemPrompt(): string {
  return `당신은 한국 이커머스 전문 상세페이지 기획자입니다.
상품 정보를 분석해서 쿠팡 상세페이지 이미지 AI 편집에 사용할 프롬프트 3가지를 제안하세요.

## 프롬프트 작성 규칙
- 각 프롬프트는 AI 이미지 편집 도구에 바로 입력 가능한 한국어 지시문
- 구체적이고 실행 가능한 표현 (예: "배경을 밝은 회색으로 교체하고 그림자 추가" O, "예쁘게" X)
- 상세페이지는 썸네일과 달리 상품 특징·기능·사용감을 전달하는 것이 목적

## 3가지 프롬프트 방향
1. **배경정리형** - 배경을 깔끔하게 정리해 상품 본연의 디자인이 잘 보이도록 (흰 배경 또는 옅은 단색)
2. **특징강조형** - 이 상품 카테고리에서 구매 결정에 영향을 주는 핵심 부위·기능을 클로즈업하거나 화살표/텍스트 없이 구도로 강조
3. **라이프스타일형** - 실제 사용 환경(거실, 주방, 야외 등 카테고리에 맞는 배경)에 자연스럽게 배치해 사용감 전달

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
