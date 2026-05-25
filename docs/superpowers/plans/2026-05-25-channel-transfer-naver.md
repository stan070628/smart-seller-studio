# 채널 간 재고 이동 & 네이버 판매 채널 추가 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원가관리 탭에서 재고를 채널 간 분할 이동하고, 네이버를 입고·판매·필터의 정식 채널로 추가한다.

**Architecture:** `channel_transfers` 전용 테이블에 이동 이력을 기록한다. products API에서 이 테이블을 조인해, TO-채널은 가상 입고 배치로, FROM-채널은 최종 재고에서 차감하는 방식으로 채널별 재고를 계산한다. 네이버는 기존 'wing'/'rg'와 동일한 패턴으로 `ENTRY_CHANNEL`과 `SALE_CHANNEL` 상수에 추가된다.

**Tech Stack:** Next.js App Router, PostgreSQL (pg pool), TypeScript, React, Vitest

---

## 파일 구조 (수정/생성)

| 역할 | 경로 |
|---|---|
| DB 마이그레이션 | `src/db/migrations/003_channel_transfers.sql` |
| FIFO 상수 확장 | `src/lib/cost-management/fifo.ts` |
| 채널 이동 API (POST/GET) | `src/app/api/cost-management/products/[id]/channel-transfer/route.ts` |
| 채널 이동 삭제 API (DELETE) | `src/app/api/cost-management/channel-transfers/[transferId]/route.ts` |
| 네이버 판매 임포트 API | `src/app/api/cost-management/products/[id]/naver-import/route.ts` |
| 상품 목록 API (채널 필터 확장) | `src/app/api/cost-management/products/route.ts` |
| 입고 API (naver 허용) | `src/app/api/cost-management/products/[id]/entries/route.ts` |
| 채널 이동 모달 컴포넌트 | `src/components/orders/ChannelTransferModal.tsx` |
| 원가관리 탭 UI | `src/components/orders/CostManagementTab.tsx` |
| 입고 드로어 UI | `src/components/orders/CostEntryDrawer.tsx` |
| 판매 엔트리 패널 UI | `src/components/orders/SaleEntryPanel.tsx` |
| 단위 테스트 | `src/__tests__/lib/channel-transfer-logic.test.ts` |
| API 테스트 | `src/__tests__/api/channel-transfer.test.ts` |

---

## Task 1: DB 마이그레이션

**Files:**
- Create: `src/db/migrations/003_channel_transfers.sql`

- [ ] **Step 1: 마이그레이션 SQL 파일 작성**

```sql
-- 003_channel_transfers.sql

-- cost_entries.channel CHECK 제약 확장 ('naver' 추가)
ALTER TABLE cost_entries
  DROP CONSTRAINT IF EXISTS cost_entries_channel_check;

ALTER TABLE cost_entries
  ADD CONSTRAINT cost_entries_channel_check
    CHECK (channel IN ('wing', 'rg', 'naver'));

-- 채널 간 재고 이동 이력 테이블
CREATE TABLE IF NOT EXISTS channel_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  product_cost_id UUID NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  from_channel    TEXT NOT NULL CHECK (from_channel IN ('wing', 'rg', 'naver')),
  to_channel      TEXT NOT NULL CHECK (to_channel IN ('wing', 'rg', 'naver')),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost       NUMERIC(12,2) NOT NULL,
  transferred_at  DATE NOT NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_transfers_product ON channel_transfers(product_cost_id);
CREATE INDEX IF NOT EXISTS idx_channel_transfers_user    ON channel_transfers(user_id);
```

- [ ] **Step 2: 마이그레이션 실행**

```bash
# 프로젝트 루트에서 실행 (DB 연결은 .env.local의 DATABASE_URL 사용)
node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync('src/db/migrations/003_channel_transfers.sql', 'utf8');
pool.query(sql).then(() => { console.log('마이그레이션 완료'); pool.end(); }).catch(e => { console.error(e); pool.end(1); });
" 
```

Expected output: `마이그레이션 완료`

- [ ] **Step 3: 커밋**

```bash
git add src/db/migrations/003_channel_transfers.sql
git commit -m "feat: channel_transfers 테이블 추가 및 cost_entries.channel naver 허용"
```

---

## Task 2: FIFO 상수 및 채널 이동 헬퍼 함수 추가 (TDD)

**Files:**
- Modify: `src/lib/cost-management/fifo.ts`
- Create: `src/__tests__/lib/channel-transfer-logic.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/channel-transfer-logic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ENTRY_CHANNEL, SALE_CHANNEL, calcChannelStock } from '@/lib/cost-management/fifo';

describe('ENTRY_CHANNEL', () => {
  it('naver 상수 포함', () => {
    expect(ENTRY_CHANNEL.NAVER).toBe('naver');
  });
});

describe('SALE_CHANNEL', () => {
  it('naver 상수 포함', () => {
    expect(SALE_CHANNEL.NAVER).toBe('naver');
  });
});

describe('calcChannelStock', () => {
  it('입고만 있고 판매·이동 없으면 전체 재고 반환', () => {
    const batches = [
      { id: 'e1', received_at: '2026-01-01', quantity: 100, unit_cost: 5000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0, channel: 'wing' },
    ];
    const sales: never[] = [];
    const incomingTransfers: never[] = [];
    const outgoingQty = 0;
    const result = calcChannelStock(batches, sales, incomingTransfers, outgoingQty, 0);
    expect(result.current_stock).toBe(100);
    expect(result.total_realized_profit).toBe(0);
  });

  it('TO-이동이 가상 입고로 처리됨', () => {
    const batches: never[] = [];
    const sales: never[] = [];
    const incomingTransfers = [
      { received_at: '2026-02-01', quantity: 30, unit_cost: 5000 },
    ];
    const result = calcChannelStock(batches, sales, incomingTransfers, 0, 0);
    expect(result.current_stock).toBe(30);
  });

  it('FROM-이동 수량이 current_stock에서 차감됨', () => {
    const batches = [
      { id: 'e1', received_at: '2026-01-01', quantity: 100, unit_cost: 5000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0, channel: 'wing' },
    ];
    const result = calcChannelStock(batches, [], [], 30, 0);
    expect(result.current_stock).toBe(70);
  });

  it('실제 판매가 있으면 실현손익 계산', () => {
    const batches = [
      { id: 'e1', received_at: '2026-01-01', quantity: 10, unit_cost: 5000, unit_shipping_fee: 500, unit_rg_shipping_fee: 0, channel: 'wing' },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-01-10', quantity: 5, selling_price: 10000 },
    ];
    // 원가 = (5000+500) × 5 = 27500, 수수료 = 10000 × 0.1 × 5 = 5000, 손익 = 50000 - 27500 - 5000 = 17500
    const result = calcChannelStock(batches, sales, [], 0, 0.1);
    expect(result.total_realized_profit).toBe(17500);
    expect(result.current_stock).toBe(5);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/lib/channel-transfer-logic.test.ts
```

Expected: FAIL (`ENTRY_CHANNEL.NAVER is not defined`, `calcChannelStock is not a function`)

- [ ] **Step 3: fifo.ts에 상수와 함수 추가**

`src/lib/cost-management/fifo.ts` 수정:

```typescript
// 기존 ENTRY_CHANNEL 교체
export const ENTRY_CHANNEL = {
  RG: 'rg',
  WING: 'wing',
  NAVER: 'naver',
} as const;

// 기존 SALE_CHANNEL 교체
export const SALE_CHANNEL = {
  ROCKET_GROWTH: 'rocket_growth',
  MANUAL: 'manual',
  COUPANG: 'coupang',
  NAVER: 'naver',
} as const;
```

파일 맨 아래에 `calcChannelStock` 함수 추가:

```typescript
/** 채널 이동을 포함한 채널별 재고/손익 계산 */
export interface IncomingTransferBatch {
  received_at: string;
  quantity: number;
  unit_cost: number;
}

export function calcChannelStock(
  batches: PurchaseBatch[],
  sales: SaleRow[],
  incomingTransfers: IncomingTransferBatch[],
  outgoingQty: number,
  platformFeeRate: number,
): FifoSummary {
  // TO-이동을 가상 입고 배치로 변환 (배송비 없음 — 이미 원본 채널에서 반영됨)
  const syntheticBatches: PurchaseBatch[] = incomingTransfers.map((t, i) => ({
    id: `transfer-in-${i}`,
    received_at: t.received_at,
    quantity: t.quantity,
    unit_cost: t.unit_cost,
    unit_shipping_fee: 0,
    unit_rg_shipping_fee: 0,
  }));

  const allBatches = [...batches, ...syntheticBatches];
  const result = calculateFifo(allBatches, sales, platformFeeRate);

  // FROM-이동 수량을 현재 재고에서 차감
  const adjustedStock = Math.max(0, result.current_stock - outgoingQty);

  return { ...result, current_stock: adjustedStock };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/channel-transfer-logic.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/cost-management/fifo.ts src/__tests__/lib/channel-transfer-logic.test.ts
git commit -m "feat: ENTRY_CHANNEL/SALE_CHANNEL에 naver 추가, calcChannelStock 함수 구현"
```

---

## Task 3: 채널 이동 API (POST/GET) — TDD

**Files:**
- Create: `src/app/api/cost-management/products/[id]/channel-transfer/route.ts`
- Create: `src/__tests__/api/channel-transfer.test.ts`

- [ ] **Step 1: 실패하는 API 테스트 작성**

`src/__tests__/api/channel-transfer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST, GET } from '@/app/api/cost-management/products/[id]/channel-transfer/route';
import { NextRequest } from 'next/server';

// getCurrentUser mock
vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

// DB pool mock
const mockQuery = vi.fn();
vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({
      query: mockQuery,
      release: vi.fn(),
    }),
  }),
}));

function makeReq(body: object, productId = 'prod-1') {
  return {
    request: new NextRequest('http://localhost', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    params: Promise.resolve({ id: productId }),
  };
}

describe('POST /api/cost-management/products/[id]/channel-transfer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('from_channel === to_channel이면 400 반환', async () => {
    const { request, params } = makeReq({
      from_channel: 'wing', to_channel: 'wing', quantity: 10, transferred_at: '2026-05-25',
    });
    const res = await POST(request, { params });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/같은 채널/);
  });

  it('상품이 없으면 404 반환', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // product 조회
    const { request, params } = makeReq({
      from_channel: 'wing', to_channel: 'naver', quantity: 10, transferred_at: '2026-05-25',
    });
    const res = await POST(request, { params });
    expect(res.status).toBe(404);
  });

  it('재고 부족이면 400 반환', async () => {
    // product 조회 성공
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'prod-1', platform_fee_rate: '0.1' }] });
    // 입고 entries
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 'e1', received_at: '2026-01-01', quantity: 5, unit_cost: 5000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0, channel: 'wing' },
    ]});
    // 판매 records
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 기존 FROM-transfers
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { request, params } = makeReq({
      from_channel: 'wing', to_channel: 'naver', quantity: 10, transferred_at: '2026-05-25',
    });
    const res = await POST(request, { params });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/재고 부족/);
  });
});

describe('GET /api/cost-management/products/[id]/channel-transfer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('이동 이력 목록 반환', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'prod-1' }] }); // product check
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 't1', from_channel: 'wing', to_channel: 'naver', quantity: 30, unit_cost: 5000, transferred_at: '2026-05-25', note: null },
    ]});
    const req = new NextRequest('http://localhost');
    const res = await GET(req, { params: Promise.resolve({ id: 'prod-1' }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].from_channel).toBe('wing');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/api/channel-transfer.test.ts
```

Expected: FAIL (모듈 없음)

- [ ] **Step 3: 채널 이동 API 구현**

`src/app/api/cost-management/products/[id]/channel-transfer/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { calculateFifo, ENTRY_CHANNEL } from '@/lib/cost-management/fifo';
import type { PurchaseBatch, SaleRow } from '@/lib/cost-management/fifo';

type Channel = 'wing' | 'rg' | 'naver';
const VALID_CHANNELS: Channel[] = ['wing', 'rg', 'naver'];

// POST /api/cost-management/products/[id]/channel-transfer
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { from_channel, to_channel, quantity, transferred_at, note } = body ?? {};

  // 유효성 검사
  if (!VALID_CHANNELS.includes(from_channel) || !VALID_CHANNELS.includes(to_channel)) {
    return NextResponse.json({ success: false, error: 'from_channel, to_channel은 wing/rg/naver 중 하나여야 합니다.' }, { status: 400 });
  }
  if (from_channel === to_channel) {
    return NextResponse.json({ success: false, error: '같은 채널로는 이동할 수 없습니다.' }, { status: 400 });
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return NextResponse.json({ success: false, error: 'quantity는 양의 정수여야 합니다.' }, { status: 400 });
  }
  if (!transferred_at || !/^\d{4}-\d{2}-\d{2}$/.test(transferred_at)) {
    return NextResponse.json({ success: false, error: 'transferred_at은 YYYY-MM-DD 형식이어야 합니다.' }, { status: 400 });
  }

  const pool = getSourcingPool();

  // 상품 소유 확인
  const { rows: productRows } = await pool.query(
    `SELECT id, platform_fee_rate FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (productRows.length === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const feeRate = Number(productRows[0].platform_fee_rate);

  // from_channel 재고 계산 (FIFO)
  const [{ rows: entryRows }, { rows: saleRows }, { rows: transferRows }] = await Promise.all([
    pool.query(
      `SELECT id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, channel
       FROM cost_entries WHERE product_cost_id = $1 AND channel = $2`,
      [id, from_channel],
    ),
    pool.query(
      `SELECT id, sold_at, quantity, selling_price
       FROM sale_records WHERE product_cost_id = $1 AND channel = $2`,
      [id, saleChannelForEntry(from_channel)],
    ),
    pool.query(
      `SELECT COALESCE(SUM(quantity), 0) AS outgoing
       FROM channel_transfers WHERE product_cost_id = $1 AND from_channel = $2 AND user_id = $3`,
      [id, from_channel, user.userId],
    ),
  ]);

  const batches: PurchaseBatch[] = entryRows.map((e) => ({
    id: e.id,
    received_at: String(e.received_at).slice(0, 10),
    quantity: Number(e.quantity),
    unit_cost: Number(e.unit_cost),
    unit_shipping_fee: Number(e.unit_shipping_fee),
    unit_rg_shipping_fee: Number(e.unit_rg_shipping_fee),
  }));
  const sales: SaleRow[] = saleRows.map((s) => ({
    id: s.id,
    sold_at: String(s.sold_at).slice(0, 10),
    quantity: Number(s.quantity),
    selling_price: Number(s.selling_price),
  }));

  let fifoStock = 0;
  try {
    const result = calculateFifo(batches, sales, feeRate);
    fifoStock = result.current_stock;
  } catch {
    fifoStock = 0;
  }

  // TO-transfers는 이 채널에서 나간 수량
  const outgoingAlready = Number(transferRows[0].outgoing);
  const availableStock = fifoStock - outgoingAlready;

  if (availableStock < quantity) {
    return NextResponse.json(
      {
        success: false,
        error: `재고 부족: ${from_channel} 채널 가용 재고 ${availableStock}개, 요청 ${quantity}개`,
      },
      { status: 400 },
    );
  }

  // FIFO 단가 계산: 이동할 수량만큼 FIFO 적용 시 평균 단가
  const unitCost = computeTransferUnitCost(batches, sales, quantity);

  // channel_transfers 레코드 삽입
  const { rows: inserted } = await pool.query(
    `INSERT INTO channel_transfers (user_id, product_cost_id, from_channel, to_channel, quantity, unit_cost, transferred_at, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [user.userId, id, from_channel, to_channel, quantity, unitCost, transferred_at, note ?? null],
  );

  return NextResponse.json({ success: true, data: inserted[0] }, { status: 201 });
}

// GET /api/cost-management/products/[id]/channel-transfer
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
    `SELECT id, from_channel, to_channel, quantity, unit_cost, transferred_at, note, created_at
     FROM channel_transfers WHERE product_cost_id = $1 AND user_id = $2
     ORDER BY transferred_at DESC, created_at DESC`,
    [id, user.userId],
  );

  return NextResponse.json({ success: true, data: rows });
}

// 입고 채널 → 판매 채널 매핑
function saleChannelForEntry(entryChannel: string): string {
  if (entryChannel === ENTRY_CHANNEL.RG) return 'rocket_growth';
  if (entryChannel === ENTRY_CHANNEL.NAVER) return 'naver';
  return 'coupang'; // wing
}

// FIFO 방식으로 이동할 quantity만큼의 평균 단가 계산
function computeTransferUnitCost(batches: PurchaseBatch[], sales: SaleRow[], qty: number): number {
  const sorted = [...batches].sort((a, b) => a.received_at.localeCompare(b.received_at));
  const queue = sorted.map((b) => ({ ...b, remaining: b.quantity }));

  // 기존 판매로 소진된 수량 먼저 차감
  for (const sale of [...sales].sort((a, b) => a.sold_at.localeCompare(b.sold_at))) {
    let left = sale.quantity;
    for (const batch of queue) {
      if (left <= 0) break;
      const take = Math.min(batch.remaining, left);
      batch.remaining -= take;
      left -= take;
    }
  }

  // 남은 재고에서 qty만큼의 가중평균 단가 계산
  let left = qty;
  let totalCost = 0;
  for (const batch of queue) {
    if (left <= 0) break;
    const take = Math.min(batch.remaining, left);
    totalCost += batch.unit_cost * take;
    left -= take;
  }
  return qty > 0 ? Math.round(totalCost / qty) : 0;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/channel-transfer.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add "src/app/api/cost-management/products/[id]/channel-transfer/route.ts" src/__tests__/api/channel-transfer.test.ts
git commit -m "feat: 채널 이동 API (POST/GET) 구현"
```

---

## Task 4: 채널 이동 삭제 API (DELETE)

**Files:**
- Create: `src/app/api/cost-management/channel-transfers/[transferId]/route.ts`

- [ ] **Step 1: 삭제 API 구현**

`src/app/api/cost-management/channel-transfers/[transferId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

// DELETE /api/cost-management/channel-transfers/[transferId]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ transferId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { transferId } = await params;
  const pool = getSourcingPool();

  const { rowCount } = await pool.query(
    `DELETE FROM channel_transfers WHERE id = $1 AND user_id = $2`,
    [transferId, user.userId],
  );

  if ((rowCount ?? 0) === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: 동작 확인 (수동)**

개발 서버가 실행 중이면:
```bash
curl -X DELETE http://localhost:3000/api/cost-management/channel-transfers/nonexistent-id
# Expected: {"success":false,"error":"Not found"} status 404
```

- [ ] **Step 3: 커밋**

```bash
git add "src/app/api/cost-management/channel-transfers/[transferId]/route.ts"
git commit -m "feat: 채널 이동 삭제 API (DELETE) 구현"
```

---

## Task 5: 입고 API에 naver 채널 허용

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/entries/route.ts`

- [ ] **Step 1: POST 핸들러의 channel 유효성 검사 수정**

`src/app/api/cost-management/products/[id]/entries/route.ts` 에서 아래 라인을 찾아 수정:

기존:
```typescript
(channel === ENTRY_CHANNEL.RG || channel === ENTRY_CHANNEL.WING) ? channel : ENTRY_CHANNEL.WING,
```

변경:
```typescript
([ENTRY_CHANNEL.RG, ENTRY_CHANNEL.WING, ENTRY_CHANNEL.NAVER] as string[]).includes(channel)
  ? channel
  : ENTRY_CHANNEL.WING,
```

- [ ] **Step 2: 커밋**

```bash
git add "src/app/api/cost-management/products/[id]/entries/route.ts"
git commit -m "feat: 입고 API에 naver 채널 허용"
```

---

## Task 6: products API에 naver 채널 필터 및 이동 반영

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`

- [ ] **Step 1: channelFilter 타입 확장**

`src/app/api/cost-management/products/route.ts` 에서:

기존:
```typescript
const channelFilter = (searchParams.get('channel') ?? 'all') as 'all' | 'rg' | 'wing';
```

변경:
```typescript
const channelFilter = (searchParams.get('channel') ?? 'all') as 'all' | 'rg' | 'wing' | 'naver';
```

- [ ] **Step 2: channel_transfers 조회 추가**

기존 `allSales` 조회 다음 줄에 아래 쿼리 추가:

```typescript
// 채널 이동 이력 전체 조회
const { rows: allTransfers } = await pool.query(
  `SELECT product_cost_id, from_channel, to_channel, quantity, unit_cost, transferred_at
   FROM channel_transfers WHERE user_id = $1`,
  [user.userId],
);

// product별 채널 이동 그룹핑
const transfersByProduct = new Map<string, typeof allTransfers>();
for (const t of allTransfers) {
  const list = transfersByProduct.get(t.product_cost_id) ?? [];
  list.push(t);
  transfersByProduct.set(t.product_cost_id, list);
}
```

- [ ] **Step 3: filteredProducts에 naver 케이스 추가**

기존:
```typescript
const filteredProducts = channelFilter === 'rg'
  ? products.filter((p) => p.vendor_item_id != null)
  : channelFilter === 'wing'
    ? products.filter((p) => p.seller_product_id != null)
    : products;
```

변경:
```typescript
const filteredProducts = channelFilter === 'rg'
  ? products.filter((p) => p.vendor_item_id != null)
  : channelFilter === 'wing'
    ? products.filter((p) => p.seller_product_id != null)
    : products; // naver & all: 모든 상품 표시
```

- [ ] **Step 4: batchesToUse / salesToUse에 naver 케이스 추가**

기존 batchesToUse 코드를 다음으로 교체 (wing/rg에도 TO-이동 가상 배치 추가):

```typescript
const pTransfers = transfersByProduct.get(p.id) ?? [];

// TO-이동을 가상 입고 배치로 변환 (배송비 0 — 원본 채널에서 이미 반영됨)
function toSyntheticBatches(targetChannel: string): PurchaseBatch[] {
  return pTransfers
    .filter((t) => t.to_channel === targetChannel)
    .map((t, i): PurchaseBatch => ({
      id: `transfer-in-${targetChannel}-${i}`,
      received_at: String(t.transferred_at).slice(0, 10),
      quantity: Number(t.quantity),
      unit_cost: Number(t.unit_cost),
      unit_shipping_fee: 0,
      unit_rg_shipping_fee: 0,
    }));
}

const batchesToUse = channelFilter === 'rg'
  ? [...pEntries.filter((e) => e.channel === ENTRY_CHANNEL.RG), ...toSyntheticBatches('rg')]
  : channelFilter === 'wing'
    ? [...pEntries.filter((e) => e.channel === ENTRY_CHANNEL.WING), ...toSyntheticBatches('wing')]
  : channelFilter === 'naver'
    ? [...pEntries.filter((e) => e.channel === ENTRY_CHANNEL.NAVER), ...toSyntheticBatches('naver')]
    : pEntries;

const salesToUse = channelFilter === 'rg'
  ? pSales.filter((s) => s.channel === SALE_CHANNEL.ROCKET_GROWTH)
  : channelFilter === 'wing'
    ? pSales.filter((s) => s.channel !== SALE_CHANNEL.ROCKET_GROWTH)
  : channelFilter === 'naver'
    ? pSales.filter((s) => s.channel === SALE_CHANNEL.NAVER)
    : pSales;
```

- [ ] **Step 5: FROM-이동 차감 (wing/rg/naver 공통)**

FIFO 계산 후 `fifoResult` 처리 부분에서 current_stock 조정 추가:

```typescript
// 기존 try/catch로 fifoResult 계산 후 ...
// TO-이동은 batchesToUse에 가상 배치로 포함됨. FROM-이동만 추가 차감.
if (channelFilter === 'wing' || channelFilter === 'rg' || channelFilter === 'naver') {
  const outgoingQty = pTransfers
    .filter((t) => t.from_channel === channelFilter)
    .reduce((sum, t) => sum + Number(t.quantity), 0);
  fifoResult = {
    ...fifoResult,
    current_stock: Math.max(0, fifoResult.current_stock - outgoingQty),
  };
}
```

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/cost-management/products/route.ts
git commit -m "feat: products API에 naver 채널 필터 및 channel_transfers 반영"
```

---

## Task 7: 네이버 판매 임포트 API

**Files:**
- Create: `src/app/api/cost-management/products/[id]/naver-import/route.ts`

- [ ] **Step 1: 네이버 임포트 API 구현**

`src/app/api/cost-management/products/[id]/naver-import/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';

// POST /api/cost-management/products/[id]/naver-import
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { from, to, productName } = body ?? {};

  if (!from || !to) {
    return NextResponse.json({ success: false, error: 'from, to (YYYY-MM-DD) required' }, { status: 400 });
  }

  const pool = getSourcingPool();
  const { rows: products } = await pool.query(
    `SELECT id, product_name FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (products.length === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const storedName = String(products[0].product_name ?? '').toLowerCase().trim();
  const filterName = productName ? String(productName).toLowerCase().trim() : storedName;

  try {
    const client = getNaverCommerceClient();
    const result = await client.getOrders({ fromDate: from, toDate: to });

    const CANCELLED_STATUSES = new Set(['CANCELED', 'RETURNED', 'EXCHANGED']);
    const MIN_NAME_MATCH = 8;

    const items: Array<{
      sold_at: string;
      quantity: number;
      selling_price: number;
      naver_product_order_id: string;
    }> = [];

    for (const o of result.contents ?? []) {
      if (CANCELLED_STATUSES.has(o.productOrderStatus)) continue;
      if (!o.productName) continue;

      const oName = o.productName.toLowerCase().trim();
      // 상품명 앞뒤 prefix 매칭 (8자 이상일 때만)
      const matches =
        filterName.length >= MIN_NAME_MATCH &&
        oName.length >= MIN_NAME_MATCH &&
        (oName.startsWith(filterName) || filterName.startsWith(oName));

      if (!matches) continue;

      const unitPrice = o.quantity > 0
        ? Math.round(o.totalPaymentAmount / o.quantity)
        : o.totalPaymentAmount;

      items.push({
        sold_at: o.orderDate.slice(0, 10),
        quantity: o.quantity,
        selling_price: unitPrice,
        naver_product_order_id: o.productOrderId,
      });
    }

    let imported = 0;
    let skipped = 0;
    for (const item of items) {
      const result = await pool.query(
        `INSERT INTO sale_records
           (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id)
         VALUES ($1, $2, $3, $4, $5, 'naver', $6)
         ON CONFLICT (coupang_order_item_id) DO NOTHING`,
        [user.userId, id, item.sold_at, item.quantity, item.selling_price, `naver-${item.naver_product_order_id}`],
      );
      if ((result.rowCount ?? 0) > 0) imported++;
      else skipped++;
    }

    return NextResponse.json({ success: true, data: { imported, skipped, total: items.length } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

> 참고: `coupang_order_item_id` 컬럼을 `naver-{productOrderId}` 형식으로 재사용해 중복 방지.
> 기존 테이블에 UNIQUE 제약이 이 컬럼에 걸려 있어 동일 패턴으로 동작한다.

- [ ] **Step 2: 커밋**

```bash
git add "src/app/api/cost-management/products/[id]/naver-import/route.ts"
git commit -m "feat: 네이버 판매 임포트 API 구현"
```

---

## Task 8: ChannelTransferModal 컴포넌트 (TDD)

**Files:**
- Create: `src/components/orders/ChannelTransferModal.tsx`

- [ ] **Step 1: 컴포넌트 구현**

`src/components/orders/ChannelTransferModal.tsx`:

```typescript
'use client';

import React, { useState } from 'react';
import { X, ArrowRight } from 'lucide-react';

type Channel = 'wing' | 'rg' | 'naver';

const CHANNEL_LABEL: Record<Channel, string> = {
  wing: '윙판매',
  rg: 'RG',
  naver: '네이버',
};

const CHANNEL_COLOR: Record<Channel, string> = {
  wing: '#be0014',
  rg: '#15803d',
  naver: '#03c75a',
};

interface Props {
  productId: string;
  productName: string;
  currentStock: number;
  onClose: () => void;
  onChanged: () => void;
}

export default function ChannelTransferModal({
  productId,
  productName,
  currentStock,
  onClose,
  onChanged,
}: Props) {
  const [fromChannel, setFromChannel] = useState<Channel>('wing');
  const [toChannel, setToChannel] = useState<Channel>('naver');
  const [quantity, setQuantity] = useState('');
  const [transferredAt, setTransferredAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qty = parseInt(quantity, 10);
  const isValid = !isNaN(qty) && qty > 0 && qty <= currentStock && fromChannel !== toChannel;

  async function handleSubmit() {
    if (!isValid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/cost-management/products/${productId}/channel-transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_channel: fromChannel, to_channel: toChannel, quantity: qty, transferred_at: transferredAt, note: note || undefined }),
      });
      const json = await res.json();
      if (!json.success) { setError(json.error ?? '이동 실패'); return; }
      onChanged();
      onClose();
    } catch {
      setError('네트워크 오류');
    } finally {
      setSaving(false);
    }
  }

  const afterFrom = !isNaN(qty) && qty > 0 ? currentStock - qty : null;
  const afterTo = !isNaN(qty) && qty > 0 ? qty : null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: '16px', padding: '28px', width: '420px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', color: '#71717a' }}>
          <X size={18} />
        </button>

        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>📦 채널 간 재고 이동</h2>
        <p style={{ fontSize: '12px', color: '#71717a', marginBottom: '20px' }}>{productName}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* 수량 */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#52525b', display: 'block', marginBottom: '4px' }}>이동할 수량</label>
            <input
              type="number"
              min={1}
              max={currentStock}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={`최대 ${currentStock}개`}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e5e5', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
            />
            {!isNaN(qty) && qty > currentStock && (
              <p style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>현재 재고(총 {currentStock}개)를 초과합니다.</p>
            )}
          </div>

          {/* 이동 날짜 */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#52525b', display: 'block', marginBottom: '4px' }}>이동 날짜</label>
            <input
              type="date"
              value={transferredAt}
              onChange={(e) => setTransferredAt(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e5e5', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          {/* 채널 선택 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#52525b', display: 'block', marginBottom: '4px' }}>출발 채널</label>
              <select
                value={fromChannel}
                onChange={(e) => setFromChannel(e.target.value as Channel)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: '8px', fontSize: '13px', outline: 'none' }}
              >
                {(['wing', 'rg', 'naver'] as Channel[]).map((ch) => (
                  <option key={ch} value={ch}>{CHANNEL_LABEL[ch]}</option>
                ))}
              </select>
            </div>
            <ArrowRight size={18} color="#71717a" style={{ marginTop: '20px', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#52525b', display: 'block', marginBottom: '4px' }}>도착 채널</label>
              <select
                value={toChannel}
                onChange={(e) => setToChannel(e.target.value as Channel)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: '8px', fontSize: '13px', outline: 'none' }}
              >
                {(['wing', 'rg', 'naver'] as Channel[]).filter((ch) => ch !== fromChannel).map((ch) => (
                  <option key={ch} value={ch}>{CHANNEL_LABEL[ch]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 이동 후 재고 미리보기 */}
          {afterFrom !== null && (
            <div style={{ background: '#f9f9f9', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#52525b' }}>
              <span style={{ color: CHANNEL_COLOR[fromChannel], fontWeight: 600 }}>{CHANNEL_LABEL[fromChannel]}</span> 이동 후 재고: <b>{afterFrom}개</b>
              <span style={{ margin: '0 8px', color: '#ccc' }}>|</span>
              <span style={{ color: CHANNEL_COLOR[toChannel], fontWeight: 600 }}>{CHANNEL_LABEL[toChannel]}</span> 추가 예정: <b>+{afterTo}개</b>
            </div>
          )}

          {/* 메모 */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#52525b', display: 'block', marginBottom: '4px' }}>메모 (선택)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 네이버 채널 전환"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e5e5', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          {error && <p style={{ fontSize: '12px', color: '#ef4444' }}>{error}</p>}

          {/* 버튼 */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: '8px', border: '1px solid #e5e5e5', background: '#fff', color: '#71717a', fontSize: '13px', cursor: 'pointer' }}>
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={!isValid || saving}
              style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: isValid && !saving ? '#18181b' : '#d4d4d4', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: isValid && !saving ? 'pointer' : 'default' }}
            >
              {saving ? '이동 중...' : '이동 확인'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/orders/ChannelTransferModal.tsx
git commit -m "feat: ChannelTransferModal 컴포넌트 구현"
```

---

## Task 9: CostManagementTab UI 변경

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

- [ ] **Step 1: channelFilter 타입 확장**

기존:
```typescript
const [channelFilter, setChannelFilter] = useState<'all' | 'rg' | 'wing'>('all');
```

변경:
```typescript
const [channelFilter, setChannelFilter] = useState<'all' | 'wing' | 'rg' | 'naver'>('all');
```

- [ ] **Step 2: 채널 이동 모달 state & import 추가**

파일 상단 import에 추가:
```typescript
import ChannelTransferModal from './ChannelTransferModal';
```

컴포넌트 내부 state 추가 (기존 state 선언 근처):
```typescript
const [transferTarget, setTransferTarget] = useState<{ id: string; name: string; stock: number } | null>(null);
```

- [ ] **Step 3: 채널 필터 UI에 네이버 추가**

기존:
```typescript
{(['all', 'wing', 'rg'] as const).map((ch) => (
  // ...
  {ch === 'all' ? '전체' : ch === 'wing' ? '윙판매' : 'RG'}
```

변경:
```typescript
{(['all', 'wing', 'rg', 'naver'] as const).map((ch) => (
  // ...
  {ch === 'all' ? '전체' : ch === 'wing' ? '윙판매' : ch === 'rg' ? 'RG' : '네이버'}
```

- [ ] **Step 4: 테이블 헤더에 '이동' 컬럼 추가**

기존 헤더 배열:
```typescript
{['채널', '상품명', '원가(가중평균)', '배송비(배분)', 'RG배송비', '재고', '재고가치', '실현손익', '마진율', '광고비', 'ROAS', '위너', '입고', '판매', '내역'].map((h) => (
```

변경:
```typescript
{['채널', '상품명', '원가(가중평균)', '배송비(배분)', 'RG배송비', '재고', '재고가치', '실현손익', '마진율', '광고비', 'ROAS', '위너', '입고', '판매', '이동', '내역'].map((h) => (
```

- [ ] **Step 5: 테이블 행에 '이동' 버튼 추가**

기존 '판매' 카운트 셀 (`entry_count`, `sale_count`) 다음, '내역' 버튼 앞에 추가:

```typescript
{/* 이동 버튼 */}
<td style={{ padding: '10px 12px', textAlign: 'center' }}>
  <button
    onClick={() => setTransferTarget({ id: p.id, name: p.product_name, stock: p.current_stock })}
    disabled={p.current_stock === 0}
    title="채널 간 재고 이동"
    style={{
      background: 'none', border: '1px solid #e5e5e5', borderRadius: '6px',
      padding: '3px 8px', fontSize: '11px', color: p.current_stock > 0 ? '#52525b' : '#d4d4d4',
      cursor: p.current_stock > 0 ? 'pointer' : 'default',
      opacity: p.current_stock === 0 ? 0.3 : 1,
    }}
  >
    → 이동
  </button>
</td>
```

- [ ] **Step 6: 모달 렌더링 추가**

컴포넌트 JSX 반환 최상단 (기존 모달들 아래)에 추가:
```typescript
{transferTarget && (
  <ChannelTransferModal
    productId={transferTarget.id}
    productName={transferTarget.name}
    currentStock={transferTarget.stock}
    onClose={() => setTransferTarget(null)}
    onChanged={() => { setTransferTarget(null); load(); }}
  />
)}
```

- [ ] **Step 7: 네이버 채널 필터에서 naver 처리 추가**

기존 `channelFilter === 'rg'` 분기의 RG 실재고 조회 조건 확인:
```typescript
// channelFilter가 'rg'일 때만 RG 실재고 조회 — 기존 로직 유지
if (channelFilter !== 'rg') { setRgInventory(new Map()); return; }
```
→ 이 로직은 변경 불필요 (naver는 별도 실재고 없음).

- [ ] **Step 8: 커밋**

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat: CostManagementTab에 네이버 필터·이동 버튼·ChannelTransferModal 연결"
```

---

## Task 10: CostEntryDrawer에 네이버 입고 채널 추가

**Files:**
- Modify: `src/components/orders/CostEntryDrawer.tsx`

- [ ] **Step 1: entryChannel 타입 확장**

기존:
```typescript
const [entryChannel, setEntryChannel] = useState<'rg' | 'wing'>('wing');
```

변경:
```typescript
const [entryChannel, setEntryChannel] = useState<'rg' | 'wing' | 'naver'>('wing');
```

- [ ] **Step 2: 채널 토글 UI에 네이버 추가**

기존 wing/rg 토글 버튼을 찾아 수정. 현재 파일에서 `entryChannel` 관련 UI를 검색:

기존 (wing/rg 2개 버튼 형태):
```typescript
// 입고 채널 선택 UI (entryChannel === 'wing' or 'rg' 토글)
```

변경 후 — 3개 버튼 형태로:
```typescript
<div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
  <span style={{ fontSize: '11px', color: '#52525b', fontWeight: 600, alignSelf: 'center', marginRight: '4px' }}>입고 채널</span>
  {(['wing', 'rg', 'naver'] as const).map((ch) => (
    <button
      key={ch}
      onClick={() => setEntryChannel(ch)}
      style={{
        padding: '4px 12px', borderRadius: '16px', border: `1px solid ${entryChannel === ch ? '#18181b' : '#e5e5e5'}`,
        background: entryChannel === ch ? '#18181b' : '#fff',
        color: entryChannel === ch ? '#fff' : '#52525b',
        fontSize: '11px', fontWeight: entryChannel === ch ? 600 : 400, cursor: 'pointer',
      }}
    >
      {ch === 'wing' ? '윙판매' : ch === 'rg' ? 'RG' : '네이버'}
    </button>
  ))}
</div>
```

> 참고: 실제 파일에서 `entryChannel` 토글 UI를 찾아 위 패턴으로 교체한다. 파일 내 `entryChannel === 'wing'` 또는 `entryChannel === 'rg'` 버튼 조건부 렌더링 부분.

- [ ] **Step 3: 커밋**

```bash
git add src/components/orders/CostEntryDrawer.tsx
git commit -m "feat: CostEntryDrawer에 네이버 입고 채널 추가"
```

---

## Task 11: SaleEntryPanel에 네이버 판매 가져오기 버튼 추가

**Files:**
- Modify: `src/components/orders/SaleEntryPanel.tsx`

- [ ] **Step 1: 네이버 임포트 state 추가**

기존 `importing` state 근처에 추가:
```typescript
const [importingNaver, setImportingNaver] = useState(false);
```

- [ ] **Step 2: 네이버 가져오기 함수 구현**

기존 쿠팡 임포트 함수 패턴을 참고하여 `importForm` 재사용:

```typescript
async function importNaverSales() {
  setImportingNaver(true);
  try {
    const res = await fetch(`/api/cost-management/products/${productId}/naver-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: importForm.from, to: importForm.to }),
    });
    const json = await res.json();
    if (json.success) {
      alert(`네이버 판매 ${json.data.imported}건 가져오기 완료 (중복 ${json.data.skipped}건 스킵)`);
      load();
    } else {
      alert(`실패: ${json.error}`);
    }
  } catch {
    alert('네트워크 오류');
  } finally {
    setImportingNaver(false);
  }
}
```

- [ ] **Step 3: UI에 네이버 가져오기 버튼 추가**

기존 쿠팡/RG 가져오기 버튼이 있는 `showImportForm` 섹션 내부에, 쿠팡 임포트 버튼 바로 아래에 추가:

```typescript
<button
  onClick={importNaverSales}
  disabled={importingNaver}
  style={{
    display: 'flex', alignItems: 'center', gap: '5px',
    padding: '6px 12px', borderRadius: '7px', border: '1px solid #bbf7d0',
    background: '#fff', color: '#15803d', fontSize: '12px', cursor: importingNaver ? 'not-allowed' : 'pointer',
    opacity: importingNaver ? 0.6 : 1,
  }}
>
  <CloudDownload size={13} />
  {importingNaver ? '가져오는 중...' : '네이버 판매 가져오기'}
</button>
```

- [ ] **Step 4: 커밋**

```bash
git add src/components/orders/SaleEntryPanel.tsx
git commit -m "feat: SaleEntryPanel에 네이버 판매 가져오기 버튼 추가"
```

---

## Task 12: 전체 테스트 실행 및 최종 커밋

- [ ] **Step 1: 전체 단위 테스트 실행**

```bash
npx vitest run
```

Expected: 기존 테스트 포함 전체 PASS. 실패가 있으면 해당 테스트의 에러 메시지를 확인하고 수정.

- [ ] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit
```

Expected: 오류 없음. 오류가 있으면 해당 파일의 타입 불일치를 수정.

- [ ] **Step 3: 최종 커밋**

```bash
git add -A
git commit -m "feat: 채널 간 재고 이동 & 네이버 판매 채널 추가 완료"
```

---

## 체크리스트 (구현 완료 기준)

- [ ] `channel_transfers` 테이블이 DB에 생성됨
- [ ] `cost_entries.channel`에 'naver' 값 저장 가능
- [ ] 원가관리 채널 필터에 '네이버' 탭 표시
- [ ] 상품 행 '→ 이동' 버튼 클릭 시 `ChannelTransferModal` 표시
- [ ] 이동 완료 후 재고 수치 갱신
- [ ] 네이버 채널 필터 선택 시 naver 입고·이동 기반으로 재고 계산
- [ ] CostEntryDrawer에서 '네이버' 채널 선택 가능
- [ ] SaleEntryPanel에서 네이버 판매 가져오기 가능
- [ ] 모든 Vitest 테스트 통과
