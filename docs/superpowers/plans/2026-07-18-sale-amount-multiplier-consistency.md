# 매출 축 정합성 (sale_amount) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `sale_records.selling_price × quantity`가 `unit_multiplier`배로 매출을 부풀리는 버그를 없애고, 채널이 확정한 실매출을 `sale_amount` 컬럼에 저장해 매출을 곱셈으로 유도하지 않게 만든다.

**Architecture:** `sale_records`에 `sale_amount int`(NULL 허용) 컬럼을 추가한다. 6개 판매 임포트 경로가 채널 응답의 확정 금액을 이 컬럼에 채우고, 매출을 읽는 두 곳(`fifo.ts`, `products/route.ts`)이 `sale_amount ?? (selling_price × quantity)` 폴백으로 읽는다. `fifo.ts`는 단가 축 계산을 총액 축으로 재구성하며, 이 과정에서 쿠폰 과차감 버그도 함께 해소된다. 폴백 덕분에 마이그레이션 → 쓰기 → 읽기 순서 중 어디서 멈춰도 숫자가 깨지지 않는다.

**Tech Stack:** Next.js App Router (Route Handlers), Render PostgreSQL (`getSourcingPool`), Vitest.

**참조 스펙:** `docs/superpowers/specs/2026-07-18-sale-amount-multiplier-consistency-design.md`

---

## 배경 요약 (작업자용)

- `product_cost_channels.unit_multiplier`(마이그 081)는 "판매 1건당 소비되는 **단품 개수**"다. 임포트는 `quantity = 주문수량 × multiplier`(단품 축), `selling_price = 팩 단가`로 저장한다. 두 컬럼이 다른 축이라 `selling_price × quantity`는 실매출의 multiplier배가 된다.
- **현재 `unit_multiplier > 1`인 상품이 없다.** 그래서 기존 데이터는 전부 `multiplier = 1`이고 `selling_price × quantity`가 우연히 정확하다. 버그는 잠복 상태다. 이 작업의 목적은 "지금 틀린 데이터 교정"이 아니라 "2개입 상품을 등록하는 순간 터질 버그를 미리 막고, 앞으로 매출을 확정 금액으로 저장"하는 것이다.
- **원가는 이미 정확하다.** `fifo.ts`에서 원가 항(`fifo_cost_per_unit × quantity`)은 옳고, 매출·수수료만 오염돼 있다.

## 축 규약 (이 계획 전체의 불변식)

`sale_records`의 세 금액 컬럼은 각각 다른 축의 진실을 하나씩 맡는다:

| 컬럼 | 축 | 의미 |
|---|---|---|
| `sale_amount` | 매출 | 그 판매가 번 돈 (총액). 채널 확정 금액 |
| `quantity` | 재고 | 그 판매로 빠진 단품 개수 (× multiplier 적용됨) |
| `selling_price` | 표시 | 팩 표시가격. 계산에 쓰지 않음(폴백·표시용) |

**매출은 저장된 `sale_amount`를 읽는다. `selling_price × quantity`는 폴백에서만 등장한다.**

## 파일 구조

- **생성:** `supabase/migrations/087_sale_records_sale_amount.sql` — 컬럼 추가 + 백필
- **수정 (읽기):** `src/lib/cost-management/fifo.ts` — `SaleRow` 타입에 `sale_amount`, 총액 축 재구성
- **수정 (읽기):** `src/app/api/cost-management/products/route.ts` — 판매 로딩 SQL·매핑·`periodSalesAmount`
- **수정 (쓰기):** `wing-bulk-import/route.ts`, `rg-bulk-import/route.ts`, `products/[id]/coupang-import/route.ts`, `naver-bulk-import/route.ts`, `products/[id]/sales/route.ts`
- **수정 (UI):** `src/components/orders/SaleEntryPanel.tsx` — 판매가 컬럼 헤더에 단위 명시
- **테스트:** `src/lib/cost-management/__tests__/fifo.test.ts`(확장), `src/__tests__/api/cost-management-sales-sale-amount.test.ts`(신규)

## 테스트 전략 메모 (작업자용)

정합성의 핵심은 순수 함수 `calculateFifo`에 있으므로 **Task 2에 가장 강한 TDD를 건다** — multiplier=2 판매가 현재 코드에서 실패하고 수정 후 통과하는 것이 이 계획의 핵심 증거다. 수동 판매 라우트(모호했던 경로)는 실제 라우트 테스트로 `sale_amount` 저장을 고정한다(Task 8). `products/route.ts`의 매출 폴백은 `fifo.ts`와 **동일한 한 줄 표현식**이라 5단계 쿼리 목킹으로 중복 검증하지 않고 `tsc` + 기존 스위트로 회귀만 막는다(Task 3). 임포트 쓰기 경로는 기계적 컬럼 추가라 `tsc --noEmit`로 가드한다.

각 vitest 실행은 경로를 지정한다 — 인자 없는 `npx vitest run`은 무관한 라이브러리 테스트까지 돌려 대량 선재 실패를 낸다.

---

### Task 1: 마이그레이션 087 — sale_amount 컬럼 + 백필

**Files:**
- Create: `supabase/migrations/087_sale_records_sale_amount.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 087_sale_records_sale_amount.sql
-- sale_records에 실매출 총액 컬럼 추가.
--
-- 배경: 081(unit_multiplier)이 quantity를 "단품 개수"(주문수량 × 배수)로
-- 바꿨으나 selling_price는 "팩 단가"로 남아, selling_price × quantity가
-- 실매출의 배수배가 되는 버그가 있다. sale_amount는 채널이 확정한 실매출을
-- 그대로 보관해 매출을 곱으로 유도하지 않게 한다.
--
-- 백필 전제: 현재 unit_multiplier > 1 판매가 존재하지 않으므로
-- selling_price × quantity가 전 행에서 정확하다. multiplier > 1 상품을
-- 도입하려면 이 마이그레이션과 관련 앱 코드가 먼저 배포돼 있어야 한다.

ALTER TABLE sale_records ADD COLUMN IF NOT EXISTS sale_amount int;

UPDATE sale_records
   SET sale_amount = selling_price * quantity
 WHERE sale_amount IS NULL;
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/migrations/087_sale_records_sale_amount.sql
git commit -m "feat(db): sale_records.sale_amount 컬럼 + 백필 (087)"
```

> 참고: 이 저장소의 마이그레이션은 Render PostgreSQL에 psql로 직접 적용된다(파일 존재 = 스키마 소스). 운영 적용은 배포 절차에 따르며, `IF NOT EXISTS`라 재적용은 무해하다.

---

### Task 2: fifo.ts — SaleRow 타입 + 총액 축 재구성 (핵심 TDD)

**Files:**
- Modify: `src/lib/cost-management/fifo.ts:36-51` (SaleRow), `:129-146` (계산부)
- Test: `src/lib/cost-management/__tests__/fifo.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가 (multiplier=2 판매)**

`src/lib/cost-management/__tests__/fifo.test.ts`의 마지막 `it(...)` 뒤, `});`(describe 종료) 앞에 아래 3개 테스트를 추가한다.

```typescript
  it('sale_amount가 있으면 매출은 sale_amount 기준 (2개입: quantity=2, 팩가 30000)', () => {
    // 2개입 1건 판매: 재고 2개 차감(quantity=2), 실매출은 팩가 30000.
    // 버그 코드는 selling_price(30000) × quantity(2) = 60000으로 매출을 2배 계산한다.
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 2, selling_price: 30000, sale_amount: 30000 },
    ];
    const result = calculateFifo(batches, sales, 0.1);
    // 매출 30000 - 수수료 round(30000*0.1)=3000 - 원가(10000*2=20000) = 7000
    expect(result.sale_details[0].realized_profit).toBe(7000);
    expect(result.total_realized_profit).toBe(7000);
  });

  it('sale_amount가 null이면 selling_price × quantity로 폴백 (레거시 행)', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 10, selling_price: 20000 }, // sale_amount 없음
    ];
    const result = calculateFifo(batches, sales, 0.1);
    // 폴백 매출 200000 - 수수료 20000 - 원가 100000 = 80000 (기존 동작과 동일)
    expect(result.total_realized_profit).toBe(80000);
  });

  it('쿠폰은 총액에서 1회만 차감 (수량 2, 쿠폰 6000 → 과차감 없음)', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 2, selling_price: 40000, sale_amount: 40000, coupon_discount: 6000 },
    ];
    const result = calculateFifo(batches, sales, 0.1);
    // 실효매출 40000-6000=34000, 수수료 round(34000*0.1)=3400, 원가 20000
    // 손익 34000 - 20000 - 3400 = 10600
    expect(result.sale_details[0].realized_profit).toBe(10600);
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/lib/cost-management/__tests__/fifo.test.ts`
Expected: 첫 번째 새 테스트 FAIL — 버그 코드는 매출을 `30000 × 2`로 봐서 `realized_profit`이 7000이 아닌 값(약 46000대)이 된다. (타입 에러가 먼저 날 수도 있음 — `sale_amount`가 `SaleRow`에 없으므로. 그 경우 Step 3에서 타입 추가 후 다시 실패 확인.)

- [ ] **Step 3: SaleRow 타입에 sale_amount 추가**

`src/lib/cost-management/fifo.ts`의 `SaleRow` 인터페이스(`:36-51`)에서 `selling_price` 필드 바로 아래에 추가:

```typescript
  /** 판매 단가 (원) */
  selling_price: number;
  /** 실매출 총액 (원) — 채널 확정 금액. 없으면 selling_price × quantity로 폴백 */
  sale_amount?: number | null;
  /** 채널 ('rocket_growth' | 'coupang' | 'manual' 등) — 채널별 FIFO 분리 시 필터링에 사용 */
  channel?: string;
```

- [ ] **Step 4: 계산부를 총액 축으로 재구성**

`src/lib/cost-management/fifo.ts`의 `:129-146` 블록(`// 실효 판매가:`부터 `total_realized_profit += realized_profit;`까지)을 아래로 교체:

```typescript
    // 매출: 채널 확정 총액(sale_amount) 우선, 없으면 selling_price × quantity 폴백.
    // selling_price × quantity 는 multiplier > 1 에서 실매출을 부풀리므로 폴백 전용.
    const revenue = sale.sale_amount ?? sale.selling_price * sale.quantity;

    // 실효 매출: 쿠폰 할인(건당 총액)을 매출 총액에서 1회 차감.
    // (기존 코드는 단가에서 차감해 수량 > 1이면 과차감했음 — 총액 축으로 교정)
    const effective_revenue = revenue - (sale.coupon_discount ?? 0);

    // 플랫폼 수수료: 실효 매출 총액 × 수수료율 (반올림)
    const fee = Math.round(effective_revenue * platformFeeRate);

    // 원가: FIFO 단위원가 × 수량 (기존과 동일, 이미 정확)
    const cost = fifo_cost_per_unit * sale.quantity;

    // 택배비 제외 손익 (per-unit 표시용 파생)
    const profit_before_shipping = effective_revenue - cost - fee;
    const realized_profit_per_unit =
      sale.quantity > 0 ? Math.round(profit_before_shipping / sale.quantity) : 0;

    // 건당 택배비는 판매 1건당 한 번만 차감. 수량 0이면 판매·배송 자체가 없으므로 0.
    const shipping_fee = sale.shipping_fee ?? 0;
    const realized_profit =
      sale.quantity > 0 ? profit_before_shipping - shipping_fee : 0;

    sale_details.push({ saleId: sale.id, fifo_cost_per_unit, realized_profit_per_unit, realized_profit });
    total_realized_profit += realized_profit;
```

- [ ] **Step 5: 전체 fifo 테스트 통과 확인 (신규 + 기존 회귀 없음)**

Run: `npx vitest run src/lib/cost-management/__tests__/fifo.test.ts`
Expected: PASS (신규 3개 + 기존 14개 모두). 기존 픽스처는 수수료가 정수로 나누어떨어지고 쿠폰 테스트가 수량 1이라 총액 축에서도 동일 결과가 나온다.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/cost-management/fifo.ts src/lib/cost-management/__tests__/fifo.test.ts
git commit -m "fix(fifo): 매출을 sale_amount 총액 축으로 계산 — multiplier·쿠폰 과차감 버그 수정"
```

---

### Task 3: products/route.ts — 판매 로딩·매출 폴백

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts:76` (SQL), `:122-130` (매핑), `:216` (periodSalesAmount)

- [ ] **Step 1: 판매 로딩 SQL에 sale_amount 추가**

`:76`의 쿼리에서 `selling_price` 뒤에 `sale_amount`를 넣는다:

```typescript
      `SELECT id, product_cost_id, sold_at, quantity, selling_price, sale_amount, coupon_discount, channel, shipping_fee FROM sale_records WHERE user_id = $1 AND voided_at IS NULL`,
```

- [ ] **Step 2: SaleRow 매핑에 sale_amount 추가**

`:122-130`의 `list.push({ ... })` 안에서 `selling_price` 줄 아래에 추가:

```typescript
        selling_price: Number(s.selling_price),
        sale_amount: s.sale_amount == null ? null : Number(s.sale_amount),
        coupon_discount: Number(s.coupon_discount ?? 0),
```

- [ ] **Step 3: periodSalesAmount를 폴백 표현식으로 교체**

`:216`을 교체:

```typescript
      const periodSalesAmount = pFilteredSales.reduce((s, sale) => s + (sale.sale_amount ?? sale.selling_price * sale.quantity), 0);
```

- [ ] **Step 4: 타입체크 + 기존 원가관리 테스트 회귀 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (`sale_amount`는 `SaleRow`에서 `number | null | undefined` 허용)

Run: `npx vitest run src/__tests__/api/cost-management-hidden.test.ts src/__tests__/api/product-cost-channels-crud.test.ts`
Expected: PASS (회귀 없음)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/cost-management/products/route.ts
git commit -m "fix(cost): 원가 탭 매출을 sale_amount 폴백으로 읽기"
```

---

### Task 4: wing-bulk-import — sale_amount 저장

**Files:**
- Modify: `src/app/api/cost-management/wing-bulk-import/route.ts:93-99` (records 타입), `:126-132` (record), `:143-159` (INSERT)

- [ ] **Step 0: records 배열 타입에 sale_amount 추가**

`:93-99`의 선언을 교체:

```typescript
    const records: Array<{
      product_cost_id: string;
      sold_at: string;
      quantity: number;
      selling_price: number;
      sale_amount: number;
      coupang_order_item_id: string;
    }> = [];
```

- [ ] **Step 1: record에 sale_amount 추가**

`:126-132`의 `records.push({ ... })`에 `sale_amount`를 넣는다. `item.saleAmount`는 응답 inner item의 라인 매출 총액이다(`coupang-client.ts:654`) — multiplier와 무관한 실매출이므로 그대로 쓴다:

```typescript
            records.push({
              product_cost_id: productCostId,
              sold_at: soldAt,
              quantity: item.quantity * multiplier,
              selling_price: item.salePrice,
              sale_amount: item.saleAmount,
              coupang_order_item_id: `wing-${order.orderId}-${item.vendorItemId}`,
            });
```

- [ ] **Step 2: bulk INSERT를 8컬럼으로 확장**

`:143-159` 블록을 교체 (파라미터 7 → 8, `sale_amount` 컬럼·플레이스홀더 추가):

```typescript
      const CHUNK = 175; // 파라미터 수 한계 고려 (8 params × 175 = 1400)
      for (let i = 0; i < records.length; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK);
        const values: unknown[] = [];
        const shippingFee = resolveSaleShippingFee('wing');
        const placeholders = chunk.map((rec, idx) => {
          const base = idx * 8;
          values.push(user.userId, rec.product_cost_id, rec.sold_at, rec.quantity, rec.selling_price, rec.sale_amount, rec.coupang_order_item_id, shippingFee);
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},'coupang',$${base + 7},$${base + 8})`;
        });
        const result = await pool.query(
          `INSERT INTO sale_records
             (user_id, product_cost_id, sold_at, quantity, selling_price, sale_amount, channel, coupang_order_item_id, shipping_fee)
           VALUES ${placeholders.join(',')}
           ON CONFLICT (coupang_order_item_id) DO NOTHING`,
          values,
        );
        imported += result.rowCount ?? 0;
      }
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음. (`item.saleAmount`는 `getRevenueHistory` 반환 타입 inner item에 존재 — `coupang-client.ts:615`; records 타입은 Step 0에서 확장됨)

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/cost-management/wing-bulk-import/route.ts
git commit -m "feat(import): 윙 일괄 임포트에 sale_amount 저장"
```

---

### Task 5: rg-bulk-import — sale_amount 저장

**Files:**
- Modify: `src/app/api/cost-management/rg-bulk-import/route.ts:67-73` (items 타입), `:91-103` (accumulate), `:114-124` (INSERT)

- [ ] **Step 0: items 배열 타입에 sale_amount 추가**

`:67-73`의 선언을 교체 (`orderItemMap`은 `(typeof items)[number]` 등으로 이 타입을 참조하므로 함께 반영된다):

```typescript
    const items: Array<{
      product_cost_id: string;
      sold_at: string;
      quantity: number;
      selling_price: number;
      sale_amount: number;
      coupang_order_item_id: string;
    }> = [];
```

- [ ] **Step 1: orderItemMap에 sale_amount 누적**

RG 응답에는 라인 총액 필드가 없고 `unitSalesPrice`(팩 단가)·`salesQuantity`(팩 수)만 있다. 실매출 = `unitSalesPrice × salesQuantity` (multiplier 미적용). `:91-103` 블록을 교체:

```typescript
            const key = `rg-${order.orderId}-${item.vendorItemId}`;
            const lineAmount = item.unitSalesPrice * item.salesQuantity;
            const existing = orderItemMap.get(key);
            if (existing) {
              existing.quantity += item.salesQuantity * match.multiplier;
              existing.sale_amount += lineAmount;
            } else {
              orderItemMap.set(key, {
                product_cost_id: match.id,
                sold_at: soldAt,
                quantity: item.salesQuantity * match.multiplier,
                selling_price: item.unitSalesPrice,
                sale_amount: lineAmount,
                coupang_order_item_id: key,
              });
            }
```

- [ ] **Step 2: INSERT를 8컬럼으로 확장**

`:114-124`의 루프를 교체:

```typescript
    for (const item of items) {
      const result = await pool.query(
        `INSERT INTO sale_records
           (user_id, product_cost_id, sold_at, quantity, selling_price, sale_amount, channel, coupang_order_item_id, shipping_fee)
         VALUES ($1, $2, $3, $4, $5, $6, 'rocket_growth', $7, $8)
         ON CONFLICT (coupang_order_item_id) DO NOTHING`,
        [user.userId, item.product_cost_id, item.sold_at, item.quantity, item.selling_price, item.sale_amount, item.coupang_order_item_id, resolveSaleShippingFee('rg')],
      );
      if ((result.rowCount ?? 0) > 0) imported++;
      else skipped++;
    }
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음. (Step 0에서 `items` 타입을 확장했고 `orderItemMap`은 `(typeof items)[number]`를 참조하므로 함께 반영됨.)

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/cost-management/rg-bulk-import/route.ts
git commit -m "feat(import): RG 일괄 임포트에 sale_amount 저장"
```

---

### Task 6: coupang-import (단건, 3 phase) — sale_amount 저장

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/coupang-import/route.ts:152-156` (generalItems 타입), `:182-193` (wing), `:223-232`+`:269-278` (rg), `:294-322` (naver), `:347-354` (INSERT)

- [ ] **Step 1: 세 배열의 공통 요소 타입에 sale_amount 추가**

`:152-156`의 `generalItems` 타입, `:223-232`의 `rgItems` 타입, `:294-298`의 `naverItems` 타입 세 곳 모두 `selling_price: number;` 뒤에 `sale_amount: number;`를 추가한다. 예 (`generalItems`):

```typescript
    const generalItems: Array<{
      sold_at: string; quantity: number; selling_price: number; sale_amount: number;
      coupang_order_item_id: string; channel: string; variant_name: string | null;
      shipping_fee: number; coupon_discount: number;
    }> = [];
```

`rgItems`(`:223-232`)와 `naverItems`(`:294-298`)에도 동일하게 `sale_amount: number;`를 넣는다.

- [ ] **Step 2: wing phase — sale_amount = item.orderPrice**

`:182-193`의 `return { ... }`에 추가. 윙 단건 응답의 `item.orderPrice`는 그 주문 라인의 총액이다(`selling_price`는 이를 `shippingCount`로 나눈 단가):

```typescript
            return {
              sold_at: order.paidAt?.slice(0, 10) ?? order.orderedAt.slice(0, 10),
              quantity: item.shippingCount * wm,
              selling_price: item.shippingCount > 0
                ? Math.round(item.orderPrice / item.shippingCount)
                : item.salesPrice,
              sale_amount: item.orderPrice,
              coupang_order_item_id: `${order.orderId}-${item.vendorItemId}`,
              channel: 'coupang',
              variant_name: variantsCache[String(item.vendorItemId)] ?? null,
              shipping_fee: resolveSaleShippingFee('wing'),
              coupon_discount: 0,
            };
```

- [ ] **Step 3: rg phase — sale_amount = unitSalesPrice × salesQuantity 누적**

`:264-279`의 accumulate 블록을 교체:

```typescript
            const existing = orderItemMap.get(key);
            const rm = rgMultiplierMap.get(item.vendorItemId) ?? 1;
            const lineAmount = item.unitSalesPrice * item.salesQuantity;
            if (existing) {
              existing.quantity += item.salesQuantity * rm;
              existing.sale_amount += lineAmount;
            } else {
              orderItemMap.set(key, {
                sold_at: paidDate,
                quantity: item.salesQuantity * rm,
                selling_price: item.unitSalesPrice,
                sale_amount: lineAmount,
                coupang_order_item_id: key,
                channel: 'rocket_growth',
                variant_name: variantsCache[String(item.vendorItemId)] ?? null,
                shipping_fee: resolveSaleShippingFee('rg'),
                coupon_discount: 0,
              });
            }
```

- [ ] **Step 4: naver phase — sale_amount = totalPaymentAmount**

`:311-322`의 `naverItems.push({ ... })`에 추가:

```typescript
          naverItems.push({
            sold_at: soldAt,
            quantity: order.quantity,
            selling_price: order.quantity > 0
              ? Math.round(order.totalPaymentAmount / order.quantity)
              : order.totalPaymentAmount,
            sale_amount: order.totalPaymentAmount,
            coupang_order_item_id: `naver-${order.productOrderId}`,
            channel: 'naver',
            variant_name: null,
            shipping_fee: resolveSaleShippingFee('naver'),
            coupon_discount: 0,
          });
```

- [ ] **Step 5: INSERT를 11컬럼으로 확장**

`:347-354`의 쿼리를 교체 (10 → 11 파라미터, `sale_amount` 추가):

```typescript
      const result = await pool.query(
        `INSERT INTO sale_records
           (user_id, product_cost_id, sold_at, quantity, selling_price, sale_amount, coupon_discount, channel, coupang_order_item_id, variant_name, shipping_fee)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (coupang_order_item_id) DO UPDATE
           SET coupon_discount = EXCLUDED.coupon_discount
           WHERE sale_records.coupon_discount = 0`,
        [user.userId, id, item.sold_at, item.quantity, item.selling_price, item.sale_amount, item.coupon_discount, item.channel, item.coupang_order_item_id, item.variant_name ?? null, item.shipping_fee],
      );
```

> 주의: `ON CONFLICT ... DO UPDATE`는 기존 행의 `coupon_discount`만 갱신한다. `sale_amount`는 신규 INSERT에만 채워지고 기존 행은 Task 1 백필값을 유지한다 — 의도된 동작(재임포트가 확정 매출을 덮지 않음).

- [ ] **Step 6: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 7: 커밋**

```bash
git add "src/app/api/cost-management/products/[id]/coupang-import/route.ts"
git commit -m "feat(import): 단건 임포트 3개 채널에 sale_amount 저장"
```

---

### Task 7: naver-bulk-import — sale_amount 저장

**Files:**
- Modify: `src/app/api/cost-management/naver-bulk-import/route.ts:46-52` (records 타입), `:69-75` (record), `:80-96` (INSERT)

- [ ] **Step 0: records 배열 타입에 sale_amount 추가**

`:46-52`의 선언을 교체:

```typescript
    const records: Array<{
      product_cost_id: string;
      sold_at: string;
      quantity: number;
      selling_price: number;
      sale_amount: number;
      naver_order_id: string;
    }> = [];
```

- [ ] **Step 1: record에 sale_amount 추가**

`:69-75`의 `records.push({ ... })`에 추가. 네이버 `totalPaymentAmount`가 주문 총액이다:

```typescript
      records.push({
        product_cost_id: productCostId,
        sold_at: soldAt,
        quantity: order.quantity,
        selling_price: unitPrice,
        sale_amount: order.totalPaymentAmount,
        naver_order_id: `naver-${order.productOrderId}`,
      });
```

- [ ] **Step 2: bulk INSERT를 8컬럼으로 확장**

`:80-96` 블록을 교체:

```typescript
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const shippingFee = resolveSaleShippingFee('naver');
      const placeholders = chunk.map((rec, idx) => {
        const base = idx * 8;
        values.push(user.userId, rec.product_cost_id, rec.sold_at, rec.quantity, rec.selling_price, rec.sale_amount, rec.naver_order_id, shippingFee);
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},'naver',$${base + 7},$${base + 8})`;
      });
      const r = await pool.query(
        `INSERT INTO sale_records
           (user_id, product_cost_id, sold_at, quantity, selling_price, sale_amount, channel, coupang_order_item_id, shipping_fee)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (coupang_order_item_id) DO NOTHING`,
        values,
      );
      imported += r.rowCount ?? 0;
    }
```

`CHUNK`이 파일 상단(`:79 const CHUNK = 200`)에서 선언돼 있다. 8 params × 200 = 1600으로 안전 범위이나 일관성을 위해 그대로 둔다.

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음. (records 타입은 Step 0에서 확장됨.)

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/cost-management/naver-bulk-import/route.ts
git commit -m "feat(import): 네이버 일괄 임포트에 sale_amount 저장"
```

---

### Task 8: 수동 판매 라우트 — sale_amount = selling_price × quantity + UI 단위 명시

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/sales/route.ts:119-124` (INSERT)
- Modify: `src/components/orders/SaleEntryPanel.tsx:366` (헤더)
- Test: `src/__tests__/api/cost-management-sales-sale-amount.test.ts` (신규)

수동 입력은 옵션ID를 특정하지 않아 multiplier를 알 수 없다. 규약: **판매가 = 단품 1개 가격, 수량 = 단품 개수**, 따라서 `sale_amount = selling_price × quantity`.

- [ ] **Step 1: 실패하는 라우트 테스트 작성**

Create `src/__tests__/api/cost-management-sales-sale-amount.test.ts`:

```typescript
/**
 * POST /api/cost-management/products/[id]/sales — sale_amount 저장 검증
 * 수동 입력 규약: sale_amount = selling_price × quantity (단품 축)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function makeRequest(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/cost-management/products/${id}/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST sales — sale_amount', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'u1', email: 't@e.com' });
    mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'prod-1' }] })      // 소유 확인
      .mockResolvedValueOnce({ rows: [{ id: 'sale-1' }] });     // INSERT RETURNING
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('sale_amount = selling_price × quantity 로 INSERT 파라미터에 포함', async () => {
    const { POST } = await import('@/app/api/cost-management/products/[id]/sales/route');
    const res = await POST(
      makeRequest('prod-1', { sold_at: '2026-07-10', quantity: 3, selling_price: 10000, channel: 'manual' }),
      { params: Promise.resolve({ id: 'prod-1' }) },
    );
    expect(res.status).toBe(201);
    // 두 번째 쿼리(INSERT)의 파라미터 배열에 sale_amount=30000 포함
    const insertCall = mockQuery.mock.calls[1];
    const sql = insertCall[0] as string;
    const params = insertCall[1] as unknown[];
    expect(sql).toContain('sale_amount');
    expect(params).toContain(30000);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/api/cost-management-sales-sale-amount.test.ts`
Expected: FAIL — 현재 INSERT에 `sale_amount` 컬럼·값이 없다.

- [ ] **Step 3: 라우트 INSERT 수정**

`src/app/api/cost-management/products/[id]/sales/route.ts:119-124`를 교체:

```typescript
    const { rows } = await pool.query(
      `INSERT INTO sale_records (user_id, product_cost_id, sold_at, quantity, selling_price, sale_amount, channel, shipping_fee, coupon_discount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [user.userId, id, sold_at, quantity, selling_price, selling_price * quantity, saleChannel, shipping_fee, couponDiscount],
    );
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/api/cost-management-sales-sale-amount.test.ts`
Expected: PASS

- [ ] **Step 5: SaleEntryPanel 헤더에 단위 명시**

`src/components/orders/SaleEntryPanel.tsx:366`의 헤더 배열에서 `'판매가'`를 `'판매가(단품)'`로 바꾼다:

```typescript
              {['판매일', '수량', '판매가(단품)', '쿠폰할인', '채널', '사이즈', '택배비', ''].map((h, i) => (
```

- [ ] **Step 6: 컴포넌트 테스트 회귀 확인 + 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

Run: `npx vitest run src/__tests__/components/cost-table-product-row.test.tsx`
Expected: PASS (헤더 문자열 변경이 이 스위트를 깨지 않음)

- [ ] **Step 7: 커밋**

```bash
git add "src/app/api/cost-management/products/[id]/sales/route.ts" src/components/orders/SaleEntryPanel.tsx src/__tests__/api/cost-management-sales-sale-amount.test.ts
git commit -m "feat(sales): 수동 판매에 sale_amount 저장 + 판매가 단위 명시"
```

---

### Task 9: 최종 검증

- [ ] **Step 1: 관련 테스트 전체 실행**

Run: `npx vitest run src/lib/cost-management/__tests__ src/__tests__/api/cost-management-sales-sale-amount.test.ts src/__tests__/api/cost-management-hidden.test.ts src/__tests__/api/product-cost-channels-crud.test.ts`
Expected: 전부 PASS

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: sale_records write 경로 누락 확인**

Run: `grep -rn "INSERT INTO sale_records" src/app/api`
Expected: 반환된 모든 INSERT가 컬럼 목록에 `sale_amount`를 포함한다(6곳: wing-bulk, rg-bulk, coupang-import, naver-bulk, sales, 그리고 sales/[id] PATCH가 있다면 확인). PATCH 경로(`sales/[id]/route.ts`)가 `selling_price`/`quantity`를 수정하면서 `sale_amount`를 갱신하지 않으면 후속 이슈로 기록한다 — 이 계획 범위는 신규 판매 기록의 매출 정합성이며, 기존 행 수정 시 재계산은 §9 후속.

- [ ] **Step 4: 최종 커밋 (남은 변경 있을 시)**

```bash
git status
```

---

## Self-Review 결과 (작성자 기록)

- **스펙 커버리지:** 컬럼 추가+백필(§3→T1), fifo 총액 재구성+쿠폰 해소(§5.2→T2), products 읽기(§5.1→T3), 6개 쓰기 경로(§4→T4~T8), 수동 입력 규약(§7→T8), 배포 순서(§6→마이그→쓰기→읽기 태스크 순서로 반영), 회귀 테스트 선작성(§8→T2/T8). 모두 태스크에 대응됨.
- **PATCH 경로(`sales/[id]/route.ts`):** 스펙 §9의 "기존 행 수정 시 재계산"은 범위 밖. T9 Step 3에서 명시적으로 후속 이슈로 남기도록 처리 — 은닉 캡 방지.
- **타입 일관성:** `sale_amount`는 DB `int`, `fifo.ts`에서 `number | null | undefined`(폴백 `??`), 라우트 매핑에서 `null` 정규화. 임포트 record는 항상 `number`를 넣음. 일관됨.
- **배포 순서 안전성:** 폴백 `sale_amount ?? selling_price*quantity`가 T3(읽기)에 들어가므로, T1 이후 T4~T8 중 어디까지만 배포돼도 매출이 정확. T3를 T4~T8보다 먼저 배포해도 안전(폴백).
