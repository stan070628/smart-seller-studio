# 입고/판매 완전 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `cost_entries`에서 판매 정보를 분리해 독립된 `sale_records` 테이블을 만들고, FIFO 원가 계산과 쿠팡 자동 수입으로 실현손익을 정확히 계산한다.

**Architecture:** DB 마이그레이션(058)으로 `sale_records` 테이블 신설 + 기존 `selling_price` 데이터 이전 → 순수 FIFO 계산 라이브러리(`fifo.ts`) → REST API 4종 → UI 컴포넌트 좌우 분할 드로어.

**Tech Stack:** Next.js App Router (TypeScript), PostgreSQL via `getSourcingPool()`, Vitest, React inline-style

---

## 파일 구조

| 파일 | 역할 |
|------|------|
| `supabase/migrations/058_sale_records.sql` | sale_records 생성, selling_price 마이그레이션, 컬럼 제거 |
| `src/lib/cost-management/fifo.ts` | FIFO 순수 계산 함수 |
| `src/lib/cost-management/__tests__/fifo.test.ts` | FIFO 단위 테스트 |
| `src/app/api/cost-management/products/[id]/sales/route.ts` | GET(판매 목록) + POST(수동 추가) |
| `src/app/api/cost-management/sales/[id]/route.ts` | PATCH(수정) + DELETE(삭제) |
| `src/app/api/cost-management/products/[id]/coupang-import/route.ts` | 쿠팡 주문 자동 수입 |
| `src/components/orders/SaleEntryPanel.tsx` | 드로어 우측 판매 패널 |
| `src/components/orders/CostEntryDrawer.tsx` | 좌우 분할 레이아웃으로 재구성 |
| `src/app/api/cost-management/products/[id]/entries/route.ts` | selling_price 제거 |
| `src/app/api/cost-management/products/route.ts` | FIFO 기반 지표로 교체 |
| `src/lib/cost-management/calculations.ts` | selling_price 참조 제거 |

---

## Task 1: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/058_sale_records.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- supabase/migrations/058_sale_records.sql
-- sale_records 테이블 신설
CREATE TABLE IF NOT EXISTS sale_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid,
  product_cost_id       uuid NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  sold_at               date NOT NULL,
  quantity              integer NOT NULL CHECK (quantity > 0),
  selling_price         integer NOT NULL CHECK (selling_price >= 0),
  channel               text NOT NULL DEFAULT 'manual',
  coupang_order_item_id text UNIQUE,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sale_records_product_cost_id_sold_at_idx
  ON sale_records (product_cost_id, sold_at);
CREATE INDEX IF NOT EXISTS sale_records_user_id_sold_at_idx
  ON sale_records (user_id, sold_at);

-- 기존 cost_entries.selling_price > 0 행을 sale_records로 이전
INSERT INTO sale_records (user_id, product_cost_id, sold_at, quantity, selling_price, channel)
SELECT user_id, product_cost_id, received_at, quantity, selling_price, 'manual'
FROM cost_entries
WHERE selling_price > 0;

-- cost_entries에서 selling_price 제거
ALTER TABLE cost_entries DROP CONSTRAINT IF EXISTS cost_entries_selling_price_check;
ALTER TABLE cost_entries DROP COLUMN IF EXISTS selling_price;
```

- [ ] **Step 2: 마이그레이션 적용**

```bash
# Render PostgreSQL 직접 실행 (DATABASE_URL은 .env.local 참조)
node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(fs.readFileSync('supabase/migrations/058_sale_records.sql', 'utf8'))
  .then(() => { console.log('OK'); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); process.exit(1); });
"
```

Expected: `OK`

- [ ] **Step 3: 스키마 확인**

```bash
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
Promise.all([
  pool.query('SELECT column_name FROM information_schema.columns WHERE table_name=\\'sale_records\\' ORDER BY ordinal_position'),
  pool.query('SELECT column_name FROM information_schema.columns WHERE table_name=\\'cost_entries\\' ORDER BY ordinal_position'),
]).then(([sr, ce]) => {
  console.log('sale_records:', sr.rows.map(r=>r.column_name).join(', '));
  console.log('cost_entries:', ce.rows.map(r=>r.column_name).join(', '));
  pool.end();
});
"
```

Expected:
```
sale_records: id, user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id, created_at
cost_entries: id, user_id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, shipping_group_id, created_at
```
(`selling_price` 없는 것 확인)

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/058_sale_records.sql
git commit -m "feat(db): sale_records 테이블 추가 및 cost_entries.selling_price 분리"
```

---

## Task 2: FIFO 계산 라이브러리

**Files:**
- Create: `src/lib/cost-management/fifo.ts`
- Create: `src/lib/cost-management/__tests__/fifo.test.ts`

- [ ] **Step 1: 테스트 파일 작성 (먼저 실패 확인)**

```typescript
// src/lib/cost-management/__tests__/fifo.test.ts
import { describe, it, expect } from 'vitest';
import { calculateFifo } from '../fifo';

describe('calculateFifo', () => {
  it('판매 없음 → current_stock = 입고 합계, realized_profit = 0', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 30, unit_cost: 15000, unit_shipping_fee: 800 },
      { id: 'b2', received_at: '2026-04-10', quantity: 20, unit_cost: 14500, unit_shipping_fee: 800 },
    ];
    const result = calculateFifo(batches, [], 0.108);
    expect(result.current_stock).toBe(50);
    expect(result.stock_value).toBe(30 * 15000 + 20 * 14500);
    expect(result.total_realized_profit).toBe(0);
    expect(result.sale_details).toHaveLength(0);
  });

  it('FIFO: 오래된 배치부터 소진됨', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 15000, unit_shipping_fee: 0 },
      { id: 'b2', received_at: '2026-04-10', quantity: 10, unit_cost: 20000, unit_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 10, selling_price: 30000 },
    ];
    const result = calculateFifo(batches, sales, 0);
    // b1이 먼저 소진되어야 함
    expect(result.sale_details[0].fifo_cost_per_unit).toBe(15000);
    expect(result.current_stock).toBe(10); // b2 잔여
    expect(result.stock_value).toBe(10 * 20000);
  });

  it('배치 걸친 판매 → 가중평균 원가', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 5, unit_cost: 10000, unit_shipping_fee: 0 },
      { id: 'b2', received_at: '2026-04-10', quantity: 5, unit_cost: 20000, unit_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 10, selling_price: 30000 },
    ];
    const result = calculateFifo(batches, sales, 0);
    // (10000*5 + 20000*5) / 10 = 15000
    expect(result.sale_details[0].fifo_cost_per_unit).toBe(15000);
    expect(result.current_stock).toBe(0);
    expect(result.stock_value).toBe(0);
  });

  it('수수료 포함 실현손익 계산', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 10, selling_price: 20000 },
    ];
    const result = calculateFifo(batches, sales, 0.1);
    // profit_per_unit = 20000 - 10000 - round(20000*0.1) = 20000 - 10000 - 2000 = 8000
    expect(result.sale_details[0].realized_profit_per_unit).toBe(8000);
    expect(result.total_realized_profit).toBe(80000);
  });

  it('배송비 포함 원가로 FIFO', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 14000, unit_shipping_fee: 1000 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 5, selling_price: 25000 },
    ];
    const result = calculateFifo(batches, sales, 0);
    // fifo cost = (14000 + 1000) = 15000/unit
    expect(result.sale_details[0].fifo_cost_per_unit).toBe(15000);
    expect(result.current_stock).toBe(5);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/lib/cost-management/__tests__/fifo.test.ts 2>&1 | tail -10
```

Expected: FAIL (fifo.ts 없음)

- [ ] **Step 3: fifo.ts 구현**

```typescript
// src/lib/cost-management/fifo.ts
export interface PurchaseBatch {
  id: string;
  received_at: string;
  quantity: number;
  unit_cost: number;
  unit_shipping_fee: number;
}

export interface SaleRow {
  id: string;
  sold_at: string;
  quantity: number;
  selling_price: number;
}

export interface SaleFifoDetail {
  saleId: string;
  fifo_cost_per_unit: number;
  realized_profit_per_unit: number;
}

export interface FifoSummary {
  current_stock: number;
  stock_value: number;
  total_realized_profit: number;
  sale_details: SaleFifoDetail[];
}

export function calculateFifo(
  batches: PurchaseBatch[],
  sales: SaleRow[],
  platformFeeRate: number,
): FifoSummary {
  const sortedBatches = [...batches].sort((a, b) => a.received_at.localeCompare(b.received_at));
  const sortedSales = [...sales].sort((a, b) => a.sold_at.localeCompare(b.sold_at));

  const queue = sortedBatches.map((b) => ({ ...b, remaining: b.quantity }));

  const sale_details: SaleFifoDetail[] = [];
  let total_realized_profit = 0;

  for (const sale of sortedSales) {
    let qtyLeft = sale.quantity;
    let totalCost = 0;

    for (const batch of queue) {
      if (qtyLeft <= 0) break;
      const take = Math.min(batch.remaining, qtyLeft);
      totalCost += (batch.unit_cost + batch.unit_shipping_fee) * take;
      batch.remaining -= take;
      qtyLeft -= take;
    }

    const fifo_cost_per_unit = sale.quantity > 0 ? Math.round(totalCost / sale.quantity) : 0;
    const fee_per_unit = Math.round(sale.selling_price * platformFeeRate);
    const realized_profit_per_unit = sale.selling_price - fifo_cost_per_unit - fee_per_unit;

    sale_details.push({ saleId: sale.id, fifo_cost_per_unit, realized_profit_per_unit });
    total_realized_profit += realized_profit_per_unit * sale.quantity;
  }

  const current_stock = queue.reduce((s, b) => s + b.remaining, 0);
  const stock_value = queue.reduce((s, b) => s + b.unit_cost * b.remaining, 0);

  return { current_stock, stock_value, total_realized_profit, sale_details };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/cost-management/__tests__/fifo.test.ts 2>&1 | tail -5
```

Expected: `5 passed`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/cost-management/fifo.ts src/lib/cost-management/__tests__/fifo.test.ts
git commit -m "feat(lib): FIFO 원가 계산 라이브러리 추가"
```

---

## Task 3: calculations.ts에서 selling_price 참조 제거

**Files:**
- Modify: `src/lib/cost-management/calculations.ts`

- [ ] **Step 1: CostEntryRow에서 selling_price 제거, ProductMetrics 정리**

현재 파일을 아래로 교체한다. (selling_price 없는 엔트리, selling_price 기반 지표 제거)

```typescript
// src/lib/cost-management/calculations.ts
export interface CostEntryRow {
  id: string;
  product_cost_id: string;
  received_at: string;
  quantity: number;
  unit_cost: number;
  unit_shipping_fee: number;
  shipping_group_id: string | null;
}

export interface ProductMetrics {
  weighted_avg_cost: number;
  weighted_avg_shipping: number;
  total_quantity: number;
  total_purchase_amount: number;
}

export function calculateWeightedAvg(
  entries: Pick<CostEntryRow, 'quantity' | 'unit_cost' | 'unit_shipping_fee'>[],
  field: 'unit_cost' | 'unit_shipping_fee',
): number {
  const totalQty = entries.reduce((s, e) => s + e.quantity, 0);
  if (totalQty === 0) return 0;
  return Math.round(entries.reduce((s, e) => s + e[field] * e.quantity, 0) / totalQty);
}

export function calculateProductMetrics(entries: CostEntryRow[]): ProductMetrics {
  if (entries.length === 0) {
    return { weighted_avg_cost: 0, weighted_avg_shipping: 0, total_quantity: 0, total_purchase_amount: 0 };
  }

  const weighted_avg_cost = calculateWeightedAvg(entries, 'unit_cost');
  const weighted_avg_shipping = calculateWeightedAvg(entries, 'unit_shipping_fee');
  const total_quantity = entries.reduce((s, e) => s + e.quantity, 0);
  const total_purchase_amount = entries.reduce((s, e) => s + e.unit_cost * e.quantity, 0);

  return { weighted_avg_cost, weighted_avg_shipping, total_quantity, total_purchase_amount };
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
  for (let i = 1; i < entries.length; i++) {
    const fee = Math.round((totalShippingFee * entries[i].quantity) / totalQty);
    result.set(entries[i].id, fee);
    remaining -= fee;
  }
  result.set(entries[0].id, remaining);
  return result;
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep calculations | head -20
```

Expected: 오류 없음 (빈 출력)

- [ ] **Step 3: 커밋**

```bash
git add src/lib/cost-management/calculations.ts
git commit -m "refactor(calculations): selling_price 참조 제거, ProductMetrics 단순화"
```

---

## Task 4: entries API에서 selling_price 제거

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/entries/route.ts`
- Modify: `src/app/api/cost-management/entries/[id]/route.ts` (존재하는 경우)

- [ ] **Step 1: entries/route.ts GET과 POST에서 selling_price 제거**

`src/app/api/cost-management/products/[id]/entries/route.ts` 전체를 아래로 교체:

```typescript
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

  const { rows: check } = await pool.query(
    `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const { rows } = await pool.query(
    `SELECT ce.id, ce.received_at, ce.quantity, ce.unit_cost, ce.unit_shipping_fee,
            ce.shipping_group_id, sg.name as shipping_group_name, ce.created_at
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
  const { received_at, quantity, unit_cost, unit_shipping_fee } = body ?? {};

  if (
    !received_at ||
    quantity == null || !Number.isInteger(quantity) || quantity <= 0 ||
    unit_cost == null || unit_cost < 0
  ) {
    return NextResponse.json(
      { success: false, error: 'received_at, quantity(>0), unit_cost(>=0) required' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  const { rows: check } = await pool.query(
    `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const { rows } = await pool.query(
    `INSERT INTO cost_entries (user_id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [user.userId, id, received_at, quantity, unit_cost, unit_shipping_fee ?? 0],
  );

  return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
}
```

- [ ] **Step 2: entries/[id] PATCH 라우트 확인 및 selling_price 제거**

```bash
find src/app/api/cost-management/entries -name "route.ts" 2>/dev/null
```

파일이 있으면 PATCH 핸들러에서 selling_price 파라미터와 UPDATE 쿼리의 selling_price 참조를 제거한다:

```typescript
// PATCH 핸들러 내 body 구조분해에서 selling_price 제거
const { received_at, quantity, unit_cost, unit_shipping_fee } = body ?? {};

// UPDATE 쿼리에서 selling_price 제거
const { rows } = await pool.query(
  `UPDATE cost_entries
   SET received_at=$1, quantity=$2, unit_cost=$3, unit_shipping_fee=$4
   WHERE id=$5 AND user_id=$6
   RETURNING *`,
  [received_at, quantity, unit_cost, unit_shipping_fee ?? 0, id, user.userId],
);
```

- [ ] **Step 3: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep entries | head -20
```

Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add "src/app/api/cost-management/products/[id]/entries/route.ts"
git commit -m "refactor(api): entries 라우트에서 selling_price 제거"
```

---

## Task 5: 판매 내역 API (GET/POST + PATCH/DELETE)

**Files:**
- Create: `src/app/api/cost-management/products/[id]/sales/route.ts`
- Create: `src/app/api/cost-management/sales/[id]/route.ts`

- [ ] **Step 1: 판매 목록 + 추가 라우트 작성**

```typescript
// src/app/api/cost-management/products/[id]/sales/route.ts
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

  const { rows: check } = await pool.query(
    `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const { rows } = await pool.query(
    `SELECT id, sold_at, quantity, selling_price, channel, coupang_order_item_id, created_at
     FROM sale_records
     WHERE product_cost_id = $1
     ORDER BY sold_at DESC, created_at DESC`,
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
  const { sold_at, quantity, selling_price } = body ?? {};

  if (
    !sold_at ||
    quantity == null || !Number.isInteger(quantity) || quantity <= 0 ||
    selling_price == null || !Number.isInteger(selling_price) || selling_price < 0
  ) {
    return NextResponse.json(
      { success: false, error: 'sold_at, quantity(>0), selling_price(>=0) required' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  const { rows: check } = await pool.query(
    `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const { rows } = await pool.query(
    `INSERT INTO sale_records (user_id, product_cost_id, sold_at, quantity, selling_price, channel)
     VALUES ($1, $2, $3, $4, $5, 'manual')
     RETURNING *`,
    [user.userId, id, sold_at, quantity, selling_price],
  );

  return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
}
```

- [ ] **Step 2: 판매 수정/삭제 라우트 작성**

```typescript
// src/app/api/cost-management/sales/[id]/route.ts
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
  const { sold_at, quantity, selling_price } = body ?? {};

  if (
    !sold_at ||
    quantity == null || !Number.isInteger(quantity) || quantity <= 0 ||
    selling_price == null || !Number.isInteger(selling_price) || selling_price < 0
  ) {
    return NextResponse.json(
      { success: false, error: 'sold_at, quantity(>0), selling_price(>=0) required' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `UPDATE sale_records SET sold_at=$1, quantity=$2, selling_price=$3
     WHERE id=$4 AND user_id=$5
     RETURNING *`,
    [sold_at, quantity, selling_price, id, user.userId],
  );

  if (rows.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
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
  const { rows } = await pool.query(
    `DELETE FROM sale_records WHERE id=$1 AND user_id=$2 RETURNING id`,
    [id, user.userId],
  );

  if (rows.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep sales | head -20
```

Expected: 오류 없음

- [ ] **Step 4: curl로 POST 테스트 (dev 서버 실행 중 가정)**

```bash
# 테스트용 — product_cost_id는 실제 존재하는 ID로 교체
curl -s -X POST http://localhost:3000/api/cost-management/products/PRODUCT_ID/sales \
  -H "Content-Type: application/json" \
  -d '{"sold_at":"2026-05-01","quantity":5,"selling_price":25000}' | jq .
```

Expected: `{"success":true,"data":{...}}`

- [ ] **Step 5: 커밋**

```bash
git add "src/app/api/cost-management/products/[id]/sales/route.ts" \
        "src/app/api/cost-management/sales/[id]/route.ts"
git commit -m "feat(api): 판매 내역 GET/POST/PATCH/DELETE 라우트 추가"
```

---

## Task 6: 쿠팡 주문 자동 수입 API

**Files:**
- Create: `src/app/api/cost-management/products/[id]/coupang-import/route.ts`

- [ ] **Step 1: coupang-import 라우트 작성**

```typescript
// src/app/api/cost-management/products/[id]/coupang-import/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { from, to } = body ?? {};

  if (!from || !to) {
    return NextResponse.json({ success: false, error: 'from, to (YYYY-MM-DD) required' }, { status: 400 });
  }

  const pool = getSourcingPool();

  const { rows: products } = await pool.query(
    `SELECT id, seller_product_id FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (products.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const sellerProductId = products[0].seller_product_id;
  if (!sellerProductId) {
    return NextResponse.json(
      { success: false, error: '이 상품에 쿠팡 seller_product_id가 연결되지 않았습니다.' },
      { status: 400 },
    );
  }

  try {
    const client = getCoupangClient();

    // 모든 페이지 수집 (nextToken 방식 페이지네이션)
    const allOrders = [];
    let nextToken: string | null = null;
    do {
      const result = await client.getOrders({
        createdAtFrom: from,
        createdAtTo: to,
        status: 'FINAL_DELIVERY',
        maxPerPage: 50,
        ...(nextToken ? { nextToken } : {}),
      });
      allOrders.push(...result.items);
      nextToken = result.nextToken;
    } while (nextToken);

    // 이 상품의 라인 아이템만 필터 (취소 제외)
    const matchedItems = allOrders.flatMap((order) =>
      order.orderItems
        .filter((item) => Number(item.sellerProductId) === Number(sellerProductId) && !item.canceled)
        .map((item) => ({
          sold_at: order.paidAt?.slice(0, 10) ?? order.orderedAt.slice(0, 10),
          quantity: item.shippingCount,
          selling_price: item.shippingCount > 0
            ? Math.round(item.orderPrice / item.shippingCount)
            : item.salesPrice,
          coupang_order_item_id: `${order.orderId}-${item.vendorItemId}`,
        })),
    );

    let imported = 0;
    let skipped = 0;
    for (const item of matchedItems) {
      const result = await pool.query(
        `INSERT INTO sale_records
           (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id)
         VALUES ($1, $2, $3, $4, $5, 'coupang', $6)
         ON CONFLICT (coupang_order_item_id) DO NOTHING`,
        [user.userId, id, item.sold_at, item.quantity, item.selling_price, item.coupang_order_item_id],
      );
      if ((result.rowCount ?? 0) > 0) imported++;
      else skipped++;
    }

    return NextResponse.json({ success: true, data: { imported, skipped, total: matchedItems.length } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep coupang-import | head -10
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add "src/app/api/cost-management/products/[id]/coupang-import/route.ts"
git commit -m "feat(api): 쿠팡 주문 자동 수입 라우트 추가"
```

---

## Task 7: products API FIFO 기반 지표로 교체

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`

- [ ] **Step 1: GET �핸들러를 FIFO 기반으로 교체**

`src/app/api/cost-management/products/route.ts`의 GET 함수 전체를 아래로 교체한다. POST 함수는 그대로 유지한다.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { calculateProductMetrics } from '@/lib/cost-management/calculations';
import type { CostEntryRow } from '@/lib/cost-management/calculations';
import { calculateFifo } from '@/lib/cost-management/fifo';
import type { PurchaseBatch, SaleRow } from '@/lib/cost-management/fifo';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const pool = getSourcingPool();

    const { rows: products } = await pool.query(
      `SELECT id, product_name, seller_product_id, platform, platform_fee_rate, created_at
       FROM product_costs
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user.userId],
    );

    // 입고 전체 조회 (기간 필터는 판매 지표에만 적용, 재고는 전체 입고 기준)
    const { rows: allEntries } = await pool.query(
      `SELECT id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, shipping_group_id
       FROM cost_entries WHERE user_id = $1`,
      [user.userId],
    );

    // 판매는 기간 필터 적용
    const saleQuery = from && to
      ? `SELECT id, product_cost_id, sold_at, quantity, selling_price FROM sale_records WHERE user_id = $1 AND sold_at BETWEEN $2 AND $3`
      : `SELECT id, product_cost_id, sold_at, quantity, selling_price FROM sale_records WHERE user_id = $1`;
    const saleParams = from && to ? [user.userId, from, to] : [user.userId];
    const { rows: allSales } = await pool.query(saleQuery, saleParams);

    const entriesByProduct = new Map<string, CostEntryRow[]>();
    for (const e of allEntries) {
      const list = entriesByProduct.get(e.product_cost_id) ?? [];
      list.push({
        id: e.id,
        product_cost_id: e.product_cost_id,
        received_at: e.received_at,
        quantity: Number(e.quantity),
        unit_cost: Number(e.unit_cost),
        unit_shipping_fee: Number(e.unit_shipping_fee),
        shipping_group_id: e.shipping_group_id,
      });
      entriesByProduct.set(e.product_cost_id, list);
    }

    const salesByProduct = new Map<string, SaleRow[]>();
    for (const s of allSales) {
      const list = salesByProduct.get(s.product_cost_id) ?? [];
      list.push({
        id: s.id,
        sold_at: s.sold_at,
        quantity: Number(s.quantity),
        selling_price: Number(s.selling_price),
      });
      salesByProduct.set(s.product_cost_id, list);
    }

    const data = products.map((p) => {
      const pEntries = entriesByProduct.get(p.id) ?? [];
      const pSales = salesByProduct.get(p.id) ?? [];
      const feeRate = Number(p.platform_fee_rate);

      const metrics = calculateProductMetrics(pEntries);
      const fifo = calculateFifo(
        pEntries.map((e) => ({
          id: e.id,
          received_at: e.received_at,
          quantity: e.quantity,
          unit_cost: e.unit_cost,
          unit_shipping_fee: e.unit_shipping_fee,
        } as PurchaseBatch)),
        pSales,
        feeRate,
      );

      return {
        id: p.id,
        product_name: p.product_name,
        seller_product_id: p.seller_product_id,
        platform: p.platform,
        platform_fee_rate: feeRate,
        entry_count: pEntries.length,
        sale_count: pSales.length,
        weighted_avg_cost: metrics.weighted_avg_cost,
        weighted_avg_shipping: metrics.weighted_avg_shipping,
        total_purchase_amount: metrics.total_purchase_amount,
        current_stock: fifo.current_stock,
        stock_value: fifo.stock_value,
        total_realized_profit: fifo.total_realized_profit,
        total_sales_amount: pSales.reduce((s, sale) => s + sale.selling_price * sale.quantity, 0),
      };
    });

    const summary = {
      total_purchase_amount: data.reduce((s, p) => s + p.total_purchase_amount, 0),
      total_sales_amount: data.reduce((s, p) => s + p.total_sales_amount, 0),
      total_realized_profit: data.reduce((s, p) => s + p.total_realized_profit, 0),
    };

    return NextResponse.json({ success: true, data, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add "src/app/api/cost-management/products/route.ts"
git commit -m "feat(api): products 목록 FIFO 기반 지표(재고/실현손익/재고가치)로 교체"
```

---

## Task 8: SaleEntryPanel 컴포넌트

**Files:**
- Create: `src/components/orders/SaleEntryPanel.tsx`

- [ ] **Step 1: SaleEntryPanel 작성**

```typescript
// src/components/orders/SaleEntryPanel.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, CloudDownload } from 'lucide-react';

interface SaleRecord {
  id: string;
  sold_at: string;
  quantity: number;
  selling_price: number;
  channel: string;
  coupang_order_item_id: string | null;
}

interface SaleForm {
  sold_at: string;
  quantity: string;
  selling_price: string;
}

function emptyForm(): SaleForm {
  return { sold_at: new Date().toISOString().slice(0, 10), quantity: '', selling_price: '' };
}

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

interface ImportForm {
  from: string;
  to: string;
}

interface Props {
  productId: string;
  sellerProductId: number | null;
  onChanged: () => void;
}

export default function SaleEntryPanel({ productId, sellerProductId, onChanged }: Props) {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [form, setForm] = useState<SaleForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [importForm, setImportForm] = useState<ImportForm>({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/cost-management/products/${productId}/sales`);
    const json = await res.json();
    if (json.success) setSales(json.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, [productId]);

  async function save() {
    const qty = Math.round(Number(form.quantity));
    const price = Math.round(Number(form.selling_price));
    if (!form.sold_at || qty <= 0) { alert('판매일과 수량을 입력해 주세요.'); return; }
    setSaving(true);
    try {
      const payload = { sold_at: form.sold_at, quantity: qty, selling_price: price };
      const url = editingId
        ? `/api/cost-management/sales/${editingId}`
        : `/api/cost-management/products/${productId}/sales`;
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (json.success) {
        await load();
        onChanged();
        setEditingId(null);
        setAddingNew(false);
        setForm(emptyForm());
      } else {
        alert(json.error ?? '저장에 실패했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteSale(id: string) {
    if (!confirm('이 판매 건을 삭제할까요?')) return;
    const res = await fetch(`/api/cost-management/sales/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) { await load(); onChanged(); }
    else alert(json.error ?? '삭제에 실패했습니다.');
  }

  function startEdit(s: SaleRecord) {
    setEditingId(s.id);
    setAddingNew(false);
    setForm({ sold_at: s.sold_at.slice(0, 10), quantity: String(s.quantity), selling_price: String(s.selling_price) });
  }

  async function runImport() {
    setImporting(true);
    try {
      const res = await fetch(`/api/cost-management/products/${productId}/coupang-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importForm),
      });
      const json = await res.json();
      if (json.success) {
        const { imported, skipped } = json.data;
        alert(`${imported}건 가져옴, ${skipped}건 중복 스킵`);
        await load();
        onChanged();
        setShowImportForm(false);
      } else {
        alert(json.error ?? '가져오기에 실패했습니다.');
      }
    } finally {
      setImporting(false);
    }
  }

  const canSave = !!form.sold_at && Number(form.quantity) > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '6px' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#18181b' }}>💰 판매 내역</span>
        {sellerProductId && (
          <button
            onClick={() => setShowImportForm((v) => !v)}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '6px', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', fontSize: '11px', cursor: 'pointer' }}
          >
            <CloudDownload size={12} /> 쿠팡 가져오기
          </button>
        )}
      </div>

      {showImportForm && (
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '6px', padding: '10px', marginBottom: '8px', fontSize: '11px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="date" value={importForm.from} onChange={(e) => setImportForm((f) => ({ ...f, from: e.target.value }))}
              style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #bae6fd', fontSize: '11px', color: '#18181b' }} />
            <span style={{ color: '#64748b' }}>~</span>
            <input type="date" value={importForm.to} onChange={(e) => setImportForm((f) => ({ ...f, to: e.target.value }))}
              style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #bae6fd', fontSize: '11px', color: '#18181b' }} />
            <button onClick={runImport} disabled={importing}
              style={{ padding: '3px 10px', borderRadius: '4px', background: '#1d4ed8', color: '#fff', border: 'none', fontSize: '11px', cursor: importing ? 'not-allowed' : 'pointer' }}>
              {importing ? '가져오는 중...' : '실행'}
            </button>
          </div>
        </div>
      )}

      <div style={{ overflowY: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
              {['판매일', '수량', '판매가', '채널', ''].map((h) => (
                <th key={h} style={{ padding: '6px 8px', textAlign: h === '판매일' ? 'left' : 'right', fontWeight: 600, color: '#27272a' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: '#52525b' }}>불러오는 중...</td></tr>
            ) : sales.map((s) => (
              editingId === s.id ? (
                <tr key={s.id} style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
                  <td style={{ padding: '4px 6px' }}>
                    <input type="date" value={form.sold_at} onChange={(e) => setForm((f) => ({ ...f, sold_at: e.target.value }))}
                      style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }} />
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <input type="number" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                      style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }} />
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <input type="number" value={form.selling_price} onChange={(e) => setForm((f) => ({ ...f, selling_price: e.target.value }))}
                      style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }} />
                  </td>
                  <td colSpan={2} style={{ padding: '4px 6px' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button onClick={save} disabled={saving || !canSave}
                        style={{ padding: '3px 8px', borderRadius: '4px', background: canSave ? '#16a34a' : '#d4d4d4', color: canSave ? '#fff' : '#71717a', border: 'none', fontSize: '11px', cursor: canSave ? 'pointer' : 'not-allowed' }}>
                        {saving ? '저장중' : '저장'}
                      </button>
                      <button onClick={() => { setEditingId(null); setForm(emptyForm()); }}
                        style={{ padding: '3px 6px', borderRadius: '4px', background: '#f3f4f6', border: 'none', fontSize: '11px', cursor: 'pointer', color: '#27272a' }}>취소</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '6px 8px', color: '#27272a' }}>{s.sold_at.slice(0, 10)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{fmt(s.quantity)}개</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: '#2563eb' }}>{fmt(s.selling_price)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <span style={{ background: s.channel === 'coupang' ? '#dbeafe' : '#f3f4f6', color: s.channel === 'coupang' ? '#1d4ed8' : '#6b7280', padding: '2px 5px', borderRadius: '3px', fontSize: '10px' }}>
                      {s.channel === 'coupang' ? '쿠팡' : '직접'}
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                      <button onClick={() => startEdit(s)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px' }}><Pencil size={11} color="#6b7280" /></button>
                      <button onClick={() => deleteSale(s.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px' }}><Trash2 size={11} color="#ef4444" /></button>
                    </div>
                  </td>
                </tr>
              )
            ))}
            {addingNew && !editingId && (
              <tr style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
                <td style={{ padding: '4px 6px' }}>
                  <input type="date" value={form.sold_at} onChange={(e) => setForm((f) => ({ ...f, sold_at: e.target.value }))}
                    style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }} />
                </td>
                <td style={{ padding: '4px 6px' }}>
                  <input type="number" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                    style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }} />
                </td>
                <td style={{ padding: '4px 6px' }}>
                  <input type="number" value={form.selling_price} onChange={(e) => setForm((f) => ({ ...f, selling_price: e.target.value }))}
                    style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }} />
                </td>
                <td colSpan={2} style={{ padding: '4px 6px' }}>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={save} disabled={saving || !canSave}
                      style={{ padding: '3px 8px', borderRadius: '4px', background: canSave ? '#16a34a' : '#d4d4d4', color: canSave ? '#fff' : '#71717a', border: 'none', fontSize: '11px', cursor: canSave ? 'pointer' : 'not-allowed' }}>
                      {saving ? '저장중' : '저장'}
                    </button>
                    <button onClick={() => { setAddingNew(false); setForm(emptyForm()); }}
                      style={{ padding: '3px 6px', borderRadius: '4px', background: '#f3f4f6', border: 'none', fontSize: '11px', cursor: 'pointer', color: '#27272a' }}>취소</button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!addingNew && !editingId && (
        <button
          onClick={() => { setAddingNew(true); setForm(emptyForm()); }}
          style={{ width: '100%', marginTop: '8px', padding: '6px', borderRadius: '6px', border: '1px dashed #e5e5e5', background: '#fafafa', fontSize: '11px', color: '#27272a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
        >
          <Plus size={11} /> 판매 추가
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep SaleEntry | head -10
```

Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/orders/SaleEntryPanel.tsx
git commit -m "feat(ui): SaleEntryPanel 판매 내역 컴포넌트 추가"
```

---

## Task 9: CostEntryDrawer 좌우 분할 레이아웃 + CostManagementTab 컬럼 업데이트

**Files:**
- Modify: `src/components/orders/CostEntryDrawer.tsx`
- Modify: `src/components/orders/CostManagementTab.tsx`

- [ ] **Step 1: CostEntryDrawer 전체 교체 (좌우 분할)**

`src/components/orders/CostEntryDrawer.tsx` 전체를 아래로 교체:

```typescript
'use client';

import React, { useState, useEffect } from 'react';
import { X, Plus, Pencil, Trash2 } from 'lucide-react';
import SaleEntryPanel from './SaleEntryPanel';

interface Entry {
  id: string;
  received_at: string;
  quantity: number;
  unit_cost: number;
  unit_shipping_fee: number;
  shipping_group_id: string | null;
  shipping_group_name: string | null;
}

interface EntryForm {
  received_at: string;
  quantity: string;
  unit_cost: string;
  unit_shipping_fee: string;
}

function emptyForm(): EntryForm {
  return { received_at: new Date().toISOString().slice(0, 10), quantity: '', unit_cost: '', unit_shipping_fee: '0' };
}

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

interface FifoSummary {
  current_stock: number;
  stock_value: number;
  total_realized_profit: number;
}

interface Props {
  productId: string;
  productName: string;
  sellerProductId: number | null;
  platformFeeRate: number;
  onClose: () => void;
  onChanged: () => void;
}

export default function CostEntryDrawer({ productId, productName, sellerProductId, platformFeeRate, onClose, onChanged }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [form, setForm] = useState<EntryForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [fifo, setFifo] = useState<FifoSummary>({ current_stock: 0, stock_value: 0, total_realized_profit: 0 });
  const [fifoVersion, setFifoVersion] = useState(0);

  async function loadEntries() {
    setLoading(true);
    const res = await fetch(`/api/cost-management/products/${productId}/entries`);
    const json = await res.json();
    if (json.success) setEntries(json.data);
    setLoading(false);
  }

  async function loadFifo() {
    const res = await fetch(`/api/cost-management/products/${productId}/fifo-summary`);
    const json = await res.json();
    if (json.success) setFifo(json.data);
  }

  useEffect(() => { loadEntries(); }, [productId]);
  useEffect(() => { loadFifo(); }, [productId, fifoVersion]);

  function refreshAll() {
    loadEntries();
    setFifoVersion((v) => v + 1);
    onChanged();
  }

  async function save() {
    const qty = Math.round(Number(form.quantity));
    const cost = Math.round(Number(form.unit_cost));
    if (!form.received_at || qty <= 0) { alert('입고일과 수량을 입력해 주세요.'); return; }
    setSaving(true);
    try {
      const payload = { received_at: form.received_at, quantity: qty, unit_cost: cost, unit_shipping_fee: Math.round(Number(form.unit_shipping_fee)) };
      const url = editingId
        ? `/api/cost-management/entries/${editingId}`
        : `/api/cost-management/products/${productId}/entries`;
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (json.success) {
        refreshAll();
        setEditingId(null);
        setAddingNew(false);
        setForm(emptyForm());
      } else {
        alert(json.error ?? '저장에 실패했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(id: string) {
    if (!confirm('이 입고 건을 삭제할까요?')) return;
    const res = await fetch(`/api/cost-management/entries/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) refreshAll();
    else alert(json.error ?? '삭제에 실패했습니다.');
  }

  function startEdit(e: Entry) {
    setEditingId(e.id);
    setAddingNew(false);
    setForm({ received_at: e.received_at.slice(0, 10), quantity: String(e.quantity), unit_cost: String(e.unit_cost), unit_shipping_fee: String(e.unit_shipping_fee) });
  }

  const canSave = !!form.received_at && Number(form.quantity) > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex' }}>
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.3)' }} />
      <div style={{ width: '900px', background: '#fff', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column' }}>
        {/* 헤더 */}
        <div style={{ padding: '16px 24px 12px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ flex: 1, fontSize: '14px', fontWeight: 700, color: '#18181b' }}>{productName}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px' }}>
            <X size={18} color="#52525b" />
          </button>
        </div>

        {/* FIFO 요약 카드 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', padding: '14px 24px', flexShrink: 0 }}>
          {[
            { label: '현재 재고', value: `${fmt(fifo.current_stock)}개`, color: '#18181b' },
            { label: '실현손익', value: `${fmt(fifo.total_realized_profit)}원`, color: fifo.total_realized_profit >= 0 ? '#16a34a' : '#ef4444' },
            { label: '재고가치', value: `${fmt(fifo.stock_value)}원`, color: '#18181b' },
          ].map((c) => (
            <div key={c.label} style={{ background: '#f5f5f7', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: '#52525b', marginBottom: '3px' }}>{c.label}</div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: c.color }}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* 좌우 분할 패널 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', flex: 1, overflow: 'hidden', borderTop: '1px solid #e5e5e5' }}>
          {/* 좌: 입고 내역 */}
          <div style={{ padding: '14px 16px 14px 24px', borderRight: '1px solid #e5e5e5', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#18181b', marginBottom: '8px' }}>📦 입고 내역</div>
            <div style={{ overflowX: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
                    {['입고일', '수량', '단가', '배송비', ''].map((h) => (
                      <th key={h} style={{ padding: '6px 8px', textAlign: h === '입고일' ? 'left' : 'right', fontWeight: 600, color: '#27272a' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} style={{ padding: '16px', textAlign: 'center', color: '#52525b' }}>불러오는 중...</td></tr>
                  ) : entries.map((e) => (
                    editingId === e.id ? (
                      <tr key={e.id} style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
                        {(['received_at', 'quantity', 'unit_cost', 'unit_shipping_fee'] as (keyof EntryForm)[]).map((field) => (
                          <td key={field} style={{ padding: '4px 6px' }}>
                            <input
                              type={field === 'received_at' ? 'date' : 'number'}
                              value={form[field]}
                              onChange={(ev) => setForm((f) => ({ ...f, [field]: ev.target.value }))}
                              style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }}
                            />
                          </td>
                        ))}
                        <td style={{ padding: '4px 6px' }}>
                          <div style={{ display: 'flex', gap: '3px' }}>
                            <button onClick={save} disabled={saving || !canSave} style={{ padding: '3px 7px', borderRadius: '4px', background: canSave ? '#16a34a' : '#d4d4d4', color: canSave ? '#fff' : '#71717a', border: 'none', fontSize: '10px', cursor: canSave ? 'pointer' : 'not-allowed' }}>
                              {saving ? '...' : '저장'}
                            </button>
                            <button onClick={() => { setEditingId(null); setAddingNew(false); setForm(emptyForm()); }} style={{ padding: '3px 5px', borderRadius: '4px', background: '#f3f4f6', border: 'none', fontSize: '10px', cursor: 'pointer', color: '#27272a' }}>취소</button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '6px 8px', color: '#27272a' }}>{e.received_at.slice(0, 10)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{fmt(e.quantity)}개</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#ef4444' }}>{fmt(e.unit_cost)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#f97316' }}>
                          {fmt(e.unit_shipping_fee)}
                          {e.shipping_group_name && <span style={{ marginLeft: '3px', fontSize: '9px', color: '#999' }}>({e.shipping_group_name})</span>}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '3px', justifyContent: 'flex-end' }}>
                            <button onClick={() => startEdit(e)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px' }}><Pencil size={11} color="#6b7280" /></button>
                            <button onClick={() => deleteEntry(e.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px' }}><Trash2 size={11} color="#ef4444" /></button>
                          </div>
                        </td>
                      </tr>
                    )
                  ))}
                  {addingNew && !editingId && (
                    <tr style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
                      {(['received_at', 'quantity', 'unit_cost', 'unit_shipping_fee'] as (keyof EntryForm)[]).map((field) => (
                        <td key={field} style={{ padding: '4px 6px' }}>
                          <input
                            type={field === 'received_at' ? 'date' : 'number'}
                            value={form[field]}
                            onChange={(ev) => setForm((f) => ({ ...f, [field]: ev.target.value }))}
                            style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }}
                          />
                        </td>
                      ))}
                      <td style={{ padding: '4px 6px' }}>
                        <div style={{ display: 'flex', gap: '3px' }}>
                          <button onClick={save} disabled={saving || !canSave} style={{ padding: '3px 7px', borderRadius: '4px', background: canSave ? '#16a34a' : '#d4d4d4', color: canSave ? '#fff' : '#71717a', border: 'none', fontSize: '10px', cursor: canSave ? 'pointer' : 'not-allowed' }}>
                            {saving ? '...' : '저장'}
                          </button>
                          <button onClick={() => { setAddingNew(false); setForm(emptyForm()); }} style={{ padding: '3px 5px', borderRadius: '4px', background: '#f3f4f6', border: 'none', fontSize: '10px', cursor: 'pointer', color: '#27272a' }}>취소</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {!addingNew && !editingId && (
              <button onClick={() => { setAddingNew(true); setForm(emptyForm()); }}
                style={{ width: '100%', marginTop: '8px', padding: '6px', borderRadius: '6px', border: '1px dashed #e5e5e5', background: '#fafafa', fontSize: '11px', color: '#27272a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                <Plus size={11} /> 새 입고 건 추가
              </button>
            )}
          </div>

          {/* 우: 판매 내역 */}
          <div style={{ padding: '14px 24px 14px 16px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <SaleEntryPanel
              productId={productId}
              sellerProductId={sellerProductId}
              onChanged={() => { setFifoVersion((v) => v + 1); onChanged(); }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CostManagementTab — ProductRow 타입 및 테이블 컬럼 업데이트**

`src/components/orders/CostManagementTab.tsx`에서 아래 변경을 적용한다:

**2a) ProductRow 인터페이스 교체**

```typescript
// 기존 인터페이스를 이걸로 교체
interface ProductRow {
  id: string;
  product_name: string;
  seller_product_id: number | null;
  platform_fee_rate: number;
  entry_count: number;
  sale_count: number;
  weighted_avg_cost: number;
  weighted_avg_shipping: number;
  total_purchase_amount: number;
  current_stock: number;
  stock_value: number;
  total_realized_profit: number;
  total_sales_amount: number;
}
```

**2b) summary state 타입 교체**

```typescript
const [summary, setSummary] = useState({
  total_purchase_amount: 0,
  total_sales_amount: 0,
  total_realized_profit: 0,
});
```

**2c) 요약 카드 4개 교체**

```typescript
{ label: '관리 상품 수', value: `${products.length}개`, color: '#18181b', sub: undefined },
{ label: '기간 총 매입비', value: `${fmt(summary.total_purchase_amount)}원`, color: '#ef4444', sub: '입고 단가 × 수량 합계' },
{ label: '기간 총 매출', value: `${fmt(summary.total_sales_amount)}원`, color: '#2563eb', sub: '판매가 × 수량 합계' },
{
  label: '기간 실현손익',
  value: `${fmt(summary.total_realized_profit)}원`,
  color: summary.total_realized_profit >= 0 ? '#16a34a' : '#ef4444',
  sub: `마진율 ${summary.total_sales_amount > 0 ? ((summary.total_realized_profit / summary.total_sales_amount) * 100).toFixed(1) : '0.0'}%`,
},
```

**2d) 테이블 헤더 교체**

```typescript
{['상품명', '원가(가중평균)', '배송비(배분)', '재고', '재고가치', '실현손익', '입고', '판매', '내역', ''].map((h) => (
  <th key={h} style={{ padding: '10px 12px', textAlign: h === '상품명' ? 'left' : 'right', fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>{h}</th>
))}
```

**2e) 테이블 행 교체** — 기존 판매가/수수료/마진율 셀 제거, 아래로 교체:

```typescript
{filtered.map((p) => (
  <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0', background: '#fff' }}>
    <td style={{ padding: '10px 12px', fontWeight: 500, color: p.entry_count === 0 ? '#999' : '#18181b' }}>{p.product_name}</td>
    <td style={{ padding: '10px 12px', textAlign: 'right', color: p.entry_count === 0 ? '#ccc' : '#ef4444' }}>
      {p.entry_count === 0 ? '—' : fmt(p.weighted_avg_cost)}
    </td>
    <td style={{ padding: '10px 12px', textAlign: 'right', color: p.entry_count === 0 ? '#ccc' : '#f97316' }}>
      {p.entry_count === 0 ? '—' : fmt(p.weighted_avg_shipping)}
    </td>
    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#18181b' }}>
      {fmt(p.current_stock)}개
    </td>
    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#52525b' }}>
      {p.current_stock > 0 ? `${fmt(p.stock_value)}원` : '—'}
    </td>
    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: p.total_realized_profit >= 0 ? '#16a34a' : '#ef4444' }}>
      {p.sale_count === 0 ? <span style={{ color: '#ccc' }}>—</span> : `${fmt(p.total_realized_profit)}원`}
    </td>
    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#52525b' }}>{p.entry_count}건</td>
    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#52525b' }}>{p.sale_count}건</td>
    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
      <button
        onClick={() => setDrawerProductId(p.id)}
        style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #e5e5e5', background: '#fff', fontSize: '11px', cursor: 'pointer', color: '#555' }}
      >
        📋 보기
      </button>
    </td>
    <td style={{ padding: '10px 8px', textAlign: 'right' }}>
      <button
        onClick={() => deleteProduct(p.id, p.product_name)}
        style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', opacity: 0.25 }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.25')}
        title="상품 삭제"
      >
        <Trash2 size={13} color="#ef4444" />
      </button>
    </td>
  </tr>
))}
```

**2f) CostEntryDrawer 호출부 props 추가**

```typescript
// 기존 CostEntryDrawer 렌더링 부분에 sellerProductId, platformFeeRate props 추가
{drawerProductId && (
  <CostEntryDrawer
    productId={drawerProductId}
    productName={products.find((p) => p.id === drawerProductId)?.product_name ?? ''}
    sellerProductId={products.find((p) => p.id === drawerProductId)?.seller_product_id ?? null}
    platformFeeRate={products.find((p) => p.id === drawerProductId)?.platform_fee_rate ?? 0.108}
    onClose={() => setDrawerProductId(null)}
    onChanged={load}
  />
)}
```

**2g) 주석 업데이트**

```typescript
<div style={{ marginTop: '10px', fontSize: '11px', color: '#999' }}>
  실현손익 = FIFO 원가 기준 (판매가 − 입고원가 − 배송비 − 수수료)
</div>
```

- [ ] **Step 3: fifo-summary API 라우트 추가**

`CostEntryDrawer`가 호출하는 `/api/cost-management/products/[id]/fifo-summary`를 생성한다:

```typescript
// src/app/api/cost-management/products/[id]/fifo-summary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { calculateFifo } from '@/lib/cost-management/fifo';
import type { PurchaseBatch, SaleRow } from '@/lib/cost-management/fifo';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  const { rows: check } = await pool.query(
    `SELECT id, platform_fee_rate FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const feeRate = Number(check[0].platform_fee_rate);

  const [{ rows: entryRows }, { rows: saleRows }] = await Promise.all([
    pool.query(
      `SELECT id, received_at, quantity, unit_cost, unit_shipping_fee FROM cost_entries WHERE product_cost_id = $1`,
      [id],
    ),
    pool.query(
      `SELECT id, sold_at, quantity, selling_price FROM sale_records WHERE product_cost_id = $1`,
      [id],
    ),
  ]);

  const batches: PurchaseBatch[] = entryRows.map((e) => ({
    id: e.id,
    received_at: e.received_at,
    quantity: Number(e.quantity),
    unit_cost: Number(e.unit_cost),
    unit_shipping_fee: Number(e.unit_shipping_fee),
  }));

  const sales: SaleRow[] = saleRows.map((s) => ({
    id: s.id,
    sold_at: s.sold_at,
    quantity: Number(s.quantity),
    selling_price: Number(s.selling_price),
  }));

  const result = calculateFifo(batches, sales, feeRate);

  return NextResponse.json({
    success: true,
    data: {
      current_stock: result.current_stock,
      stock_value: result.stock_value,
      total_realized_profit: result.total_realized_profit,
    },
  });
}
```

- [ ] **Step 4: TypeScript 전체 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 오류 없음

- [ ] **Step 5: dev 서버 시작 후 UI 확인**

```bash
npm run dev
```

브라우저에서 확인:
- [ ] 원가관리 탭 → 상품 목록에 재고/재고가치/실현손익 컬럼 표시
- [ ] 상품 행 "📋 보기" 클릭 → 드로어 열림, 좌우 분할 레이아웃
- [ ] 입고 추가 → 좌측에 행 추가, FIFO 요약 카드 업데이트
- [ ] 판매 추가 → 우측에 행 추가, FIFO 요약 카드 업데이트
- [ ] 쿠팡 가져오기 버튼 표시 (seller_product_id 있는 상품에만)

- [ ] **Step 6: 커밋**

```bash
git add src/components/orders/CostEntryDrawer.tsx \
        src/components/orders/CostManagementTab.tsx \
        "src/app/api/cost-management/products/[id]/fifo-summary/route.ts"
git commit -m "feat(ui): 드로어 좌우 분할 레이아웃, CostManagementTab FIFO 지표로 교체"
```

---

## 완료 체크리스트

- [ ] 마이그레이션 적용 완료 (sale_records 테이블 존재, cost_entries에 selling_price 없음)
- [ ] FIFO 테스트 5개 모두 통과
- [ ] 기존 selling_price > 0 데이터가 sale_records로 이전됨
- [ ] 입고 추가/수정/삭제 동작
- [ ] 판매 수동 추가/수정/삭제 동작
- [ ] 쿠팡 가져오기 성공 (seller_product_id 연결된 상품)
- [ ] 쿠팡 가져온 행 수정/삭제 가능
- [ ] 중복 재수입 SKIP 동작
- [ ] FIFO 재고/재고가치/실현손익 정확히 표시
- [ ] TypeScript 컴파일 오류 없음
