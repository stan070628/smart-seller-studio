/**
 * POST /api/ai/analyze-detail-page
 *
 * 참고 상세페이지 스크린샷을 Gemini Vision으로 분석해서
 * 섹션 타입과 차트 데이터를 구조화된 JSON으로 추출합니다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getGeminiGenAI } from '@/lib/ai/gemini';

export const maxDuration = 90;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 3 };

// ─── Zod 스키마 ───────────────────────────────────────────────────────────────

const ImageInputSchema = z.object({
  base64: z.string().min(1),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
});

const RequestSchema = z.object({
  images: z.array(ImageInputSchema).min(1).max(8),
  productName: z.string().max(100).default(''),
});

const AnalyzedSectionSchema = z.object({
  blockType: z.enum([
    'layout_bar_chart',
    'progress_bar',
    'process_flow',
    'icon_grid',
    'stat_row',
    'text',
    'unknown',
  ]),
  rawText: z.string(),
  extractedData: z.union([
    z.object({
      type: z.literal('layout_bar_chart'),
      title: z.string(),
      groups: z.array(z.string()),
      items: z.array(
        z.object({ label: z.string(), values: z.array(z.number()) }),
      ),
      unit: z.string().optional(),
    }),
    z.object({
      type: z.literal('progress_bar'),
      items: z.array(
        z.object({
          label: z.string(),
          value: z.number(),
          displayValue: z.string().optional(),
        }),
      ),
    }),
    z.object({
      type: z.literal('process_flow'),
      items: z.array(
        z.object({
          label: z.string(),
          sublabel: z.string().optional(),
          highlight: z.boolean().optional(),
        }),
      ),
    }),
    z.object({
      type: z.literal('icon_grid'),
      items: z.array(
        z.object({
          icon: z.string(),
          title: z.string(),
          subtitle: z.string().optional(),
        }),
      ),
    }),
    z.object({
      type: z.literal('stat_row'),
      items: z.array(
        z.object({
          label: z.string(),
          value: z.string(),
          unit: z.string().optional(),
        }),
      ),
    }),
    z.object({
      type: z.literal('text'),
      heading: z.string().optional(),
      body: z.string().optional(),
    }),
    z.object({
      type: z.literal('unknown'),
      description: z.string(),
    }),
  ]),
  confidence: z.enum(['high', 'medium', 'low']),
  needsReview: z.boolean(),
});

export type AnalyzedSection = z.infer<typeof AnalyzedSectionSchema>;

// ─── Gemini 프롬프트 ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Korean e-commerce detail page analyzer. Analyze the provided screenshot and extract structured data.

Identify the section type:
- layout_bar_chart: vertical grouped bar chart with numeric data
- progress_bar: horizontal progress bars showing percentages or comparisons
- process_flow: sequential steps connected with arrows
- icon_grid: grid of icons with titles
- stat_row: large numeric statistics with labels
- text: heading/body text sections
- unknown: cannot determine

For charts, extract ALL visible numbers and labels accurately.
Confidence: high = all data clearly readable, medium = some ambiguity, low = data unreliable.
needsReview: true if confidence is medium or low.

Return ONLY valid JSON matching this schema — no explanation:
{
  "blockType": "...",
  "rawText": "all text visible in image",
  "extractedData": { "type": "same as blockType", ... },
  "confidence": "high|medium|low",
  "needsReview": true|false
}`;

// ─── 폴백 섹션 생성 헬퍼 ─────────────────────────────────────────────────────

function makeUnknownSection(
  rawText: string,
  description: string,
): AnalyzedSection {
  return {
    blockType: 'unknown',
    rawText,
    extractedData: { type: 'unknown', description },
    confidence: 'low',
    needsReview: true,
  };
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  // 인증 검사
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;

  // Rate Limit 검사
  const ip =
    req.headers.get('x-forwarded-for') ??
    req.headers.get('x-real-ip') ??
    'unknown';
  const rl = checkRateLimit(
    getRateLimitKey(ip, 'analyze-detail-page'),
    RATE_LIMIT,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      {
        status: 429,
        headers: { 'X-RateLimit-Reset': rl.resetAt.toString() },
      },
    );
  }

  // 요청 바디 파싱 및 검증
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '요청 바디를 JSON으로 파싱할 수 없습니다.' },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: parsed.error.issues[0]?.message ?? '잘못된 요청입니다.',
      },
      { status: 400 },
    );
  }

  const { images, productName } = parsed.data;

  try {
    const ai = getGeminiGenAI();
    const results: AnalyzedSection[] = [];

    for (const img of images) {
      try {
        const userText =
          SYSTEM_PROMPT +
          (productName ? `\nProduct: ${productName}` : '');

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              role: 'user',
              parts: [
                { text: userText },
                {
                  inlineData: {
                    mimeType: img.mimeType,
                    data: img.base64,
                  },
                },
              ],
            },
          ],
          config: { temperature: 0.2 },
        });

        // 텍스트 파트 추출
        const textPart = response.candidates?.[0]?.content?.parts?.find(
          (p) => typeof (p as { text?: string }).text === 'string',
        ) as { text: string } | undefined;

        const text = textPart?.text ?? '';

        if (!text) {
          results.push(makeUnknownSection('', 'Gemini 응답이 비어 있습니다.'));
          continue;
        }

        // JSON 블록 추출
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          results.push(makeUnknownSection(text, 'JSON 파싱 실패'));
          continue;
        }

        let raw: unknown;
        try {
          raw = JSON.parse(jsonMatch[0]);
        } catch {
          results.push(makeUnknownSection(text, 'JSON.parse 실패'));
          continue;
        }

        const validated = AnalyzedSectionSchema.safeParse(raw);
        if (validated.success) {
          results.push(validated.data);
        } else {
          console.warn(
            '[analyze-detail-page] schema 불일치:',
            validated.error.issues,
          );
          results.push(makeUnknownSection(text, 'schema 불일치'));
        }
      } catch (imgErr) {
        console.error('[analyze-detail-page] 이미지 분석 오류:', imgErr);
        results.push(makeUnknownSection('', '이미지 분석 중 오류 발생'));
      }
    }

    const reviewRequired = results.some((r) => r.needsReview);
    return NextResponse.json({ success: true, sections: results, reviewRequired });
  } catch (error) {
    console.error('[analyze-detail-page] 오류:', error);
    return NextResponse.json(
      { success: false, error: '분석에 실패했습니다.' },
      { status: 500 },
    );
  }
}
