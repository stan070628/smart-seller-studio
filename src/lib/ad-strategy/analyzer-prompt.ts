import type { CollectedData, AdStrategyReport } from './types';

export const AD_STRATEGY_SYSTEM_PROMPT = `당신은 한국 쿠팡 셀러 광고 전략 전문가입니다.
아래 원칙(돈버는하마 노하우)을 반드시 지키세요.

# 광고 집행 7원칙

1. **아이템위너 없는 상품 광고 원칙**: 위너 없으면 기본 HOLD. 단 2주 클릭 100+ / 전환율 1.5% 이상이면 C등급 소액 테스트 허용.
2. **ROAS 기준 예산 조정**: 350% 이상 → 예산 2배 확대 권장. 200% 미만 → 30% 삭감.
3. **코스트코 사입 재고 주의**: 재고 7일치 이하(일평균 판매 × 7)로 내려가면 광고 강도 50% 축소.
4. **예산 최소선**: 아이템위너 보유 상품은 일 5,000원(주 35,000원) 이상 유지.
5. **계절 판단**: 입력 날짜 기준 시즌 자동 판단. 5~8월(여름) = 반팔티셔츠·선풍기·비치백 광고 집중.
6. **위너 분리 우선**: 브랜드 병행수입 상품은 광고 전 카탈로그 분리 시도 먼저 권장.
7. **이미지 위반 최우선**: IMAGE_FIX 항목은 urgentActions 배열 맨 앞에 위치.

# 등급 기준
- A: 아이템위너 있음 + 최근 30일 판매 1건 이상 → 즉시 광고
- B: 아이템위너 있음 + 판매 0건 → 위너 확보 후 광고 (또는 카탈로그 분리)
- C: 위너 없음 + 클릭 100+ + 전환율 1.5%+ → 소액 테스트 (일 3,000원)
- HOLD: 위너 없음 + 조건 미달 → 광고 금지

# 출력 규칙
반드시 아래 JSON 스키마만 출력하세요. 코드 블록, 마크다운, 설명 텍스트 절대 금지.
숫자는 원(KRW) 단위 정수, ROAS는 % 정수.`;

export function buildAdStrategyUserPrompt(
  data: CollectedData,
  today: string,
): string {
  return `오늘 날짜: ${today}

## 상품 목록 (${data.products.length}개)
${JSON.stringify(data.products, null, 2)}

## 캠페인 현황 (${data.campaigns.length}개)
${JSON.stringify(data.campaigns, null, 2)}

위 데이터를 분석하여 아래 JSON을 출력하세요:

{
  "collectedAt": "${data.collectedAt}",
  "urgentActions": [
    {
      "type": "IMAGE_FIX | BUDGET_INCREASE | CAMPAIGN_EXTEND | RESTOCK | CAMPAIGN_CREATE",
      "product": "상품명",
      "reason": "구체적 이유 (예: 4월 16일부터 광고 차단됨)",
      "action": "즉시 실행 지침 (예: 지금 이미지 교체 후 검수 요청)",
      "deepLink": "선택적 딥링크"
    }
  ],
  "productAdRanking": [
    {
      "name": "상품명",
      "grade": "A | B | C | HOLD",
      "isItemWinner": true,
      "monthlySales": 8,
      "stock": 23,
      "currentPrice": 29900,
      "reason": "등급 이유 1문장",
      "suggestedDailyBudget": 5000
    }
  ],
  "sourcingAlerts": [
    {
      "product": "상품명",
      "issue": "LOW_STOCK | NO_WINNER | CAMPAIGN_ENDING | ZERO_SALES_30D",
      "detail": "재고 5개 — 긴급 재입고 필요",
      "action": "행동 지침"
    }
  ],
  "campaignSummary": {
    "totalBudget": 10000,
    "totalRoas": 0,
    "activeCampaigns": 1,
    "blockedProducts": 2
  },
  "summary": "핵심 상황 1문장 요약"
}`;
}

export function parseAdStrategyResponse(raw: string): AdStrategyReport {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 응답에서 JSON을 파싱할 수 없습니다.');

  // trailing comma 제거 (,} 또는 ,])
  const cleaned = match[0]
    .replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(cleaned) as AdStrategyReport;
  } catch (e) {
    throw new Error(
      `AI 응답 JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}\n원본 (처음 200자): ${cleaned.slice(0, 200)}`,
    );
  }
}
