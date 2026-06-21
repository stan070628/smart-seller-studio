# 쿠폰 할인 반영 실현 손익 계산 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 쿠팡 즉시할인쿠폰·다운로드쿠폰 할인액을 `sale_records.coupon_discount`에 저장하고, FIFO 실현손익 계산 시 `effective_price = selling_price - coupon_discount` 기준으로 수수료와 이익을 산출한다.

**Architecture:** DB에 `coupon_discount` 컬럼 추가 → 임포트 시 fms orderId 쿠폰 API 호출(즉시할인쿠폰) + 상품별 정책 기반 계산(다운로드쿠폰)으로 합산 저장 → FIFO 수식에 `effective_price` 도입 → UI에 쿠폰할인 컬럼 표시 및 다운로드쿠폰 정책 설정 폼 추가.

**Tech Stack:** PostgreSQL (Render), Next.js App Router API Routes, TypeScript, HMAC-SHA256 쿠팡 API 인증, Vitest

---

## 파일 맵

| 파일 | 역할 | 변경 |
|------|------|------|
| `supabase/migrations/082_coupon_discount.sql` | DB 스키마 추가 | 신규 |
| `src/lib/cost-management/fifo.ts` | SaleRow 타입 + FIFO 수식 | 수정 |
| `src/lib/listing/coupang-client.ts` | fms 쿠폰 조회 메서드 추가 | 수정 |
| `src/app/api/cost-management/products/[id]/coupang-import/route.ts` | 임포트 시 coupon_discount 계산 + ON CONFLICT 변경 | 수정 |
| `src/app/api/cost-management/products/route.ts` | 판매 쿼리에 coupon_discount 포함 | 수정 |
| `src/app/api/cost-management/products/[id]/sales/route.ts` | GET 응답에 coupon_discount 포함 | 수정 |
| `src/app/api/cost-management/products/[id]/route.ts` | PATCH에 download_coupon_policy 지원 | 수정 |
| `src/components/orders/SaleEntryPanel.tsx` | 쿠폰할인 컬럼 + 정책 설정 UI | 수정 |
| `src/lib/cost-management/__tests__/fifo.test.ts` | coupon_discount 테스트 케이스 추가 | 수정 |

---

## Task 1: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/082_coupon_discount.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- supabase/migrations/082_coupon_discount.sql
ALTER TABLE sale_records
  ADD COLUMN coupon_discount INTEGER NOT NULL DEFAULT 0;

ALTER TABLE product_costs
  ADD COLUMN download_coupon_policy JSONB;

COMMENT ON COLUMN sale_records.coupon_discount IS
  '임포트 시점 계산된 쿠폰 할인 합계(원). 즉시할인쿠폰 + 다운로드쿠폰. effective_price = selling_price - coupon_discount.';

COMMENT ON COLUMN product_costs.download_coupon_policy IS
  '다운로드쿠폰 정책: {"rate": 0.10, "max_discount": 1000, "min_price": 30000}. null이면 쿠폰 없음.';
```

- [ ] **Step 2: 마이그레이션 실행**

```bash
node scripts/migrate-sourcing.mjs 082
```

기대 출력: `✅ 082_coupon_discount.sql 완료` (또는 유사한 성공 메시지)

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/082_coupon_discount.sql
git commit -m "feat(db): sale_records에 coupon_discount, product_costs에 download_coupon_policy 추가"
```

---

## Task 2: CoupangClient에 fms 쿠폰 조회 메서드 추가

**Files:**
- Modify: `src/lib/listing/coupang-client.ts`

fms orderId 쿠폰 API: `GET /v2/providers/fms/apis/api/v2/vendors/{vendorId}/{orderId}/coupons`
실제 응답 예시:
```json
{
  "code": 200, "data": {
    "content": [{"vendorItemId": 95551633272, "type": "PRICE", "discount": 5000, "status": "APPLIED"}]
  }
}
```

- [ ] **Step 1: 타입 정의 및 메서드 추가**

`CoupangClient` 클래스에서 `getRocketGrowthOrders` 메서드 아래에 추가:

```ts
// ─── fms 주문별 즉시할인쿠폰 조회 ──────────────────────────
/**
 * 주문번호로 적용된 즉시할인쿠폰 목록 조회 (fms API)
 * Wing/RG 모두 지원. 다운로드쿠폰은 미반환.
 * @returns PRICE 타입 쿠폰의 discount 합계 (원)
 */
async getOrderImmediateDiscount(orderId: string): Promise<number> {
  const url = `/v2/providers/fms/apis/api/v2/vendors/${this.vendorId}/${orderId}/coupons`;
  await sleep(API_DELAY);
  try {
    const res = await this.request<{
      success: boolean;
      content: Array<{ type: string; discount: number; status: string }>;
    }>('GET', url);
    const content = (res.data as { content?: Array<{ type: string; discount: number; status: string }> })?.content ?? [];
    return content
      .filter((c) => c.type === 'PRICE' && c.status === 'APPLIED')
      .reduce((sum, c) => sum + (c.discount > 0 ? c.discount : 0), 0);
  } catch {
    // 쿠폰 조회 실패 시 0으로 처리 (임포트 중단 방지)
    return 0;
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/listing/coupang-client.ts
git commit -m "feat(coupang-client): fms 주문별 즉시할인쿠폰 조회 메서드 추가"
```

---

## Task 3: FIFO 수식에 coupon_discount 반영

**Files:**
- Modify: `src/lib/cost-management/fifo.ts`
- Modify: `src/lib/cost-management/__tests__/fifo.test.ts`

- [ ] **Step 1: SaleRow 인터페이스에 coupon_discount 추가 및 수식 변경**

`src/lib/cost-management/fifo.ts`의 `SaleRow` 인터페이스에 필드 추가:

```ts
export interface SaleRow {
  id: string;
  sold_at: string;
  quantity: number;
  selling_price: number;
  channel?: string;
  shipping_fee?: number;
  /** 쿠폰 할인 합계 (원) — effective_price = selling_price - coupon_discount */
  coupon_discount?: number;
}
```

- [ ] **Step 2: calculateFifo 내 수식 변경**

`calculateFifo` 함수 내 fee/profit 계산 부분을 수정한다 (현재 `fifo.ts:126-133` 위치):

기존:
```ts
const fee_per_unit = Math.round(sale.selling_price * platformFeeRate);
const shipping_fee_per_unit = sale.shipping_fee ?? 0;
const realized_profit_per_unit =
  sale.selling_price - fifo_cost_per_unit - fee_per_unit - shipping_fee_per_unit;
```

변경:
```ts
const effective_price = sale.selling_price - (sale.coupon_discount ?? 0);
const fee_per_unit = Math.round(effective_price * platformFeeRate);
const shipping_fee_per_unit = sale.shipping_fee ?? 0;
const realized_profit_per_unit =
  effective_price - fifo_cost_per_unit - fee_per_unit - shipping_fee_per_unit;
```

- [ ] **Step 3: 실패 테스트 작성**

`src/lib/cost-management/__tests__/fifo.test.ts` 파일 끝에 추가:

```ts
it('coupon_discount → effective_price 기준 수수료·손익 계산', () => {
  const batches = [
    { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
  ];
  const sales = [
    { id: 's1', sold_at: '2026-05-01', quantity: 1, selling_price: 35800, coupon_discount: 6000 },
  ];
  // effective_price = 35800 - 6000 = 29800
  // fee = round(29800 * 0.108) = round(3218.4) = 3218
  // profit = 29800 - 10000 - 3218 = 16582
  const result = calculateFifo(batches, sales, 0.108);
  expect(result.sale_details[0].realized_profit_per_unit).toBe(16582);
});

it('coupon_discount 없으면 기존 동작 유지', () => {
  const batches = [
    { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
  ];
  const sales = [
    { id: 's1', sold_at: '2026-05-01', quantity: 1, selling_price: 20000 },
  ];
  // coupon_discount undefined → effective_price = 20000, fee = 2000, profit = 8000
  const result = calculateFifo(batches, sales, 0.1);
  expect(result.sale_details[0].realized_profit_per_unit).toBe(8000);
});
```

- [ ] **Step 4: 테스트 실행 → FAIL 확인**

```bash
npx vitest run src/lib/cost-management/__tests__/fifo.test.ts
```

기대: 새로 추가한 `coupon_discount` 테스트가 FAIL (아직 코드 수정 전)

- [ ] **Step 5: fifo.ts 수정 적용 후 테스트 PASS 확인**

```bash
npx vitest run src/lib/cost-management/__tests__/fifo.test.ts
```

기대: 모든 테스트 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/lib/cost-management/fifo.ts src/lib/cost-management/__tests__/fifo.test.ts
git commit -m "feat(fifo): coupon_discount → effective_price 기준 수수료·손익 계산 반영"
```

---

## Task 4: products GET API — 판매 쿼리에 coupon_discount 포함

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`

FIFO 계산 시 `coupon_discount`를 전달하려면, 판매 레코드 조회 쿼리와 `SaleRow` 빌드 코드를 수정해야 한다.

- [ ] **Step 1: allSales 쿼리에 coupon_discount 추가**

`products/route.ts:76`에서 SELECT 수정:

기존:
```ts
`SELECT id, product_cost_id, sold_at, quantity, selling_price, channel, shipping_fee FROM sale_records WHERE user_id = $1`,
```

변경:
```ts
`SELECT id, product_cost_id, sold_at, quantity, selling_price, coupon_discount, channel, shipping_fee FROM sale_records WHERE user_id = $1`,
```

- [ ] **Step 2: SaleRow 빌드 코드에 coupon_discount 포함**

`products/route.ts:122-130` 근처의 `list.push({ ... })` 블록에 필드 추가:

기존:
```ts
list.push({
  id: s.id,
  sold_at: s.sold_at instanceof Date ? s.sold_at.toISOString().slice(0, 10) : String(s.sold_at).slice(0, 10),
  quantity: Number(s.quantity),
  selling_price: Number(s.selling_price),
  channel: s.channel ?? SALE_CHANNEL.MANUAL,
  shipping_fee: Number(s.shipping_fee ?? 0),
});
```

변경:
```ts
list.push({
  id: s.id,
  sold_at: s.sold_at instanceof Date ? s.sold_at.toISOString().slice(0, 10) : String(s.sold_at).slice(0, 10),
  quantity: Number(s.quantity),
  selling_price: Number(s.selling_price),
  coupon_discount: Number(s.coupon_discount ?? 0),
  channel: s.channel ?? SALE_CHANNEL.MANUAL,
  shipping_fee: Number(s.shipping_fee ?? 0),
});
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/products/route.ts
git commit -m "feat(api): products GET — 판매 쿼리에 coupon_discount 포함"
```

---

## Task 5: sales GET API — 응답에 coupon_discount 포함

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/sales/route.ts`

- [ ] **Step 1: SELECT 쿼리 수정**

`sales/route.ts:26`의 SELECT에 `coupon_discount` 추가:

기존:
```ts
`SELECT id, sold_at, quantity, selling_price, channel, coupang_order_item_id, shipping_fee, created_at
 FROM sale_records
 WHERE product_cost_id = $1
 ORDER BY sold_at DESC, created_at DESC`,
```

변경:
```ts
`SELECT id, sold_at, quantity, selling_price, coupon_discount, channel, coupang_order_item_id, shipping_fee, created_at
 FROM sale_records
 WHERE product_cost_id = $1
 ORDER BY sold_at DESC, created_at DESC`,
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/cost-management/products/[id]/sales/route.ts
git commit -m "feat(api): sales GET — 응답에 coupon_discount 포함"
```

---

## Task 6: products/[id] PATCH — download_coupon_policy 지원

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/route.ts`

- [ ] **Step 1: download_coupon_policy 추출 및 검증 추가**

`products/[id]/route.ts`의 PATCH 핸들러에서 body 파싱 부분 수정:

기존:
```ts
const { seller_product_id, vendor_item_id, naver_channel_product_no, variants, hidden, channel_type, external_id } = body ?? {};
```

변경:
```ts
const { seller_product_id, vendor_item_id, naver_channel_product_no, variants, hidden, channel_type, external_id, download_coupon_policy } = body ?? {};
```

- [ ] **Step 2: download_coupon_policy 검증 로직 추가**

`hidden` 검증 블록 아래 (`channel_type` 검증 블록 전) 에 삽입:

```ts
if (download_coupon_policy !== undefined && download_coupon_policy !== null) {
  const p = download_coupon_policy as Record<string, unknown>;
  if (
    typeof p.rate !== 'number' || p.rate <= 0 || p.rate > 1 ||
    typeof p.max_discount !== 'number' || p.max_discount <= 0 ||
    typeof p.min_price !== 'number' || p.min_price < 0
  ) {
    return NextResponse.json(
      { success: false, error: 'download_coupon_policy: {rate(0<r≤1), max_discount(>0), min_price(≥0)} 필요' },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 3: COALESCE UPDATE에 download_coupon_policy 추가**

`pool.query` UPDATE 블록 수정:

기존:
```ts
const { rows } = await pool.query(
  `UPDATE product_costs
   SET seller_product_id          = COALESCE($3, seller_product_id),
       vendor_item_id             = COALESCE($4, vendor_item_id),
       naver_channel_product_no   = COALESCE($5, naver_channel_product_no),
       variants                   = COALESCE($6, variants),
       hidden                     = COALESCE($7, hidden)
   WHERE id = $1 AND user_id = $2
   RETURNING id, seller_product_id, vendor_item_id, naver_channel_product_no, variants, hidden`,
  [id, user.userId, seller_product_id ?? null, vendor_item_id ?? null, naver_channel_product_no ?? null, variants ? JSON.stringify(variants) : null, hidden === undefined ? null : hidden],
);
```

변경:
```ts
const { rows } = await pool.query(
  `UPDATE product_costs
   SET seller_product_id          = COALESCE($3, seller_product_id),
       vendor_item_id             = COALESCE($4, vendor_item_id),
       naver_channel_product_no   = COALESCE($5, naver_channel_product_no),
       variants                   = COALESCE($6, variants),
       hidden                     = COALESCE($7, hidden),
       download_coupon_policy     = CASE WHEN $8::jsonb IS NOT NULL THEN $8::jsonb ELSE download_coupon_policy END
   WHERE id = $1 AND user_id = $2
   RETURNING id, seller_product_id, vendor_item_id, naver_channel_product_no, variants, hidden, download_coupon_policy`,
  [
    id, user.userId,
    seller_product_id ?? null,
    vendor_item_id ?? null,
    naver_channel_product_no ?? null,
    variants ? JSON.stringify(variants) : null,
    hidden === undefined ? null : hidden,
    download_coupon_policy !== undefined ? JSON.stringify(download_coupon_policy) : null,
  ],
);
```

> **참고:** `download_coupon_policy`를 `null`로 초기화(쿠폰 삭제)하려면 `{"rate": null}` 같은 명시적 null 전송이 필요하다. 현재 구현은 `undefined`(미전송)와 `null`(삭제) 구분이 CASE WHEN으로 처리되지 않는다. 쿠폰 삭제가 필요하면 별도 엔드포인트나 `clear_download_coupon` boolean을 추가해야 하나, 현재 스펙에서는 설정만 지원한다.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/cost-management/products/[id]/route.ts
git commit -m "feat(api): products PATCH — download_coupon_policy 지원 추가"
```

---

## Task 7: coupang-import — coupon_discount 계산 및 ON CONFLICT 변경

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/coupang-import/route.ts`

이 Task는 임포트 로직의 핵심 변경이다. 세 가지를 동시에 처리한다:
1. orderId 파싱 헬퍼
2. 즉시할인쿠폰 fms API 호출
3. 다운로드쿠폰 정책 기반 계산
4. ON CONFLICT 전략 변경

- [ ] **Step 1: orderId 파싱 헬퍼 함수 추가**

파일 상단 `splitInto30DayChunks` 함수 아래에 추가:

```ts
/**
 * coupang_order_item_id 형식별 orderId 추출
 * - Wing: "{orderId}-{vendorItemId}" → parts.slice(0, -1).join('-')
 * - RG:   "rg-{orderId}-{vendorItemId}" → parts[1]
 * - Naver/Manual: null 반환 (fms 호출 불필요)
 */
function extractOrderId(coupangOrderItemId: string): string | null {
  const parts = coupangOrderItemId.split('-');
  if (parts[0] === 'rg') {
    return parts[1] ?? null;  // rg-{orderId}-{vendorItemId}
  }
  if (parts[0] === 'naver') {
    return null;  // naver-{productOrderId}
  }
  if (parts.length >= 2) {
    return parts.slice(0, -1).join('-');  // {orderId}-{vendorItemId}
  }
  return null;
}

/**
 * 다운로드쿠폰 정책 기반 할인액 계산
 * 실제 고객 사용 여부 확인 불가 — 조건 충족 시 최악 시나리오(100% 사용) 가정
 */
function calcDownloadDiscount(
  sellingPrice: number,
  policy: { rate: number; max_discount: number; min_price: number } | null,
): number {
  if (!policy) return 0;
  if (sellingPrice < policy.min_price) return 0;
  return Math.min(Math.round(sellingPrice * policy.rate), policy.max_discount);
}
```

- [ ] **Step 2: 임포트 시작 시 download_coupon_policy 로드**

`products` 쿼리에 `download_coupon_policy` 추가 (route.ts:44):

기존:
```ts
`SELECT id, seller_product_id, vendor_item_id, product_name, naver_channel_product_no, variants FROM product_costs WHERE id = $1 AND user_id = $2`,
```

변경:
```ts
`SELECT id, seller_product_id, vendor_item_id, product_name, naver_channel_product_no, variants, download_coupon_policy FROM product_costs WHERE id = $1 AND user_id = $2`,
```

그리고 `storedProductName` 변수 아래에 정책 로드:

```ts
const rawPolicy = products[0].download_coupon_policy as {
  rate: number; max_discount: number; min_price: number;
} | null;
const downloadCouponPolicy = rawPolicy ?? null;
```

- [ ] **Step 3: Wing 아이템에 coupon_discount 필드 추가**

Wing 아이템 빌드 블록(현재 `generalItems` 배열에 push하는 `.map()`) 타입 선언에 `coupon_discount` 추가:

`generalItems` 배열 타입 변경:
```ts
const generalItems: Array<{
  sold_at: string; quantity: number; selling_price: number;
  coupang_order_item_id: string; channel: string; variant_name: string | null;
  shipping_fee: number; coupon_discount: number;
}> = [];
```

Wing 아이템 `.map()` 반환 객체에 `coupon_discount: 0` 추가 (아직 API 미호출, 0으로 초기화):
```ts
.map((item) => ({
  sold_at: order.paidAt?.slice(0, 10) ?? order.orderedAt.slice(0, 10),
  quantity: item.shippingCount,
  selling_price: item.shippingCount > 0
    ? Math.round(item.orderPrice / item.shippingCount)
    : item.salesPrice,
  coupang_order_item_id: `${order.orderId}-${item.vendorItemId}`,
  channel: 'coupang',
  variant_name: variantsCache[String(item.vendorItemId)] ?? null,
  shipping_fee: 3500,
  coupon_discount: 0,  // Task 7 Step 4에서 채워짐
})),
```

- [ ] **Step 4: RG 아이템 타입에도 coupon_discount 추가**

`rgItems` 배열 타입 변경:
```ts
const rgItems: Array<{
  sold_at: string;
  quantity: number;
  selling_price: number;
  coupang_order_item_id: string;
  channel: string;
  variant_name: string | null;
  shipping_fee: number;
  coupon_discount: number;
}> = [];
```

RG 아이템 `orderItemMap.set(key, { ... })` 에 `coupon_discount: 0` 추가:
```ts
orderItemMap.set(key, {
  sold_at: paidDate,
  quantity: item.salesQuantity,
  selling_price: item.unitSalesPrice,
  coupang_order_item_id: key,
  channel: 'rocket_growth',
  variant_name: variantsCache[String(item.vendorItemId)] ?? null,
  shipping_fee: 0,
  coupon_discount: 0,  // Task 7 Step 5에서 채워짐
});
```

- [ ] **Step 5: Naver 아이템 타입에도 coupon_discount 추가**

`naverItems` 배열 타입 변경 (coupon_discount 포함):
```ts
const naverItems: Array<{
  sold_at: string; quantity: number; selling_price: number;
  coupang_order_item_id: string; channel: string; variant_name: string | null;
  shipping_fee: number; coupon_discount: number;
}> = [];
```

Naver 아이템 push 블록에 `coupon_discount: 0` 추가.

- [ ] **Step 6: 합산 후 coupon_discount 계산 루프 추가**

DB 저장 직전 (`const allItems = [...generalItems, ...rgItems, ...naverItems];` 아래)에 삽입:

```ts
// coupon_discount 계산: Wing/RG는 fms API + 다운로드쿠폰 정책, Naver는 0
if (client && (generalItems.length > 0 || rgItems.length > 0)) {
  for (const item of allItems) {
    if (item.channel === 'naver' || item.channel === 'manual') continue;
    const orderId = extractOrderId(item.coupang_order_item_id);
    if (!orderId) continue;
    const immediateDiscount = await client.getOrderImmediateDiscount(orderId);
    const downloadDiscount = calcDownloadDiscount(item.selling_price, downloadCouponPolicy);
    item.coupon_discount = immediateDiscount + downloadDiscount;
  }
}
```

- [ ] **Step 7: INSERT에 coupon_discount 포함 + ON CONFLICT 전략 변경**

DB 저장 루프를 수정:

기존:
```ts
const result = await pool.query(
  `INSERT INTO sale_records
     (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id, variant_name, shipping_fee)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
   ON CONFLICT (coupang_order_item_id) DO NOTHING`,
  [user.userId, id, item.sold_at, item.quantity, item.selling_price, item.channel, item.coupang_order_item_id, item.variant_name ?? null, item.shipping_fee],
);
```

변경:
```ts
const result = await pool.query(
  `INSERT INTO sale_records
     (user_id, product_cost_id, sold_at, quantity, selling_price, coupon_discount, channel, coupang_order_item_id, variant_name, shipping_fee)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
   ON CONFLICT (coupang_order_item_id) DO UPDATE
     SET coupon_discount = EXCLUDED.coupon_discount
     WHERE sale_records.coupon_discount = 0`,
  [user.userId, id, item.sold_at, item.quantity, item.selling_price, item.coupon_discount, item.channel, item.coupang_order_item_id, item.variant_name ?? null, item.shipping_fee],
);
```

> **중요:** `DO UPDATE WHERE coupon_discount = 0`이므로 기존에 이미 coupon_discount > 0으로 저장된 레코드는 재임포트 시 덮어쓰지 않는다. 이 동작은 의도된 것이다. 수동 수정값 보호를 위해 `selling_price`, `sold_at` 등 다른 필드는 업데이트하지 않는다.

- [ ] **Step 8: 커밋**

```bash
git add src/app/api/cost-management/products/[id]/coupang-import/route.ts
git commit -m "feat(import): 쿠폰 할인액 계산 및 coupon_discount 저장 (fms API + 다운로드쿠폰 정책)"
```

---

## Task 8: SaleEntryPanel UI — 쿠폰할인 컬럼 + 다운로드쿠폰 정책 설정

**Files:**
- Modify: `src/components/orders/SaleEntryPanel.tsx`

- [ ] **Step 1: SaleRecord 타입에 coupon_discount 추가**

`SaleEntryPanel.tsx:6-15`의 `SaleRecord` 인터페이스:

기존:
```ts
interface SaleRecord {
  id: string;
  sold_at: string;
  quantity: number;
  selling_price: number;
  channel: string;
  coupang_order_item_id: string | null;
  variant_name?: string | null;
  shipping_fee: number;
}
```

변경:
```ts
interface SaleRecord {
  id: string;
  sold_at: string;
  quantity: number;
  selling_price: number;
  coupon_discount: number;
  channel: string;
  coupang_order_item_id: string | null;
  variant_name?: string | null;
  shipping_fee: number;
}
```

- [ ] **Step 2: 다운로드쿠폰 정책 상태 및 로드 추가**

Props 인터페이스에 `downloadCouponPolicy` 추가:

```ts
interface DownloadCouponPolicy {
  rate: number;
  max_discount: number;
  min_price: number;
}

interface Props {
  productId: string;
  sellerProductId: number | null;
  vendorItemId?: number | null;
  naverChannelProductNo?: number | null;
  downloadCouponPolicy?: DownloadCouponPolicy | null;
  onChanged: () => void;
}
```

컴포넌트 내 상태 추가:

```ts
const [couponPolicy, setCouponPolicy] = useState<DownloadCouponPolicy | null>(
  downloadCouponPolicy ?? null
);
const [couponPolicyForm, setCouponPolicyForm] = useState({
  rate: String(Math.round((downloadCouponPolicy?.rate ?? 0.10) * 100)),
  max_discount: String(downloadCouponPolicy?.max_discount ?? 1000),
  min_price: String(downloadCouponPolicy?.min_price ?? 30000),
});
const [showCouponPolicyForm, setShowCouponPolicyForm] = useState(false);
const [savingCouponPolicy, setSavingCouponPolicy] = useState(false);
```

- [ ] **Step 3: 다운로드쿠폰 정책 저장 함수 추가**

`save` 함수 아래에 추가:

```ts
async function saveCouponPolicy() {
  const rate = Number(couponPolicyForm.rate) / 100;
  const max_discount = Math.round(Number(couponPolicyForm.max_discount));
  const min_price = Math.round(Number(couponPolicyForm.min_price));
  if (rate <= 0 || rate > 1 || max_discount <= 0 || min_price < 0) {
    alert('다운로드쿠폰 정책 값이 올바르지 않습니다.');
    return;
  }
  setSavingCouponPolicy(true);
  try {
    const res = await fetch(`/api/cost-management/products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ download_coupon_policy: { rate, max_discount, min_price } }),
    });
    const json = await res.json();
    if (json.success) {
      setCouponPolicy({ rate, max_discount, min_price });
      setShowCouponPolicyForm(false);
      alert('다운로드쿠폰 정책이 저장되었습니다. 재임포트 시 적용됩니다.');
    } else {
      alert(json.error ?? '저장 실패');
    }
  } finally {
    setSavingCouponPolicy(false);
  }
}
```

- [ ] **Step 4: 테이블 헤더에 쿠폰할인 컬럼 추가 + 다운로드쿠폰 설정 UI 삽입**

헤더 `{['판매일', '수량', '판매가', '채널', '사이즈', '택배비', ''].map(...)}` 를:

```ts
{['판매일', '수량', '판매가', '쿠폰할인', '채널', '사이즈', '택배비', ''].map((h, i) => (
  <th key={`${h}-${i}`} style={{ padding: '6px 8px', textAlign: h === '판매일' ? 'left' : 'right', fontWeight: 600, color: '#27272a' }}>{h}</th>
))}
```

`colSpan={7}` 를 모두 `colSpan={8}` 로 변경.

- [ ] **Step 5: 테이블 행에 쿠폰할인 셀 추가**

일반 표시 행(현재 `판매가` 셀 아래)에 추가:

```tsx
{/* 쿠폰할인 */}
<td style={{ padding: '6px 8px', textAlign: 'right', color: (s.coupon_discount ?? 0) > 0 ? '#dc2626' : '#e5e5e5', fontSize: '11px' }}>
  {(s.coupon_discount ?? 0) > 0 ? `-${fmt(s.coupon_discount)}` : '—'}
</td>
```

- [ ] **Step 6: 다운로드쿠폰 정책 설정 UI 추가**

임포트 폼 (`showImportForm` 블록) 아래, 테이블 위에 삽입:

```tsx
{/* 다운로드쿠폰 정책 설정 */}
{(sellerProductId || vendorItemId) && (
  <div style={{ marginBottom: '8px' }}>
    <button
      onClick={() => setShowCouponPolicyForm((v) => !v)}
      style={{ fontSize: '10px', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
    >
      🏷️ 다운로드쿠폰 정책 {couponPolicy ? `(${Math.round(couponPolicy.rate * 100)}%, 최대 ${fmt(couponPolicy.max_discount)}원)` : '(미설정)'}
    </button>
    {showCouponPolicyForm && (
      <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '6px', padding: '8px', fontSize: '11px', marginTop: '4px' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label>할인율(%)<input type="number" value={couponPolicyForm.rate} onChange={(e) => setCouponPolicyForm((f) => ({ ...f, rate: e.target.value }))}
            style={{ width: '50px', marginLeft: '4px', padding: '2px 4px', borderRadius: '4px', border: '1px solid #fcd34d', fontSize: '11px', color: '#18181b' }} /></label>
          <label>최대할인(원)<input type="number" value={couponPolicyForm.max_discount} onChange={(e) => setCouponPolicyForm((f) => ({ ...f, max_discount: e.target.value }))}
            style={{ width: '70px', marginLeft: '4px', padding: '2px 4px', borderRadius: '4px', border: '1px solid #fcd34d', fontSize: '11px', color: '#18181b' }} /></label>
          <label>최소구매(원)<input type="number" value={couponPolicyForm.min_price} onChange={(e) => setCouponPolicyForm((f) => ({ ...f, min_price: e.target.value }))}
            style={{ width: '70px', marginLeft: '4px', padding: '2px 4px', borderRadius: '4px', border: '1px solid #fcd34d', fontSize: '11px', color: '#18181b' }} /></label>
          <button onClick={saveCouponPolicy} disabled={savingCouponPolicy}
            style={{ padding: '3px 10px', borderRadius: '4px', background: '#d97706', color: '#fff', border: 'none', fontSize: '11px', cursor: 'pointer' }}>
            {savingCouponPolicy ? '저장중...' : '저장'}
          </button>
        </div>
        <p style={{ margin: '4px 0 0', color: '#92400e', fontSize: '10px' }}>저장 후 재임포트 시 적용됩니다.</p>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 7: CostEntryDrawer에서 downloadCouponPolicy prop 전달 (필요한 경우)**

`SaleEntryPanel`의 `Props`에 `downloadCouponPolicy`를 추가했으므로, `CostEntryDrawer`에서 해당 prop을 넘겨줘야 한다. 단, 현재 `CostEntryDrawer`는 `productId`만 받고 product 데이터는 갖고 있지 않다.

가장 단순한 방법: `SaleEntryPanel` 내에서 자체적으로 policy를 관리한다 (이미 Step 2에서 상태로 관리). `downloadCouponPolicy` prop은 초기값으로만 사용하며, 없어도 동작한다. `CostEntryDrawer` 변경 불필요 — `SaleEntryPanel`에 prop을 전달하지 않으면 `null`로 초기화된다.

- [ ] **Step 8: 커밋**

```bash
git add src/components/orders/SaleEntryPanel.tsx
git commit -m "feat(ui): 판매 내역 쿠폰할인 컬럼 + 다운로드쿠폰 정책 설정 UI 추가"
```

---

## Task 9: CostManagementTab 푸터 주석 업데이트 (선택)

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

`CostManagementTab.tsx:1163`의 실현손익 설명 주석을 업데이트:

기존:
```
실현손익 = FIFO 원가 기준 (판매가 − 입고원가 − 배송비 − RG배송비 − 수수료)
```

변경:
```
실현손익 = FIFO 원가 기준 ((판매가−쿠폰할인) − 입고원가 − 배송비 − RG배송비 − 수수료)
```

- [ ] **Step 1: 주석 수정 및 커밋**

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "docs(ui): 실현손익 계산 설명에 쿠폰할인 반영"
```

---

## 검증 체크리스트

구현 완료 후 다음을 수동으로 확인한다:

- [ ] 기존 RG/Wing 주문 재임포트 시 `coupon_discount` > 0으로 업데이트됨
- [ ] 재임포트 시 이미 `coupon_discount` > 0인 레코드는 건드리지 않음 (ON CONFLICT WHERE = 0)
- [ ] 다운로드쿠폰 정책 저장 후 재임포트 시 `min_price` 미충족 주문은 할인 0원 유지
- [ ] Naver 주문은 `coupon_discount = 0` 유지
- [ ] FIFO 실현손익이 이전보다 낮아짐 (쿠폰 반영으로 올바르게 보수적 계산)
- [ ] 판매 내역 테이블에 쿠폰할인 컬럼 표시됨 (0이면 `—`)
