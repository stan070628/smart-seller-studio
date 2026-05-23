# 소분 판매 원가 자동 계산 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소분 판매 상품 입고 시 사입 총량·소분 갯수를 입력하면 팩당 원가와 이월 잔여 수량을 자동 계산한다.

**Architecture:** product_costs 에 소분 기본 설정·이월 상태 컬럼을 추가하고, 순수 계산 로직을 `src/lib/cost-management/subdivision.ts` 에 분리한다. entries POST API 가 소분 모드를 감지해 계산 후 저장하고 carryover 를 갱신한다. CostEntryDrawer 는 소분 상품이면 전용 폼·미리보기를 렌더링한다.

**Tech Stack:** Next.js App Router API Routes, PostgreSQL (pg pool), React, TypeScript, Vitest

---

## 파일 변경 목록

| 파일 | 작업 |
|---|---|
| `supabase/migrations/069_subdivision.sql` | NEW — DB 컬럼 추가 |
| `src/lib/cost-management/subdivision.ts` | NEW — 순수 계산 함수 |
| `src/lib/cost-management/__tests__/subdivision.test.ts` | NEW — 계산 함수 단위 테스트 |
| `src/app/api/cost-management/products/route.ts` | MODIFY — GET 응답에 subdivision 필드 포함, POST 에 subdivision_unit 수용 |
| `src/app/api/cost-management/products/[id]/entries/route.ts` | MODIFY — GET meta 에 carryover 포함, POST 소분 모드 처리 |
| `src/app/api/cost-management/entries/[id]/route.ts` | MODIFY — PATCH 소분 건 경고 |
| `src/components/orders/AddProductModal.tsx` | MODIFY — 소분 갯수 필드 추가 |
| `src/components/orders/CostManagementTab.tsx` | MODIFY — subdivisionUnit prop 전달 |
| `src/components/orders/CostEntryDrawer.tsx` | MODIFY — 소분 폼·미리보기 렌더링 |

---

## Task 1: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/069_subdivision.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 069_subdivision.sql
-- product_costs: 소분 기본 설정 + 이월 상태
ALTER TABLE product_costs
  ADD COLUMN IF NOT EXISTS subdivision_unit               INT,
  ADD COLUMN IF NOT EXISTS subdivision_carryover          INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subdivision_carryover_unit_cost INT NOT NULL DEFAULT 0;

-- cost_entries: 소분 입고 원본 정보 보존
ALTER TABLE cost_entries
  ADD COLUMN IF NOT EXISTS purchase_quantity INT,
  ADD COLUMN IF NOT EXISTS subdivision_unit  INT;

COMMENT ON COLUMN product_costs.subdivision_unit IS '기본 소분 갯수. null = 소분 없음';
COMMENT ON COLUMN product_costs.subdivision_carryover IS '이월 잔여 수량';
COMMENT ON COLUMN product_costs.subdivision_carryover_unit_cost IS '이월 개당 원가(원)';
COMMENT ON COLUMN cost_entries.purchase_quantity IS '사입 총량. null = 소분 없음';
COMMENT ON COLUMN cost_entries.subdivision_unit IS '이 건의 소분 갯수';
```

- [ ] **Step 2: 마이그레이션 적용**

```bash
# Supabase 연결된 프로젝트에 직접 적용 (로컬 DB 사용 시)
psql $DATABASE_URL -f supabase/migrations/069_subdivision.sql
```

성공 시 오류 없이 종료됨. `ALTER TABLE` 완료 메시지 확인.

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/069_subdivision.sql
git commit -m "feat(db): subdivision 컬럼 추가 (product_costs + cost_entries)"
```

---

## Task 2: 소분 계산 라이브러리 (TDD)

**Files:**
- Create: `src/lib/cost-management/subdivision.ts`
- Create: `src/lib/cost-management/__tests__/subdivision.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/cost-management/__tests__/subdivision.test.ts` 생성:

```typescript
import { describe, it, expect } from 'vitest';
import { calculateSubdivision } from '@/lib/cost-management/subdivision';

describe('calculateSubdivision', () => {
  it('이월 없는 첫 입고 — 3팩 + 6개 이월', () => {
    const result = calculateSubdivision({
      purchaseQuantity: 36,
      totalPurchaseCost: 21490,
      subdivisionUnit: 10,
      carryoverQuantity: 0,
      carryoverUnitCost: 0,
    });
    expect(result.sellablePacks).toBe(3);
    expect(result.newCarryoverQuantity).toBe(6);
    expect(result.totalAvailable).toBe(36);
    expect(result.packUnitCost).toBe(5970); // round(21490/36*10)
    expect(result.newCarryoverUnitCost).toBe(597); // round(21490/36)
  });

  it('이월 6개 + 신규 36개 — 4팩 + 2개 이월', () => {
    const result = calculateSubdivision({
      purchaseQuantity: 36,
      totalPurchaseCost: 21490,
      subdivisionUnit: 10,
      carryoverQuantity: 6,
      carryoverUnitCost: 597,
    });
    expect(result.sellablePacks).toBe(4);
    expect(result.newCarryoverQuantity).toBe(2);
    expect(result.totalAvailable).toBe(42);
    // (6*597 + 21490) / 42 * 10 = 25072/42*10 ≈ 5969
    expect(result.packUnitCost).toBe(5969);
    expect(result.newCarryoverUnitCost).toBe(597);
  });

  it('나머지 없음 — 30개, 10개 소분 → 3팩, 0 이월', () => {
    const result = calculateSubdivision({
      purchaseQuantity: 30,
      totalPurchaseCost: 18000,
      subdivisionUnit: 10,
      carryoverQuantity: 0,
      carryoverUnitCost: 0,
    });
    expect(result.sellablePacks).toBe(3);
    expect(result.newCarryoverQuantity).toBe(0);
    expect(result.packUnitCost).toBe(6000);
  });

  it('사입 수량이 소분 갯수보다 작음 — 0팩, 전량 이월', () => {
    const result = calculateSubdivision({
      purchaseQuantity: 5,
      totalPurchaseCost: 3000,
      subdivisionUnit: 10,
      carryoverQuantity: 0,
      carryoverUnitCost: 0,
    });
    expect(result.sellablePacks).toBe(0);
    expect(result.newCarryoverQuantity).toBe(5);
    expect(result.packUnitCost).toBe(0);
  });

  it('이월만으로 팩 완성 — 이월 12개, 소분 10개 → 1팩 + 2개 이월', () => {
    const result = calculateSubdivision({
      purchaseQuantity: 0,
      totalPurchaseCost: 0,
      subdivisionUnit: 10,
      carryoverQuantity: 12,
      carryoverUnitCost: 600,
    });
    expect(result.sellablePacks).toBe(1);
    expect(result.newCarryoverQuantity).toBe(2);
    expect(result.packUnitCost).toBe(6000); // 600*10
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/lib/cost-management/__tests__/subdivision.test.ts
```

Expected: `Cannot find module '@/lib/cost-management/subdivision'` 오류로 FAIL.

- [ ] **Step 3: 계산 함수 구현**

`src/lib/cost-management/subdivision.ts` 생성:

```typescript
export interface SubdivisionInput {
  purchaseQuantity: number;
  totalPurchaseCost: number;
  subdivisionUnit: number;
  carryoverQuantity: number;
  carryoverUnitCost: number;
}

export interface SubdivisionResult {
  sellablePacks: number;
  packUnitCost: number;
  newCarryoverQuantity: number;
  newCarryoverUnitCost: number;
  totalAvailable: number;
  perItemCost: number;
}

export function calculateSubdivision(input: SubdivisionInput): SubdivisionResult {
  const { purchaseQuantity, totalPurchaseCost, subdivisionUnit, carryoverQuantity, carryoverUnitCost } = input;

  const totalAvailable = carryoverQuantity + purchaseQuantity;
  if (totalAvailable === 0 || subdivisionUnit <= 0) {
    return { sellablePacks: 0, packUnitCost: 0, newCarryoverQuantity: 0, newCarryoverUnitCost: 0, totalAvailable: 0, perItemCost: 0 };
  }

  const sellablePacks = Math.floor(totalAvailable / subdivisionUnit);
  const newCarryoverQuantity = totalAvailable % subdivisionUnit;

  const carryoverTotalCost = carryoverQuantity * carryoverUnitCost;
  const combinedTotalCost = carryoverTotalCost + totalPurchaseCost;
  const combinedPerItemCost = combinedTotalCost / totalAvailable;

  const packUnitCost = sellablePacks > 0 ? Math.round(combinedPerItemCost * subdivisionUnit) : 0;
  const newCarryoverUnitCost = Math.round(combinedPerItemCost);
  const perItemCost = purchaseQuantity > 0 ? Math.round(totalPurchaseCost / purchaseQuantity) : 0;

  return { sellablePacks, packUnitCost, newCarryoverQuantity, newCarryoverUnitCost, totalAvailable, perItemCost };
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/lib/cost-management/__tests__/subdivision.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/cost-management/subdivision.ts src/lib/cost-management/__tests__/subdivision.test.ts
git commit -m "feat(cost): 소분 원가 계산 함수 추가 (TDD)"
```

---

## Task 3: GET /products API — subdivision 필드 포함

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`

- [ ] **Step 1: GET 쿼리 및 응답에 subdivision 필드 추가**

`src/app/api/cost-management/products/route.ts` 의 GET 핸들러에서 products 쿼리를 수정한다.

찾는 코드 (line 31-37):
```typescript
    const { rows: products } = await pool.query(
      `SELECT id, product_name, seller_product_id, vendor_item_id, platform, platform_fee_rate, created_at
       FROM product_costs
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user.userId],
    );
```

교체:
```typescript
    const { rows: products } = await pool.query(
      `SELECT id, product_name, seller_product_id, vendor_item_id, platform, platform_fee_rate,
              subdivision_unit, subdivision_carryover, subdivision_carryover_unit_cost, created_at
       FROM product_costs
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user.userId],
    );
```

그리고 `data` 배열의 각 항목 return 객체 (line 189 근처)에 세 필드 추가:

찾는 코드:
```typescript
      return {
        id: p.id,
        product_name: p.product_name,
        seller_product_id: p.seller_product_id,
        vendor_item_id: p.vendor_item_id,
        platform: p.platform,
        platform_fee_rate: feeRate,
```

교체:
```typescript
      return {
        id: p.id,
        product_name: p.product_name,
        seller_product_id: p.seller_product_id,
        vendor_item_id: p.vendor_item_id,
        platform: p.platform,
        platform_fee_rate: feeRate,
        subdivision_unit: p.subdivision_unit ? Number(p.subdivision_unit) : null,
        subdivision_carryover: Number(p.subdivision_carryover ?? 0),
        subdivision_carryover_unit_cost: Number(p.subdivision_carryover_unit_cost ?? 0),
```

- [ ] **Step 2: TypeScript 빌드 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/products/route.ts
git commit -m "feat(api): products GET 응답에 subdivision 필드 포함"
```

---

## Task 4: POST /products API — subdivision_unit 수용

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`

- [ ] **Step 1: POST 핸들러에 subdivision_unit 파라미터 추가**

`POST` 핸들러에서 body 구조 분해 라인을 찾는다 (line 241):

```typescript
    const { product_name, seller_product_id, vendor_item_id, platform_fee_rate } = body ?? {};
```

교체:
```typescript
    const { product_name, seller_product_id, vendor_item_id, platform_fee_rate, subdivision_unit } = body ?? {};
```

그리고 `subdivision_unit` 유효성 검사를 추가한다. `vendor_item_id` 검사 블록 바로 아래에 추가:

```typescript
    if (subdivision_unit !== undefined && subdivision_unit !== null) {
      if (!Number.isInteger(subdivision_unit) || subdivision_unit < 2) {
        return NextResponse.json(
          { success: false, error: 'subdivision_unit must be an integer >= 2' },
          { status: 400 },
        );
      }
    }
```

그리고 INSERT 쿼리를 수정한다:

찾는 코드:
```typescript
    const { rows } = await pool.query(
      `INSERT INTO product_costs (user_id, product_name, seller_product_id, vendor_item_id, platform_fee_rate)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, product_name, seller_product_id, vendor_item_id, platform, platform_fee_rate, current_stock, created_at`,
      [
        user.userId,
        product_name.trim(),
        seller_product_id ?? null,
        vendor_item_id ?? null,
        platform_fee_rate ?? 0.108,
      ],
    );
```

교체:
```typescript
    const { rows } = await pool.query(
      `INSERT INTO product_costs (user_id, product_name, seller_product_id, vendor_item_id, platform_fee_rate, subdivision_unit)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, product_name, seller_product_id, vendor_item_id, platform, platform_fee_rate,
                 subdivision_unit, subdivision_carryover, subdivision_carryover_unit_cost, current_stock, created_at`,
      [
        user.userId,
        product_name.trim(),
        seller_product_id ?? null,
        vendor_item_id ?? null,
        platform_fee_rate ?? 0.108,
        subdivision_unit ?? null,
      ],
    );
```

- [ ] **Step 2: TypeScript 빌드 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/products/route.ts
git commit -m "feat(api): products POST에 subdivision_unit 수용"
```

---

## Task 5: GET /entries API — meta에 carryover 포함

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/entries/route.ts`

- [ ] **Step 1: GET 응답에 product subdivision 메타 추가**

`GET` 핸들러에서 product 조회를 확장하고 meta 를 반환한다.

찾는 코드:
```typescript
    const { rows: check } = await pool.query(
      `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
```

교체:
```typescript
    const { rows: check } = await pool.query(
      `SELECT id, subdivision_unit, subdivision_carryover, subdivision_carryover_unit_cost
       FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const product = check[0];
```

그리고 SELECT 쿼리에 `purchase_quantity`, `subdivision_unit` 컬럼을 추가한다:

찾는 코드:
```typescript
    const { rows } = await pool.query(
      `SELECT ce.id, ce.received_at, ce.quantity, ce.unit_cost, ce.unit_shipping_fee,
              ce.unit_rg_shipping_fee,
              ce.shipping_group_id, sg.name as shipping_group_name, ce.created_at
       FROM cost_entries ce
       LEFT JOIN shipping_groups sg ON sg.id = ce.shipping_group_id
       WHERE ce.product_cost_id = $1
       ORDER BY ce.received_at DESC, ce.created_at DESC`,
      [id],
    );

    return NextResponse.json({ success: true, data: rows });
```

교체:
```typescript
    const { rows } = await pool.query(
      `SELECT ce.id, ce.received_at, ce.quantity, ce.unit_cost, ce.unit_shipping_fee,
              ce.unit_rg_shipping_fee, ce.purchase_quantity, ce.subdivision_unit,
              ce.shipping_group_id, sg.name as shipping_group_name, ce.created_at
       FROM cost_entries ce
       LEFT JOIN shipping_groups sg ON sg.id = ce.shipping_group_id
       WHERE ce.product_cost_id = $1
       ORDER BY ce.received_at DESC, ce.created_at DESC`,
      [id],
    );

    return NextResponse.json({
      success: true,
      data: rows,
      meta: {
        subdivision_unit: product.subdivision_unit ? Number(product.subdivision_unit) : null,
        subdivision_carryover: Number(product.subdivision_carryover ?? 0),
        subdivision_carryover_unit_cost: Number(product.subdivision_carryover_unit_cost ?? 0),
      },
    });
```

- [ ] **Step 2: TypeScript 빌드 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/products/\[id\]/entries/route.ts
git commit -m "feat(api): entries GET meta에 subdivision carryover 포함"
```

---

## Task 6: POST /entries API — 소분 모드 처리

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/entries/route.ts`

- [ ] **Step 1: 소분 모드 POST 로직 구현**

파일 상단 import 에 추가:
```typescript
import { calculateSubdivision } from '@/lib/cost-management/subdivision';
```

`POST` 핸들러에서 body 구조 분해를 변경한다:

찾는 코드:
```typescript
  const { received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, shipping_group_id, channel } = body ?? {};

  if (
    !received_at ||
    quantity == null || typeof quantity !== 'number' || quantity <= 0 ||
    unit_cost == null || !Number.isInteger(unit_cost) || unit_cost < 0
  ) {
    return NextResponse.json(
      { success: false, error: 'received_at, quantity(>0), unit_cost(>=0) required' },
      { status: 400 },
    );
  }
```

교체:
```typescript
  const { received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, shipping_group_id, channel, purchase_quantity, subdivision_unit: bodySubdivisionUnit } = body ?? {};

  const isSubdivisionMode = purchase_quantity != null && typeof purchase_quantity === 'number' && purchase_quantity > 0;

  if (!isSubdivisionMode) {
    // 일반 모드 유효성 검사
    if (
      !received_at ||
      quantity == null || typeof quantity !== 'number' || quantity <= 0 ||
      unit_cost == null || !Number.isInteger(unit_cost) || unit_cost < 0
    ) {
      return NextResponse.json(
        { success: false, error: 'received_at, quantity(>0), unit_cost(>=0) required' },
        { status: 400 },
      );
    }
  } else {
    // 소분 모드 유효성 검사
    if (
      !received_at ||
      unit_cost == null || typeof unit_cost !== 'number' || unit_cost < 0
    ) {
      return NextResponse.json(
        { success: false, error: 'received_at, unit_cost(총 구매가) required for subdivision mode' },
        { status: 400 },
      );
    }
  }
```

그리고 product 조회 후 삽입 로직을 교체한다:

찾는 코드:
```typescript
    const { rows: check } = await pool.query(
      `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const { rows } = await pool.query(
      `INSERT INTO cost_entries
         (user_id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, channel)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [user.userId, id, received_at, quantity, unit_cost, unit_shipping_fee ?? 0, unit_rg_shipping_fee ?? 0, channel ?? ENTRY_CHANNEL.WING],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
```

교체:
```typescript
    const { rows: check } = await pool.query(
      `SELECT id, subdivision_unit, subdivision_carryover, subdivision_carryover_unit_cost
       FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const product = check[0];

    let finalQuantity: number;
    let finalUnitCost: number;
    let finalPurchaseQuantity: number | null = null;
    let finalSubdivisionUnit: number | null = null;
    let carryoverOut: number | null = null;
    let newCarryoverUnitCost: number | null = null;

    if (isSubdivisionMode) {
      const subdivisionUnit = bodySubdivisionUnit ?? (product.subdivision_unit ? Number(product.subdivision_unit) : null);
      if (!subdivisionUnit || subdivisionUnit < 2) {
        return NextResponse.json(
          { success: false, error: 'subdivision_unit required (product default or body)' },
          { status: 400 },
        );
      }

      const calc = calculateSubdivision({
        purchaseQuantity: purchase_quantity,
        totalPurchaseCost: unit_cost,
        subdivisionUnit,
        carryoverQuantity: Number(product.subdivision_carryover ?? 0),
        carryoverUnitCost: Number(product.subdivision_carryover_unit_cost ?? 0),
      });

      if (calc.sellablePacks === 0) {
        return NextResponse.json(
          { success: false, error: `팩을 완성하기에 수량이 부족합니다. 현재 이월 포함 총 ${calc.totalAvailable}개, 소분 단위 ${subdivisionUnit}개` },
          { status: 400 },
        );
      }

      finalQuantity = calc.sellablePacks;
      finalUnitCost = calc.packUnitCost;
      finalPurchaseQuantity = purchase_quantity;
      finalSubdivisionUnit = subdivisionUnit;
      carryoverOut = calc.newCarryoverQuantity;
      newCarryoverUnitCost = calc.newCarryoverUnitCost;
    } else {
      finalQuantity = quantity;
      finalUnitCost = unit_cost;
    }

    const { rows } = await pool.query(
      `INSERT INTO cost_entries
         (user_id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, channel, purchase_quantity, subdivision_unit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [user.userId, id, received_at, finalQuantity, finalUnitCost, unit_shipping_fee ?? 0, unit_rg_shipping_fee ?? 0, channel ?? ENTRY_CHANNEL.WING, finalPurchaseQuantity, finalSubdivisionUnit],
    );

    if (isSubdivisionMode && carryoverOut !== null) {
      await pool.query(
        `UPDATE product_costs SET subdivision_carryover = $1, subdivision_carryover_unit_cost = $2 WHERE id = $3`,
        [carryoverOut, newCarryoverUnitCost, id],
      );
    }

    return NextResponse.json({
      success: true,
      data: rows[0],
      ...(isSubdivisionMode && { carryover_out: carryoverOut }),
    }, { status: 201 });
```

- [ ] **Step 2: TypeScript 빌드 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/products/\[id\]/entries/route.ts
git commit -m "feat(api): entries POST 소분 모드 지원 — 원가 자동 계산 + 이월 갱신"
```

---

## Task 7: PATCH /entries API — 소분 건 경고

**Files:**
- Modify: `src/app/api/cost-management/entries/[id]/route.ts`

- [ ] **Step 1: PATCH 핸들러에 소분 건 경고 추가**

`PATCH` 핸들러에서 소유권 확인 쿼리를 수정한다:

찾는 코드:
```typescript
    const { rows: check } = await pool.query(
      `SELECT id FROM cost_entries WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
```

교체:
```typescript
    const { rows: check } = await pool.query(
      `SELECT id, purchase_quantity FROM cost_entries WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    const isSubdivisionEntry = check[0].purchase_quantity != null;
```

그리고 `return NextResponse.json({ success: true, data: rows[0] });` 를 교체:

```typescript
    return NextResponse.json({
      success: true,
      data: rows[0],
      ...(isSubdivisionEntry && { warning: 'subdivision_carryover_stale' }),
    });
```

- [ ] **Step 2: TypeScript 빌드 확인**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/entries/\[id\]/route.ts
git commit -m "feat(api): 소분 입고 건 PATCH 시 carryover 경고 반환"
```

---

## Task 8: AddProductModal — 소분 갯수 필드

**Files:**
- Modify: `src/components/orders/AddProductModal.tsx`

- [ ] **Step 1: subdivisionUnit 상태 추가**

`feeRate` state 선언 바로 아래에 추가:

```typescript
  const [feeRate, setFeeRate] = useState('10.8');
  const [subdivisionUnit, setSubdivisionUnit] = useState('');  // NEW
```

- [ ] **Step 2: add() 함수에서 body에 subdivision_unit 포함**

`add()` 함수에서 각 모드의 `body` 객체에 `subdivision_unit` 을 추가한다. 세 모드(coupang, rg, manual) 모두 동일하게:

coupang 모드:
```typescript
        body = {
          product_name: selectedCoupang!.seller_product_name,
          seller_product_id: selectedCoupang!.seller_product_id,
          platform_fee_rate: Number(feeRate) / 100,
          ...(subdivisionUnit.trim() !== '' && { subdivision_unit: Number(subdivisionUnit) }),
        };
```

rg 모드:
```typescript
        body = {
          product_name: rgCustomName.trim(),
          vendor_item_id: selectedRg!.vendor_item_id,
          platform_fee_rate: Number(feeRate) / 100,
          ...(subdivisionUnit.trim() !== '' && { subdivision_unit: Number(subdivisionUnit) }),
        };
```

manual 모드:
```typescript
        body = {
          product_name: manualName.trim(),
          platform_fee_rate: Number(feeRate) / 100,
          ...(subdivisionUnit.trim() !== '' && { subdivision_unit: Number(subdivisionUnit) }),
        };
```

- [ ] **Step 3: 플랫폼 수수료율 아래에 UI 추가**

플랫폼 수수료율 `div` 블록 (`<div style={{ marginTop: '16px' }}>`) 바로 아래에 추가:

```tsx
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#27272a', marginBottom: '6px' }}>소분 갯수 (선택)</div>
            <input
              type="number"
              value={subdivisionUnit}
              onChange={(e) => setSubdivisionUnit(e.target.value)}
              step="1"
              min="2"
              placeholder="비워두면 소분 없음"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d4d4d8', fontSize: '12px', boxSizing: 'border-box', color: '#18181b' }}
            />
            <div style={{ fontSize: '10px', color: '#52525b', marginTop: '4px' }}>입력하면 입고 시 개당 원가를 자동 계산합니다</div>
          </div>
```

- [ ] **Step 4: TypeScript 빌드 확인**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: 커밋**

```bash
git add src/components/orders/AddProductModal.tsx
git commit -m "feat(ui): AddProductModal 소분 갯수 필드 추가"
```

---

## Task 9: CostManagementTab — subdivisionUnit prop 전달

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

- [ ] **Step 1: CostEntryDrawer에 subdivisionUnit prop 전달**

`CostEntryDrawer` 렌더링 부분 (line 734)을 찾아 prop 추가:

찾는 코드:
```tsx
          <CostEntryDrawer
            productId={drawerProductId}
            productName={dp?.product_name ?? ''}
            sellerProductId={dp?.seller_product_id ?? null}
            vendorItemId={dp?.vendor_item_id ?? null}
            onClose={() => setDrawerProductId(null)}
            onChanged={load}
          />
```

교체:
```tsx
          <CostEntryDrawer
            productId={drawerProductId}
            productName={dp?.product_name ?? ''}
            sellerProductId={dp?.seller_product_id ?? null}
            vendorItemId={dp?.vendor_item_id ?? null}
            subdivisionUnit={dp?.subdivision_unit ?? null}
            onClose={() => setDrawerProductId(null)}
            onChanged={load}
          />
```

- [ ] **Step 2: TypeScript 빌드 확인**

```bash
npx tsc --noEmit
```

오류가 나면 `CostEntryDrawer` Props 인터페이스에 `subdivisionUnit` 이 아직 없기 때문. Task 10 완료 후 다시 확인.

- [ ] **Step 3: 커밋 (Task 10과 함께)**

Task 10 완료 후 함께 커밋.

---

## Task 10: CostEntryDrawer — 소분 폼 + 미리보기

**Files:**
- Modify: `src/components/orders/CostEntryDrawer.tsx`

- [ ] **Step 1: import 및 타입 추가**

파일 상단에 import 추가:

```typescript
import { calculateSubdivision } from '@/lib/cost-management/subdivision';
```

`Entry` 인터페이스에 필드 추가:

```typescript
interface Entry {
  id: string;
  received_at: string;
  quantity: number;
  unit_cost: number;
  unit_shipping_fee: number;
  unit_rg_shipping_fee: number;
  shipping_group_id: string | null;
  shipping_group_name: string | null;
  purchase_quantity: number | null;   // NEW
  subdivision_unit: number | null;    // NEW
}
```

`Props` 인터페이스에 subdivisionUnit 추가:

```typescript
interface Props {
  productId: string;
  productName: string;
  sellerProductId: number | null;
  vendorItemId?: number | null;
  subdivisionUnit?: number | null;   // NEW
  onClose: () => void;
  onChanged: () => void;
}
```

함수 시그니처 업데이트:

```typescript
export default function CostEntryDrawer({ productId, productName, sellerProductId, vendorItemId, subdivisionUnit, onClose, onChanged }: Props) {
```

- [ ] **Step 2: 소분 전용 상태 추가**

컴포넌트 내부 state 선언부 (기존 state 들 아래)에 추가:

```typescript
  // 소분 모드 전용 상태
  const [subForm, setSubForm] = useState({
    received_at: new Date().toISOString().slice(0, 10),
    totalPurchaseCost: '',
    purchaseQuantity: '',
    subUnit: subdivisionUnit ? String(subdivisionUnit) : '',
    unit_shipping_fee: '0',
  });
  const [carryoverMeta, setCarryoverMeta] = useState({ quantity: 0, unitCost: 0 });

  const isSubdivisionProduct = (subdivisionUnit ?? 0) > 0;
```

- [ ] **Step 3: entries 로드 시 carryoverMeta 갱신**

`loadEntries` 함수를 수정해 meta 를 읽는다:

찾는 코드:
```typescript
  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cost-management/products/${productId}/entries`);
      const json = await res.json();
      if (json.success) setEntries(json.data);
    } catch (e) {
      console.error('입고 내역 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }, [productId]);
```

교체:
```typescript
  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cost-management/products/${productId}/entries`);
      const json = await res.json();
      if (json.success) {
        setEntries(json.data);
        if (json.meta) {
          setCarryoverMeta({
            quantity: json.meta.subdivision_carryover ?? 0,
            unitCost: json.meta.subdivision_carryover_unit_cost ?? 0,
          });
        }
      }
    } catch (e) {
      console.error('입고 내역 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }, [productId]);
```

- [ ] **Step 4: 소분 미리보기 계산 값 (useMemo 없이 인라인)**

`save()` 함수 위에 소분 preview 계산 추가:

```typescript
  const subPreview = (() => {
    const pq = Number(subForm.purchaseQuantity);
    const tc = Number(subForm.totalPurchaseCost);
    const su = Number(subForm.subUnit);
    if (pq > 0 && tc > 0 && su >= 2) {
      return calculateSubdivision({
        purchaseQuantity: pq,
        totalPurchaseCost: tc,
        subdivisionUnit: su,
        carryoverQuantity: carryoverMeta.quantity,
        carryoverUnitCost: carryoverMeta.unitCost,
      });
    }
    return null;
  })();
```

- [ ] **Step 5: 소분 모드 save() 함수 추가**

기존 `save()` 함수 아래에 추가:

```typescript
  async function saveSubdivision() {
    if (!subForm.received_at || !subPreview || subPreview.sellablePacks === 0) {
      alert('입고일, 사입 총량, 소분 갯수를 올바르게 입력해 주세요.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        received_at: subForm.received_at,
        unit_cost: Math.round(Number(subForm.totalPurchaseCost)),
        purchase_quantity: Math.round(Number(subForm.purchaseQuantity)),
        subdivision_unit: Math.round(Number(subForm.subUnit)),
        unit_shipping_fee: Math.round(Number(subForm.unit_shipping_fee)),
        channel: entryChannel,
      };
      const res = await fetch(`/api/cost-management/products/${productId}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) {
        refreshAll();
        setAddingNew(false);
        setSubForm({ received_at: new Date().toISOString().slice(0, 10), totalPurchaseCost: '', purchaseQuantity: '', subUnit: subdivisionUnit ? String(subdivisionUnit) : '', unit_shipping_fee: '0' });
      } else {
        alert(json.error ?? '저장에 실패했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }
```

- [ ] **Step 6: 소분 폼 + 미리보기 JSX 추가**

`CostEntryDrawer` 반환 JSX 에서 "새 입고 건 추가" 버튼과 `addingNew` 렌더링 부분을 찾는다. `!addingNew && !editingId` 조건의 버튼 바로 위 (`{!addingNew && !editingId && (` 바로 앞)에 소분 폼 블록 추가:

```tsx
                  {addingNew && !editingId && isSubdivisionProduct && (
                    <tr style={{ background: '#fff7ed', borderBottom: '1px solid #fed7aa' }}>
                      <td colSpan={6} style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '6px', marginBottom: '6px' }}>
                          <div>
                            <div style={{ fontSize: '9px', color: '#92400e', marginBottom: '2px' }}>입고일</div>
                            <input type="date" value={subForm.received_at} onChange={(e) => setSubForm((f) => ({ ...f, received_at: e.target.value }))} style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #fed7aa', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }} />
                          </div>
                          <div>
                            <div style={{ fontSize: '9px', color: '#92400e', marginBottom: '2px' }}>묶음 총 구매가(원)</div>
                            <input type="number" value={subForm.totalPurchaseCost} onChange={(e) => setSubForm((f) => ({ ...f, totalPurchaseCost: e.target.value }))} placeholder="예: 21490" style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #fed7aa', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }} />
                          </div>
                          <div>
                            <div style={{ fontSize: '9px', color: '#92400e', marginBottom: '2px' }}>사입 총량(개)</div>
                            <input type="number" value={subForm.purchaseQuantity} onChange={(e) => setSubForm((f) => ({ ...f, purchaseQuantity: e.target.value }))} placeholder="예: 36" style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #fed7aa', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }} />
                          </div>
                          <div>
                            <div style={{ fontSize: '9px', color: '#92400e', marginBottom: '2px' }}>소분 갯수(개)</div>
                            <input type="number" value={subForm.subUnit} onChange={(e) => setSubForm((f) => ({ ...f, subUnit: e.target.value }))} placeholder="예: 10" style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #fed7aa', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }} />
                          </div>
                        </div>
                        {subPreview && (
                          <div style={{ background: '#fff', borderRadius: '6px', padding: '6px 8px', fontSize: '10px', color: '#27272a', border: '1px solid #fed7aa', marginBottom: '6px' }}>
                            {carryoverMeta.quantity > 0 && (
                              <span style={{ color: '#92400e', marginRight: '10px' }}>이월 {carryoverMeta.quantity}개 포함 →</span>
                            )}
                            <span>총 {subPreview.totalAvailable}개</span>
                            <span style={{ margin: '0 6px', color: '#d1d5db' }}>|</span>
                            <span style={{ fontWeight: 700, color: '#16a34a' }}>판매 {subPreview.sellablePacks}팩</span>
                            <span style={{ margin: '0 6px', color: '#d1d5db' }}>|</span>
                            <span>팩당 {fmt(subPreview.packUnitCost)}원</span>
                            <span style={{ margin: '0 6px', color: '#d1d5db' }}>|</span>
                            <span style={{ color: '#f97316' }}>새 이월 {subPreview.newCarryoverQuantity}개</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <button onClick={saveSubdivision} disabled={saving || !subPreview || subPreview.sellablePacks === 0} style={{ padding: '3px 10px', borderRadius: '4px', background: subPreview && subPreview.sellablePacks > 0 ? '#16a34a' : '#d4d4d4', color: subPreview && subPreview.sellablePacks > 0 ? '#fff' : '#71717a', border: 'none', fontSize: '10px', cursor: 'pointer' }}>
                            {saving ? '...' : '저장'}
                          </button>
                          <button onClick={() => { setAddingNew(false); }} style={{ padding: '3px 5px', borderRadius: '4px', background: '#f3f4f6', border: 'none', fontSize: '10px', cursor: 'pointer', color: '#27272a' }}>취소</button>
                        </div>
                      </td>
                    </tr>
                  )}
```

그리고 기존 `addingNew && !editingId` 블록 (일반 모드)을 소분 상품이 아닌 경우에만 표시되도록 조건 추가:

찾는 코드:
```tsx
                  {addingNew && !editingId && (
```

교체:
```tsx
                  {addingNew && !editingId && !isSubdivisionProduct && (
```

마지막으로, 입고 내역 테이블에서 소분 건 수량 표시에 서브텍스트 추가:

찾는 코드:
```tsx
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#18181b' }}>{e.quantity.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}개</td>
```

교체:
```tsx
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#18181b' }}>
                          {e.quantity.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}팩
                          {e.purchase_quantity && <div style={{ fontSize: '9px', color: '#92400e', fontWeight: 400 }}>사입{e.purchase_quantity}/소분{e.subdivision_unit}</div>}
                        </td>
```

- [ ] **Step 7: TypeScript 빌드 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음.

- [ ] **Step 8: 전체 테스트 실행**

```bash
npx vitest run
```

Expected: 기존 테스트 + subdivision 테스트 모두 PASS.

- [ ] **Step 9: 커밋**

```bash
git add src/components/orders/CostEntryDrawer.tsx src/components/orders/CostManagementTab.tsx
git commit -m "feat(ui): CostEntryDrawer 소분 입고 폼 + 실시간 미리보기"
```

---

## 최종 검증

- [ ] 개발 서버 실행: `npm run dev`
- [ ] 수익 원가 탭 → 상품 추가 → 소분 갯수 입력 → 저장 확인
- [ ] 해당 상품 입고 건 추가 → 소분 폼 표시 확인
- [ ] 세차타월 예시 (36개, 21,490원, 소분 10개) → 3팩, 팩당 5,970원, 이월 6개 확인
- [ ] 이월 있는 2차 입고 (신규 36개) → 4팩, 이월 2개 확인
- [ ] 일반 상품(subdivision_unit 없음) → 기존 폼 그대로 표시 확인
