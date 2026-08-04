/**
 * POST /api/ai/read-product-labels
 *
 * 라벨·태그 사진 → 상품 정보 추출 (고시정보 초안 + 판매 포인트 후보)
 *
 * 응답: { success, data: { reading, keyPoints, notice, readCount } }
 *
 * 왜 필요한가: 2026-08-02~03 코스트코 의류 2종을 상품화하며 상세페이지 설득력을
 * 만든 정보가 전부 라벨·태그 사진에서 나왔다 — 소재·제조국·수입자·현지 정가,
 * 그리고 행택 뒷면의 기능 아이콘 4개. 제품 사진만으로는 나올 수 없는 내용이다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { callClaudeVision, type ClaudeImage } from '@/lib/ai/claude-cli';
import {
  parseLabelReading,
  toKeyPointCandidates,
  toNoticeDraft,
  countRead,
} from '@/lib/detail-page/label-reading';

export const maxDuration = 120;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 6 };

const RequestSchema = z.object({
  images: z
    .array(z.object({
      base64: z.string().min(1),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    }))
    .min(1)
    .max(6),
  productName: z.string().max(200).default(''),
  category: z.string().max(100).default(''),
});

/**
 * 추론을 막는 것이 이 프롬프트의 핵심이다.
 *
 * 티셔츠에서 소재 표기가 없어 웹의 `綿100%`를 쓸지 판단해야 했는데, 외부 값을
 * 라벨에서 읽은 것처럼 내놓으면 표시광고법 위반이고 책임은 판매자에게 간다.
 * 모델은 빈칸을 채우려는 성향이 강하므로(AI 이미지 생성과 같은 문제) 명시적으로
 * 금지해야 한다.
 */
const SYSTEM = `You read Korean e-commerce product labels and hang tags.

ABSOLUTE RULE — TRANSCRIBE ONLY:
- Report ONLY text that is physically visible in the images.
- If a field is not printed on any label, omit it. Do NOT infer, guess,
  or fill from world knowledge about the brand or product type.
- Never write "probably", "likely", "approximately", or any hedged value.
- If text is too blurry to read with confidence, omit that field.

Labels may be in Korean, English, Japanese, Chinese, or French.
For each field return BOTH:
  raw   = the text exactly as printed, in its original language
  value = a clean Korean rendering (if the raw text is already Korean, repeat it)
  imageIndex = which image (0-based) you read it from

Return ONLY a JSON object, no prose, no code fences:

{
  "material":        { "raw": "", "value": "", "imageIndex": 0 },
  "origin":          { "raw": "", "value": "", "imageIndex": 0 },
  "importer":        { "raw": "", "value": "", "imageIndex": 0 },
  "brand":           { "raw": "", "value": "", "imageIndex": 0 },
  "officialName":    { "raw": "", "value": "", "imageIndex": 0 },
  "listPrice":       { "raw": "", "value": "", "imageIndex": 0 },
  "sizeLabel":       { "raw": "", "value": "", "imageIndex": 0 },
  "careInstructions":{ "raw": "", "value": "", "imageIndex": 0 },
  "itemCode":        { "raw": "", "value": "", "imageIndex": 0 },
  "features":        [{ "raw": "", "value": "", "imageIndex": 0 }],
  "certifications":  [{ "raw": "", "value": "", "imageIndex": 0 }]
}

VALUE FORMAT — strip the field label itself:
The Korean "value" must contain ONLY the value, never the field name printed
beside it on the label.
  ✗ "제조국 방글라데시"   ✓ "방글라데시"
  ✗ "수입자 (주)코스트코"  ✓ "(주)코스트코 코리아"
  ✗ "품번 1956428"       ✓ "1956428"
Keep the field name in "raw" (it is what the label says), strip it from "value".

Do not add explanations, founding years, or descriptions that are not part of
the value itself.
  ✗ brand: "잉글리쉬 런더리 (1948년 설립)"   ✓ brand: "잉글리쉬 런더리"

FIELD NOTES:
- material: fiber composition with percentages, e.g. "겉감 폴리에스터 96%, 폴리우레탄 4%".
  Include the part name (겉감/안감) when the label separates them.
- importer: the 수입자/판매원 company NAME only. Omit address and phone —
  those belong to the seller's own A/S field, not to the product notice.
  Keep it distinct from brand.
- listPrice: MUST include country and currency in the Korean value —
  "일본 현지 정가 ¥6,000", never a bare Korean-won figure. A foreign price
  written only in KRW reads as a domestic list price and becomes a false
  discount claim.
- features: functional icons or bullet claims on hang tags, e.g.
  "STRETCH FABRIC" → "신축 원단". One entry per icon.
- certifications: authenticity marks, KC marks, license statements.
  Do NOT include serial numbers — they differ per unit and must not be
  published as if shared.
- careInstructions: washing symbols and text, joined with " · ".`;

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'read-product-labels'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: `입력이 올바르지 않습니다: ${parsed.error.issues[0]?.message ?? ''}` },
      { status: 400 },
    );
  }

  const { images, productName, category } = parsed.data;

  const userPrompt = [
    productName ? `Product name (seller's working title): "${productName}"` : '',
    category ? `Category: ${category}` : '',
    `${images.length} label/tag image(s) attached, indexed 0..${images.length - 1}.`,
    'Transcribe every field you can actually read. Omit the rest.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await callClaudeVision(SYSTEM, userPrompt, images as ClaudeImage[], 'sonnet', 3000);
    const reading = parseLabelReading(raw);
    const readCount = countRead(reading);

    if (readCount === 0) {
      // 실패가 아니라 "못 읽었다"이다. 200으로 돌려주되 셀러에게 이유를 알린다.
      return NextResponse.json({
        success: true,
        data: { reading, keyPoints: [], notice: toNoticeDraft(reading), readCount: 0 },
        warning:
          '라벨에서 읽어낸 정보가 없습니다. 글자가 흐리거나 라벨이 아닌 사진일 수 있습니다. ' +
          '글자가 읽힐 만큼 가까이, 라벨을 펴서 밝은 곳에서 다시 찍어주세요.',
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        reading,
        keyPoints: toKeyPointCandidates(reading),
        notice: toNoticeDraft(reading),
        readCount,
      },
    });
  } catch (error) {
    console.error('[read-product-labels] 오류:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `라벨 판독 실패: ${msg}` },
      { status: 500 },
    );
  }
}
