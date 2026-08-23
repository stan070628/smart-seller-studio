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
import { sanitizeProLayout } from '@/lib/detail-page/layout-validator';
import { composeYoutubeThumbnail } from '@/lib/detail-page/youtube-thumbnail';
import { PALETTE_NAMES } from '@/lib/detail-page/palette-config';
import { appendPrivacyFooter } from '@/lib/detail-page-privacy';
import { wrapRenderedSections } from '@/lib/detail-page/wrap-rendered';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';

// ─────────────────────────────────────────
// 요청 검증 스키마 (Zod)
// ─────────────────────────────────────────

const RequestSchema = z.object({
  sections: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum(['hero', 'selling_points', 'features', 'stats', 'spec_table', 'usage_steps', 'warning', 'cta', 'brand_header', 'point', 'image_grid', 'claude_layout', 'youtube']),
        order: z.number().int().min(0),
        content: z.record(z.string(), z.unknown()),
        attachedImages: z
          .array(
            z.object({
              url: z.string(),
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
  mode: z.enum(['preview', 'export']).optional().default('export'),
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
        // path를 붙이지 않으면 "expected string, received undefined"만 남아
        // 어느 필드가 빠졌는지 알 수 없다.
        error: firstIssue
          ? `${firstIssue.message} (${firstIssue.path.join('.') || 'root'})`
          : '입력값 검증 실패',
      },
      { status: 400 },
    );
  }

  const { sections, theme, mode } = parseResult.data;

  // claude_layout 섹션의 불량 블록·CJK가 렌더를 깨거나 오염하지 않도록 정화.
  // sanitizeProLayout는 CJK를 전체 문자열(title 포함)에서 제거하고 불량/빈 블록을 prune하므로
  // 정화된 결과 content 전체를 사용한다. (단일 요소라 cleaned[0]는 항상 존재하나 방어적으로 fallback.)
  const safeSections = sections.map((s) => {
    if (s.type !== 'claude_layout') return s;
    const { sections: cleaned } = sanitizeProLayout([s.content]);
    return { ...s, content: cleaned[0] ?? { ...(s.content as Record<string, unknown>), blocks: [] } };
  });

  // export 모드에서만: enabled 유튜브 섹션의 재생버튼 합성 썸네일을 미리 생성해 content에 채운다.
  const withYoutube = await Promise.all(
    safeSections.map(async (s) => {
      if (s.type !== 'youtube' || mode !== 'export') return s;
      const c = s.content as { videoId?: string; enabled?: boolean; aspect?: 'vertical' | 'horizontal' };
      if (!c.enabled || !c.videoId) return s;
      try {
        const url = await composeYoutubeThumbnail(c.videoId, c.aspect ?? 'horizontal');
        return { ...s, content: { ...c, exportThumbnailUrl: url } };
      } catch (e) {
        console.error('[detail-page/render] 유튜브 썸네일 합성 실패:', e);
        return s; // 실패 시 renderYoutube가 hqdefault 폴백 img 사용
      }
    }),
  );

  // 렌더링
  let renderedSections: string;
  try {
    // Zod에서 content는 z.record(z.unknown())으로 받았으므로 unknown 경유 후 DetailSection으로 캐스팅
    renderedSections = renderAllSections(withYoutube as unknown as DetailSection[], theme as DetailPageTheme, mode);
  } catch (error) {
    console.error('[detail-page/render] 섹션 렌더링 실패:', error);
    return NextResponse.json(
      { error: '렌더링 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }

  // 본문 컨테이너 래핑(폭 + font-family). 라우트를 거치지 않는 스크립트 경로도
  // 같은 함수를 써야 폭·폰트가 빠지지 않는다 — wrap-rendered.ts 주석 참조.
  const snippet = wrapRenderedSections(renderedSections, theme as DetailPageTheme);

  // html = snippet + 개인정보 고지 3종
  const html = appendPrivacyFooter(snippet, theme.layoutMode);

  return NextResponse.json({ html, snippet }, { status: 200 });
}
