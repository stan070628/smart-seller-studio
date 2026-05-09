# 로켓그로스 입고 배송비 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 셀러가 여러 상품을 쿠팡 로켓그로스 물류센터로 보낼 때 발생하는 배송비를 기록하고, 수량 비례로 각 상품의 입고 배치에 `unit_rg_shipping_fee`로 배분해 FIFO 원가에 합산한다.

**Architecture:** `cost_entries`에 `unit_rg_shipping_fee` 컬럼 추가. POST `/api/cost-management/rg-shipments`가 FIFO 순으로 배치를 소진하면서 일부 수량일 경우 배치를 분할한다. 프론트엔드는 `CostManagementTab` 상단 버튼 → `RocketGrowthShipmentModal`(ShippingGroupModal 패턴) 흐름으로 동작한다.

**Tech Stack:** Next.js App Router (TypeScript), React inline styles, PostgreSQL (getSourcingPool), `calculateFifo` from `@/lib/cost-management/fifo`, `distributeShippingFee` from `@/lib/cost-management/calculations`, Vitest

---

## 파일 맵

| 파일 | 역할 |
|------|------|
| `supabase/migrations/059_rg_shipping_fee.sql` | (신규) `unit_rg_shipping_fee` 컬럼 추가 |
| `src/lib/cost-management/fifo.ts` | (수정) `PurchaseBatch`에 필드 추가, 원가 합산 |
| `src/lib/cost-management/__tests__/fifo.test.ts` | (수정) rg_fee 포함 테스트 케이스 3개 추가 |
| `src/app/api/cost-management/products/[id]/entries/route.ts` | (수정) GET SELECT에 `unit_rg_shipping_fee` 추가 |
| `src/app/api/cost-management/entries/[id]/route.ts` | (수정) PATCH에서 `unit_rg_shipping_fee` 수정 허용 |
| `src/app/api/cost-management/products/route.ts` | (수정) PurchaseBatch 변환 시 `unit_rg_shipping_fee` 전달 |
| `src/app/api/cost-management/products/[id]/fifo-summary/route.ts` | (수정) PurchaseBatch 변환 시 `unit_rg_shipping_fee` 전달 |
| `src/app/api/cost-management/rg-shipments/route.ts` | (신규) 로켓그로스 입고 등록 API (FIFO 소진 + 배치 분할) |
| `src/components/orders/RocketGrowthShipmentModal.tsx` | (신규) 입고 등록 모달 |
| `src/components/orders/CostManagementTab.tsx` | (수정) "로켓그로스 입고 등록" 버튼 + 모달 연결 |
| `src/components/orders/CostEntryDrawer.tsx` | (수정) 입고 패널에 RG배송비 컬럼 추가 |

---

## Task 1: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/059_rg_shipping_fee.sql`

- [ ] **Step 1: 마이그레이션 파일 생성**

```sql
-- supabase/migrations/059_rg_shipping_fee.sql
BEGIN;
ALTER TABLE cost_entries
  ADD COLUMN IF NOT EXISTS unit_rg_shipping_fee integer NOT NULL DEFAULT 0;
COMMIT;
```

- [ ] **Step 2: 마이그레이션 적용**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
psql "$DATABASE_URL" -f supabase/migrations/059_rg_shipping_fee.sql
```

Expected: `ALTER TABLE`

> DATABASE_URL을 모를 경우: `cat .env.local | grep DATABASE_URL` 또는 `cat .env | grep DATABASE_URL`

- [ ] **Step 3: 컬럼 확인**

```bash
psql "$DATABASE_URL" -c "\d cost_entries" | grep rg_shipping
```

Expected: `unit_rg_shipping_fee | integer | not null | 0`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/059_rg_shipping_fee.sql
git commit -m "feat(db): cost_entries에 unit_rg_shipping_fee 컬럼 추가"
```

---

## Task 2: fifo.ts — unit_rg_shipping_fee 추가 (TDD)

**Files:**
- Modify: `src/lib/cost-management/__tests__/fifo.test.ts`
- Modify: `src/lib/cost-management/fifo.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/cost-management/__tests__/fifo.test.ts` 파일의 마지막 `});` 바로 앞(기존 테스트 블록 내부)에 다음 3개 테스트를 추가한다:

```typescript
  it('RG배송비 포함 원가로 FIFO', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 14000, unit_shipping_fee: 1000, unit_rg_shipping_fee: 650 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 5, selling_price: 25000 },
    ];
    const result = calculateFifo(batches, sales, 0);
    // fifo cost = 14000 + 1000 + 650 = 15650/unit
    expect(result.sale_details[0].fifo_cost_per_unit).toBe(15650);
    expect(result.current_stock).toBe(5);
  });

  it('RG배송비 0인 배치와 혼합 FIFO', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 5, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 500 },
      { id: 'b2', received_at: '2026-04-10', quantity: 5, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 10, selling_price: 20000 },
    ];
    const result = calculateFifo(batches, sales, 0);
    // (5*(10000+500) + 5*(10000+0)) / 10 = (52500 + 50000) / 10 = 10250
    expect(result.sale_details[0].fifo_cost_per_unit).toBe(10250);
  });

  it('stock_value는 RG배송비 제외', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 15000, unit_shipping_fee: 800, unit_rg_shipping_fee: 650 },
    ];
    const result = calculateFifo(batches, [], 0);
    // stock_value = unit_cost × qty 만 (배송비·RG배송비 제외)
    expect(result.stock_value).toBe(10 * 15000);
  });
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npx vitest run src/lib/cost-management/__tests__/fifo.test.ts
```

Expected: TypeScript 에러 또는 테스트 실패 (`unit_rg_shipping_fee` 없음)

- [ ] **Step 3: fifo.ts 수정**

`src/lib/cost-management/fifo.ts`의 `PurchaseBatch` 인터페이스에 필드 추가:

```typescript
export interface PurchaseBatch {
  id: string;
  /** 입고일 (ISO 8601 YYYY-MM-DD 문자열, Date 객체 불가) */
  received_at: string;
  /** 입고 수량 */
  quantity: number;
  /** 단위 매입가 (원) */
  unit_cost: number;
  /** 단위 배송비 (원) — 원가에 포함, 재고 평가액에서는 제외 */
  unit_shipping_fee: number;
  /** 단위 로켓그로스 입고 배송비 (원) — 원가에 포함, 재고 평가액에서는 제외 */
  unit_rg_shipping_fee: number;
}
```

그리고 `calculateFifo` 함수 내 line 91 부분:

```typescript
      // 원가 = (단위매입가 + 단위배송비 + 단위RG배송비) × 소진수량
      totalCost += (batch.unit_cost + batch.unit_shipping_fee + batch.unit_rg_shipping_fee) * take;
```

- [ ] **Step 4: 테스트 재실행 — PASS 확인**

```bash
npx vitest run src/lib/cost-management/__tests__/fifo.test.ts
```

Expected: PASS (기존 8개 + 신규 3개 = 11개 전부 통과)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cost-management/fifo.ts src/lib/cost-management/__tests__/fifo.test.ts
git commit -m "feat(fifo): unit_rg_shipping_fee를 PurchaseBatch에 추가하고 FIFO 원가에 포함"
```

---

## Task 3: Entries API — unit_rg_shipping_fee 노출 및 수정

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/entries/route.ts`
- Modify: `src/app/api/cost-management/entries/[id]/route.ts`

### 3a. GET entries — SELECT에 컬럼 추가

- [ ] **Step 1: entries/route.ts GET 쿼리 수정**

`src/app/api/cost-management/products/[id]/entries/route.ts`의 GET 핸들러에서 SELECT 쿼리를 찾아 `unit_rg_shipping_fee`를 추가한다.

기존:
```typescript
    const { rows } = await pool.query(
      `SELECT ce.id, ce.received_at, ce.quantity, ce.unit_cost, ce.unit_shipping_fee,
              ce.shipping_group_id, sg.name as shipping_group_name, ce.created_at
       FROM cost_entries ce
       LEFT JOIN shipping_groups sg ON sg.id = ce.shipping_group_id
       WHERE ce.product_cost_id = $1
       ORDER BY ce.received_at DESC, ce.created_at DESC`,
      [id],
    );
```

변경 후:
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
```

### 3b. PATCH entries — unit_rg_shipping_fee 수정 허용

- [ ] **Step 2: entries/[id]/route.ts PATCH 수정**

`src/app/api/cost-management/entries/[id]/route.ts`의 PATCH 핸들러를 다음과 같이 수정한다:

```typescript
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee } = body ?? {};

  const hasField = [received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee]
    .some((v) => v !== undefined);
  if (!hasField) {
    return NextResponse.json(
      { success: false, error: 'At least one field must be provided' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  try {
    const { rows: check } = await pool.query(
      `SELECT id FROM cost_entries WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const { rows } = await pool.query(
      `UPDATE cost_entries SET
         received_at            = COALESCE($1, received_at),
         quantity               = COALESCE($2, quantity),
         unit_cost              = COALESCE($3, unit_cost),
         unit_shipping_fee      = COALESCE($4, unit_shipping_fee),
         unit_rg_shipping_fee   = COALESCE($5, unit_rg_shipping_fee)
       WHERE id = $6
       RETURNING id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, shipping_group_id, created_at`,
      [received_at ?? null, quantity ?? null, unit_cost ?? null, unit_shipping_fee ?? null, unit_rg_shipping_fee ?? null, id],
    );

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 3: TypeScript 컴파일 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | head -30
```

Expected: 오류 없음

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cost-management/products/[id]/entries/route.ts \
        src/app/api/cost-management/entries/[id]/route.ts
git commit -m "feat(api): entries GET/PATCH에 unit_rg_shipping_fee 추가"
```

---

## Task 4: products/route.ts + fifo-summary/route.ts — PurchaseBatch에 rg_fee 전달

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`
- Modify: `src/app/api/cost-management/products/[id]/fifo-summary/route.ts`

### 4a. products/route.ts

- [ ] **Step 1: allEntries SELECT에 unit_rg_shipping_fee 추가**

`src/app/api/cost-management/products/route.ts`에서 입고 전체 조회 쿼리를 찾는다:

기존:
```typescript
    const { rows: allEntries } = await pool.query(
      `SELECT id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, shipping_group_id
       FROM cost_entries WHERE user_id = $1`,
      [user.userId],
    );
```

변경 후:
```typescript
    const { rows: allEntries } = await pool.query(
      `SELECT id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, shipping_group_id
       FROM cost_entries WHERE user_id = $1`,
      [user.userId],
    );
```

- [ ] **Step 2: PurchaseBatch 변환에 unit_rg_shipping_fee 추가**

같은 파일에서 `PurchaseBatch[]` 매핑 코드를 찾아 `unit_rg_shipping_fee` 필드를 추가한다.

기존 (어딘가에 있는 변환 로직):
```typescript
      const batches: PurchaseBatch[] = pEntries.map((e) => ({
        id: e.id,
        received_at: e.received_at instanceof Date ? e.received_at.toISOString().slice(0, 10) : String(e.received_at).slice(0, 10),
        quantity: Number(e.quantity),
        unit_cost: Number(e.unit_cost),
        unit_shipping_fee: Number(e.unit_shipping_fee),
      }));
```

변경 후:
```typescript
      const batches: PurchaseBatch[] = pEntries.map((e) => ({
        id: e.id,
        received_at: e.received_at instanceof Date ? e.received_at.toISOString().slice(0, 10) : String(e.received_at).slice(0, 10),
        quantity: Number(e.quantity),
        unit_cost: Number(e.unit_cost),
        unit_shipping_fee: Number(e.unit_shipping_fee),
        unit_rg_shipping_fee: Number(e.unit_rg_shipping_fee ?? 0),
      }));
```

> 주의: products/route.ts는 파일이 길다. `grep -n "unit_shipping_fee" src/app/api/cost-management/products/route.ts`로 변환 위치를 먼저 확인한다.

### 4b. fifo-summary/route.ts

- [ ] **Step 3: fifo-summary SELECT + 변환에 unit_rg_shipping_fee 추가**

`src/app/api/cost-management/products/[id]/fifo-summary/route.ts`에서:

기존 SELECT:
```typescript
        `SELECT id, received_at, quantity, unit_cost, unit_shipping_fee FROM cost_entries WHERE product_cost_id = $1`,
```

변경 후:
```typescript
        `SELECT id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee FROM cost_entries WHERE product_cost_id = $1`,
```

기존 변환:
```typescript
    const batches: PurchaseBatch[] = entryRows.map((e) => ({
      id: e.id,
      received_at: e.received_at instanceof Date ? e.received_at.toISOString().slice(0, 10) : String(e.received_at).slice(0, 10),
      quantity: Number(e.quantity),
      unit_cost: Number(e.unit_cost),
      unit_shipping_fee: Number(e.unit_shipping_fee),
    }));
```

변경 후:
```typescript
    const batches: PurchaseBatch[] = entryRows.map((e) => ({
      id: e.id,
      received_at: e.received_at instanceof Date ? e.received_at.toISOString().slice(0, 10) : String(e.received_at).slice(0, 10),
      quantity: Number(e.quantity),
      unit_cost: Number(e.unit_cost),
      unit_shipping_fee: Number(e.unit_shipping_fee),
      unit_rg_shipping_fee: Number(e.unit_rg_shipping_fee ?? 0),
    }));
```

- [ ] **Step 4: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 오류 없음

- [ ] **Step 5: 기존 테스트 여전히 통과 확인**

```bash
npx vitest run src/lib/cost-management/__tests__/fifo.test.ts
```

Expected: 11개 모두 PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cost-management/products/route.ts \
        src/app/api/cost-management/products/[id]/fifo-summary/route.ts
git commit -m "feat(api): products/fifo-summary API에 unit_rg_shipping_fee를 FIFO 계산에 전달"
```

---

## Task 5: POST /api/cost-management/rg-shipments — 입고 등록 API

**Files:**
- Create: `src/app/api/cost-management/rg-shipments/route.ts`

이 API가 핵심 비즈니스 로직을 담당한다. 각 item에 대해 FIFO 순으로 배치를 소진하고, 일부 수량만 보낼 경우 배치를 분할한다. 모든 작업은 단일 트랜잭션으로 처리한다.

- [ ] **Step 1: 파일 생성**

```typescript
// src/app/api/cost-management/rg-shipments/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

interface RgShipmentItem {
  product_cost_id: string;
  quantity: number;
  unit_rg_fee: number;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { shipped_at, total_shipping_fee, items } = body ?? {};

  // 유효성 검사
  if (!shipped_at || !/^\d{4}-\d{2}-\d{2}$/.test(shipped_at)) {
    return NextResponse.json({ success: false, error: 'shipped_at must be YYYY-MM-DD' }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ success: false, error: 'items must be a non-empty array' }, { status: 400 });
  }
  if (!Number.isInteger(total_shipping_fee) || total_shipping_fee < 0) {
    return NextResponse.json({ success: false, error: 'total_shipping_fee must be a non-negative integer' }, { status: 400 });
  }

  for (const item of items as RgShipmentItem[]) {
    if (!item.product_cost_id || typeof item.product_cost_id !== 'string') {
      return NextResponse.json({ success: false, error: 'Each item must have product_cost_id' }, { status: 400 });
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return NextResponse.json({ success: false, error: 'Each item quantity must be > 0' }, { status: 400 });
    }
    if (!Number.isInteger(item.unit_rg_fee) || item.unit_rg_fee < 0) {
      return NextResponse.json({ success: false, error: 'Each item unit_rg_fee must be >= 0' }, { status: 400 });
    }
  }

  // total_shipping_fee 검증: sum(qty × unit_rg_fee) ≈ total_shipping_fee (±items.length 허용)
  const computedTotal = (items as RgShipmentItem[]).reduce((s, i) => s + i.quantity * i.unit_rg_fee, 0);
  if (Math.abs(computedTotal - total_shipping_fee) > items.length) {
    return NextResponse.json(
      { success: false, error: `sum(quantity × unit_rg_fee)=${computedTotal}가 total_shipping_fee=${total_shipping_fee}와 일치하지 않습니다.` },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let affectedEntries = 0;
    let splitEntries = 0;

    for (const item of items as RgShipmentItem[]) {
      const { product_cost_id, quantity: rgQty, unit_rg_fee } = item;

      // 소유권 확인
      const { rows: ownerCheck } = await client.query(
        `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
        [product_cost_id, user.userId],
      );
      if (ownerCheck.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ success: false, error: `product_cost_id ${product_cost_id} not found` }, { status: 404 });
      }

      // 현재 재고 확인
      const { rows: stockRows } = await client.query(
        `SELECT COALESCE(SUM(quantity), 0)::int AS total_stock FROM cost_entries WHERE product_cost_id = $1`,
        [product_cost_id],
      );
      const totalStock = Number(stockRows[0].total_stock);
      if (rgQty > totalStock) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { success: false, error: `${product_cost_id}: 보낼 수량(${rgQty}) > 재고(${totalStock})` },
          { status: 400 },
        );
      }

      // FIFO 배치 목록 (received_at ASC)
      const { rows: batches } = await client.query(
        `SELECT id, quantity FROM cost_entries
         WHERE product_cost_id = $1
         ORDER BY received_at ASC, created_at ASC`,
        [product_cost_id],
      );

      let remaining = rgQty;
      for (const batch of batches) {
        if (remaining <= 0) break;
        const batchQty = Number(batch.quantity);
        const take = Math.min(batchQty, remaining);

        if (take === batchQty) {
          // 배치 전량 → unit_rg_shipping_fee만 업데이트
          await client.query(
            `UPDATE cost_entries SET unit_rg_shipping_fee = $1 WHERE id = $2`,
            [unit_rg_fee, batch.id],
          );
          affectedEntries++;
        } else {
          // 배치 일부만 필요 → 분할
          // 1. 원본 배치를 take 수량으로 줄이고 unit_rg_shipping_fee 설정
          await client.query(
            `UPDATE cost_entries SET quantity = $1, unit_rg_shipping_fee = $2 WHERE id = $3`,
            [take, unit_rg_fee, batch.id],
          );
          // 2. 나머지 수량으로 새 배치 INSERT (원본 모든 필드 복사, quantity만 차감)
          await client.query(
            `INSERT INTO cost_entries
               (user_id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, shipping_group_id, created_at)
             SELECT user_id, product_cost_id, received_at, $1, unit_cost, unit_shipping_fee, 0, shipping_group_id, created_at
             FROM cost_entries WHERE id = $2`,
            [batchQty - take, batch.id],
          );
          affectedEntries++;
          splitEntries++;
        }

        remaining -= take;
      }
    }

    await client.query('COMMIT');
    return NextResponse.json({ success: true, data: { affected_entries: affectedEntries, split_entries: splitEntries } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[rg-shipments]', err);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 오류 없음

- [ ] **Step 3: 수동 API 테스트 (dev 서버 필요)**

```bash
# dev 서버 실행 (별도 터미널)
npm run dev

# 테스트 요청 (실제 product_cost_id는 DB에서 확인)
curl -s -X POST http://localhost:3000/api/cost-management/rg-shipments \
  -H "Content-Type: application/json" \
  -d '{"shipped_at":"2026-05-09","total_shipping_fee":0,"items":[]}' | jq .
```

Expected: `{"success":false,"error":"items must be a non-empty array"}`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cost-management/rg-shipments/route.ts
git commit -m "feat(api): POST /api/cost-management/rg-shipments — FIFO 배치 소진 + 분할"
```

---

## Task 6: RocketGrowthShipmentModal 컴포넌트

**Files:**
- Create: `src/components/orders/RocketGrowthShipmentModal.tsx`

ShippingGroupModal 패턴을 따르되 차이점:
- `groupName` 입력 없음, 대신 `shipped_at` 날짜 입력
- 상품별 체크박스 대신 수량 직접 입력 (input number)
- 현재 재고를 props에서 받아 표시 (CostManagementTab의 ProductRow에 current_stock 있음)
- `unit_rg_fee` 미리보기 계산: `floor(total_fee / total_qty)`, 나머지는 첫 번째 상품에 +1

- [ ] **Step 1: 컴포넌트 작성**

```typescript
// src/components/orders/RocketGrowthShipmentModal.tsx
'use client';

import React, { useState } from 'react';
import { X, Package } from 'lucide-react';

interface ProductForRg {
  id: string;
  product_name: string;
  current_stock: number;
}

interface Props {
  products: ProductForRg[];
  onClose: () => void;
  onCreated: () => void;
}

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

export default function RocketGrowthShipmentModal({ products, onClose, onCreated }: Props) {
  const [shippedAt, setShippedAt] = useState(new Date().toISOString().slice(0, 10));
  const [totalFee, setTotalFee] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const feeNum = Number(totalFee.replace(/,/g, '')) || 0;

  function setQty(productId: string, value: string) {
    setQuantities((prev) => ({ ...prev, [productId]: value }));
  }

  const activeItems = products
    .map((p) => ({ ...p, qty: parseInt(quantities[p.id] ?? '0') || 0 }))
    .filter((p) => p.qty > 0);

  const totalQty = activeItems.reduce((s, i) => s + i.qty, 0);

  function previewUnitFees(): Map<string, number> {
    const result = new Map<string, number>();
    if (totalQty === 0 || feeNum === 0) return result;

    const baseUnit = Math.floor(feeNum / totalQty);
    const accounted = baseUnit * totalQty;
    const remainder = feeNum - accounted;

    activeItems.forEach((item, idx) => {
      // 첫 번째 상품에 나머지(원) 분산: floor(remainder / qty) 추가
      const extra = idx === 0 ? Math.ceil(remainder / item.qty) : 0;
      result.set(item.id, baseUnit + extra);
    });
    return result;
  }

  const unitFees = previewUnitFees();
  const canSubmit = activeItems.length > 0 && feeNum > 0 && !!shippedAt;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const items = activeItems.map((item) => ({
        product_cost_id: item.id,
        quantity: item.qty,
        unit_rg_fee: unitFees.get(item.id) ?? 0,
      }));

      const res = await fetch('/api/cost-management/rg-shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipped_at: shippedAt, total_shipping_fee: feeNum, items }),
      });
      const json = await res.json();
      if (json.success) {
        onCreated();
        onClose();
      } else {
        alert(json.error ?? '등록에 실패했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', width: '520px', maxHeight: '85vh', background: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* 헤더 */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(3,105,161,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Package size={15} color="#0369a1" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 700 }}>로켓그로스 입고 등록</div>
            <div style={{ fontSize: '11px', color: '#71717a' }}>배송비를 수량 비례로 자동 배분합니다</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}><X size={16} color="#71717a" /></button>
        </div>

        {/* 본문 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {/* 입고일 */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>입고일</div>
            <input
              type="date"
              value={shippedAt}
              onChange={(e) => setShippedAt(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px', color: '#18181b' }}
            />
          </div>

          {/* 총 배송비 */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>총 배송비 (원)</div>
            <input
              type="number"
              value={totalFee}
              onChange={(e) => setTotalFee(e.target.value)}
              placeholder="예: 22750"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '13px', fontWeight: 600, boxSizing: 'border-box' }}
            />
          </div>

          {/* 상품 목록 */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '8px' }}>보낼 수량 입력</div>
            <div style={{ background: '#f9f9f9', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e5e5' }}>
              {/* 헤더 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 80px 70px', gap: '8px', padding: '8px 12px', fontSize: '10px', color: '#999', fontWeight: 600, borderBottom: '1px solid #e5e5e5', background: '#f5f5f7' }}>
                <span>상품명</span>
                <span style={{ textAlign: 'right' }}>재고</span>
                <span style={{ textAlign: 'right' }}>이번 수량</span>
                <span style={{ textAlign: 'right' }}>unit배송비</span>
              </div>
              {products.map((p) => {
                const qtyStr = quantities[p.id] ?? '';
                const qty = parseInt(qtyStr) || 0;
                const unitFee = qty > 0 ? (unitFees.get(p.id) ?? 0) : null;
                const overStock = qty > p.current_stock;
                return (
                  <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 80px 70px', gap: '8px', padding: '8px 12px', alignItems: 'center', borderBottom: '1px solid #f0f0f0', background: '#fff' }}>
                    <span style={{ fontSize: '11px', color: '#18181b', fontWeight: 500 }}>{p.product_name}</span>
                    <span style={{ fontSize: '11px', textAlign: 'right', color: '#71717a' }}>{fmt(p.current_stock)}개</span>
                    <div style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min={0}
                        max={p.current_stock}
                        value={qtyStr}
                        onChange={(e) => setQty(p.id, e.target.value)}
                        placeholder="0"
                        style={{
                          width: '60px', padding: '4px 6px', borderRadius: '6px', textAlign: 'right',
                          border: `1px solid ${overStock ? '#ef4444' : '#e5e5e5'}`,
                          fontSize: '12px', fontWeight: 600, color: overStock ? '#ef4444' : '#18181b',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: '11px', textAlign: 'right', color: '#0369a1', fontWeight: unitFee ? 600 : 400 }}>
                      {unitFee !== null ? `${fmt(unitFee)}원` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 미리보기 합계 */}
          {activeItems.length > 0 && feeNum > 0 && (
            <div style={{ background: '#f0f9ff', borderRadius: '8px', padding: '12px', border: '1px solid #bae6fd' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#0369a1', marginBottom: '6px' }}>배분 미리보기</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#0369a1' }}>
                <span>합계 수량</span>
                <span style={{ fontWeight: 600 }}>{fmt(totalQty)}개</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#0369a1', marginTop: '4px' }}>
                <span>총 배송비</span>
                <span style={{ fontWeight: 600 }}>{fmt(feeNum)}원</span>
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e5e5' }}>
          <button
            onClick={submit}
            disabled={saving || !canSubmit}
            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', background: canSubmit ? '#0369a1' : '#e5e5e5', color: canSubmit ? '#fff' : '#999', fontSize: '13px', fontWeight: 600, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          >
            {saving ? '등록 중...' : '로켓그로스 입고 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 오류 없음

- [ ] **Step 3: Commit**

```bash
git add src/components/orders/RocketGrowthShipmentModal.tsx
git commit -m "feat(ui): RocketGrowthShipmentModal 컴포넌트 추가"
```

---

## Task 7: CostManagementTab + CostEntryDrawer UI 업데이트

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`
- Modify: `src/components/orders/CostEntryDrawer.tsx`

### 7a. CostManagementTab — 버튼 + 모달 연결

- [ ] **Step 1: import 추가 및 state 추가**

`src/components/orders/CostManagementTab.tsx` 상단 import에:
```typescript
import RocketGrowthShipmentModal from './RocketGrowthShipmentModal';
```

컴포넌트 내 state 선언부에:
```typescript
const [showRgModal, setShowRgModal] = useState(false);
```

- [ ] **Step 2: 버튼 추가**

액션 버튼 행(`<div style={{ display: 'flex', gap: '8px', ...}}>` 안)에서 "배송비 그룹 생성" 버튼 다음에 추가:

```typescript
        <button
          onClick={() => setShowRgModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', background: '#fff', color: '#0369a1', border: '1px solid #bae6fd', fontSize: '12px', cursor: 'pointer' }}
        >
          <Package size={13} /> 로켓그로스 입고 등록
        </button>
```

그리고 `import { Plus, Truck, Search, Trash2 } from 'lucide-react';` 를 `import { Plus, Truck, Package, Search, Trash2 } from 'lucide-react';`로 수정한다.

- [ ] **Step 3: 모달 렌더링 추가**

컴포넌트 return 내부 맨 아래 (기존 `{showAddModal && ...}` 다음)에:

```typescript
      {showRgModal && (
        <RocketGrowthShipmentModal
          products={products.filter((p) => p.current_stock > 0).map((p) => ({
            id: p.id,
            product_name: p.product_name,
            current_stock: p.current_stock,
          }))}
          onClose={() => setShowRgModal(false)}
          onCreated={load}
        />
      )}
```

### 7b. CostEntryDrawer — RG배송비 컬럼 추가

- [ ] **Step 4: CostEntryDrawer 파일 확인**

```bash
grep -n "unit_shipping_fee\|RG\|rg_" src/components/orders/CostEntryDrawer.tsx | head -20
```

- [ ] **Step 5: 입고 패널 헤더에 RG배송비 컬럼 추가**

`CostEntryDrawer.tsx`에서 입고 내역 테이블 헤더를 찾는다. 현재 패턴:
```
입고일 | 수량 | 단가 | 배송비 | [그룹] | 액션
```

배송비 다음에 `RG배송비` 컬럼을 추가한다. 실제 코드에서 헤더 행을 찾아:

```typescript
// 헤더 행에서 "배송비" 다음 열을 찾아 "RG배송비" 열 삽입
// 예시 (실제 코드 구조에 맞게 조정):
<th style={{ textAlign: 'right', ... }}>RG배송비</th>
```

- [ ] **Step 6: 입고 내역 각 행에 unit_rg_shipping_fee 셀 추가**

각 입고 행에서 `unit_shipping_fee` 셀 다음에:

```typescript
<td style={{ textAlign: 'right', fontSize: '11px', color: entry.unit_rg_shipping_fee > 0 ? '#0369a1' : '#ccc' }}>
  {entry.unit_rg_shipping_fee > 0 ? fmt(entry.unit_rg_shipping_fee) : '—'}
</td>
```

> 주의: CostEntryDrawer의 실제 레이아웃을 먼저 읽은 후 적합한 위치에 삽입한다. 파일 전체를 읽어 현재 구조를 파악한다.

- [ ] **Step 7: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 오류 없음

- [ ] **Step 8: Commit**

```bash
git add src/components/orders/CostManagementTab.tsx \
        src/components/orders/CostEntryDrawer.tsx
git commit -m "feat(ui): CostManagementTab에 로켓그로스 입고 등록 버튼 추가, CostEntryDrawer에 RG배송비 컬럼 추가"
```

---

## 최종 검증

- [ ] **전체 테스트 통과 확인**

```bash
npx vitest run
```

Expected: 모든 테스트 PASS

- [ ] **TypeScript 최종 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **성공 기준 체크**
  - [ ] 모달에서 여러 상품 수량 입력 + 총 배송비 → unit_rg_fee 미리보기 표시
  - [ ] 등록 시 FIFO 순서로 배치 소진, 일부 수량이면 자동 분할
  - [ ] 분할된 배치가 CostEntryDrawer에 올바르게 표시됨
  - [ ] FIFO 원가 = `unit_cost + unit_shipping_fee + unit_rg_shipping_fee` 합산
  - [ ] 보낼 수량 > 재고 시 400 오류
  - [ ] TypeScript 컴파일 오류 없음
  - [ ] fifo.ts 테스트 11개 모두 통과
