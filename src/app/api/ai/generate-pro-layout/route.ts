/**
 * POST /api/ai/generate-pro-layout
 *
 * OCR 결과 + 상품 정보 → Claude Sonnet으로 전체 페이지 DSL 생성
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { callClaude } from '@/lib/ai/claude-cli';

export const maxDuration = 180;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 2 };

const RequestSchema = z.object({
  productInfo: z.object({
    name: z.string().min(1).max(200),
    points: z.array(z.string().max(200)).max(30).default([]),
    category: z.string().max(100).default(''),
  }),
  analyzedSections: z
    .array(
      z.object({
        blockType: z.string(),
        rawText: z.string(),
        extractedData: z.unknown(),
        confidence: z.string(),
        needsReview: z.boolean(),
      })
    )
    .max(8)
    .default([]),
  productImageCount: z.number().min(0).max(4).default(0),
});

const CLAUDE_SYSTEM = `You are a Korean e-commerce product detail page designer.
Generate a complete page layout as a JSON array of sections for mobile (390px width).

Each section is a ClaudeLayoutContent object:
{
  "type": "claude_layout",
  "title": "section title",
  "blocks": [...],
  "bgStyle": "white"|"light"|"dark"|"primary",
  "padding": "normal"|"compact"|"wide",
  "imageSlots": [{"slotType": "flux_lifestyle"|"product_nukki", "promptHint": "..."}]
}

Available block types in blocks[]:
- badge: { type, text, color?: 'primary'|'accent'|'neutral' }
- heading: { type, text, size: 'xl'|'lg'|'md', bold?, color? }
- subtext: { type, text, align?: 'left'|'center' }
- image: { type, attachedIndex: 0..N }
- stat_row: { type, items: [{label, value, unit?}] }
- bullet_list: { type, items: string[], icon?: 'dot'|'check'|'arrow' }
- columns: { type, cols: LayoutBlock[][], gap? }
- divider: { type }
- spacer: { type, height: number }
- progress_bar: { type, items: [{label, value(0-100), displayValue?, highlight?}] }
- process_flow: { type, direction?: 'horizontal'|'vertical', items: [{label, sublabel?, highlight?}] }
- icon_grid: { type, cols?: 2|3, items: [{icon, title, subtitle?}] }
- layout_bar_chart: { type, title?, unit?, groups: string[], groupColors: string[], items: [{label, values: number[]}], showLegend? }

DESIGN RULES:
1. Use extracted chart data EXACTLY as provided — do not modify numbers
2. Use stat_row for large impact numbers
3. heading 'xl' for section headlines
4. imageSlots map to section images
5. For lifestyle images use slotType "flux_lifestyle" with descriptive promptHint in Korean
6. Generate 6-10 sections for a complete detail page
7. NEVER use Chinese characters (한자/漢字). Use Korean (한글) or English ONLY. This applies to ALL text: titles, labels, sublabels, stat values, promptHints, badge text, etc. Examples of FORBIDDEN characters: 適當 → write "적당", 溫度 → write "온도", 品質 → write "품질".
8. Design for 390px mobile width — avoid wide horizontal layouts or tables that overflow narrow screens. Use vertical or wrapped layouts.

Return ONLY valid JSON array — no explanation, no code fences:
[section1, section2, ...]`;

/** CJK 문자 감지 정규식 (한자, 한중일 통합 한자 등) */
const CJK_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g;

/** JSON 값 트리를 재귀 순회하며 문자열에서 CJK 문자를 제거 */
function stripCjk(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(CJK_REGEX, '').trim();
  if (Array.isArray(value)) return value.map(stripCjk);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripCjk(v)]));
  }
  return value;
}

/** 첫 번째 완전한 JSON 배열을 추출 (코드펜스 무관) */
function extractJsonArray(text: string): string | null {
  // 코드펜스 안에 있어도 첫 [ 부터 매칭하면 충분
  const start = text.indexOf('[');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'generate-pro-layout'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청입니다.' },
      { status: 400 }
    );
  }

  const { productInfo, analyzedSections, productImageCount } = parsed.data;

  const userPrompt = [
    `Product: "${productInfo.name}"`,
    productInfo.category ? `Category: ${productInfo.category}` : '',
    productInfo.points.length > 0
      ? `Key points:\n${productInfo.points.map(p => `- ${p}`).join('\n')}`
      : '',
    productImageCount > 0 ? `Product images available: ${productImageCount}` : '',
    analyzedSections.length > 0
      ? `Extracted data from reference pages:\n${analyzedSections
          .map((s, i) => `Section ${i + 1} (${s.blockType}): ${JSON.stringify(s.extractedData)}`)
          .join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const text = await callClaude(CLAUDE_SYSTEM, userPrompt, 'opus', 16000);

    console.log('[generate-pro-layout] text 길이:', text.length, '앞100자:', JSON.stringify(text.slice(0, 100)));

    const jsonStr = extractJsonArray(text);
    if (!jsonStr) {
      console.error('[generate-pro-layout] JSON 배열 없음. 앞500자:', JSON.stringify(text.slice(0, 500)));
      return NextResponse.json(
        { success: false, error: 'Claude 응답에서 JSON 배열을 찾을 수 없습니다.', _debug: text.slice(0, 300) },
        { status: 500 }
      );
    }

    let sections: unknown[];
    try {
      sections = JSON.parse(jsonStr) as unknown[];
    } catch (e) {
      console.error('[generate-pro-layout] JSON 파싱 실패. 추출된 문자열:', jsonStr.slice(0, 500));
      return NextResponse.json(
        { success: false, error: 'Claude 응답 JSON 파싱 실패' },
        { status: 500 }
      );
    }

    sections = stripCjk(sections) as unknown[];

    return NextResponse.json({ success: true, sections });
  } catch (error) {
    console.error('[generate-pro-layout] 오류:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `레이아웃 생성 실패: ${msg}` },
      { status: 500 }
    );
  }
}
