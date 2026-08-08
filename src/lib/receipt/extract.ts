import sharp from 'sharp';
import { z } from 'zod';
import { getAnthropicClient } from '@/lib/ai/claude';
import type { AllowedMimeType } from '@/lib/ai/claude-vision';
import type { ExtractedReceipt } from '@/lib/receipt/types';

/**
 * 영수증 Vision 추출.
 *
 * 실측 (2026-08-08, 실제 코스트코 영수증 2장): 장당 약 67원, 12~14초.
 * 검산 4종과 줄 검산 16줄이 전부 통과했다.
 */

/** claude-opus-5 고해상도 상한. 더 줄이면 숫자 오독이 는다 */
const MAX_EDGE = 2576;

const nullableNum = z.number().int().nullable();

export const RECEIPT_LINE_SCHEMA = z.object({
  line_no: z.number().int(),
  item_code: z.string().nullable(),
  item_label: z.string(),
  quantity: z.number(),
  unit_price: nullableNum,
  amount: z.number().int(),
  is_discount: z.boolean(),
  tax_type: z.enum(['taxable', 'exempt', 'unknown']),
});

export const RECEIPT_SCHEMA = z.object({
  store_name: z.string().nullable(),
  purchased_at: z.string().nullable(),
  purchased_time: z.string().nullable(),
  register_no: z.string().nullable(),
  receipt_total: nullableNum,
  total_item_count: nullableNum,
  tax_exempt_total: nullableNum,
  taxable_total: nullableNum,
  vat: nullableNum,
  lines: z.array(RECEIPT_LINE_SCHEMA),
});

export const RECEIPT_PROMPT = `이 코스트코(COSTCO) 영수증 사진에서 품목을 추출한다.

읽히지 않으면 null. 절대 추측하지 마라. 흐릿하거나 가려진 값을 그럴듯하게 채우는 것은 최악의 실패다.

코스트코 영수증 구조:
- 품목은 두 줄로 찍힌다: 윗줄에 상품명, 아랫줄에 "품번 수량x 단가 금액 과세마커".
- 과세 상품은 금액 뒤에 T가 붙는다. 면세 상품은 붙지 않는다.
- 쿠폰 할인은 CPN 마커 뒤에 별도 줄로 찍히고, 자체 품번과 자체 상품명을 가지며, 금액 뒤에 마이너스 부호가 붙는다. 할인 줄도 lines에 담되 is_discount=true, amount는 음수로.
- "상품수 소계", "PRESCAN 상품 시작/종료", "COUPON TOTAL" 같은 구분선은 품목이 아니다. 담지 마라.
- 같은 품번이 여러 줄에 나올 수 있다. 합치지 말고 나온 순서대로 각각 담아라.
- 봉투값 등 품번 없는 줄은 item_code를 null로 두고 담아라. 버리면 합계가 안 맞는다.

purchased_at은 YYYY-MM-DD. 영수증 날짜는 MM/DD/YYYY 형식이다.
purchased_time은 HH:MM. register_no는 "REG:8"의 8.
receipt_total은 "합계 (VAT 포함)" 값. total_item_count는 "총 판매 상품수"(줄 수가 아니라 수량 합계).

회원번호와 카드번호는 절대 추출하지 마라.`;

/**
 * 영수증을 claude-opus-5 고해상도 상한(2,576px)에 맞춘다.
 *
 * 기존 `resizeForClaude`를 쓰지 않는 이유: 상한이 7500px로 하드코딩되어 있고
 * 인자로 바꿀 수 없다. 그 크기로 보내면 이미지 토큰이 크게 늘어 비용이 뛴다.
 * 반대로 2,576px보다 줄이면 조밀한 숫자 오독이 는다 — Vision 단독 추출의
 * 유일한 약점이 거기다.
 */
async function fitForReceipt(data: Buffer): Promise<{ base64: string; mimeType: AllowedMimeType }> {
  const meta = await sharp(data).metadata();
  const needsResize = (meta.width ?? 0) > MAX_EDGE || (meta.height ?? 0) > MAX_EDGE;

  // EXIF 자동 회전만 하고 인위적 회전은 하지 않는다 —
  // 실측에서 프레임 안에 가로로 누운 사진도 전 줄 정확히 읽혔다
  const pipeline = sharp(data).rotate();
  const out = needsResize
    ? await pipeline
        .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer()
    : await pipeline.jpeg({ quality: 90 }).toBuffer();

  return { base64: out.toString('base64'), mimeType: 'image/jpeg' };
}

export interface ExtractInput {
  images: { data: Buffer; mimeType: AllowedMimeType }[];
}

/**
 * 영수증 이미지에서 구조화된 결과를 뽑는다.
 * 긴 영수증은 여러 장을 한 번에 넣어 하나의 lines 배열로 받는다.
 */
export async function extractReceipt(input: ExtractInput): Promise<ExtractedReceipt> {
  const client = getAnthropicClient();

  const contents = await Promise.all(
    input.images.map(async (img) => {
      const fitted = await fitForReceipt(img.data);
      return {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: fitted.mimeType,
          data: fitted.base64,
        },
      };
    }),
  );

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 8000,
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: z.toJSONSchema(RECEIPT_SCHEMA) },
    },
    messages: [
      { role: 'user', content: [...contents, { type: 'text', text: RECEIPT_PROMPT }] },
    ],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  return RECEIPT_SCHEMA.parse(JSON.parse(text)) as ExtractedReceipt;
}
