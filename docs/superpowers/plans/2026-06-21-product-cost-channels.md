# product_cost_channels 구현 플랜 (Option C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** product_costs의 채널 식별자(vendor_item_id, naver_channel_product_no, Wing seller_product_id)를 `product_cost_channels` junction 테이블로 분리해 1 원가 단위(product_costs row)에 N개 채널을 연결할 수 있게 한다.

**Architecture:**
- `product_costs` = 원가 단위(variant). `seller_product_id`는 Level 1 그루핑 키(쿠팡 등록상품ID)로 유지.
- `product_cost_channels(product_cost_id, channel_type, external_id)` = 채널별 식별자 junction.
- channel_type: `'coupang_rg'` (vendor_item_id), `'coupang_wing'` (Wing seller_product_id), `'naver'` (naver_channel_product_no).
- 기존 product_costs 컬럼들은 마이그레이션 후 deprecated 처리, 코드 이전 완료 후 별도 DROP.

**Tech Stack:** PostgreSQL, Next.js App Router (TypeScript), React, vitest

**프로젝트 경로:** `/Users/seungminlee/Desktop/projects/smart_seller_studio`

---

## 현재 스키마 요약

```
product_costs
  id uuid PK
  user_id uuid
  seller_product_id bigint  ← 쿠팡 등록상품ID (Level 1 그루핑 키, 유지)
  vendor_item_id bigint     ← 쿠팡 RG 옵션ID (→ product_cost_channels로 이전)
  naver_channel_product_no bigint  (→ product_cost_channels로 이전)
  product_name text
  platform_fee_rate numeric
  hidden boolean
  ...

product_wing_seller_ids
  id uuid PK
  user_id uuid
  product_cost_id uuid → product_costs.id
  seller_product_id bigint  ← Wing 옵션별 ID (→ product_cost_channels로 이전)
```

---

## Task 1: Migration 079 — product_cost_channels 테이블 생성 + 백필

**Files:**
- Create: `supabase/migrations/079_product_cost_channels.sql`
- Test: `src/__tests__/migrations/079-product-cost-channels.test.ts` (구조 검증)

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- supabase/migrations/079_product_cost_channels.sql
BEGIN;

CREATE TABLE IF NOT EXISTS product_cost_channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  product_cost_id uuid NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  channel_type    text NOT NULL,
  external_id     bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_cost_channels_channel_type_check
    CHECK (channel_type IN ('coupang_rg', 'coupang_wing', 'naver')),
  UNIQUE (user_id, channel_type, external_id)
);

CREATE INDEX IF NOT EXISTS product_cost_channels_product_cost_id_idx
  ON product_cost_channels (product_cost_id);

CREATE INDEX IF NOT EXISTS product_cost_channels_user_channel_idx
  ON product_cost_channels (user_id, channel_type);

-- 백필: product_costs.vendor_item_id → coupang_rg
INSERT INTO product_cost_channels (user_id, product_cost_id, channel_type, external_id)
SELECT user_id, id, 'coupang_rg', vendor_item_id
FROM product_costs
WHERE vendor_item_id IS NOT NULL
ON CONFLICT (user_id, channel_type, external_id) DO NOTHING;

-- 백필: product_costs.naver_channel_product_no → naver
INSERT INTO product_cost_channels (user_id, product_cost_id, channel_type, external_id)
SELECT user_id, id, 'naver', naver_channel_product_no
FROM product_costs
WHERE naver_channel_product_no IS NOT NULL
ON CONFLICT (user_id, channel_type, external_id) DO NOTHING;

-- 백필: product_wing_seller_ids → coupang_wing
INSERT INTO product_cost_channels (user_id, product_cost_id, channel_type, external_id)
SELECT user_id, product_cost_id, 'coupang_wing', seller_product_id
FROM product_wing_seller_ids
ON CONFLICT (user_id, channel_type, external_id) DO NOTHING;

COMMENT ON TABLE product_cost_channels IS
  '원가 단위(product_costs)에 연결된 채널별 외부 ID. channel_type: coupang_rg|coupang_wing|naver';
COMMENT ON COLUMN product_cost_channels.external_id IS
  'coupang_rg=vendor_item_id, coupang_wing=seller_product_id(Wing), naver=naver_channel_product_no';

COMMIT;
```

- [ ] **Step 2: 마이그레이션 실행 및 백필 검증**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
# 실제 DB에 적용 (psql 또는 supabase CLI)
# 백필 건수 확인
psql $DATABASE_URL -c "SELECT channel_type, COUNT(*) FROM product_cost_channels GROUP BY channel_type;"
# 기존 product_costs vendor_item_id 건수와 일치하는지 확인
psql $DATABASE_URL -c "SELECT COUNT(*) FROM product_costs WHERE vendor_item_id IS NOT NULL;"
```

- [ ] **Step 3: 구조 검증 테스트 작성**

```typescript
// src/__tests__/migrations/079-product-cost-channels.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getSourcingPool } from '@/lib/sourcing/db';
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

describe('product_cost_channels 테이블 구조', () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockQuery = vi.fn();
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('UNIQUE 제약: 동일 user_id+channel_type+external_id 중복 불가', () => {
    // 중복 삽입 시 ON CONFLICT DO NOTHING 동작 검증 (mock으로 행 수 0 반환)
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(mockQuery).toBeDefined();
  });

  it('channel_type CHECK 제약: 허용값은 coupang_rg|coupang_wing|naver', () => {
    const allowed = ['coupang_rg', 'coupang_wing', 'naver'];
    expect(allowed).toContain('coupang_rg');
    expect(allowed).toContain('coupang_wing');
    expect(allowed).toContain('naver');
    expect(allowed).not.toContain('invalid_channel');
  });
});
```

- [ ] **Step 4: 테스트 실행**

```bash
npx vitest run src/__tests__/migrations/079-product-cost-channels.test.ts
```

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/079_product_cost_channels.sql \
        src/__tests__/migrations/079-product-cost-channels.test.ts
git commit -m "feat(db): product_cost_channels junction 테이블 — 채널 ID를 product_costs에서 분리"
```

---

## Task 2: Channels CRUD API

**Files:**
- Create: `src/app/api/cost-management/products/[id]/channels/route.ts`
- Create: `src/app/api/cost-management/products/[id]/channels/[channelId]/route.ts`
- Test: `src/__tests__/api/product-cost-channels-crud.test.ts`

### GET /api/cost-management/products/[id]/channels
→ 해당 product의 channel 목록 반환

### POST /api/cost-management/products/[id]/channels
Body: `{ channel_type: 'coupang_rg'|'coupang_wing'|'naver', external_id: number }`
→ 새 채널 항목 추가

### DELETE /api/cost-management/products/[id]/channels/[channelId]
→ 채널 항목 삭제

- [ ] **Step 1: channels/route.ts 작성**

```typescript
// src/app/api/cost-management/products/[id]/channels/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

const VALID_CHANNEL_TYPES = ['coupang_rg', 'coupang_wing', 'naver'] as const;
type ChannelType = typeof VALID_CHANNEL_TYPES[number];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  const { rows } = await pool.query(
    `SELECT id, channel_type, external_id, created_at
     FROM product_cost_channels
     WHERE product_cost_id = $1 AND user_id = $2
     ORDER BY created_at ASC`,
    [id, user.userId],
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
  const { channel_type, external_id } = body ?? {};

  if (!VALID_CHANNEL_TYPES.includes(channel_type as ChannelType)) {
    return NextResponse.json(
      { success: false, error: `channel_type must be one of: ${VALID_CHANNEL_TYPES.join(', ')}` },
      { status: 400 },
    );
  }
  if (!Number.isInteger(external_id) || external_id <= 0) {
    return NextResponse.json(
      { success: false, error: 'external_id must be a positive integer' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  try {
    // 1. product_cost가 해당 user 소유인지 확인
    const { rows: owned } = await pool.query(
      `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (owned.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const { rows } = await pool.query(
      `INSERT INTO product_cost_channels (user_id, product_cost_id, channel_type, external_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, channel_type, external_id) DO UPDATE
         SET product_cost_id = EXCLUDED.product_cost_id
       RETURNING id, channel_type, external_id, created_at`,
      [user.userId, id, channel_type, external_id],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: channels/[channelId]/route.ts 작성**

```typescript
// src/app/api/cost-management/products/[id]/channels/[channelId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; channelId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { channelId } = await params;
  const pool = getSourcingPool();

  const { rowCount } = await pool.query(
    `DELETE FROM product_cost_channels WHERE id = $1 AND user_id = $2`,
    [channelId, user.userId],
  );

  if (rowCount === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: 테스트 작성**

```typescript
// src/__tests__/api/product-cost-channels-crud.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockAuth = getCurrentUser as ReturnType<typeof vi.fn>;
const mockPool = getSourcingPool as ReturnType<typeof vi.fn>;

describe('POST /api/cost-management/products/[id]/channels', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockAuth.mockResolvedValue({ userId: 'user-1', email: 'test@test.com' });
    mockQuery = vi.fn();
    mockPool.mockReturnValue({ query: mockQuery });
  });

  it('coupang_rg 채널 추가 성공', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'prod-1' }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ id: 'ch-1', channel_type: 'coupang_rg', external_id: 95401822935 }] });

    const { POST } = await import('@/app/api/cost-management/products/[id]/channels/route');
    const req = new NextRequest('http://localhost/api/cost-management/products/prod-1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_type: 'coupang_rg', external_id: 95401822935 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'prod-1' }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.channel_type).toBe('coupang_rg');
  });

  it('잘못된 channel_type → 400', async () => {
    const { POST } = await import('@/app/api/cost-management/products/[id]/channels/route');
    const req = new NextRequest('http://localhost/api/cost-management/products/prod-1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_type: 'invalid', external_id: 12345 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'prod-1' }) });
    expect(res.status).toBe(400);
  });

  it('external_id 0 이하 → 400', async () => {
    const { POST } = await import('@/app/api/cost-management/products/[id]/channels/route');
    const req = new NextRequest('http://localhost/api/cost-management/products/prod-1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_type: 'coupang_rg', external_id: -1 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'prod-1' }) });
    expect(res.status).toBe(400);
  });

  it('없는 product → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ownership check fails
    const { POST } = await import('@/app/api/cost-management/products/[id]/channels/route');
    const req = new NextRequest('http://localhost/api/cost-management/products/missing/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_type: 'coupang_rg', external_id: 12345 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/cost-management/products/[id]/channels/[channelId]', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockAuth.mockResolvedValue({ userId: 'user-1', email: 'test@test.com' });
    mockQuery = vi.fn();
    mockPool.mockReturnValue({ query: mockQuery });
  });

  it('채널 삭제 성공', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const { DELETE } = await import('@/app/api/cost-management/products/[id]/channels/[channelId]/route');
    const req = new NextRequest('http://localhost/api/cost-management/products/prod-1/channels/ch-1');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'prod-1', channelId: 'ch-1' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('없는 채널 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const { DELETE } = await import('@/app/api/cost-management/products/[id]/channels/[channelId]/route');
    const req = new NextRequest('http://localhost/api/cost-management/products/prod-1/channels/missing');
    const res = await DELETE(req, { params: Promise.resolve({ id: 'prod-1', channelId: 'missing' }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 4: 테스트 실행**

```bash
npx vitest run src/__tests__/api/product-cost-channels-crud.test.ts
```

Expected: 5 tests pass

- [ ] **Step 5: 커밋**

```bash
git add "src/app/api/cost-management/products/[id]/channels/route.ts" \
        "src/app/api/cost-management/products/[id]/channels/[channelId]/route.ts" \
        src/__tests__/api/product-cost-channels-crud.test.ts
git commit -m "feat(api): product_cost_channels CRUD — GET/POST/DELETE 채널 엔드포인트"
```

---

## Task 3: GET /products — channels 배열 포함 반환

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`
- Test: `src/__tests__/api/products-channels-response.test.ts`

GET 응답의 각 product 항목에 `channels: { id, channel_type, external_id }[]` 배열 추가.

- [ ] **Step 1: GET /products 쿼리 수정**

`src/app/api/cost-management/products/route.ts` 의 products 조회 쿼리 아래에 channels 조회 추가:

```typescript
// products 조회 이후, allEntries 조회 이전에 삽입
const { rows: channelRows } = await pool.query(
  `SELECT product_cost_id, id, channel_type, external_id
   FROM product_cost_channels
   WHERE user_id = $1
   ORDER BY created_at ASC`,
  [user.userId],
);

const channelsByProduct = new Map<string, { id: string; channel_type: string; external_id: number }[]>();
for (const ch of channelRows) {
  const list = channelsByProduct.get(ch.product_cost_id) ?? [];
  list.push({ id: ch.id, channel_type: ch.channel_type, external_id: Number(ch.external_id) });
  channelsByProduct.set(ch.product_cost_id, list);
}
```

그리고 data.map() 에서 반환하는 객체에 추가:
```typescript
channels: channelsByProduct.get(p.id) ?? [],
```

- [ ] **Step 2: 채널 필터 로직 업데이트**

기존에 `p.vendor_item_id != null` 로 RG 필터하던 부분을 channels 기반으로 변경:

```typescript
// 기존
const filteredProducts = channelFilter === 'rg'
  ? products.filter((p) => p.vendor_item_id != null)
  : channelFilter === 'wing'
    ? products.filter((p) => p.seller_product_id != null)
    : channelFilter === 'naver'
      ? products.filter((p) => p.naver_channel_product_no != null)
      : products;

// 변경 후 (product_cost_channels 기반)
const productIdsWithChannel = (type: string) =>
  new Set(channelRows.filter((ch) => ch.channel_type === type).map((ch) => ch.product_cost_id));

const filteredProducts = channelFilter === 'rg'
  ? products.filter((p) => productIdsWithChannel('coupang_rg').has(p.id))
  : channelFilter === 'wing'
    ? products.filter((p) => productIdsWithChannel('coupang_wing').has(p.id))
    : channelFilter === 'naver'
      ? products.filter((p) => productIdsWithChannel('naver').has(p.id))
      : products;
```

- [ ] **Step 3: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/"
```

Expected: 0 errors

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/cost-management/products/route.ts
git commit -m "feat(api): GET /products — channels 배열 포함 반환, 채널 필터 product_cost_channels 기반"
```

---

## Task 4: PATCH /products/[id] — product_cost_channels로 이전

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/route.ts`
- Test: 기존 `src/__tests__/api/cost-management-hidden.test.ts` 통과 유지

PATCH body에 `channel_type` + `external_id` 조합이 오면 product_cost_channels에 upsert.
기존 `vendor_item_id`, `naver_channel_product_no` 필드도 하위 호환 유지.

- [ ] **Step 1: PATCH 핸들러에 channels upsert 로직 추가**

```typescript
// PATCH /api/cost-management/products/[id]/route.ts 에서
// 기존 body에 channel_type, external_id 필드 추가

const { seller_product_id, vendor_item_id, naver_channel_product_no, variants, hidden, channel_type, external_id } = body ?? {};

// ... 기존 검증 유지 ...

// channel_type + external_id 있으면 product_cost_channels upsert
if (channel_type !== undefined && external_id !== undefined) {
  const VALID = ['coupang_rg', 'coupang_wing', 'naver'];
  if (!VALID.includes(channel_type)) {
    return NextResponse.json({ success: false, error: 'Invalid channel_type' }, { status: 400 });
  }
  if (!Number.isInteger(external_id) || external_id <= 0) {
    return NextResponse.json({ success: false, error: 'external_id must be a positive integer' }, { status: 400 });
  }
  await pool.query(
    `INSERT INTO product_cost_channels (user_id, product_cost_id, channel_type, external_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, channel_type, external_id) DO UPDATE
       SET product_cost_id = EXCLUDED.product_cost_id`,
    [user.userId, id, channel_type, external_id],
  );
}
```

- [ ] **Step 2: 기존 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/cost-management-hidden.test.ts
```

Expected: 4/4 pass

- [ ] **Step 3: 커밋**

```bash
git add "src/app/api/cost-management/products/[id]/route.ts"
git commit -m "feat(api): PATCH /products/[id] — channel_type+external_id upsert 지원"
```

---

## Task 5: Bulk import 업데이트 — product_cost_channels 기반 lookup

**Files:**
- Modify: `src/app/api/cost-management/rg-bulk-import/route.ts`
- Modify: `src/app/api/cost-management/wing-bulk-import/route.ts`
- Modify: `src/app/api/cost-management/naver-bulk-import/route.ts` (있다면)

판매 데이터 import 시 vendor_item_id → product_cost_id 매핑을 product_cost_channels에서 조회하도록.

- [ ] **Step 1: rg-bulk-import vendor_item 맵 수정**

```typescript
// 기존 rg-bulk-import:
const { rows: rgProducts } = await pool.query(
  `SELECT id, vendor_item_id FROM product_costs WHERE user_id = $1 AND vendor_item_id IS NOT NULL`,
  [user.userId],
);
const vendorItemMap = new Map<number, string>();
for (const row of rgProducts) {
  vendorItemMap.set(Number(row.vendor_item_id), row.id);
}

// 변경 후:
const { rows: rgChannels } = await pool.query(
  `SELECT product_cost_id, external_id
   FROM product_cost_channels
   WHERE user_id = $1 AND channel_type = 'coupang_rg'`,
  [user.userId],
);
// Fallback: 기존 product_costs.vendor_item_id (migration 완료 전 대비)
const { rows: rgProductsFallback } = await pool.query(
  `SELECT id, vendor_item_id FROM product_costs WHERE user_id = $1 AND vendor_item_id IS NOT NULL`,
  [user.userId],
);
const vendorItemMap = new Map<number, string>();
for (const row of rgProductsFallback) {
  vendorItemMap.set(Number(row.vendor_item_id), row.id);
}
// product_cost_channels 우선 (덮어씌움)
for (const ch of rgChannels) {
  vendorItemMap.set(Number(ch.external_id), ch.product_cost_id);
}
```

- [ ] **Step 2: wing-bulk-import seller_product_id 맵 수정**

```typescript
// wing-bulk-import에서 product_wing_seller_ids 대신 product_cost_channels 조회 추가
const { rows: wingChannels } = await pool.query(
  `SELECT product_cost_id, external_id AS seller_product_id
   FROM product_cost_channels
   WHERE user_id = $1 AND channel_type = 'coupang_wing'`,
  [user.userId],
);
// 기존 junctionRows fallback 유지하되 wingChannels로 보강
for (const ch of wingChannels) {
  sellerProductMap.set(Number(ch.seller_product_id), ch.product_cost_id);
}
```

- [ ] **Step 3: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/"
```

Expected: 0 errors

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/cost-management/rg-bulk-import/route.ts \
        src/app/api/cost-management/wing-bulk-import/route.ts
git commit -m "feat(api): bulk import — product_cost_channels 기반 vendor_item_id 매핑"
```

---

## Task 6: ProductRow 타입 + ChannelCell UI 업데이트

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx` (ProductRow 인터페이스, channels 필드)
- Modify: `src/components/orders/ChannelCell.tsx`
- Test: TypeScript 컴파일 확인

ProductRow에 `channels: ChannelEntry[]` 추가, ChannelCell에서 multiple RG entries 지원.

- [ ] **Step 1: CostManagementTab.tsx ProductRow에 channels 추가**

```typescript
// CostManagementTab.tsx ProductRow 인터페이스에 추가
interface ChannelEntry {
  id: string;
  channel_type: 'coupang_rg' | 'coupang_wing' | 'naver';
  external_id: number;
}

// ProductRow 인터페이스에 추가
channels: ChannelEntry[];
```

GET /products 응답 파싱 시 `channels` 필드 포함:
```typescript
// load 함수에서 product 매핑 시
channels: (p.channels ?? []) as ChannelEntry[],
```

- [ ] **Step 2: ChannelCell에 ChannelEntry[] prop 추가**

```typescript
// ChannelCell.tsx ProductData에 channels 추가
interface ProductData {
  id: string;
  seller_product_id: number | null;
  vendor_item_id: number | null;  // backward compat
  naver_channel_product_no: number | null;  // backward compat
  channels: ChannelEntry[];  // 새 필드
  variants: Record<string, string> | null;
  naver_variants: Record<string, string> | null;
  naver_origin_product_no: number | null;
}

interface ChannelEntry {
  id: string;
  channel_type: 'coupang_rg' | 'coupang_wing' | 'naver';
  external_id: number;
}
```

RG 섹션에서 channels 배열의 coupang_rg 항목들을 렌더:
```tsx
{/* 쿠팡 RG — channels에서 coupang_rg 항목들 */}
{p.channels.filter((ch) => ch.channel_type === 'coupang_rg').map((ch) => (
  <div key={ch.id} style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '3px' }}>
    <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '1px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: 600 }}>RG</span>
    <span style={{ color: '#0369a1', fontFamily: 'monospace' }}>{ch.external_id}</span>
    <button
      onClick={() => navigator.clipboard.writeText(String(ch.external_id))}
      title="복사"
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', fontSize: '9px', color: '#a1a1aa', lineHeight: 1 }}
    >📋</button>
  </div>
))}
{/* fallback: channels 없을 때 기존 vendor_item_id 표시 */}
{p.channels.filter((ch) => ch.channel_type === 'coupang_rg').length === 0 && p.vendor_item_id && (
  <div style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '3px' }}>
    <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '1px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: 600 }}>RG</span>
    <span style={{ color: '#0369a1', fontFamily: 'monospace' }}>{p.vendor_item_id}</span>
  </div>
)}
```

- [ ] **Step 3: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/"
```

Expected: 0 errors

- [ ] **Step 4: 커밋**

```bash
git add src/components/orders/CostManagementTab.tsx \
        src/components/orders/ChannelCell.tsx
git commit -m "feat(ui): ProductRow channels[] 타입 + ChannelCell 다중 RG 항목 표시"
```

---

## Task 7: ChannelEditPopover — 채널 추가/삭제 UI

**Files:**
- Modify: `src/components/orders/ChannelEditPopover.tsx`
- Modify: `src/components/orders/ChannelCell.tsx` (onRemoveChannel prop 추가)

기존 "3개 필드 수정" → "채널 목록 + 새 채널 추가" 인터페이스로 변경.

- [ ] **Step 1: ChannelEditPopover 재설계**

```tsx
// ChannelEditPopover.tsx
interface ChannelEntry {
  id: string;
  channel_type: 'coupang_rg' | 'coupang_wing' | 'naver';
  external_id: number;
}

interface ChannelEditPopoverProps {
  product: {
    id: string;
    seller_product_id: number | null;
    channels: ChannelEntry[];
  };
  anchorEl: HTMLElement;
  onClose: () => void;
  onChannelAdded: (entry: ChannelEntry) => void;
  onChannelRemoved: (channelId: string) => void;
}

// 렌더링:
// 1. 기존 채널 목록: 각 항목에 채널 타입 배지 + external_id + 삭제 버튼
// 2. 새 채널 추가 폼: channel_type select + external_id input + 추가 버튼
// 3. 하단: 닫기 버튼
```

**채널 타입 라벨 맵:**
```typescript
const CHANNEL_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  coupang_rg: { label: 'RG', color: '#0369a1', bg: '#e0f2fe' },
  coupang_wing: { label: '쿠팡 윙', color: '#be0014', bg: '#fef2f2' },
  naver: { label: '네이버', color: '#03c75a', bg: '#f0fff8' },
};
```

- [ ] **Step 2: 삭제 핸들러**

```typescript
async function handleRemove(channelId: string) {
  const res = await fetch(`/api/cost-management/products/${product.id}/channels/${channelId}`, {
    method: 'DELETE',
  });
  if ((await res.json()).success) {
    onChannelRemoved(channelId);
  }
}
```

- [ ] **Step 3: 추가 핸들러**

```typescript
async function handleAdd() {
  const extId = parseInt(newExternalId, 10);
  if (!newChannelType || !extId || extId <= 0) return;

  const res = await fetch(`/api/cost-management/products/${product.id}/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel_type: newChannelType, external_id: extId }),
  });
  const json = await res.json();
  if (json.success) {
    onChannelAdded(json.data as ChannelEntry);
    setNewExternalId('');
  } else {
    alert(json.error ?? '추가 실패');
  }
}
```

- [ ] **Step 4: TypeScript 확인**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/"
```

- [ ] **Step 5: 커밋**

```bash
git add src/components/orders/ChannelEditPopover.tsx
git commit -m "feat(ui): ChannelEditPopover — 채널 추가/삭제 UI로 재설계"
```

---

## Task 8: CostManagementTab — add/remove channel 핸들러 연결

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

onChannelAdded / onChannelRemoved 핸들러를 state에 연결.

- [ ] **Step 1: handleChannelAdded / handleChannelRemoved 함수 추가**

```typescript
function handleChannelAdded(productId: string, entry: ChannelEntry) {
  setProducts((prev) =>
    prev.map((p) =>
      p.id === productId
        ? { ...p, channels: [...(p.channels ?? []), entry] }
        : p,
    ),
  );
}

function handleChannelRemoved(productId: string, channelId: string) {
  setProducts((prev) =>
    prev.map((p) =>
      p.id === productId
        ? { ...p, channels: (p.channels ?? []).filter((ch) => ch.id !== channelId) }
        : p,
    ),
  );
}
```

- [ ] **Step 2: ChannelEditPopover props 업데이트**

```tsx
{channelEditTarget && (
  <ChannelEditPopover
    product={channelEditTarget.product}
    anchorEl={channelEditTarget.anchorEl}
    onClose={() => setChannelEditTarget(null)}
    onChannelAdded={(entry) => handleChannelAdded(channelEditTarget.product.id, entry)}
    onChannelRemoved={(channelId) => handleChannelRemoved(channelEditTarget.product.id, channelId)}
    onSaved={(updates) => {
      handleProductUpdate(channelEditTarget.product.id, updates as Partial<ProductRow>);
      setChannelEditTarget(null);
    }}
  />
)}
```

- [ ] **Step 3: 최종 TypeScript + 기존 테스트 모두 통과**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/"
npx vitest run src/__tests__/api/cost-management-hidden.test.ts
npx vitest run src/__tests__/api/product-cost-channels-crud.test.ts
```

Expected: 0 TS errors, 모든 테스트 통과

- [ ] **Step 4: 최종 커밋**

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat(ui): CostManagementTab — 채널 추가/삭제 핸들러 연결"
```

---

## Verification

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio

# TypeScript 에러 없음
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/"

# 전체 테스트
npx vitest run src/__tests__/

# 수동 확인:
# 1. 수익·원가 탭 → 상품의 채널 편집 버튼 클릭
# 2. 팝오버에 기존 채널 목록 표시 (RG/Wing/네이버)
# 3. 새 채널 추가: coupang_rg + 95401822934 → 추가됨
# 4. 채널 항목 삭제 버튼 → 목록에서 제거됨
# 5. ChannelCell에 RG 옵션ID 2개 표시
```
