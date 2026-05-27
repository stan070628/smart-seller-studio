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
import {
  buildThumbnailSystemPrompt,
  buildDetailSystemPrompt,
  buildDetailHtmlSystemPrompt,
} from './utils';

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
