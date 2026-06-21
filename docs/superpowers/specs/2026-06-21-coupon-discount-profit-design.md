# 쿠폰 할인 반영 실현 손익 계산 설계

**날짜:** 2026-06-21  
**상태:** 승인됨

## 배경

`sale_records.selling_price`에 쿠폰 할인 전 금액이 저장되어 FIFO 손익이 과대계산되고 있다. 현재 판매가 35,800원 상품에 즉시할인쿠폰 5,000원 + 다운로드쿠폰 최대 1,000원이 적용되면 실수령액은 29,800원이지만 손익 계산은 35,800원 기준으로 이루어진다.

쿠폰 2종:
- **즉시할인쿠폰** (PRICE 타입): 쿠팡 fms API `GET /v2/providers/fms/apis/api/v2/vendors/{vendorId}/{orderId}/coupons`로 주문별 정확한 할인액 조회 가능 (Wing/RG 모두 작동 확인)
- **다운로드쿠폰** (RATE 타입): 동일 API에서 미반환. 주문별 실사용 여부 확인 불가 → 정책 기반 보수적 추정 적용

## 접근법: 혼합 방식

- 임포트 시점에 fms API로 즉시할인쿠폰 정확한 금액 확보
- 다운로드쿠폰은 상품별 정책 저장 후 조건 충족 시 계산 합산
- `sale_records`에 `coupon_discount` 컬럼으로 저장하여 이력 보존

## DB 스키마 변경

### sale_records

```sql
ALTER TABLE sale_records
  ADD COLUMN coupon_discount INTEGER NOT NULL DEFAULT 0;
```

### product_costs

```sql
ALTER TABLE product_costs
  ADD COLUMN download_coupon_policy JSONB;
```

`download_coupon_policy` 구조:
```json
{
  "rate": 0.10,
  "max_discount": 1000,
  "min_price": 30000
}
```

`null`이면 다운로드쿠폰 없음.

## 임포트 로직 변경

`src/app/api/cost-management/products/[id]/coupang-import/route.ts`

### orderId 파싱

채널별 `coupang_order_item_id` 형식:
- Wing: `{orderId}-{vendorItemId}` → `parts.slice(0, -1).join('-')`으로 orderId 추출
- RG: `rg-{orderId}-{vendorItemId}` → `parts[1]`으로 orderId 추출
- Naver: `naver-{productOrderId}` → fms 호출 없이 `coupon_discount = 0`
- Manual: `coupon_discount = 0`

### fms 즉시할인쿠폰 조회

```
GET /v2/providers/fms/apis/api/v2/vendors/{vendorId}/{orderId}/coupons
```

응답에서 `type === 'PRICE'`인 항목의 `discount` 합산 → 즉시할인 금액.  
API 호출 간 300ms delay 적용 (기존 패턴 동일).

### 다운로드쿠폰 조건 계산

```ts
function calcDownloadDiscount(
  sellingPrice: number,
  policy: { rate: number; max_discount: number; min_price: number } | null
): number {
  if (!policy) return 0;
  if (sellingPrice < policy.min_price) return 0;
  return Math.min(Math.round(sellingPrice * policy.rate), policy.max_discount);
}
```

> **주의**: 실제 고객이 다운로드쿠폰을 적용했는지 확인 불가. 최악 시나리오(모든 주문에 적용) 기준으로 계산하며, 실제 정산액보다 이익이 소폭 낮게 나올 수 있음.

### coupon_discount 합산

```ts
const coupon_discount = immediateDiscount + downloadDiscount;
```

### ON CONFLICT 전략 변경

기존 `DO NOTHING` → 기존 레코드의 쿠폰 할인이 0인 경우 소급 적용 가능하도록 변경:

```sql
INSERT INTO sale_records (...)
VALUES (...)
ON CONFLICT (coupang_order_item_id) DO UPDATE
  SET coupon_discount = EXCLUDED.coupon_discount
  WHERE sale_records.coupon_discount = 0
```

단, `sold_at`, `selling_price` 등 다른 필드는 기존 값 유지 (의도적 수동 수정 보호).

## FIFO 계산 변경

`src/lib/cost-management/fifo.ts`

### SaleRow 인터페이스 추가

```ts
export interface SaleRow {
  // 기존 필드 유지 ...
  /** 쿠폰 할인 합계 (원) — effective_price 계산에 사용 */
  coupon_discount?: number;
}
```

### 실현손익 공식 변경

```
effective_price = selling_price - coupon_discount
realized_profit = effective_price - fifo_cost - (effective_price × platformFeeRate) - shipping_fee
```

수수료 기준을 `effective_price`로 변경하는 이유: 쿠팡 정산 시 즉시할인쿠폰은 셀러 부담이므로 실수령액에서 수수료가 계산됨.

## Sales API 변경

`src/app/api/cost-management/products/[id]/sales/route.ts`

GET 응답에 `coupon_discount` 포함:
```sql
SELECT id, sold_at, quantity, selling_price, coupon_discount,
       channel, coupang_order_item_id, shipping_fee, created_at
FROM sale_records ...
```

## UI 변경 (최소)

`src/components/orders/CostManagementTab.tsx`

- 판매 내역 테이블에 `쿠폰할인` 컬럼 추가 (선택적 표시)
- 상품 설정 영역에 다운로드쿠폰 정책 입력 UI 추가 (rate, max_discount, min_price)

## 구현 순서

1. DB 마이그레이션: `sale_records.coupon_discount`, `product_costs.download_coupon_policy` 컬럼 추가
2. `fifo.ts` SaleRow에 `coupon_discount` 추가, 공식 수정
3. `coupang-import/route.ts` fms API 호출 + ON CONFLICT 전략 변경
4. `sales/route.ts` GET 응답에 `coupon_discount` 포함
5. UI: 다운로드쿠폰 정책 설정 폼 + 판매 내역 쿠폰할인 컬럼
6. 기존 Wing/RG 레코드 재임포트로 소급 적용

## 레이트리밋 고려

주문 100건 임포트 시 fms API 호출 100건 × 300ms delay = 약 30초 추가 소요.  
임포트 UI에 진행 중 표시(spinner)가 있으면 충분; 없으면 타임아웃 설정 확인 필요.
