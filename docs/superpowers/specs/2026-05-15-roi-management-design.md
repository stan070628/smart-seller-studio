# ROI 관리 페이지 설계 스펙

**날짜:** 2026-05-15  
**참고 영상:** 돈버는하마 — 월500만원 버는 쿠팡셀러 100명 키운 공식  
**전제:** 간이과세자 (부가세 1.1 미적용)

---

## 1. 목적

쿠팡 셀러가 상품(SKU)별 수익성을 한눈에 파악하고, 목표 순이익 달성을 위한 의사결정(사입 전환, 광고 조정, 재고 발주)을 한 페이지에서 할 수 있게 한다.

---

## 2. 기능 범위 (6가지)

| # | 기능 | 설명 |
|---|---|---|
| 1 | 수익 목표 역산 플래너 | 목표 순이익 입력 → 필요 매출·ROAS 손익분기점 자동 계산 |
| 2 | 손익분기 ROAS 계산기 | 상품별 마진액 기반 광고 손익분기 ROAS 표시 |
| 3 | 위너 판별 + 사입 전환 신호 | 4가지 기준 달성 시 위너 뱃지 및 사입 권고 |
| 4 | 광고비 보정 분석 | 취소 주문·쿠폰 반영한 실제 ROAS 계산 |
| 5 | 재고 회전일 경고 | 품절 임박 상품 자동 경고 |
| 6 | SKU별 종합 수익성 대시보드 | 위 5가지를 상품 테이블 단일 뷰로 통합 |

---

## 3. 페이지 레이아웃

```
/roi 페이지
┌──────────────────────────────────────────────────┐
│  [목표 수익 역산 위젯]                            │
│  목표 순이익: [500만원 ▼]  기준 마진율: [30% ▼]  │
│  → 필요 매출: 1,670만원   ROAS 손익분기점: 333%  │
├──────────────────────────────────────────────────┤
│  [필터] 전체 | 위너만 | 사입권고 | 재고경고       │
├──────────────────────────────────────────────────┤
│  SKU 테이블                                       │
│  상품명 | 판매가 | 원가 | 마진율 | 광고비(보정)  │
│  ROAS(보정) | 순이익 | 위너 | 재고회전 | 사입권고 │
└──────────────────────────────────────────────────┘
  행 클릭 시 → 우측 슬라이드 패널
    ├ 광고비 보정 3항목 상세
    ├ 위너 기준 달성 현황 (4개 체크리스트)
    └ 사입 전환 시 예상 순이익 변화
```

---

## 4. 계산 공식

### 4-1. 수익 목표 역산

```
필요 매출 = 목표 순이익 ÷ 마진율
ROAS 손익분기점 = (판매가 ÷ 마진액) × 100   // 간이과세자
```

### 4-2. 마진액

```
마진액 = 판매가 - 원가 - (판매가 × 쿠팡 수수료율) - 배송비
```

수수료율: 기존 `src/lib/calculator/coupang-fees.ts` 재사용

### 4-3. 보정 ROAS

```
실매출 = attributed_sales - cancelled_sales_from_ads
실제 마진액 = 마진액 - 쿠폰할인액
보정 ROAS = 실매출 ÷ 광고비 × 100
```

- `attributed_sales`: 쿠팡 Ads API
- `cancelled_sales`: 쿠팡 Wing API
- `coupon_discount`: 쿠팡 Wing API

### 4-4. 위너 판별 (하마 공식)

4가지 조건 모두 충족 시 위너:

| 조건 | 기준값 |
|---|---|
| 클릭수 | ≥ 100 |
| 전환율 (`주문수 ÷ 클릭수 × 100`) | ≥ 1.5% |
| ROAS (보정) | ≥ 250% |
| 판매 건수 | ≥ 5건 |

- 4개 충족: 🟢 위너 + 사입 권고
- 3개 충족: 🟡 관찰
- 2개 이하: 무표시

### 4-5. 재고 회전일

```
일평균 판매수 = 최근 30일 판매수 ÷ 30
재고 회전일 = 현재 재고 ÷ 일평균 판매수

경고 기준:
  🔴 < 7일   — 품절 임박 (알고리즘 페널티 위험)
  🟡 7~14일  — 발주 권고
  🟢 15일+   — 정상
```

---

## 5. 데이터 소스

| 데이터 | 출처 |
|---|---|
| 판매가, 주문수, 취소수, 재고, 쿠폰할인 | 쿠팡 Wing API |
| 광고비, attributed_sales, 클릭수, 전환율 | 쿠팡 Ads API |
| 원가, 배송비 | `sourcing` 테이블 (`price_dome`, `deli_fee`) |
| 쿠팡 수수료율 | `src/lib/calculator/coupang-fees.ts` |

DB 스키마 변경 없음. 기존 테이블 및 API 연동 재사용.

---

## 6. 신규 파일

```
src/app/roi/
  page.tsx                    # 서버 컴포넌트, 초기 데이터 패치
src/components/roi/
  RoiPageClient.tsx           # 메인 클라이언트 컴포넌트 (상태 관리)
  RoiGoalWidget.tsx           # 상단 역산 플래너 위젯
  SkuTable.tsx                # SKU 메인 테이블
  SkuDetailPanel.tsx          # 우측 슬라이드 상세 패널
src/app/api/roi/
  route.ts                    # SKU별 수익성 데이터 집계 API
src/lib/roi/
  calculations.ts             # 순수 함수 공식 모음
```

---

## 7. `calculations.ts` 인터페이스

```typescript
calcMargin(sellingPrice: number, costPrice: number, feeRate: number, deliveryFee: number): number

calcBreakevenRoas(sellingPrice: number, marginAmount: number): number
// 간이과세자: (sellingPrice / marginAmount) * 100

calcAdjustedRoas(attributedSales: number, cancelledSales: number, adSpend: number): number

isWinner(clicks: number, conversionRate: number, roas: number, salesCount: number): 'winner' | 'watch' | 'normal'

calcStockTurnover(stockQty: number, avgDailySales: number): { days: number; status: 'danger' | 'warning' | 'ok' }

calcRequiredRevenue(targetProfit: number, marginRate: number): number
```

---

## 8. 네비게이션

기존 사이드바에 `ROI 관리` 메뉴 1개 추가 (`/roi`).

---

## 9. 미결 사항

- 쿠팡 Ads API `attributed_sales` 필드가 현재 연동에 포함되어 있는지 확인 필요
- `sourcing` 테이블에 원가가 없는 상품의 처리 방식 (빈 값으로 표시 or 입력 유도 UI)
