/**
 * POST /api/detail-page/edit-section
 *
 * 기존 섹션 데이터와 사용자 지시어를 받아 Claude로 섹션 content를 재생성하고,
 * renderSection으로 HTML을 즉시 렌더링하여 반환합니다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getAnthropicClient } from '@/lib/ai/claude';
import { withRetry } from '@/lib/ai/resilience';
import { checkProhibitedPhrases, buildSectionEditPrompt, parseJsonFromText } from '@/lib/ai/prompts/detail-page';
import { renderSection } from '@/lib/detail-page/section-renderer';
import type { DetailSection, DetailPageTheme, SectionContent } from '@/types/detail-page';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const EDIT_SECTION_RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };

// ─────────────────────────────────────────
// 요청 검증 스키마 (Zod)
// ─────────────────────────────────────────

const RequestSchema = z.object({
  section: z.object({
    id: z.string(),
    type: z.enum([
      'hero',
      'selling_points',
      'features',
      'stats',
      'spec_table',
      'usage_steps',
      'warning',
      'cta',
    ]),
    order: z.number().int().min(0),
    content: z.record(z.string(), z.unknown()),
    attachedImages: z
      .array(
        z.object({
          url: z.string().url(),
          order: z.number().int().min(0),
          processingMode: z.enum(['original', 'bg_removed', 'bg_composed']),
        }),
      )
      .default([]),
    aiInstruction: z.string().optional(),
  }),
  instruction: z
    .string()
    .min(1, '지시어를 입력해주세요.')
    .max(500, '지시어는 500자 이하로 입력해주세요.'),
  theme: z.object({
    palette: z.enum(['warm_cream', 'cool_white', 'deep_dark', 'nature_green', 'tech_navy']),
    primaryColor: z.string(),
    accentColor: z.string(),
    fontStyle: z.enum(['serif', 'sans', 'mixed']),
    imageLayout: z.enum(['fullbleed', 'composed', 'split']),
  }),
  // 컨텍스트 (선택 — AI 일관성 유지에 활용)
  productName: z.string().max(100).optional(),
  existingSections: z
    .array(
      z.object({
        type: z.string(),
        content: z.record(z.string(), z.unknown()),
      }),
    )
    .max(20)
    .optional(),
});

// ─────────────────────────────────────────
// AI 시스템 프롬프트
// ─────────────────────────────────────────

const SECTION_EDIT_SYSTEM_PROMPT = `당신은 한국 이커머스 상세페이지 섹션을 편집하는 전문가입니다.

주어진 섹션 데이터를 사용자의 지시어에 따라 개선하여 JSON으로만 반환하세요.
- 코드 블록, 마크다운, 설명 텍스트 없이 JSON만 출력
- 기존 섹션 타입(type 필드)은 절대 변경 금지
- 쿠팡 광고 정책: "감염예방", "선착순", "피부 속" 등 금지어 포함 금지
- 모든 텍스트는 한국어로 작성
- type 필드는 반드시 원본과 동일하게 유지`;

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 인증 검사
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) {
    return authResult as unknown as NextResponse;
  }

  // Rate Limit 검사
  const ip =
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    'unknown';
  const rateLimitResult = checkRateLimit(
    getRateLimitKey(ip, 'edit-section'),
    EDIT_SECTION_RATE_LIMIT,
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
  } catch (e) {
    console.error('[edit-section] request.json() 실패:', String(e));
    return NextResponse.json(
      { error: '요청 바디를 JSON으로 파싱할 수 없습니다.' },
      { status: 400 },
    );
  }

  // Zod 검증
  const parseResult = RequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    console.error('[edit-section] Zod 검증 실패:', JSON.stringify(parseResult.error.issues));
    const firstIssue = parseResult.error.issues[0];
    return NextResponse.json(
      { error: firstIssue ? firstIssue.message : '입력값 검증 실패' },
      { status: 400 },
    );
  }

  const { section: rawSection, instruction, theme, productName, existingSections } = parseResult.data;

  // Zod 파싱 결과를 DetailSection 타입으로 재구성
  const section: DetailSection = {
    id: rawSection.id,
    type: rawSection.type,
    order: rawSection.order,
    content: rawSection.content as unknown as SectionContent,
    attachedImages: rawSection.attachedImages,
    aiInstruction: rawSection.aiInstruction,
  };

  const themeValue: DetailPageTheme = theme;

  // AI 호출
  const client = getAnthropicClient();
  let aiResponseText: string;
  try {
    const response = await withRetry(
      () =>
        client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: SECTION_EDIT_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: buildSectionEditPrompt(section, instruction, productName, existingSections),
            },
          ],
        }),
      { label: 'edit-section' },
    );

    aiResponseText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
  } catch (error) {
    console.error('[edit-section] Claude API 호출 실패:', error);
    return NextResponse.json(
      { error: '섹션 편집 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }

  // AI 응답에서 JSON 파싱
  let parsedContent: unknown;
  try {
    parsedContent = parseJsonFromText(aiResponseText);
  } catch (error) {
    console.error('[edit-section] AI 응답 JSON 파싱 실패:', error, '\n응답 원문:', aiResponseText);
    return NextResponse.json(
      { error: 'AI 응답을 파싱하지 못했습니다.' },
      { status: 500 },
    );
  }

  // 배열·null 응답 가드: AI가 객체가 아닌 값을 반환한 경우 즉시 거부
  if (typeof parsedContent !== 'object' || parsedContent === null || Array.isArray(parsedContent)) {
    return NextResponse.json(
      { error: 'AI가 올바른 JSON 객체를 반환하지 않았습니다.' },
      { status: 500 },
    );
  }

  // type 필드 강제 고정: AI가 변경하지 못하도록 원본 type으로 덮어씀
  const updatedContent = {
    ...(parsedContent as object),
    type: section.type,
  } as unknown as SectionContent;

  // 금지어 검사
  const { violations } = checkProhibitedPhrases(JSON.stringify(updatedContent));
  if (violations.length > 0) {
    console.warn('[edit-section] 금지 표현 감지:', violations);
    return NextResponse.json(
      { error: `생성된 콘텐츠에 금지 표현이 포함되어 있습니다: ${violations.join(', ')}` },
      { status: 400 },
    );
  }

  // 업데이트된 섹션 조립
  const updatedSection: DetailSection = {
    ...section,
    content: updatedContent,
  };

  // renderSection으로 HTML 렌더링
  let html: string;
  try {
    html = renderSection(updatedSection, themeValue);
  } catch (error) {
    console.error('[edit-section] renderSection 실패:', error);
    return NextResponse.json(
      { error: '섹션 편집 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ section: updatedSection, html }, { status: 200 });
}
