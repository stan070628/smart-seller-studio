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

const BLOCK_TYPES = [
  'layout_bar_chart',
  'progress_bar',
  'process_flow',
  'icon_grid',
  'option_grid',
  'stat_row',
  'text',
  'unknown',
] as const;

// LLM은 숫자를 문자열("75", "75%")로 반환하는 경우가 잦아 강제 변환한다.
const numberish = z.preprocess((v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ''));
    return Number.isNaN(n) ? v : n;
  }
  return v;
}, z.number());

// confidence/needsReview는 렌더링과 무관한 메타 필드다. LLM이 대소문자·숫자 등
// 다른 형태로 반환하더라도 섹션 전체를 버리지 않도록 정규화 후 기본값으로 흡수한다.
const confidenceish = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.toLowerCase().trim() : v),
    z.enum(['high', 'medium', 'low']),
  )
  .catch('medium');

const needsReviewish = z
  .preprocess((v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.toLowerCase().trim() === 'true';
    return v;
  }, z.boolean())
  .catch(true);

// LLM 출력을 검증 전에 정규화한다:
//  1) null → 제거 (optional string 필드가 null을 거부하는 문제 방지)
//  2) extractedData.type 을 검증된 blockType 으로 강제 통일. LLM이 type 을
//     blockType 과 다른 값(의미형 이름 등)으로 주거나 누락해도 discriminatedUnion
//     판별이 안정적으로 동작하고, blockType↔type 불일치도 원천 차단된다.
function sanitizeSection(raw: unknown): unknown {
  const stripNull = (val: unknown): unknown => {
    if (val === null) return undefined;
    if (Array.isArray(val)) return val.map(stripNull);
    if (val && typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        const cleaned = stripNull(v);
        if (cleaned !== undefined) out[k] = cleaned;
      }
      return out;
    }
    return val;
  };
  const cleaned = stripNull(raw);
  if (cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned)) {
    const r = cleaned as Record<string, unknown>;
    if (
      r.extractedData &&
      typeof r.extractedData === 'object' &&
      !Array.isArray(r.extractedData) &&
      typeof r.blockType === 'string'
    ) {
      const ed: Record<string, unknown> = {
        ...(r.extractedData as Record<string, unknown>),
        type: r.blockType,
      };
      // Gemini가 분류 못한 unknown 섹션엔 description이 없다. 검증 실패로 버리지 말고
      // rawText를 description으로 보존해 사용자가 리뷰 화면에서 내용을 볼 수 있게 한다.
      if (r.blockType === 'unknown' && typeof ed.description !== 'string') {
        ed.description = typeof r.rawText === 'string' ? r.rawText : '';
      }
      r.extractedData = ed;
    }
  }
  return cleaned;
}

const AnalyzedSectionObject = z.object({
  blockType: z.enum(BLOCK_TYPES),
  rawText: z.string(),
  extractedData: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('layout_bar_chart'),
      title: z.string(),
      groups: z.array(z.string()),
      items: z.array(
        z.object({ label: z.string(), values: z.array(numberish) }),
      ),
      unit: z.string().optional(),
    }),
    z.object({
      type: z.literal('progress_bar'),
      items: z.array(
        z.object({
          label: z.string(),
          value: numberish,
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
      type: z.literal('option_grid'),
      items: z.array(
        z.object({
          label: z.string(),
          sublabel: z.string().optional(),
          highlight: z.boolean().optional(),
        }),
      ),
    }),
    z.object({
      type: z.literal('stat_row'),
      items: z.array(
        z.object({
          label: z.string(),
          value: z.coerce.string(),
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
      // Gemini가 분류 못한 unknown 섹션은 description이 없을 수 있으므로 기본값 허용.
      description: z.string().default(''),
    }),
  ]),
  confidence: confidenceish,
  needsReview: needsReviewish,
});

export const AnalyzedSectionSchema = z.preprocess(
  sanitizeSection,
  AnalyzedSectionObject,
);

export type AnalyzedSection = z.infer<typeof AnalyzedSectionSchema>;

// ─── Gemini 프롬프트 ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Korean e-commerce detail page analyzer. Analyze the provided screenshot and extract ALL visible text and structured data.

IMPORTANT: One screenshot usually contains MULTIPLE sections stacked vertically. Return a JSON ARRAY with one object per section, in top-to-bottom order. If the image has only one section, return an array with a single element. Never wrap the array in another object.

Identify the section type:
- layout_bar_chart: vertical grouped bar chart with numeric data
- progress_bar: horizontal progress bars showing percentages or comparisons
- process_flow: sequential/time-ordered steps connected with arrows (e.g. 봄→여름→가을, 세탁→건조)
- icon_grid: grid of icons with titles
- option_grid: parallel selectable options WITHOUT arrows (sizes S/M/L, colors, capacities). If cards show sizes/colors side by side with no flow arrows, use option_grid — NOT process_flow.
- stat_row: large numeric statistics with labels
- text: any section with headings, body text, descriptions, or product copy
- unknown: cannot determine

For charts/stats, extract ALL visible numbers and labels accurately.
For layout_bar_chart, progress_bar, process_flow, icon_grid, option_grid and stat_row, extractedData MUST include a non-empty "items" array.
For text sections, ALWAYS extract the actual text content into heading and body fields.
Confidence: high = all data clearly readable, medium = some ambiguity, low = data unreliable.
needsReview: true if confidence is medium or low.

Return ONLY a valid JSON array — no explanation. Each element:
{
  "blockType": "...",
  "rawText": "all text visible in this section — copy every word you can read",
  "extractedData": { "type": "same as blockType", ... },
  "confidence": "high|medium|low",
  "needsReview": true|false
}

extractedData examples by type:
- text: { "type": "text", "heading": "제목 텍스트", "body": "본문 내용 전체를 여기에 적어주세요" }
- stat_row: { "type": "stat_row", "items": [{ "label": "라벨", "value": "99", "unit": "%" }] }
- progress_bar: { "type": "progress_bar", "items": [{ "label": "항목", "value": 75, "displayValue": "75%" }] }
- process_flow: { "type": "process_flow", "items": [{ "label": "단계1" }, { "label": "단계2", "highlight": true }] }
- icon_grid: { "type": "icon_grid", "items": [{ "icon": "", "title": "제목", "subtitle": "부제목" }] }  // icon은 빈 문자열 — 이모지 금지
- option_grid: { "type": "option_grid", "items": [{ "label": "S", "sublabel": "40 x 35cm" }, { "label": "M", "sublabel": "55 x 45cm", "highlight": true }] }
- layout_bar_chart: { "type": "layout_bar_chart", "title": "차트명", "groups": ["그룹A"], "items": [{ "label": "항목", "values": [42] }], "unit": "%" }`;

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

    // 이미지 1장을 분석해 섹션 배열을 반환. 이미지들은 병렬 처리한다(순차 시
    // 장당 ~30초 → 8장이면 maxDuration 90초 초과). 실패해도 그 이미지만 폴백.
    const processImage = async (
      img: (typeof images)[number],
    ): Promise<AnalyzedSection[]> => {
      const out: AnalyzedSection[] = [];
      try {
        const userText =
          SYSTEM_PROMPT + (productName ? `\nProduct: ${productName}` : '');

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              role: 'user',
              parts: [
                { text: userText },
                { inlineData: { mimeType: img.mimeType, data: img.base64 } },
              ],
            },
          ],
          // responseSchema는 쓰지 않는다: Gemini structured output이 속성명
          // `items`를 JSON-schema 예약어로 오인해 통째로 누락시키는 버그가 있어,
          // process_flow/stat_row 등 items 기반 섹션이 깨진다. JSON 모드
          // (responseMimeType)만으로 펜스 제거 + 순수 JSON 배열이 보장된다.
          config: { temperature: 0.2, responseMimeType: 'application/json' },
        });

        const textPart = response.candidates?.[0]?.content?.parts?.find(
          (p) => typeof (p as { text?: string }).text === 'string',
        ) as { text: string } | undefined;
        const text = textPart?.text ?? '';

        if (!text) {
          out.push(makeUnknownSection('', 'Gemini 응답이 비어 있습니다.'));
          return out;
        }

        // structured output(JSON mode)이므로 text 전체가 유효한 JSON.
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          out.push(makeUnknownSection(text, 'JSON.parse 실패'));
          return out;
        }

        // 배열 / { sections: [...] } / 단일 객체 모두 배열로 정규화
        const rawSections: unknown[] = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as { sections?: unknown[] })?.sections)
            ? (parsed as { sections: unknown[] }).sections
            : [parsed];

        if (rawSections.length === 0) {
          out.push(makeUnknownSection(text, '섹션을 추출하지 못했습니다.'));
          return out;
        }

        // 섹션별 개별 검증 — 하나가 깨져도 나머지는 살린다.
        for (const rawSection of rawSections) {
          const validated = AnalyzedSectionSchema.safeParse(rawSection);
          if (validated.success) {
            out.push(validated.data);
            continue;
          }
          const first = validated.error.issues[0];
          const detail = first
            ? `${first.path.join('.') || '(root)'} — ${first.message}`
            : '알 수 없는 검증 오류';
          console.warn(
            '[analyze-detail-page] schema 불일치:',
            JSON.stringify(validated.error.issues),
            '\nsection:',
            JSON.stringify(rawSection).slice(0, 1000),
          );
          // rawText는 살려 사용자가 처음부터 다시 타이핑하지 않도록 한다.
          const salvagedText =
            typeof (rawSection as { rawText?: unknown })?.rawText === 'string'
              ? (rawSection as { rawText: string }).rawText
              : text;
          out.push(makeUnknownSection(salvagedText, `schema 불일치: ${detail}`));
        }
      } catch (imgErr) {
        console.error('[analyze-detail-page] 이미지 분석 오류:', imgErr);
        out.push(makeUnknownSection('', '이미지 분석 중 오류 발생'));
      }
      return out;
    };

    // 순서 보존 병렬 실행 후 이미지 순서대로 flatten
    const perImage = await Promise.all(images.map(processImage));
    const results: AnalyzedSection[] = perImage.flat();

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
