/**
 * POST /api/detail-page/render
 *
 * sections 배열과 theme을 받아 인라인 스타일 HTML을 렌더링합니다.
 * AI 호출 없는 순수 렌더링 엔드포인트 — rate limit 없음.
 * 응답에 개인정보 고지 3종 이미지(appendPrivacyFooter)를 항상 포함합니다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { renderAllSections } from '@/lib/detail-page/section-renderer';
import { PALETTE_NAMES } from '@/lib/detail-page/palette-config';
import { appendPrivacyFooter } from '@/lib/detail-page-privacy';
import type { DetailSection, DetailPageTheme, FontStyle } from '@/types/detail-page';

// fontStyle → CSS font-family 매핑 (모듈 레벨 상수)
const FONT_FAMILY_MAP: Record<FontStyle, string> = {
  sans:  "'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif",
  serif: "'Batang','HY신명조','Noto Serif KR',Georgia,serif",
  mixed: "'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif",
};

// ─────────────────────────────────────────
// 요청 검증 스키마 (Zod)
// ─────────────────────────────────────────

const RequestSchema = z.object({
  sections: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum(['hero', 'selling_points', 'features', 'stats', 'spec_table', 'usage_steps', 'warning', 'cta', 'brand_header', 'point', 'image_grid']),
        order: z.number().int().min(0),
        content: z.record(z.string(), z.unknown()),
        attachedImages: z
          .array(
            z.object({
              url: z.string().url(),
              order: z.number().int().min(0),
              processingMode: z.enum(['original', 'bg_removed', 'bg_composed'] as const),
            }),
          )
          .max(6)
          .default([]),
        aiInstruction: z.string().optional(),
        eyebrow: z.string().optional(),
      }),
    )
    .min(1, '섹션은 최소 1개 이상이어야 합니다.')
    .max(20, '섹션은 최대 20개까지 허용됩니다.'),
  theme: z.object({
    palette: z.enum(PALETTE_NAMES),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'primaryColor는 #RRGGBB 형식이어야 합니다.'),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'accentColor는 #RRGGBB 형식이어야 합니다.'),
    fontStyle: z.enum(['serif', 'sans', 'mixed']),
    imageLayout: z.enum(['fullbleed', 'composed', 'split']),
    layoutMode: z.enum(['desktop', 'mobile']).optional(),
  }),
});

// ─────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────

interface ApiSuccessResponse {
  html: string;     // 개인정보 고지 3종 포함된 전체 HTML
  snippet: string;  // 본문만 (개인정보 고지 제외)
}

interface ApiErrorResponse {
  error: string;
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse>> {
  // 인증 검사
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) {
    return authResult as unknown as NextResponse<ApiErrorResponse>;
  }

  // 요청 바디 파싱
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (e) {
    console.error('[detail-page/render] request.json() 실패:', String(e));
    return NextResponse.json(
      { error: '요청 바디를 JSON으로 파싱할 수 없습니다.' },
      { status: 400 },
    );
  }

  // Zod 검증
  const parseResult = RequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    console.error('[detail-page/render] Zod 검증 실패:', JSON.stringify(parseResult.error.issues));
    const firstIssue = parseResult.error.issues[0];
    return NextResponse.json(
      {
        error: firstIssue
          ? firstIssue.message
          : '입력값 검증 실패',
      },
      { status: 400 },
    );
  }

  const { sections, theme } = parseResult.data;

  // 렌더링
  let renderedSections: string;
  try {
    // Zod에서 content는 z.record(z.unknown())으로 받았으므로 unknown 경유 후 DetailSection으로 캐스팅
    renderedSections = renderAllSections(sections as unknown as DetailSection[], theme as DetailPageTheme);
  } catch (error) {
    console.error('[detail-page/render] 섹션 렌더링 실패:', error);
    return NextResponse.json(
      { error: '렌더링 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }

  // max-width:780px 컨테이너로 래핑 — snippet은 개인정보 고지 미포함 본문
  const snippet = `<div style="max-width:780px;margin:0 auto;font-family:${FONT_FAMILY_MAP[theme.fontStyle]};">\n${renderedSections}\n</div>`;

  // html = snippet + 개인정보 고지 3종
  const html = appendPrivacyFooter(snippet);

  return NextResponse.json({ html, snippet }, { status: 200 });
}
