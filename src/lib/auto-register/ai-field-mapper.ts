/**
 * 정규화된 상품 정보를 Coupang 오픈마켓 필드로 매핑하는 AI 엔진
 * Claude API를 사용하여 한국 이커머스 도메인 지식을 활용한 필드 추론 및 신뢰도 산정
 */

import { callClaude } from '@/lib/ai/claude-cli';
import type { NormalizedProduct, MappedCoupangFields } from './types';

const SYSTEM_PROMPT = `당신은 쿠팡 월 매출 1억 탑 셀러 출신 이커머스 전문가입니다.
주어진 상품 정보를 바탕으로 쿠팡 등록에 필요한 각 필드의 값을 추론하고, 각 필드에 대한 신뢰도(0.0~1.0)를 함께 반환하세요.
신뢰도는 정보가 충분하고 명확할수록 높게(0.9~1.0), 추측이 많이 필요할수록 낮게(0.3~0.5) 설정하세요.

## 쿠팡 상품명 작성 원칙
1. **검색 키워드 앞 배치**: 구매자가 실제 검색할 카테고리 키워드 + 소재/기능을 맨 앞에 배치
2. **구체적 스펙 포함**: 사이즈·용량·수량·색상 등 선택 기준이 되는 스펙을 명시
3. **타겟 명시**: 남성용/여성용/유아용/1인용 등 구매자 세그먼트가 명확하면 포함
4. **혜택어 활용**: 대용량·세트·무료배송·당일출발 등 실제 혜택을 포함할 경우만 사용
5. **중복 단어 금지**: 같은 단어를 두 번 쓰지 않음
6. **50~80자 권장**: 너무 짧으면 노출 기회 감소, 너무 길면 검색 결과에서 잘림
7. **특수문자 금지**: [], ★, ♥ 등 특수문자 사용 금지
8. **과대광고 금지**: 1위, 최초, 혁명적, 압도적 등 표현 금지

예시 (나쁜 → 좋은):
- "멀티포켓 크로스백" → "남성 멀티포켓 크로스백 대용량 방수 직장인 출퇴근 숄더백 14인치 노트북 수납"
- "스테인리스 텀블러" → "스테인리스 보온 텀블러 500ml 12시간 보온보냉 직장인 차량용 뚜껑포함 2개세트"

반드시 JSON만 반환하세요.`;

function buildPrompt(product: NormalizedProduct): string {
  return `상품 정보:
- 제목: ${product.title}
- 가격(원가): ${product.price}원
- 원래가격: ${product.originalPrice ?? '없음'}원
- 브랜드: ${product.brand ?? '없음'}
- 제조사: ${product.manufacturer ?? '없음'}
- 소스 카테고리: ${product.categoryHint ?? '없음'}
- 설명: ${product.description.slice(0, 500)}

다음 JSON 스키마로 반환하세요:
{
  "sellerProductName": { "value": "string (쿠팡 상품명: 카테고리 키워드+소재+기능+타겟+스펙 조합, 50~80자 권장, 특수문자 금지)", "confidence": 0.0~1.0 },
  "displayCategoryCode": { "value": number (쿠팡 카테고리 코드, 모르면 0), "confidence": 0.0~1.0 },
  "brand": { "value": "string (브랜드명. 상품 제목에서 추론 가능하면 추론. 확실하지 않으면 빈 문자열)", "confidence": 0.0~1.0 },
  "salePrice": { "value": number (원 단위 정수), "confidence": 0.0~1.0 },
  "originalPrice": { "value": number (정가, 없으면 salePrice와 동일), "confidence": 0.0~1.0 },
  "stockQuantity": { "value": number (권장: 100), "confidence": 0.0~1.0 },
  "deliveryChargeType": { "value": "FREE" | "NOT_FREE", "confidence": 0.0~1.0 },
  "deliveryCharge": { "value": number (FREE이면 0), "confidence": 0.0~1.0 },
  "searchTags": { "value": ["태그1", "태그2", ...] (최대 10개), "confidence": 0.0~1.0 }
}`;
}

/**
 * NormalizedProduct를 Coupang 필드로 매핑합니다.
 * Claude API를 호출하여 각 필드별 추천값과 신뢰도를 반환합니다.
 *
 * @param product - parse-url route에서 반환한 정규화된 상품 데이터
 * @returns Coupang 필드 매핑 결과 (각 필드별 value + confidence)
 * @throws Error JSON 파싱 실패 또는 API 호출 실패 시
 */
export async function mapProductToCoupangFields(
  product: NormalizedProduct,
): Promise<MappedCoupangFields> {
  const raw = await callClaude(SYSTEM_PROMPT, buildPrompt(product), 'sonnet');

  // 마크다운 코드 블록 제거
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned) as MappedCoupangFields;

  // displayCategoryCode value가 0(모르는 카테고리)이면 신뢰도를 0으로 보정
  if (parsed.displayCategoryCode.value === 0) {
    parsed.displayCategoryCode.confidence = 0;
  }

  return parsed;
}
