/**
 * POST /api/ai/generate-pro-layout
 *
 * OCR 결과 + 상품 정보 → Claude Sonnet으로 전체 페이지 DSL 생성
 * SSE로 진행률을 실시간 스트리밍합니다.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';

export const maxDuration = 180;

/** 분당 최대 요청 수 */
const RATE_LIMIT = { windowMs: 60_000, maxRequests: 2 };

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

const RequestSchema = z.object({
  productInfo: z.object({
    name: z.string().min(1).max(200),
    points: z.array(z.string().max(200)).max(10).default([]),
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

// ─────────────────────────────────────────
// Claude 시스템 프롬프트
// ─────────────────────────────────────────

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

Return ONLY valid JSON array — no explanation, no code fences:
[section1, section2, ...]`;

// ─────────────────────────────────────────
// SSE 유틸
// ─────────────────────────────────────────

function sseChunk(event: string, data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ─────────────────────────────────────────
// POST 핸들러
// ─────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  // 1. 인증 검증
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  // 2. Rate Limit 검사
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'generate-pro-layout'), RATE_LIMIT);
  if (!rl.allowed) {
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(sseChunk('error', { message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }));
        ctrl.close();
      },
    });
    return new Response(stream, {
      status: 429,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }

  // 3. 요청 바디 검증
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(
          sseChunk('error', { message: parsed.error.issues[0]?.message ?? '잘못된 요청입니다.' })
        );
        ctrl.close();
      },
    });
    return new Response(stream, {
      status: 400,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }

  const { productInfo, analyzedSections, productImageCount } = parsed.data;

  // 4. SSE 스트림 생성
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: Record<string, unknown>) => {
        ctrl.enqueue(sseChunk(event, data));
      };

      try {
        send('progress', { step: 'generating', message: 'Claude가 레이아웃을 설계하는 중...' });

        // 사용자 프롬프트 조립
        const userPrompt = [
          `Product: "${productInfo.name}"`,
          productInfo.category ? `Category: ${productInfo.category}` : '',
          productInfo.points.length > 0
            ? `Key points:\n${productInfo.points.map(p => `- ${p}`).join('\n')}`
            : '',
          productImageCount > 0 ? `Product images available: ${productImageCount}` : '',
          analyzedSections.length > 0
            ? `Extracted data from reference pages:\n${analyzedSections
                .map(
                  (s, i) =>
                    `Section ${i + 1} (${s.blockType}): ${JSON.stringify(s.extractedData)}`
                )
                .join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n');

        // Claude API 호출
        const { getAnthropicClient } = await import('@/lib/ai/claude');
        const client = getAnthropicClient();
        const res = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: CLAUDE_SYSTEM,
          messages: [{ role: 'user', content: userPrompt }],
        });

        // 텍스트 블록 추출
        const text = res.content
          .filter(b => b.type === 'text')
          .map(b => (b as { type: 'text'; text: string }).text)
          .join('');

        send('progress', { step: 'parsing', message: '레이아웃을 구성하는 중...' });

        // JSON 배열 파싱 (첫 번째 [...] 블록 추출)
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) {
          send('error', { message: 'Claude 응답 파싱 실패: JSON 배열을 찾을 수 없습니다.' });
          ctrl.close();
          return;
        }

        let sections: unknown[];
        try {
          sections = JSON.parse(match[0]) as unknown[];
        } catch {
          send('error', { message: 'Claude 응답 파싱 실패: 유효하지 않은 JSON입니다.' });
          ctrl.close();
          return;
        }

        send('complete', { sections });
      } catch (error) {
        console.error('[generate-pro-layout] 오류:', error);
        send('error', { message: '레이아웃 생성 중 오류가 발생했습니다.' });
      } finally {
        ctrl.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
