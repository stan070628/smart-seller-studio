# 코스트코 오프라인가 기반 추천 판매가 제안 기능

**날짜:** 2026-06-03  
**상태:** 승인됨  
**관련 파일:** `MobileCodeSearchCard.tsx`, `costco-pricing.ts`

---

## 개요

코스트코모바일 소싱 프로그램의 상품코드 검색 카드(`MobileCodeSearchCard`)에서 오프라인 매장 가격을 입력하면, 마진율 20% 기준 추천 판매가를 즉시(API 호출 없이) 네이버·쿠팡 채널별로 계산해 보여준다.

---

## 아키텍처

### 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `src/lib/sourcing/costco-pricing.ts` | `CostcoPriceInput`에 선택적 `targetRate?: number` 필드 추가, `calcCostcoPrice()` 내부에서 카테고리 기본값보다 우선 적용 |
| `src/components/sourcing/mobile/MobileCodeSearchCard.tsx` | Step 2 하단에 추천 판매가 블록 조건부 렌더링 |

### 데이터 흐름

```
오프라인가 입력 (isValidPrice === true)
  → calcCostcoPrice({ buyPrice: offlinePriceNum, targetRate: 0.2, channel: 'naver', weightKg, packQty: 1, categoryName })
  → calcCostcoPrice({ buyPrice: offlinePriceNum, targetRate: 0.2, channel: 'coupang', weightKg, packQty: 1, categoryName })
  → 결과 즉시 렌더 (순수 클라이언트 계산, 네트워크 없음)
```

`weightKg`는 `product.unitType === 'weight'`이고 `product.totalQuantity > 0`일 때 `totalQuantity / 1000`으로 파생. 그 외엔 `null` (기본 배송비 3,500원 적용).

---

## `costco-pricing.ts` 변경 상세

### `CostcoPriceInput` 인터페이스

```ts
export interface CostcoPriceInput {
  buyPrice: number;
  packQty: number;
  categoryName: string | null;
  channel: Channel;
  weightKg?: number | null;
  packingCost?: number | null;
  marketPrice?: number | null;
  /** 목표 마진율 override. 미전달 시 카테고리 기본값 적용 (하위 호환 유지) */
  targetRate?: number;
}
```

### `calcCostcoPrice()` 내부 변경

```ts
// Before
const targetRate = CATEGORY_TARGET_RATES[categoryName ?? ''] ?? COSTCO_TARGET_MARGIN_RATE;

// After
const targetRate =
  input.targetRate ??
  CATEGORY_TARGET_RATES[categoryName ?? ''] ??
  COSTCO_TARGET_MARGIN_RATE;
```

하위 호환 완전 유지. `targetRate` 미전달 시 기존 동작과 동일.

---

## UI 레이아웃

Step 2(매장 가격 입력) 영역에서 `isValidPrice === true`일 때 입력란 하단에 추천 판매가 블록을 표시한다.

```
┌─────────────────────────────────────────┐
│ STEP 2 · 매장 가격 입력                  │
│ ┌──────────────────────┐  ┌──────────┐  │
│ │ 29,900           원  │  │ 비교하기 │  │
│ └──────────────────────┘  └──────────┘  │
│ 온라인과 다른 실제 매장 가격을 입력하세요  │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ 추천 판매가 (마진 20%)               │ │
│ │                                     │ │
│ │  네이버 쇼핑        쿠팡             │ │
│ │  ───────────        ─────────────   │ │
│ │  49,900원           52,900원        │ │
│ │  마진율 20.3%       마진율 20.1%    │ │
│ │  순이익 10,150원    순이익 10,620원  │ │
│ │                                     │ │
│ │  배송비 3,500원 + 포장비 500원 포함  │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### UI 세부 규칙

- `isValidPrice === false`(빈값 또는 0)이면 블록 미표시
- 네이버·쿠팡 두 채널을 2열로 나란히 배치
- 표시 항목: 추천가, 마진율(소수점 1자리), 순이익
- 블록 하단에 배송비·포장비 금액을 작은 글씨로 표시 (`shippingCost`, `PACKING_COST`)
- Step 3로 전환되면 Step 2 영역 전체가 숨겨지므로 블록도 자연스럽게 사라짐

---

## 입력값 매핑

| `calcCostcoPrice` 파라미터 | 값 |
|---|---|
| `buyPrice` | `offlinePriceNum` (오프라인 매장가) |
| `packQty` | `1` |
| `categoryName` | `product.categoryName` |
| `channel` | `'naver'` / `'coupang'` |
| `weightKg` | `product.unitType === 'weight' && product.totalQuantity > 0 ? product.totalQuantity / 1000 : null` |
| `packingCost` | 미전달 (기본 500원) |
| `targetRate` | `0.2` (20% 고정) |
| `marketPrice` | 미전달 (vsMarket 불필요) |

---

## 범위 외 (이번 구현에서 제외)

- 목표 마진율 사용자 직접 입력 (20% 고정)
- DB 저장 또는 서버 연동
- 입수(packQty) 수동 입력
