import { z } from 'zod';
import { getAnthropicClient } from '@/lib/ai/claude';
import { toStructuredOutputSchema } from '@/lib/ai/structured-schema';
import type { Extracted1688 } from '@/lib/sourcing-candidates/types';

export const OFFER_SCHEMA = z.object({
  screen: z.enum(['1688', 'other']),
  title_cn: z.string().nullable(),
  tiers: z.array(z.object({ min_qty: z.number().int(), cny: z.number() })),
  options: z.array(z.object({ name: z.string(), cny: z.number().nullable() })),
  sold_count: z.number().int().nullable(),
  sale_unit: z.string().nullable(),
  match_verdict: z.enum(['same', 'diff', 'different']),
  match_reason: z.string(),
});

export function offerPrompt(target: { title: string; price: number }): string {
  return `이 이미지(1장 이상)는 1688 상품 페이지 한 곳의 캡처다. 원가 정보를 추출하고, 아래 네이버 상품과 같은 물건인지 판정한다.

대상 네이버 상품: "${target.title}" · 판매가 ${target.price.toLocaleString('ko-KR')}원

읽히지 않으면 null. 절대 추측하지 마라.

- screen: 1688 상품 페이지면 "1688", 아니면 "other". other면 나머지는 빈 값, match_verdict는 "different".
- title_cn: 상품 제목 원문.
- tiers: 수량 구간가. 예 "2~99件 ¥9.20 / ≥100件 ¥8.50" → [{min_qty:2,cny:9.2},{min_qty:100,cny:8.5}]. 구간이 하나면 한 개.
- options: 옵션별 가격이 따로 보이면 [{name, cny}]. 없으면 빈 배열.
- sold_count: 누적 판매량 숫자("已售", "成交" 옆). "1万+"처럼 뭉뚱그린 값은 10000처럼 하한으로. 안 보이면 null.
- sale_unit: 가격의 판매 단위 글자(件·双·套·个·对 등).
- match_verdict: 형태·크기·소재·용도·판매 단위를 네이버 상품과 비교한다.
  "same" = 같은 물건. "diff" = 같은 종류지만 차이가 있다. "different" = 다른 물건.
  판매 단위 차이를 반드시 본다 — 네이버가 좌우 한 쌍인데 1688이 한 짝(件) 가격이면 수량이 2배 다르므로 "diff"다.
- match_reason: 판정 이유 한 줄(한국어).`;
}

export function offerJsonSchema(): Record<string, unknown> {
  return toStructuredOutputSchema(OFFER_SCHEMA);
}

export async function extract1688(
  images: Buffer[],
  target: { title: string; price: number },
): Promise<Extracted1688> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4000,
    output_config: { effort: 'high', format: { type: 'json_schema', schema: offerJsonSchema() } },
    messages: [{
      role: 'user',
      content: [
        ...images.map((img) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: img.toString('base64') },
        })),
        { type: 'text' as const, text: offerPrompt(target) },
      ],
    }],
  });
  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  return OFFER_SCHEMA.parse(JSON.parse(text)) as Extracted1688;
}
