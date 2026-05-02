# 광고 전략 자동 분석 기능 설계

## Goal

버튼 하나로 쿠팡 윙스 + 광고센터 데이터를 수집하고, 돈버는하마 노하우 기반으로 Claude AI가 상품별 광고 우선순위·즉시 실행 항목·소싱 경보를 생성하는 청연코퍼레이션 전용 내부 툴.

## Architecture

**Tech Stack:** Next.js App Router, Claude API (claude-sonnet-4-6), Supabase (캐시), 기존 CoupangClient

**데이터 수집 방식:**
- 상품 목록 + 주문: 기존 `CoupangClient` Open API 사용
- 광고 현황 (ROAS, CTR, 예산, 캠페인 상태, 이미지 위반): `advertising.coupang.com` 서버사이드 fetch (저장된 세션 쿠키 사용)
- 쿠키 저장: `.env.local`의 `COUPANG_ADS_COOKIE` 환경변수 → 만료 시 수동 갱신

**전체 흐름:**
```
UI: "분석 시작" 클릭
  → POST /api/ad-strategy/collect
      ├─ CoupangClient.getSellerProducts() → 상품 목록
      ├─ CoupangClient.getOrders() → 최근 30일 주문
      └─ fetch advertising.coupang.com/marketing/dashboard/sales (쿠키 인증)
          → 캠페인 성과 + 이미지 위반 목록
  → POST /api/ad-strategy/analyze
      └─ Claude API → 전략 리포트 JSON
  → Supabase ad_strategy_cache 저장 (24시간 TTL)
  → UI 렌더링
```

---

## 파일 구조

| 파일 | 역할 |
|------|------|
| `src/app/ad-strategy/page.tsx` | 광고 전략 페이지 (신규) |
| `src/components/ad-strategy/AdStrategyPanel.tsx` | 메인 패널 컴포넌트 |
| `src/components/ad-strategy/UrgentActionCard.tsx` | 즉시 실행 카드 |
| `src/components/ad-strategy/ProductAdTable.tsx` | 상품별 광고 등급 테이블 |
| `src/components/ad-strategy/SourcingAlert.tsx` | 소싱 경보 컴포넌트 |
| `src/app/api/ad-strategy/collect/route.ts` | 데이터 수집 API |
| `src/app/api/ad-strategy/analyze/route.ts` | AI 분석 API |
| `src/lib/ad-strategy/scraper.ts` | 광고센터 스크래퍼 |
| `src/lib/ad-strategy/analyzer-prompt.ts` | Claude 프롬프트 + 출력 스키마 |
| `src/lib/ad-strategy/types.ts` | 공유 타입 정의 |

---

## AI 분석 출력 스키마

```typescript
interface AdStrategyReport {
  collectedAt: string;           // ISO 날짜

  urgentActions: UrgentAction[]; // 오늘 당장 실행 항목

  productAdRanking: ProductAdGrade[]; // 상품별 광고 등급

  sourcingAlerts: SourcingAlert[];    // 소싱/재고 경보

  campaignSummary: {
    totalBudget: number;         // 주간 집행 광고비 (원)
    totalRoas: number;           // 전체 ROAS (%)
    activeCampaigns: number;     // 운영 중 캠페인 수
    blockedProducts: number;     // 이미지 위반 차단 상품 수
  };

  summary: string;               // 한 줄 요약
}

type UrgentActionType =
  | 'IMAGE_FIX'        // 이미지 가이드 위반 수정
  | 'BUDGET_INCREASE'  // 예산 증액
  | 'CAMPAIGN_EXTEND'  // 캠페인 종료일 연장
  | 'RESTOCK'          // 긴급 재입고
  | 'CAMPAIGN_CREATE'; // 신규 캠페인 생성 필요

interface UrgentAction {
  type: UrgentActionType;
  product: string;
  reason: string;       // "4월 16일부터 광고 차단됨"
  action: string;       // "지금 이미지 교체 후 검수 요청"
  deepLink?: string;    // Wing or 광고센터 딥링크
}

type AdGrade = 'A' | 'B' | 'C' | 'HOLD';
// A = 즉시 광고 (아이템위너 + 판매 이력)
// B = 위너 확보 후 광고 (아이템위너 있으나 판매 0)
// C = 소액 테스트 가능 (위너 없지만 조건 충족)
// HOLD = 광고 금지 (위너 없음 + 전환율 미달)

interface ProductAdGrade {
  name: string;
  grade: AdGrade;
  isItemWinner: boolean;
  monthlySales: number;
  stock: number;
  currentPrice: number;
  reason: string;
  suggestedDailyBudget?: number; // 원, grade A/B만
}

interface SourcingAlert {
  product: string;
  issue: 'LOW_STOCK' | 'NO_WINNER' | 'CAMPAIGN_ENDING' | 'ZERO_SALES_30D';
  detail: string;     // "재고 5개 — 긴급 재입고 필요"
  action: string;
}
```

---

## 프롬프트 전략 (돈버는하마 노하우 반영)

**시스템 프롬프트 핵심 원칙 (고정):**

1. **아이템위너 없는 상품 광고 원칙**: 위너 없으면 원칙상 HOLD. 단 2주 클릭 100+ / 전환율 1.5% 이상이면 C등급 소액 테스트 허용
2. **ROAS 기준 예산 조정**: 350% 이상 → 예산 2배 확대 권장 / 200% 미만 → 30% 삭감
3. **코스트코 사입 주의**: 재고 7일치 이하로 내려가면 광고 강도 50% 축소 (재고 소진 후 품절 페널티 2주 방지)
4. **예산 최소선**: 아이템위너 보유 상품은 일 5,000원(주 35,000원) 이상
5. **계절 판단**: 입력 날짜 기준 시즌 자동 판단 → 여름(5~8월) = 반팔티셔츠·선풍기·비치백 광고 집중 시기
6. **위너 분리 우선**: 브랜드 병행수입 상품은 광고 전 카탈로그 분리 시도 먼저
7. **이미지 위반 최우선**: IMAGE_FIX는 항상 urgentActions 첫 번째

---

## UI 레이아웃

```
┌─────────────────────────────────────────────────────┐
│  광고 전략 분석                                        │
│  마지막 분석: 2026.05.02 14:32           [분석 시작]   │
├─────────────────────────────────────────────────────┤
│  🚨 즉시 실행 N건                                      │
│  ┌─────────────────┐  ┌─────────────────────────┐   │
│  │ 이미지 미등록     │  │ 예산 10,000→35,000원     │   │
│  │ 파우치 2종       │  │ 코스트코 캠페인           │   │
│  │ [광고센터 이동]  │  │ [광고센터 이동]           │   │
│  └─────────────────┘  └─────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│  📦 상품별 광고 등급                                    │
│  등급  상품명              권장 일예산  이유            │
│  [A]   커클랜드 반팔티셔츠  5,000원    아이템위너+8판매  │
│  [A]   컬럼비아 티셔츠      3,000원    아이템위너+재고多  │
│  [B]   루메나 선풍기        -          위너 분리 먼저    │
│  [HOLD] 파우치             -          위너없음, 0판매   │
├─────────────────────────────────────────────────────┤
│  ⚠️ 소싱 경보                                          │
│  코오롱 니트 재고 5개 → 긴급 재입고                      │
│  코스트코 캠페인 05.09 종료 → 연장 필요                  │
└─────────────────────────────────────────────────────┘
```

**진행 상태 메시지 (분석 시작 후):**
- "상품 목록 수집 중..."
- "광고 현황 수집 중..."
- "AI 전략 분석 중..."
- 완료 후 결과 표시

---

## 캐시 전략

- Supabase 테이블: `ad_strategy_cache` (`user_id`, `report_json`, `collected_at`)
- 24시간 이내 캐시가 있으면 재사용, 없거나 "분석 시작" 강제 실행 시 새로 수집
- 단일 유저이므로 user_id는 고정값 사용 가능

---

## 에러 처리

- `COUPANG_ADS_COOKIE` 미설정 → "광고센터 쿠키를 .env.local에 추가해 주세요" 안내 + 설정 방법 표시
- 쿠키 만료 (401/403) → "세션이 만료되었습니다. 쿠키를 갱신해 주세요" 안내
- Claude API 실패 → 수집 데이터 raw 표시 + "AI 분석 실패, 잠시 후 재시도" 메시지
- 광고센터 구조 변경으로 파싱 실패 → 수집 가능한 데이터만으로 분석 진행 (부분 실패 허용)

---

## 범위 외 (YAGNI)

- 다중 셀러 지원 — 단일 계정 전용
- 자동 캠페인 생성/수정 — 읽기 전용 분석만
- 히스토리/트렌드 차트 — 단일 스냅샷
- Playwright 자동 로그인 — 수동 쿠키 갱신으로 충분
