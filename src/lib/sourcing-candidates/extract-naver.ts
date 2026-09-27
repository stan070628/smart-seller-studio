import { z } from 'zod';
import { getAnthropicClient } from '@/lib/ai/claude';
import { toStructuredOutputSchema } from '@/lib/ai/structured-schema';
import { readStructuredText } from '@/lib/sourcing-candidates/parse-response';
import type { ExtractedNaverPage } from '@/lib/sourcing-candidates/types';

const int = z.number().int();

export const NAVER_LISTING_SCHEMA = z.object({
  row: int,
  col: int,
  title: z.string(),
  seller: z.string(),
  price: int,
  list_price: int.nullable(),
  discount_pct: int.nullable(),
  review_count: int.nullable(),
  rating: z.number().nullable(),
  // filters.ts의 배지 판정과 어긋나지 않도록 Vision 출력을 화이트리스트로 못 박는다.
  badges: z.array(z.enum(['공식', '우수셀러', '인증', '해외'])),
});

export const NAVER_PAGE_SCHEMA = z.object({
  screen: z.enum(['naver_list', 'other']),
  sort_bar_seen: z.boolean(),
  category_path: z.string().nullable(),
  sort_label: z.string().nullable(),
  products: z.array(NAVER_LISTING_SCHEMA),
});

export const NAVER_PROMPT = `이 이미지는 네이버 쇼핑 카테고리 상품 목록 화면이거나 그 세로 조각이다. 상품 카드를 추출한다.

읽히지 않으면 null. 절대 추측하지 마라. 흐릿한 숫자를 그럴듯하게 채우는 것은 최악의 실패다.

- screen: 네이버 쇼핑 상품 목록이면 "naver_list", 아니면(1688·다른 사이트) "other". other면 products는 빈 배열.
- sort_bar_seen: "추천순 · 낮은 가격순 · 높은 가격순 · 판매 많은순 · 리뷰 많은순 · 신상품순" 정렬 바가 보이면 true.
- 정렬 바가 보이면 그 위에 있는 상품은 전부 무시한다. 맞춤 추천·장보기·신상 같은 광고 블록이다. 정렬 바 아래 격자만 담는다.
- sort_label: 정렬 바에서 굵게(선택된) 항목의 글자. 정렬 바가 없으면 null.
- category_path: 상단 경로(홈 > A > B)에서 "홈"을 뺀 나머지를 " > "로 이은 것. 안 보이면 null.
- products: 격자 카드마다 하나. row는 위에서 0부터, col은 왼쪽에서 0부터.
- 이미지 위·아래 가장자리에서 잘려 판매자·판매가·리뷰 중 하나라도 온전히 보이지 않는 카드는 담지 마라. 다른 조각에 온전히 있다.
- 글자가 없는 회색 로딩 칸은 담지 마라. 사진만 회색이고 글자가 있으면 담는다.
- 가격 없이 "기획전 바로가기"만 있는 기획전 카드는 담지 마라.
- title: 상품명 줄 그대로(말줄임표 포함). seller: 상품명 위 판매자명(끝의 ">" 제외).
- price: 굵은 판매가(원, 정수). list_price: 취소선 정가, 없으면 null. discount_pct: 판매가 앞 빨간 % 숫자, 없으면 null.
- review_count: "리뷰 N"의 N(쉼표 제거). rating: 별점 숫자.
- badges: 판매자명 옆 배지 중 "공식", "우수셀러", "인증", "해외"만. "슈퍼적립"·"최저가"·"품절임박"은 배지가 아니다.
- 「전체 판매자 상품 N개」가 붙은 가격비교 카드는 판매자 자리에 보이는 이름을 그대로 seller에, 표시된 가격을 price에 담는다.`;

export function naverJsonSchema(): Record<string, unknown> {
  return toStructuredOutputSchema(NAVER_PAGE_SCHEMA);
}

/**
 * 네이버 캡처 한 장(조각)을 판독한다. 조각마다 따로 불러 병렬로 돌린다 —
 * 합치는 것은 merge.ts가 한다(겹친 카드는 키로 걸러진다).
 * 이미지는 브라우저가 이미 2,576px 이하 JPEG로 만들어 보냈다.
 */
export async function extractNaverPage(image: Buffer): Promise<ExtractedNaverPage> {
  const client = getAnthropicClient();
  const response = await client.messages.create(
    {
      model: 'claude-opus-5',
      max_tokens: 16000,
      output_config: { effort: 'high', format: { type: 'json_schema', schema: naverJsonSchema() } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.toString('base64') } },
          { type: 'text', text: NAVER_PROMPT },
        ],
      }],
    },
    // 함수 제한(maxDuration=300)에 걸려 죽기 전에 이 호출이 먼저 깔끔하게 실패해야
    // allSettled·fail()이 오류로 잡는다. 재시도는 라우트가 조각 단위로 다시 하므로 여기선 1회만.
    { timeout: 240_000, maxRetries: 1 },
  );
  return NAVER_PAGE_SCHEMA.parse(readStructuredText(response)) as ExtractedNaverPage;
}
