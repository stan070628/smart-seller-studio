# 원가관리 메뉴 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주문/매출 메뉴에 "원가관리" 탭을 추가해, 상품별 매입원가를 건별로 수기 입력하고 가중평균 기준 순이익·마진율을 계산·표시한다.

**Architecture:** Entry-first + Shipping Group 태그 방식. `product_costs`(상품 마스터) → `cost_entries`(건별 입고 이력) → `shipping_groups`(배송비 공동배분 그룹) 3테이블. 계산 로직은 `src/lib/cost-management/calculations.ts`에 순수 함수로 분리하고 API에서 호출한다.

**Tech Stack:** Next.js App Router, Render PostgreSQL (`getSourcingPool`), JWT Cookie Auth (`getCurrentUser`), React inline-style UI (기존 OrdersClient 패턴 동일)

---

## 파일 구조

| 역할 | 경로 |
|------|------|
| DB 마이그레이션 | `supabase/migrations/056_cost_management.sql` |
| 계산 로직 | `src/lib/cost-management/calculations.ts` |
| 계산 로직 테스트 | `src/__tests__/lib/cost-management-calculations.test.ts` |
| 상품 목록 API | `src/app/api/cost-management/products/route.ts` |
| 입고 건 API | `src/app/api/cost-management/products/[id]/entries/route.ts` |
| 입고 건 수정/삭제 API | `src/app/api/cost-management/entries/[id]/route.ts` |
| 재고 수정 API | `src/app/api/cost-management/products/[id]/stock/route.ts` |
| 배송비 그룹 API | `src/app/api/cost-management/shipping-groups/route.ts` |
| 쿠팡 연동 상품 목록 API | `src/app/api/cost-management/coupang-products/route.ts` |
| 탭 진입점 수정 | `src/components/orders/OrdersClient.tsx` |
| 메인 탭 | `src/components/orders/CostManagementTab.tsx` |
| 건별 입고 드로어 | `src/components/orders/CostEntryDrawer.tsx` |
| 배송비 그룹 모달 | `src/components/orders/ShippingGroupModal.tsx` |
| 상품 추가 모달 | `src/components/orders/AddProductModal.tsx` |

---

## Task 1: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/056_cost_management.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 배송비 그룹 (로켓그로스 공동 배분) — cost_entries FK 대상이므로 먼저 생성
CREATE TABLE IF NOT EXISTS shipping_groups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid,
  name              text,
  total_shipping_fee int NOT NULL CHECK (total_shipping_fee >= 0),
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipping_groups_user
  ON shipping_groups (user_id, created_at DESC);

-- 상품 마스터
CREATE TABLE IF NOT EXISTS product_costs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid,
  seller_product_id bigint,
  product_name      text NOT NULL,
  platform          text DEFAULT 'coupang',
  platform_fee_rate numeric(5,4) DEFAULT 0.1080,
  current_stock     int DEFAULT 0,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_costs_user
  ON product_costs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_costs_seller_product
  ON product_costs (user_id, seller_product_id) WHERE seller_product_id IS NOT NULL;

-- 건별 입고 내역
CREATE TABLE IF NOT EXISTS cost_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid,
  product_cost_id   uuid REFERENCES product_costs(id) ON DELETE CASCADE,
  received_at       date NOT NULL,
  quantity          int NOT NULL CHECK (quantity > 0),
  unit_cost         int NOT NULL CHECK (unit_cost >= 0),
  unit_shipping_fee int NOT NULL DEFAULT 0,
  selling_price     int NOT NULL CHECK (selling_price > 0),
  shipping_group_id uuid REFERENCES shipping_groups(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_entries_product
  ON cost_entries (product_cost_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_entries_group
  ON cost_entries (shipping_group_id) WHERE shipping_group_id IS NOT NULL;

COMMENT ON TABLE shipping_groups IS '로켓그로스 배송비 공동 배분 그룹. spec 2026-05-09 §3';
COMMENT ON TABLE product_costs IS '원가관리 상품 마스터. spec 2026-05-09 §3';
COMMENT ON TABLE cost_entries IS '건별 입고 이력. 가중평균 계산 기준. spec 2026-05-09 §3';
```

- [ ] **Step 2: 마이그레이션 실행**

```bash
psql "$SOURCING_DATABASE_URL" -f supabase/migrations/056_cost_management.sql
```

Expected: `CREATE TABLE` × 3, `CREATE INDEX` × 5

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/056_cost_management.sql
git commit -m "feat(db): 원가관리 3테이블 추가 (shipping_groups, product_costs, cost_entries)"
```

---

## Task 2: 계산 로직 라이브러리 + 테스트

**Files:**
- Create: `src/lib/cost-management/calculations.ts`
- Create: `src/__tests__/lib/cost-management-calculations.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```typescript
// src/__tests__/lib/cost-management-calculations.test.ts
import { describe, it, expect } from 'vitest';
import {
  calculateWeightedAvg,
  calculateProductMetrics,
  distributeShippingFee,
  type CostEntryRow,
} from '@/lib/cost-management/calculations';

const makeEntry = (overrides: Partial<CostEntryRow>): CostEntryRow => ({
  id: 'e1',
  product_cost_id: 'p1',
  received_at: '2026-05-01',
  quantity: 10,
  unit_cost: 10000,
  unit_shipping_fee: 1000,
  selling_price: 20000,
  shipping_group_id: null,
  ...overrides,
});

describe('calculateWeightedAvg', () => {
  it('단일 건 → 해당 값 그대로', () => {
    const entries = [makeEntry({ unit_cost: 15000, quantity: 5 })];
    expect(calculateWeightedAvg(entries, 'unit_cost')).toBe(15000);
  });

  it('두 건 수량 가중 평균', () => {
    const entries = [
      makeEntry({ id: 'e1', unit_cost: 10000, quantity: 3 }),
      makeEntry({ id: 'e2', unit_cost: 20000, quantity: 7 }),
    ];
    // (10000×3 + 20000×7) / 10 = 17000
    expect(calculateWeightedAvg(entries, 'unit_cost')).toBe(17000);
  });

  it('빈 배열 → 0', () => {
    expect(calculateWeightedAvg([], 'unit_cost')).toBe(0);
  });
});

describe('calculateProductMetrics', () => {
  it('정상 계산 — 순이익·마진율', () => {
    const entries = [makeEntry({ unit_cost: 10000, unit_shipping_fee: 1000, selling_price: 20000, quantity: 10 })];
    const metrics = calculateProductMetrics(entries, 0.108);
    // 수수료 = 20000 × 0.108 = 2160
    // 순이익 = 20000 - 10000 - 1000 - 2160 = 6840
    // 마진율 = 6840 / 20000 × 100 = 34.2
    expect(metrics.fee).toBe(2160);
    expect(metrics.net_profit).toBe(6840);
    expect(Math.round(metrics.margin_rate * 10) / 10).toBe(34.2);
  });

  it('순이익 음수 → 마진율 음수', () => {
    const entries = [makeEntry({ unit_cost: 18000, unit_shipping_fee: 3000, selling_price: 20000, quantity: 5 })];
    const metrics = calculateProductMetrics(entries, 0.108);
    expect(metrics.net_profit).toBeLessThan(0);
    expect(metrics.margin_rate).toBeLessThan(0);
  });

  it('빈 entries → 모두 0', () => {
    const metrics = calculateProductMetrics([], 0.108);
    expect(metrics.net_profit).toBe(0);
    expect(metrics.total_quantity).toBe(0);
  });
});

describe('distributeShippingFee', () => {
  it('수량 비례 배분 후 합계가 총 배송비와 같음', () => {
    const entries = [
      { id: 'e1', quantity: 20 },
      { id: 'e2', quantity: 10 },
    ];
    const dist = distributeShippingFee(entries, 54000);
    const total = [...dist.values()].reduce((s, v) => s + v, 0);
    expect(total).toBe(54000);
  });

  it('반올림 오차는 첫 번째 entry에 흡수', () => {
    // 총 배송비 100, 수량 3:7 → 30:70 이지만 정수 반올림 오차 확인
    const entries = [
      { id: 'e1', quantity: 3 },
      { id: 'e2', quantity: 7 },
    ];
    const dist = distributeShippingFee(entries, 100);
    expect(dist.get('e1')! + dist.get('e2')!).toBe(100);
  });

  it('빈 배열 → 빈 Map', () => {
    expect(distributeShippingFee([], 10000).size).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npx vitest run src/__tests__/lib/cost-management-calculations.test.ts
```

Expected: 모든 테스트 FAIL (모듈 없음)

- [ ] **Step 3: 계산 로직 구현**

```typescript
// src/lib/cost-management/calculations.ts
export interface CostEntryRow {
  id: string;
  product_cost_id: string;
  received_at: string;
  quantity: number;
  unit_cost: number;
  unit_shipping_fee: number;
  selling_price: number;
  shipping_group_id: string | null;
}

export interface ProductMetrics {
  weighted_avg_cost: number;
  weighted_avg_shipping: number;
  weighted_avg_selling_price: number;
  fee: number;
  net_profit: number;
  margin_rate: number;
  total_quantity: number;
  total_purchase_amount: number;
}

export function calculateWeightedAvg(
  entries: Pick<CostEntryRow, 'quantity' | 'unit_cost' | 'unit_shipping_fee' | 'selling_price'>[],
  field: 'unit_cost' | 'unit_shipping_fee' | 'selling_price',
): number {
  const totalQty = entries.reduce((s, e) => s + e.quantity, 0);
  if (totalQty === 0) return 0;
  const weightedSum = entries.reduce((s, e) => s + e[field] * e.quantity, 0);
  return Math.round(weightedSum / totalQty);
}

export function calculateProductMetrics(
  entries: CostEntryRow[],
  platformFeeRate: number,
): ProductMetrics {
  if (entries.length === 0) {
    return {
      weighted_avg_cost: 0,
      weighted_avg_shipping: 0,
      weighted_avg_selling_price: 0,
      fee: 0,
      net_profit: 0,
      margin_rate: 0,
      total_quantity: 0,
      total_purchase_amount: 0,
    };
  }

  const weighted_avg_cost = calculateWeightedAvg(entries, 'unit_cost');
  const weighted_avg_shipping = calculateWeightedAvg(entries, 'unit_shipping_fee');
  const weighted_avg_selling_price = calculateWeightedAvg(entries, 'selling_price');
  const fee = Math.round(weighted_avg_selling_price * platformFeeRate);
  const net_profit = weighted_avg_selling_price - weighted_avg_cost - weighted_avg_shipping - fee;
  const margin_rate =
    weighted_avg_selling_price > 0 ? (net_profit / weighted_avg_selling_price) * 100 : 0;
  const total_quantity = entries.reduce((s, e) => s + e.quantity, 0);
  const total_purchase_amount = entries.reduce((s, e) => s + e.unit_cost * e.quantity, 0);

  return {
    weighted_avg_cost,
    weighted_avg_shipping,
    weighted_avg_selling_price,
    fee,
    net_profit,
    margin_rate,
    total_quantity,
    total_purchase_amount,
  };
}

export function distributeShippingFee(
  entries: { id: string; quantity: number }[],
  totalShippingFee: number,
): Map<string, number> {
  if (entries.length === 0) return new Map();

  const totalQty = entries.reduce((s, e) => s + e.quantity, 0);
  if (totalQty === 0) return new Map();

  const result = new Map<string, number>();
  let remaining = totalShippingFee;

  // 2번째부터 배분하고, 남은 금액을 첫 번째에 배정 (반올림 오차 흡수)
  for (let i = 1; i < entries.length; i++) {
    const fee = Math.round((totalShippingFee * entries[i].quantity) / totalQty);
    result.set(entries[i].id, fee);
    remaining -= fee;
  }
  result.set(entries[0].id, remaining);

  return result;
}
```

- [ ] **Step 4: 테스트 재실행 — 통과 확인**

```bash
npx vitest run src/__tests__/lib/cost-management-calculations.test.ts
```

Expected: 모든 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/cost-management/calculations.ts src/__tests__/lib/cost-management-calculations.test.ts
git commit -m "feat(lib): 원가 가중평균·마진 계산·배송비 배분 로직 + 테스트"
```

---

## Task 3: API — 상품 목록 조회 + 추가

**Files:**
- Create: `src/app/api/cost-management/products/route.ts`
- Create: `src/app/api/cost-management/coupang-products/route.ts`

- [ ] **Step 1: 상품 목록 + 쿠팡 연동 API 작성**

```typescript
// src/app/api/cost-management/products/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { calculateProductMetrics } from '@/lib/cost-management/calculations';
import type { CostEntryRow } from '@/lib/cost-management/calculations';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const pool = getSourcingPool();
  const { rows: products } = await pool.query(
    `SELECT id, product_name, seller_product_id, platform, platform_fee_rate, current_stock, created_at
     FROM product_costs
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [user.userId],
  );

  const { rows: entries } = await pool.query(
    `SELECT id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, selling_price, shipping_group_id
     FROM cost_entries
     WHERE user_id = $1`,
    [user.userId],
  );

  const entriesByProduct = new Map<string, CostEntryRow[]>();
  for (const e of entries) {
    const list = entriesByProduct.get(e.product_cost_id) ?? [];
    list.push({
      id: e.id,
      product_cost_id: e.product_cost_id,
      received_at: e.received_at,
      quantity: Number(e.quantity),
      unit_cost: Number(e.unit_cost),
      unit_shipping_fee: Number(e.unit_shipping_fee),
      selling_price: Number(e.selling_price),
      shipping_group_id: e.shipping_group_id,
    });
    entriesByProduct.set(e.product_cost_id, list);
  }

  const data = products.map((p) => {
    const pEntries = entriesByProduct.get(p.id) ?? [];
    const metrics = calculateProductMetrics(pEntries, Number(p.platform_fee_rate));
    return {
      id: p.id,
      product_name: p.product_name,
      seller_product_id: p.seller_product_id,
      platform: p.platform,
      platform_fee_rate: Number(p.platform_fee_rate),
      current_stock: Number(p.current_stock),
      entry_count: pEntries.length,
      ...metrics,
    };
  });

  return NextResponse.json({ success: true, data });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { product_name, seller_product_id, platform_fee_rate } = body ?? {};

  if (!product_name || typeof product_name !== 'string' || product_name.trim() === '') {
    return NextResponse.json({ success: false, error: 'product_name required' }, { status: 400 });
  }

  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `INSERT INTO product_costs (user_id, product_name, seller_product_id, platform_fee_rate)
     VALUES ($1, $2, $3, $4)
     RETURNING id, product_name, seller_product_id, platform, platform_fee_rate, current_stock, created_at`,
    [
      user.userId,
      product_name.trim(),
      seller_product_id ?? null,
      platform_fee_rate ?? 0.108,
    ],
  );

  return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
}
```

```typescript
// src/app/api/cost-management/coupang-products/route.ts
import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

// 쿠팡 등록 상품 중 product_costs에 아직 연동되지 않은 목록 반환
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `SELECT crp.seller_product_id, crp.seller_product_name
     FROM coupang_registered_products crp
     WHERE crp.user_id = $1
       AND crp.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM product_costs pc
         WHERE pc.user_id = $1
           AND pc.seller_product_id = crp.seller_product_id
       )
     ORDER BY crp.created_at DESC
     LIMIT 100`,
    [user.userId],
  );

  return NextResponse.json({ success: true, data: rows });
}
```

- [ ] **Step 2: 서버 기동 후 API 수동 확인**

```bash
curl -s http://localhost:3000/api/cost-management/products | jq '.success'
```

Expected: `true` (빈 배열이면 정상, 미인증이면 401)

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/
git commit -m "feat(api): 원가관리 상품 목록 GET/POST + 쿠팡 연동 목록 API"
```

---

## Task 4: API — 입고 건 CRUD

**Files:**
- Create: `src/app/api/cost-management/products/[id]/entries/route.ts`
- Create: `src/app/api/cost-management/entries/[id]/route.ts`

- [ ] **Step 1: 입고 건 조회 + 추가 API 작성**

```typescript
// src/app/api/cost-management/products/[id]/entries/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  // 이 product가 이 user 것인지 확인
  const { rows: check } = await pool.query(
    `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (check.length === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  const { rows } = await pool.query(
    `SELECT ce.id, ce.received_at, ce.quantity, ce.unit_cost, ce.unit_shipping_fee,
            ce.selling_price, ce.shipping_group_id, sg.name as shipping_group_name,
            ce.created_at
     FROM cost_entries ce
     LEFT JOIN shipping_groups sg ON sg.id = ce.shipping_group_id
     WHERE ce.product_cost_id = $1
     ORDER BY ce.received_at DESC, ce.created_at DESC`,
    [id],
  );

  return NextResponse.json({ success: true, data: rows });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { received_at, quantity, unit_cost, unit_shipping_fee, selling_price } = body ?? {};

  if (!received_at || !quantity || unit_cost == null || !selling_price) {
    return NextResponse.json(
      { success: false, error: 'received_at, quantity, unit_cost, selling_price required' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  const { rows: check } = await pool.query(
    `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (check.length === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  const { rows } = await pool.query(
    `INSERT INTO cost_entries
       (user_id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, selling_price)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [user.userId, id, received_at, quantity, unit_cost, unit_shipping_fee ?? 0, selling_price],
  );

  return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
}
```

- [ ] **Step 2: 입고 건 수정·삭제 API 작성**

```typescript
// src/app/api/cost-management/entries/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { received_at, quantity, unit_cost, unit_shipping_fee, selling_price } = body ?? {};

  const pool = getSourcingPool();
  const { rows: check } = await pool.query(
    `SELECT id FROM cost_entries WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (check.length === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  const { rows } = await pool.query(
    `UPDATE cost_entries SET
       received_at       = COALESCE($1, received_at),
       quantity          = COALESCE($2, quantity),
       unit_cost         = COALESCE($3, unit_cost),
       unit_shipping_fee = COALESCE($4, unit_shipping_fee),
       selling_price     = COALESCE($5, selling_price)
     WHERE id = $6
     RETURNING *`,
    [received_at ?? null, quantity ?? null, unit_cost ?? null, unit_shipping_fee ?? null, selling_price ?? null, id],
  );

  return NextResponse.json({ success: true, data: rows[0] });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();
  const { rowCount } = await pool.query(
    `DELETE FROM cost_entries WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );

  if (rowCount === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/products/
git add src/app/api/cost-management/entries/
git commit -m "feat(api): 입고 건 CRUD API (entries GET/POST/PATCH/DELETE)"
```

---

## Task 5: API — 재고 수정 + 배송비 그룹

**Files:**
- Create: `src/app/api/cost-management/products/[id]/stock/route.ts`
- Create: `src/app/api/cost-management/shipping-groups/route.ts`

- [ ] **Step 1: 재고 수정 + 배송비 그룹 API 작성**

```typescript
// src/app/api/cost-management/products/[id]/stock/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { current_stock } = body ?? {};

  if (typeof current_stock !== 'number' || current_stock < 0) {
    return NextResponse.json({ success: false, error: 'current_stock must be a non-negative number' }, { status: 400 });
  }

  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `UPDATE product_costs SET current_stock = $1 WHERE id = $2 AND user_id = $3 RETURNING id, current_stock`,
    [current_stock, id, user.userId],
  );

  if (rows.length === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: rows[0] });
}
```

```typescript
// src/app/api/cost-management/shipping-groups/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { distributeShippingFee } from '@/lib/cost-management/calculations';

// POST body: { name?: string, total_shipping_fee: number, entry_ids: string[] }
// entry_ids: 배송비를 나눌 cost_entries ID 목록 (수량 비례 배분)
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { name, total_shipping_fee, entry_ids } = body ?? {};

  if (typeof total_shipping_fee !== 'number' || total_shipping_fee < 0) {
    return NextResponse.json({ success: false, error: 'total_shipping_fee required' }, { status: 400 });
  }
  if (!Array.isArray(entry_ids) || entry_ids.length === 0) {
    return NextResponse.json({ success: false, error: 'entry_ids required' }, { status: 400 });
  }

  const pool = getSourcingPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 그룹 생성
    const { rows: groupRows } = await client.query(
      `INSERT INTO shipping_groups (user_id, name, total_shipping_fee) VALUES ($1, $2, $3) RETURNING id`,
      [user.userId, name ?? null, total_shipping_fee],
    );
    const groupId: string = groupRows[0].id;

    // 선택된 entries 수량 조회 (본인 것만)
    const { rows: entries } = await client.query(
      `SELECT id, quantity FROM cost_entries WHERE id = ANY($1::uuid[]) AND user_id = $2`,
      [entry_ids, user.userId],
    );

    if (entries.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'No valid entries found' }, { status: 400 });
    }

    const distribution = distributeShippingFee(
      entries.map((e) => ({ id: e.id, quantity: Number(e.quantity) })),
      total_shipping_fee,
    );

    // 각 entry에 배분된 배송비 + group_id 업데이트
    for (const [entryId, fee] of distribution) {
      await client.query(
        `UPDATE cost_entries SET unit_shipping_fee = $1, shipping_group_id = $2 WHERE id = $3`,
        [fee, groupId, entryId],
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ success: true, data: { group_id: groupId, distributed: Object.fromEntries(distribution) } }, { status: 201 });
  } catch (err) {
    await client.query('ROLLBACK');
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/cost-management/products/
git add src/app/api/cost-management/shipping-groups/
git commit -m "feat(api): 재고 수정 PATCH + 배송비 그룹 생성 POST (트랜잭션 배분)"
```

---

## Task 6: OrdersClient — 원가관리 탭 추가

**Files:**
- Modify: `src/components/orders/OrdersClient.tsx`

- [ ] **Step 1: 탭 추가**

`src/components/orders/OrdersClient.tsx` 상단 import 수정:

```typescript
// 기존
import { ShoppingCart, BarChart3, Settings, ClipboardList } from 'lucide-react';
import OrdersTab from './OrdersTab';
import AnalyticsTab from './AnalyticsTab';
import ChannelsTab from './ChannelsTab';

type SubTab = 'orders' | 'analytics' | 'channels';
```

아래로 교체:

```typescript
import { ShoppingCart, BarChart3, Settings, ClipboardList, DollarSign } from 'lucide-react';
import OrdersTab from './OrdersTab';
import AnalyticsTab from './AnalyticsTab';
import ChannelsTab from './ChannelsTab';
import CostManagementTab from './CostManagementTab';

type SubTab = 'orders' | 'analytics' | 'channels' | 'cost';
```

`SUB_TABS` 배열에 항목 추가:

```typescript
const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'orders', label: '주문관리', icon: <ClipboardList size={14} /> },
  { id: 'analytics', label: '매출분석', icon: <BarChart3 size={14} /> },
  { id: 'channels', label: '채널설정', icon: <Settings size={14} /> },
  { id: 'cost', label: '원가관리', icon: <DollarSign size={14} /> },
];
```

콘텐츠 렌더링 블록에 추가:

```typescript
{activeSubTab === 'cost' && <CostManagementTab />}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/orders/OrdersClient.tsx
git commit -m "feat(ui): 주문/매출 탭에 원가관리 탭 추가"
```

---

## Task 7: CostManagementTab — 메인 테이블 UI

**Files:**
- Create: `src/components/orders/CostManagementTab.tsx`

- [ ] **Step 1: 메인 탭 컴포넌트 작성**

```typescript
// src/components/orders/CostManagementTab.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { DollarSign, Plus, Truck, Search } from 'lucide-react';
import CostEntryDrawer from './CostEntryDrawer';
import ShippingGroupModal from './ShippingGroupModal';
import AddProductModal from './AddProductModal';

interface ProductRow {
  id: string;
  product_name: string;
  seller_product_id: number | null;
  platform_fee_rate: number;
  current_stock: number;
  entry_count: number;
  weighted_avg_cost: number;
  weighted_avg_shipping: number;
  weighted_avg_selling_price: number;
  fee: number;
  net_profit: number;
  margin_rate: number;
  total_quantity: number;
  total_purchase_amount: number;
}

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

export default function CostManagementTab() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [drawerProductId, setDrawerProductId] = useState<string | null>(null);
  const [showShippingModal, setShowShippingModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cost-management/products');
      const json = await res.json();
      if (json.success) setProducts(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = products.filter((p) =>
    p.product_name.toLowerCase().includes(search.toLowerCase()),
  );

  const totalPurchase = products.reduce((s, p) => s + p.total_purchase_amount, 0);
  const avgMargin =
    products.length > 0
      ? products.reduce((s, p) => s + p.margin_rate, 0) / products.length
      : 0;
  const riskCount = products.filter((p) => p.entry_count > 0 && p.margin_rate < 5).length;

  return (
    <div>
      {/* 요약 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: '관리 상품 수', value: `${products.length}개`, color: '#18181b' },
          { label: '총 매입 금액', value: `${fmt(totalPurchase)}원`, color: '#18181b' },
          { label: '평균 마진율', value: `${avgMargin.toFixed(1)}%`, color: avgMargin >= 10 ? '#16a34a' : avgMargin >= 0 ? '#ca8a04' : '#ef4444' },
          { label: '마진 위험 상품', value: `${riskCount}개`, color: riskCount > 0 ? '#ef4444' : '#16a34a', sub: '마진율 5% 미만' },
        ].map((c) => (
          <div key={c.label} style={{ background: '#fff', borderRadius: '10px', padding: '14px', border: '1px solid #e5e5e5' }}>
            <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>{c.label}</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: c.color }}>{c.value}</div>
            {c.sub && <div style={{ fontSize: '10px', color: '#71717a' }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* 액션 버튼 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <button
          onClick={() => setShowAddModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', background: '#be0014', color: '#fff', border: 'none', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
        >
          <Plus size={13} /> 상품 추가
        </button>
        <button
          onClick={() => setShowShippingModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', background: '#fff', color: '#333', border: '1px solid #e5e5e5', fontSize: '12px', cursor: 'pointer' }}
        >
          <Truck size={13} /> 배송비 그룹 생성
        </button>
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#999' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="상품명 검색..."
            style={{ padding: '8px 12px 8px 30px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px', width: '180px' }}
          />
        </div>
      </div>

      {/* 테이블 */}
      <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid #e5e5e5', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#71717a', fontSize: '13px' }}>불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#71717a', fontSize: '13px' }}>
            {search ? '검색 결과가 없습니다.' : '상품을 추가해주세요.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
                {['상품명', '판매가(가중평균)', '원가(가중평균)', '배송비(배분)', '수수료', '순이익', '마진율', '재고', '내역'].map((h) => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: h === '상품명' ? 'left' : 'right', fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isRisk = p.entry_count > 0 && p.margin_rate < 5;
                const noEntries = p.entry_count === 0;
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0', background: isRisk ? '#fff9f9' : '#fff' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 500, color: noEntries ? '#999' : '#18181b' }}>{p.product_name}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: noEntries ? '#ccc' : undefined }}>{noEntries ? '—' : fmt(p.weighted_avg_selling_price)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: noEntries ? '#ccc' : '#ef4444' }}>{noEntries ? '—' : fmt(p.weighted_avg_cost)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: noEntries ? '#ccc' : '#f97316' }}>{noEntries ? '—' : fmt(p.weighted_avg_shipping)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: noEntries ? '#ccc' : '#f97316' }}>{noEntries ? '—' : fmt(p.fee)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: noEntries ? '#ccc' : p.net_profit >= 0 ? '#16a34a' : '#ef4444' }}>
                      {noEntries ? '—' : fmt(p.net_profit)}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      {noEntries ? <span style={{ color: '#ccc' }}>—</span> : (
                        <span style={{ background: isRisk ? '#fef2f2' : p.margin_rate >= 10 ? '#f0fdf4' : '#fefce8', color: isRisk ? '#ef4444' : p.margin_rate >= 10 ? '#16a34a' : '#ca8a04', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                          {p.margin_rate.toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <span style={{ color: '#18181b' }}>{fmt(p.current_stock)}개</span>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <button
                        onClick={() => setDrawerProductId(p.id)}
                        style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #e5e5e5', background: '#fff', fontSize: '11px', cursor: 'pointer', color: '#555' }}
                      >
                        📋 {p.entry_count}건
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: '10px', fontSize: '11px', color: '#999' }}>
        수수료 = 판매가(가중평균) × 수수료율 &nbsp;|&nbsp; 순이익 = 판매가 − 원가 − 배송비 − 수수료
      </div>

      {drawerProductId && (
        <CostEntryDrawer
          productId={drawerProductId}
          productName={products.find((p) => p.id === drawerProductId)?.product_name ?? ''}
          onClose={() => setDrawerProductId(null)}
          onChanged={load}
        />
      )}
      {showShippingModal && (
        <ShippingGroupModal
          products={products.filter((p) => p.entry_count > 0)}
          onClose={() => setShowShippingModal(false)}
          onCreated={load}
        />
      )}
      {showAddModal && (
        <AddProductModal
          onClose={() => setShowAddModal(false)}
          onAdded={load}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat(ui): CostManagementTab 메인 테이블 — 요약 카드 + 상품 목록"
```

---

## Task 8: CostEntryDrawer — 건별 입고 내역

**Files:**
- Create: `src/components/orders/CostEntryDrawer.tsx`

- [ ] **Step 1: 드로어 컴포넌트 작성**

```typescript
// src/components/orders/CostEntryDrawer.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { X, Plus, Pencil, Trash2 } from 'lucide-react';

interface Entry {
  id: string;
  received_at: string;
  quantity: number;
  unit_cost: number;
  unit_shipping_fee: number;
  selling_price: number;
  shipping_group_id: string | null;
  shipping_group_name: string | null;
}

interface EntryForm {
  received_at: string;
  quantity: string;
  unit_cost: string;
  unit_shipping_fee: string;
  selling_price: string;
}

const EMPTY_FORM: EntryForm = { received_at: new Date().toISOString().slice(0, 10), quantity: '', unit_cost: '', unit_shipping_fee: '0', selling_price: '' };

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

interface Props {
  productId: string;
  productName: string;
  onClose: () => void;
  onChanged: () => void;
}

export default function CostEntryDrawer({ productId, productName, onClose, onChanged }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [form, setForm] = useState<EntryForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/cost-management/products/${productId}/entries`);
    const json = await res.json();
    if (json.success) setEntries(json.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, [productId]);

  async function save() {
    setSaving(true);
    const payload = {
      received_at: form.received_at,
      quantity: Number(form.quantity),
      unit_cost: Number(form.unit_cost),
      unit_shipping_fee: Number(form.unit_shipping_fee),
      selling_price: Number(form.selling_price),
    };
    const url = editingId
      ? `/api/cost-management/entries/${editingId}`
      : `/api/cost-management/products/${productId}/entries`;
    const method = editingId ? 'PATCH' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const json = await res.json();
    if (json.success) {
      await load();
      onChanged();
      setEditingId(null);
      setAddingNew(false);
      setForm(EMPTY_FORM);
    }
    setSaving(false);
  }

  async function deleteEntry(id: string) {
    if (!confirm('이 입고 건을 삭제할까요?')) return;
    const res = await fetch(`/api/cost-management/entries/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) { await load(); onChanged(); }
  }

  function startEdit(e: Entry) {
    setEditingId(e.id);
    setAddingNew(false);
    setForm({
      received_at: e.received_at.slice(0, 10),
      quantity: String(e.quantity),
      unit_cost: String(e.unit_cost),
      unit_shipping_fee: String(e.unit_shipping_fee),
      selling_price: String(e.selling_price),
    });
  }

  // 가중평균 요약
  const totalQty = entries.reduce((s, e) => s + e.quantity, 0);
  const wavgCost = totalQty > 0 ? Math.round(entries.reduce((s, e) => s + e.unit_cost * e.quantity, 0) / totalQty) : 0;
  const wavgShip = totalQty > 0 ? Math.round(entries.reduce((s, e) => s + e.unit_shipping_fee * e.quantity, 0) / totalQty) : 0;

  const FormRow = () => (
    <tr style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
      {(['received_at', 'quantity', 'unit_cost', 'unit_shipping_fee', 'selling_price'] as (keyof EntryForm)[]).map((field) => (
        <td key={field} style={{ padding: '6px 8px' }}>
          <input
            type={field === 'received_at' ? 'date' : 'number'}
            value={form[field]}
            onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
            style={{ width: '100%', padding: '4px 6px', borderRadius: '6px', border: '1px solid #86efac', fontSize: '11px', boxSizing: 'border-box' }}
          />
        </td>
      ))}
      <td style={{ padding: '6px 8px' }} colSpan={2}>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={save} disabled={saving} style={{ padding: '4px 10px', borderRadius: '6px', background: '#16a34a', color: '#fff', border: 'none', fontSize: '11px', cursor: 'pointer' }}>
            {saving ? '저장중' : '저장'}
          </button>
          <button onClick={() => { setEditingId(null); setAddingNew(false); setForm(EMPTY_FORM); }} style={{ padding: '4px 8px', borderRadius: '6px', background: '#f3f4f6', border: 'none', fontSize: '11px', cursor: 'pointer' }}>
            취소
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex' }}>
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.3)' }} />
      <div style={{ width: '720px', background: '#fff', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)' }}>
        {/* 헤더 */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#18181b' }}>입고 내역</div>
            <div style={{ fontSize: '12px', color: '#71717a', marginTop: '2px' }}>{productName}</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px' }}>
            <X size={18} color="#71717a" />
          </button>
        </div>

        {/* 가중평균 요약 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', padding: '16px 24px' }}>
          {[
            { label: '가중평균 원가', value: `${fmt(wavgCost)}원`, color: '#ef4444' },
            { label: '가중평균 배송비', value: `${fmt(wavgShip)}원`, color: '#f97316' },
            { label: '총 재고', value: `${fmt(totalQty)}개`, color: '#18181b' },
          ].map((c) => (
            <div key={c.label} style={{ background: '#f5f5f7', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: '#999', marginBottom: '4px' }}>{c.label}</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: c.color }}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* 건별 테이블 */}
        <div style={{ padding: '0 24px 16px' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
                  {['입고일', '수량', '단가(원가)', '배송비(배분)', '판매가', '배송그룹', ''].map((h) => (
                    <th key={h} style={{ padding: '8px', textAlign: h === '입고일' ? 'left' : 'right', fontWeight: 600, color: '#555' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} style={{ padding: '20px', textAlign: 'center', color: '#71717a' }}>불러오는 중...</td></tr>
                ) : entries.map((e) => (
                  editingId === e.id ? (
                    <FormRow key={e.id} />
                  ) : (
                    <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '8px', color: '#555' }}>{e.received_at.slice(0, 10)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{fmt(e.quantity)}개</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: '#ef4444' }}>{fmt(e.unit_cost)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: '#f97316' }}>
                        {fmt(e.unit_shipping_fee)}
                        {e.shipping_group_name && <span style={{ marginLeft: '4px', fontSize: '9px', color: '#999' }}>({e.shipping_group_name ?? '그룹'})</span>}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{fmt(e.selling_price)}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {e.shipping_group_id
                          ? <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>그룹</span>
                          : <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>개별</span>}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                          <button onClick={() => startEdit(e)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px' }}><Pencil size={12} color="#999" /></button>
                          <button onClick={() => deleteEntry(e.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px' }}><Trash2 size={12} color="#ef4444" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                ))}
                {addingNew && !editingId && <FormRow />}
              </tbody>
            </table>
          </div>

          {!addingNew && !editingId && (
            <button
              onClick={() => { setAddingNew(true); setForm(EMPTY_FORM); }}
              style={{ width: '100%', marginTop: '12px', padding: '8px', borderRadius: '8px', border: '1px dashed #e5e5e5', background: '#fafafa', fontSize: '12px', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              <Plus size={13} /> 새 입고 건 추가
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/orders/CostEntryDrawer.tsx
git commit -m "feat(ui): CostEntryDrawer — 건별 입고 내역 사이드 패널 (CRUD)"
```

---

## Task 9: ShippingGroupModal — 배송비 그룹 생성

**Files:**
- Create: `src/components/orders/ShippingGroupModal.tsx`

- [ ] **Step 1: 배송비 그룹 모달 작성**

```typescript
// src/components/orders/ShippingGroupModal.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { X, Truck } from 'lucide-react';

interface EntryForGroup {
  id: string;
  product_cost_id: string;
  quantity: number;
  shipping_group_id: string | null;
}

interface ProductForGroup {
  id: string;
  product_name: string;
  entry_count: number;
}

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

interface Props {
  products: ProductForGroup[];
  onClose: () => void;
  onCreated: () => void;
}

export default function ShippingGroupModal({ products, onClose, onCreated }: Props) {
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [latestEntries, setLatestEntries] = useState<Map<string, EntryForGroup>>(new Map());
  const [groupName, setGroupName] = useState(`${new Date().toISOString().slice(0, 10)} 로켓그로스 입고`);
  const [totalFee, setTotalFee] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // 선택된 상품의 최신 ungrouped entry 로드
    async function loadEntries() {
      setLoading(true);
      const map = new Map<string, EntryForGroup>();
      await Promise.all(
        products.map(async (p) => {
          const res = await fetch(`/api/cost-management/products/${p.id}/entries`);
          const json = await res.json();
          if (json.success && json.data.length > 0) {
            // shipping_group_id가 없는 최신 entry
            const ungrouped = json.data.find((e: EntryForGroup) => !e.shipping_group_id);
            // product_cost_id를 직접 주입 (entries API는 이 필드를 반환하지 않음)
          if (ungrouped) map.set(p.id, { ...ungrouped, product_cost_id: p.id });
          }
        }),
      );
      setLatestEntries(map);
      setLoading(false);
    }
    loadEntries();
  }, [products]);

  function toggleProduct(id: string) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedEntries = [...selectedProductIds]
    .map((pid) => latestEntries.get(pid))
    .filter((e): e is EntryForGroup => e != null);

  const totalQty = selectedEntries.reduce((s, e) => s + e.quantity, 0);
  const feeNum = Number(totalFee.replace(/,/g, ''));

  function preview() {
    if (totalQty === 0 || !feeNum) return [];
    return selectedEntries.map((e) => {
      const product = products.find((p) => p.id === e.product_cost_id);
      const perUnit = Math.round((feeNum * e.quantity) / totalQty / e.quantity);
      return { name: product?.product_name ?? '', qty: e.quantity, perUnit };
    });
  }

  async function create() {
    if (selectedEntries.length === 0 || !feeNum) return;
    setSaving(true);
    const res = await fetch('/api/cost-management/shipping-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: groupName,
        total_shipping_fee: feeNum,
        entry_ids: selectedEntries.map((e) => e.id),
      }),
    });
    const json = await res.json();
    if (json.success) {
      onCreated();
      onClose();
    }
    setSaving(false);
  }

  const previewRows = preview();

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', width: '480px', maxHeight: '85vh', background: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* 헤더 */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(190,0,20,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Truck size={15} color="#be0014" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 700 }}>배송비 그룹 생성</div>
            <div style={{ fontSize: '11px', color: '#71717a' }}>로켓그로스 공동 입고 배송비 자동 배분</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><X size={16} color="#71717a" /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {/* 그룹명 */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>그룹명</div>
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px', boxSizing: 'border-box' }} />
          </div>

          {/* 상품 선택 */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '8px' }}>상품 선택 (그룹핑할 입고 건)</div>
            <div style={{ background: '#f9f9f9', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {loading ? <div style={{ color: '#999', fontSize: '12px', textAlign: 'center', padding: '8px' }}>로딩중...</div>
                : products.map((p) => {
                  const entry = latestEntries.get(p.id);
                  const disabled = !entry;
                  const selected = selectedProductIds.has(p.id);
                  return (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: disabled ? 'not-allowed' : 'pointer', padding: '8px', borderRadius: '6px', background: '#fff', border: `1px solid ${selected ? '#93c5fd' : '#e5e5e5'}`, opacity: disabled ? 0.5 : 1 }}>
                      <input type="checkbox" checked={selected} disabled={disabled} onChange={() => toggleProduct(p.id)} />
                      <span style={{ flex: 1 }}>{p.product_name}</span>
                      {entry ? <span style={{ fontSize: '11px', color: '#555' }}>수량: <strong>{fmt(entry.quantity)}</strong></span>
                        : <span style={{ fontSize: '11px', color: '#999' }}>미배치 입고 건 없음</span>}
                    </label>
                  );
                })}
            </div>
          </div>

          {/* 총 배송비 */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>총 배송비 (원)</div>
            <input
              type="number"
              value={totalFee}
              onChange={(e) => setTotalFee(e.target.value)}
              placeholder="예: 54000"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '13px', fontWeight: 600, boxSizing: 'border-box' }}
            />
          </div>

          {/* 배분 미리보기 */}
          {previewRows.length > 0 && feeNum > 0 && (
            <div style={{ background: '#f0fdf4', borderRadius: '8px', padding: '12px', border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#166534', marginBottom: '8px' }}>자동 배분 미리보기</div>
              {previewRows.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                  <span style={{ color: '#555' }}>{r.name} ({fmt(r.qty)}개)</span>
                  <span style={{ fontWeight: 600, color: '#16a34a' }}>개당 {fmt(r.perUnit)}원</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid #bbf7d0', marginTop: '6px', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#166534', fontWeight: 600 }}>
                <span>합계 확인</span>
                <span>{fmt(feeNum)}원 ✓</span>
              </div>
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e5e5' }}>
          <button
            onClick={create}
            disabled={saving || selectedEntries.length === 0 || !feeNum}
            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', background: selectedEntries.length > 0 && feeNum ? '#be0014' : '#e5e5e5', color: selectedEntries.length > 0 && feeNum ? '#fff' : '#999', fontSize: '13px', fontWeight: 600, cursor: selectedEntries.length > 0 && feeNum ? 'pointer' : 'not-allowed' }}
          >
            {saving ? '생성 중...' : '그룹 생성 & 배분 적용'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/orders/ShippingGroupModal.tsx
git commit -m "feat(ui): ShippingGroupModal — 배송비 그룹 생성 + 수량 비례 배분 미리보기"
```

---

## Task 10: AddProductModal — 상품 추가

**Files:**
- Create: `src/components/orders/AddProductModal.tsx`

- [ ] **Step 1: 상품 추가 모달 작성**

```typescript
// src/components/orders/AddProductModal.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { X, Package } from 'lucide-react';

interface CoupangProduct {
  seller_product_id: number;
  seller_product_name: string;
}

type Mode = 'coupang' | 'manual';

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

export default function AddProductModal({ onClose, onAdded }: Props) {
  const [mode, setMode] = useState<Mode>('coupang');
  const [coupangProducts, setCoupangProducts] = useState<CoupangProduct[]>([]);
  const [loadingCoupang, setLoadingCoupang] = useState(true);
  const [selectedCoupang, setSelectedCoupang] = useState<CoupangProduct | null>(null);
  const [manualName, setManualName] = useState('');
  const [feeRate, setFeeRate] = useState('10.8');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/cost-management/coupang-products')
      .then((r) => r.json())
      .then((j) => { if (j.success) setCoupangProducts(j.data); })
      .finally(() => setLoadingCoupang(false));
  }, []);

  async function add() {
    const isCoupang = mode === 'coupang' && selectedCoupang;
    const isManual = mode === 'manual' && manualName.trim();
    if (!isCoupang && !isManual) return;

    setSaving(true);
    const body = isCoupang
      ? { product_name: selectedCoupang!.seller_product_name, seller_product_id: selectedCoupang!.seller_product_id, platform_fee_rate: Number(feeRate) / 100 }
      : { product_name: manualName.trim(), platform_fee_rate: Number(feeRate) / 100 };

    const res = await fetch('/api/cost-management/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) { onAdded(); onClose(); }
    setSaving(false);
  }

  const canSave = mode === 'coupang' ? !!selectedCoupang : manualName.trim().length > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', width: '420px', background: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
        {/* 헤더 */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(190,0,20,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Package size={15} color="#be0014" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 700 }}>상품 추가</div>
            <div style={{ fontSize: '11px', color: '#71717a' }}>원가 관리할 상품을 선택하거나 직접 입력하세요</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><X size={16} color="#71717a" /></button>
        </div>

        <div style={{ padding: '16px 24px 20px' }}>
          {/* 모드 탭 */}
          <div style={{ display: 'flex', gap: '4px', padding: '4px', borderRadius: '10px', background: '#f5f5f7', marginBottom: '16px' }}>
            {(['coupang', 'manual'] as Mode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: '8px', borderRadius: '7px', border: 'none', fontSize: '12px', fontWeight: mode === m ? 600 : 500, color: mode === m ? '#be0014' : '#71717a', background: mode === m ? '#fff' : 'transparent', cursor: 'pointer', boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>
                {m === 'coupang' ? '쿠팡 등록 상품' : '직접 입력'}
              </button>
            ))}
          </div>

          {mode === 'coupang' ? (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '8px' }}>쿠팡 등록 상품 선택</div>
              <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #e5e5e5', borderRadius: '8px' }}>
                {loadingCoupang ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '12px' }}>로딩중...</div>
                ) : coupangProducts.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '12px' }}>연동 가능한 상품이 없습니다</div>
                ) : coupangProducts.map((p) => (
                  <div
                    key={p.seller_product_id}
                    onClick={() => setSelectedCoupang(p)}
                    style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '12px', borderBottom: '1px solid #f0f0f0', background: selectedCoupang?.seller_product_id === p.seller_product_id ? '#fef2f2' : '#fff', color: selectedCoupang?.seller_product_id === p.seller_product_id ? '#be0014' : '#18181b', fontWeight: selectedCoupang?.seller_product_id === p.seller_product_id ? 600 : 400 }}
                  >
                    {p.seller_product_name}
                    <span style={{ fontSize: '10px', color: '#999', marginLeft: '8px' }}>#{p.seller_product_id}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>상품명</div>
              <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="상품명을 입력하세요" style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px', boxSizing: 'border-box' }} />
            </div>
          )}

          {/* 수수료율 */}
          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>플랫폼 수수료율 (%)</div>
            <input type="number" value={feeRate} onChange={(e) => setFeeRate(e.target.value)} step="0.1" min="0" max="50" style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px', boxSizing: 'border-box' }} />
            <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>로켓그로스 기본 10.8% — 필요 시 수정하세요</div>
          </div>

          <button
            onClick={add}
            disabled={saving || !canSave}
            style={{ width: '100%', marginTop: '20px', padding: '10px', borderRadius: '8px', border: 'none', background: canSave ? '#be0014' : '#e5e5e5', color: canSave ? '#fff' : '#999', fontSize: '13px', fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed' }}
          >
            {saving ? '추가 중...' : '상품 추가'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 빌드 확인**

```bash
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 전체 테스트 실행**

```bash
npx vitest run
```

Expected: 기존 테스트 + 계산 로직 테스트 모두 PASS

- [ ] **Step 4: 커밋**

```bash
git add src/components/orders/AddProductModal.tsx
git commit -m "feat(ui): AddProductModal — 쿠팡 연동/수동 입력 상품 추가 모달"
```

---

## 완료 체크리스트

- [ ] `056_cost_management.sql` 마이그레이션 적용됨
- [ ] 계산 로직 테스트 전부 PASS
- [ ] API 8개 모두 구현 (products GET/POST, entries GET/POST/PATCH/DELETE, stock PATCH, shipping-groups POST, coupang-products GET)
- [ ] 주문/매출 탭에 "원가관리" 탭 표시됨
- [ ] 상품 추가 → 입고 건 추가 → 원가·마진율 표시 흐름 작동
- [ ] 배송비 그룹 생성 → entries 배분 반영됨
- [ ] 마진율 음수 행 빨간 배경 강조 표시됨
- [ ] TypeScript 빌드 에러 없음
