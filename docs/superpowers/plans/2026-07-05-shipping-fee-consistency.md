# 배송비 불일치 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단건·일괄 임포트가 동일한 배송비 규칙을 쓰게 하고, FIFO 실현손익에서 택배비를 sale_record 1건당 한 번만 차감하도록 바로잡는다.

**Architecture:** 배송비 규칙을 공용 모듈(`sale-shipping.ts`)로 뽑아 6개 임포트 경로가 참조한다. FIFO 엔진은 `SaleFifoDetail`에 per-sale `realized_profit`(건당 배송비 반영)를 추가하고, 유일한 손익 재합산 소비처(`products/route.ts`)를 그 필드로 교체한다.

**Tech Stack:** Next.js 16, TypeScript, Vitest, PostgreSQL (pg).

**설계 문서:** `docs/superpowers/specs/2026-07-05-shipping-fee-consistency-design.md`

---

## File Structure

- **Create** `src/lib/cost-management/sale-shipping.ts` — 상수 `DEFAULT_PARCEL_SHIPPING_FEE` + `resolveSaleShippingFee(source)`.
- **Modify** `src/lib/cost-management/fifo.ts` — `SaleFifoDetail`에 `realized_profit` 추가, 배송비 건당 차감.
- **Modify** `src/app/api/cost-management/products/route.ts` — 손익 합산을 `d.realized_profit`로.
- **Modify** `src/app/api/cost-management/products/[id]/coupang-import/route.ts` — 배송비 3곳을 helper로.
- **Modify** `src/app/api/cost-management/wing-bulk-import/route.ts` / `rg-bulk-import/route.ts` / `naver-bulk-import/route.ts` — INSERT에 `shipping_fee` 추가.
- **Create/Modify** tests: `sale-shipping` 단위 테스트, `fifo.test.ts` 건당 케이스 추가.

> **테스트 실행 주의:** 인자 없는 `npx vitest run`은 `node_modules.nosync` 라이브러리 테스트까지 돌려 대량 선재 실패한다. **항상 파일 경로를 지정**해 실행한다.

---

## Task 1: 공용 배송비 모듈 `sale-shipping.ts`

**Files:**
- Create: `src/lib/cost-management/sale-shipping.ts`
- Test: `src/__tests__/lib/sale-shipping.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/__tests__/lib/sale-shipping.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { resolveSaleShippingFee, DEFAULT_PARCEL_SHIPPING_FEE } from '@/lib/cost-management/sale-shipping';

describe('resolveSaleShippingFee', () => {
  it('윙은 기본 택배비', () => {
    expect(resolveSaleShippingFee('wing')).toBe(DEFAULT_PARCEL_SHIPPING_FEE);
    expect(DEFAULT_PARCEL_SHIPPING_FEE).toBe(3500);
  });
  it('네이버는 기본 택배비', () => {
    expect(resolveSaleShippingFee('naver')).toBe(3500);
  });
  it('RG는 0 (unit_rg_shipping_fee로 별도 반영)', () => {
    expect(resolveSaleShippingFee('rg')).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/__tests__/lib/sale-shipping.test.ts` → FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `src/lib/cost-management/sale-shipping.ts`

```ts
/** 판매자 택배 기본 배송비 (원). 윙·네이버 판매자배송 주문 1건당 차감. */
export const DEFAULT_PARCEL_SHIPPING_FEE = 3500;

/** 배송비 산정 대상 임포트 소스 */
export type ShippingSource = 'wing' | 'rg' | 'naver';

/**
 * 임포트 소스별 건당 배송비.
 * 윙·네이버(판매자 택배) = 기본 택배비, RG(로켓그로스) = 0 (unit_rg_shipping_fee로 별도 반영).
 */
export function resolveSaleShippingFee(source: ShippingSource): number {
  return source === 'rg' ? 0 : DEFAULT_PARCEL_SHIPPING_FEE;
}
```

- [ ] **Step 4: 테스트 통과 확인** — Run: `npx vitest run src/__tests__/lib/sale-shipping.test.ts` → PASS (3 passed).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/cost-management/sale-shipping.ts src/__tests__/lib/sale-shipping.test.ts
git commit -m "feat(cost-management): 공용 배송비 규칙 sale-shipping 모듈"
```

---

## Task 2: FIFO 건당 배송비 + 소비처 교체

**Files:**
- Modify: `src/lib/cost-management/fifo.ts`
- Modify: `src/app/api/cost-management/products/route.ts`
- Test: `src/lib/cost-management/__tests__/fifo.test.ts`

배경: 현재 `fifo.ts:127-142`가 배송비를 개당 차감(`shipping_fee_per_unit`)한 뒤 `× quantity`한다. 기존 fifo 테스트의 판매 객체엔 `shipping_fee`가 없어(=0) 이 변경으로 기존 케이스 결과는 안 바뀐다 — 새 케이스만 추가한다. 유일한 손익 재합산 소비처는 `products/route.ts:212-214`.

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/cost-management/__tests__/fifo.test.ts`의 `describe('calculateFifo', ...)` 블록 안에 케이스 추가:

```ts
  it('택배비는 건당 1회만 차감 (수량 2개 × 배송비 3500 → 3500 한 번)', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 2, selling_price: 20000, shipping_fee: 3500 },
    ];
    const result = calculateFifo(batches, sales, 0.1);
    // per-unit(배송 제외): 20000 - 10000 - round(20000*0.1)=2000 = 8000
    expect(result.sale_details[0].realized_profit_per_unit).toBe(8000);
    // 건당: 8000*2 - 3500 = 12500  (개당 차감이었다면 (8000-3500)*2 = 9000)
    expect(result.sale_details[0].realized_profit).toBe(12500);
    expect(result.total_realized_profit).toBe(12500);
  });

  it('배송비 없는 판매는 realized_profit = per_unit × quantity', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 10, selling_price: 20000 },
    ];
    const result = calculateFifo(batches, sales, 0.1);
    expect(result.sale_details[0].realized_profit).toBe(80000);
    expect(result.total_realized_profit).toBe(80000);
  });
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npx vitest run src/lib/cost-management/__tests__/fifo.test.ts` → FAIL (`realized_profit` 미정의 / undefined).

- [ ] **Step 3: `SaleFifoDetail` 필드 추가** — `fifo.ts`의 인터페이스에 `realized_profit` 추가:

```ts
export interface SaleFifoDetail {
  saleId: string;
  /** FIFO 적용 단위 원가 (배송비 포함, 반올림) */
  fifo_cost_per_unit: number;
  /** 단위 실현손익 (택배비 제외, per-unit) */
  realized_profit_per_unit: number;
  /** 이 판매 건의 실현손익 총액 (건당 택배비 1회 반영) */
  realized_profit: number;
}
```

- [ ] **Step 4: 계산 루프 교체** — `fifo.ts:133-142`의 택배비/실현손익 부분을 교체:

현재:
```ts
    // 택배비: 건당 고정 (없으면 0)
    const shipping_fee_per_unit = sale.shipping_fee ?? 0;

    // 단위 실현손익
    const realized_profit_per_unit =
      effective_price - fifo_cost_per_unit - fee_per_unit - shipping_fee_per_unit;

    sale_details.push({ saleId: sale.id, fifo_cost_per_unit, realized_profit_per_unit });
    total_realized_profit += realized_profit_per_unit * sale.quantity;
```
교체:
```ts
    // 단위 실현손익 (택배비 제외)
    const realized_profit_per_unit =
      effective_price - fifo_cost_per_unit - fee_per_unit;

    // 건당 택배비는 판매 1건당 한 번만 차감 (없으면 0)
    const shipping_fee = sale.shipping_fee ?? 0;
    const realized_profit = realized_profit_per_unit * sale.quantity - shipping_fee;

    sale_details.push({ saleId: sale.id, fifo_cost_per_unit, realized_profit_per_unit, realized_profit });
    total_realized_profit += realized_profit;
```

- [ ] **Step 5: fifo 테스트 통과 확인** — Run: `npx vitest run src/lib/cost-management/__tests__/fifo.test.ts` → PASS (기존 + 신규 2건 모두).

- [ ] **Step 6: 소비처 교체** — `products/route.ts:212-214`. 현재:
```ts
      const periodRealizedProfit = fifoResult.sale_details
        .filter((d) => periodSaleIds.has(d.saleId))
        .reduce((sum, d) => sum + d.realized_profit_per_unit * (pSalesById.get(d.saleId)?.quantity ?? 0), 0);
```
교체(건당 배송비 반영된 per-sale `realized_profit` 합):
```ts
      const periodRealizedProfit = fifoResult.sale_details
        .filter((d) => periodSaleIds.has(d.saleId))
        .reduce((sum, d) => sum + d.realized_profit, 0);
```

- [ ] **Step 7: 타입/빌드 확인** — Run: `npx tsc --noEmit`
  Expected: 신규 에러 없음(무관한 기존 `ImageLabel3x3Editor.tsx` 에러 제외). `pSalesById`가 이 블록에서 더 이상 안 쓰이면 미사용 경고가 날 수 있으니 확인 — 다른 곳(예: `:214` 외)에서 쓰면 유지, 안 쓰면 그 선언도 제거.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/cost-management/fifo.ts src/lib/cost-management/__tests__/fifo.test.ts src/app/api/cost-management/products/route.ts
git commit -m "fix(cost-management): FIFO 택배비를 건당 1회 차감 + realized_profit 필드"
```

---

## Task 3: 단건 임포트 배송비를 helper로

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/coupang-import/route.ts`

값은 동일(3500/0/3500)하고 규칙만 `resolveSaleShippingFee`로 일원화한다. 이 파일은 라우트라 격리 단위 테스트가 어려워 `tsc` + 로직 검증으로 확인.

- [ ] **Step 1: import 추가** — 파일 상단 import 블록에:
```ts
import { resolveSaleShippingFee } from '@/lib/cost-management/sale-shipping';
```

- [ ] **Step 2: Phase1 윙 배송비 교체** — `:192` `shipping_fee: 3500,` → `shipping_fee: resolveSaleShippingFee('wing'),`

- [ ] **Step 3: Phase2 RG 배송비 교체** — RG 매핑 객체(`channel: 'rocket_growth'` 근처, `:277` `shipping_fee: 0,`) → `shipping_fee: resolveSaleShippingFee('rg'),`

- [ ] **Step 4: Phase3 네이버 배송비 교체** — `:321` `shipping_fee: 3500,` → `shipping_fee: resolveSaleShippingFee('naver'),`

- [ ] **Step 5: 타입 확인** — Run: `npx tsc --noEmit` → 신규 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/cost-management/products/[id]/coupang-import/route.ts
git commit -m "refactor(cost-management): 단건 임포트 배송비를 공용 규칙으로 일원화"
```

---

## Task 4: 일괄 임포트 INSERT에 배송비 추가

**Files:**
- Modify: `src/app/api/cost-management/wing-bulk-import/route.ts`
- Modify: `src/app/api/cost-management/rg-bulk-import/route.ts`
- Modify: `src/app/api/cost-management/naver-bulk-import/route.ts`

세 라우트 모두 현재 INSERT에 `shipping_fee`가 없어 0으로 저장된다. `resolveSaleShippingFee`로 값을 넣는다. 라우트 파일 상단에 각각 `import { resolveSaleShippingFee } from '@/lib/cost-management/sale-shipping';` 추가.

- [ ] **Step 1: wing-bulk INSERT 수정** — `wing-bulk-import/route.ts`의 chunk 루프(현재 `base = idx * 6`, 컬럼 `(user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id)`, placeholder `($base+1..$base+5,'coupang',$base+6)`)를 배송비 파라미터를 더해 수정:

```ts
        const chunk = records.slice(i, i + CHUNK);
        const values: unknown[] = [];
        const shippingFee = resolveSaleShippingFee('wing');
        const placeholders = chunk.map((rec, idx) => {
          const base = idx * 7;
          values.push(user.userId, rec.product_cost_id, rec.sold_at, rec.quantity, rec.selling_price, rec.coupang_order_item_id, shippingFee);
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},'coupang',$${base + 6},$${base + 7})`;
        });
        const result = await pool.query(
          `INSERT INTO sale_records
             (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id, shipping_fee)
           VALUES ${placeholders.join(',')}
           ON CONFLICT (coupang_order_item_id) DO NOTHING`,
          values,
        );
        imported += result.rowCount ?? 0;
```
(CHUNK 주석의 "6 params" → "7 params" 표현도 맞춰 갱신. 7 × 200 = 1400.)

- [ ] **Step 2: rg-bulk INSERT 수정** — `rg-bulk-import/route.ts`의 단건 INSERT 루프:

```ts
      const result = await pool.query(
        `INSERT INTO sale_records
           (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id, shipping_fee)
         VALUES ($1, $2, $3, $4, $5, 'rocket_growth', $6, $7)
         ON CONFLICT (coupang_order_item_id) DO NOTHING`,
        [user.userId, item.product_cost_id, item.sold_at, item.quantity, item.selling_price, item.coupang_order_item_id, resolveSaleShippingFee('rg')],
      );
```

- [ ] **Step 3: naver-bulk INSERT 수정** — `naver-bulk-import/route.ts`의 chunk 루프:

```ts
      const chunk = records.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const shippingFee = resolveSaleShippingFee('naver');
      const placeholders = chunk.map((rec, idx) => {
        const base = idx * 7;
        values.push(user.userId, rec.product_cost_id, rec.sold_at, rec.quantity, rec.selling_price, rec.naver_order_id, shippingFee);
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},'naver',$${base + 6},$${base + 7})`;
      });
      const r = await pool.query(
        `INSERT INTO sale_records
           (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id, shipping_fee)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (coupang_order_item_id) DO NOTHING`,
        values,
      );
      imported += r.rowCount ?? 0;
```

- [ ] **Step 4: 타입 확인** — Run: `npx tsc --noEmit` → 신규 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/cost-management/wing-bulk-import/route.ts src/app/api/cost-management/rg-bulk-import/route.ts src/app/api/cost-management/naver-bulk-import/route.ts
git commit -m "fix(cost-management): 일괄 임포트 INSERT에 배송비 추가 — 단건과 통일"
```

---

## Task 5: 전체 검증

- [ ] **Step 1: 관련 테스트 전체 실행**

Run:
`npx vitest run src/__tests__/lib/sale-shipping.test.ts src/lib/cost-management/__tests__/fifo.test.ts src/__tests__/lib/cost-management-calculations.test.ts`
Expected: 전부 PASS.

- [ ] **Step 2: 타입 확인** — Run: `npx tsc --noEmit`
  Expected: 신규 에러 없음(무관한 `ImageLabel3x3Editor.tsx` 에러만).

- [ ] **Step 3: 수동 검증(선택) — dev 서버**
  같은 상품을 일괄 "판매 가져오기"로 임포트한 뒤, 상세 패널의 배송비/실현손익이 단건 임포트와 동일하게 나오는지, 수량 2개 이상 주문의 배송비가 3,500(개당 아님)으로 반영되는지 확인. (실 API 데이터 필요 시 생략 가능 — 로직은 단위 테스트로 커버됨.)

---

## Self-Review 노트

- **스펙 커버리지:** 공용 규칙(§2)=Task 1, 임포트 6경로 통일(§3)=Task 3·4, FIFO 건당(§4)=Task 2, 소비처(§5)=Task 2 Step 6, 테스트(§7)=각 Task. 범위 밖(§6: 쿠폰·설정 UI·취소반품·과거 소급)은 태스크 없음(의도).
- **타입 일관성:** `SaleFifoDetail.realized_profit`(Task 2 정의 → route.ts Task 2 Step 6 소비), `resolveSaleShippingFee(source)`(Task 1 → Task 3·4), `ShippingSource` 리터럴 'wing'|'rg'|'naver' 일관.
- **INSERT 인덱스:** bulk 3종 모두 `base = idx * 6 → 7`, 컬럼·플레이스홀더·values 동시 수정(Task 4).
- **기존 fifo 테스트:** 판매에 shipping_fee 없어 결과 불변 — 회귀 아님. 신규 케이스만 추가.
