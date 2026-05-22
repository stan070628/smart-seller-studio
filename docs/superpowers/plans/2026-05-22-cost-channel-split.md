# 원가 채널 분리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `cost_entries`에 채널 컬럼을 추가하고, RG / 윙 입고·판매를 완전히 분리하여 채널별 재고·손익을 독립 계산한다. Revenue-history API로 윙 판매 자동 가져오기를 추가하고, RG 실재고 API 연동으로 원가재고 검증을 가능하게 한다.

**Architecture:** DB에 `cost_entries.channel TEXT('rg'|'wing')` 컬럼을 추가하고, products API에 `channel` 쿼리 파라미터를 넣어 채널별 FIFO 계산을 분리한다. 윙 판매는 `revenue-history` API(coupang-client에 이미 구현)로 자동 임포트하고, RG 실재고는 `rg/inventory/summaries` API로 조회한다.

**Tech Stack:** Next.js App Router, PostgreSQL (pg pool), Vitest, Supabase CLI, `coupang-client.ts` (getRevenueHistory / getRocketGrowthInventories 기존 구현)

---

## 파일 맵

| 파일 | 변경 유형 | 역할 |
|------|---------|------|
| `supabase/migrations/068_cost_entries_channel.sql` | 신규 | channel 컬럼 추가 + 기존 데이터 자동 분류 |
| `src/lib/cost-management/fifo.ts` | 수정 | SaleRow에 channel? 추가 |
| `src/lib/cost-management/calculations.ts` | 수정 | CostEntryRow에 channel? 추가 |
| `src/app/api/cost-management/products/route.ts` | 수정 | channel 파라미터 처리 + 채널별 FIFO 분리 |
| `src/app/api/cost-management/products/[id]/entries/route.ts` | 수정 | channel 필드 INSERT 수용 |
| `src/app/api/cost-management/rg-inventory/route.ts` | 신규 | RG 창고 실재고 조회 |
| `src/app/api/cost-management/wing-bulk-import/route.ts` | 신규 | revenue-history 기반 윙 판매 자동 가져오기 |
| `src/components/orders/CostManagementTab.tsx` | 수정 | 채널 필터 UI + RG 실재고 컬럼 + 윙 가져오기 버튼 |
| `src/components/orders/CostEntryDrawer.tsx` | 수정 | 채널 선택 라디오 (윙+RG 동시 연결 상품용) |

---

### Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/068_cost_entries_channel.sql`

- [ ] **Step 1: 마이그레이션 파일 생성**

```sql
-- 068_cost_entries_channel.sql
ALTER TABLE cost_entries
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'wing';

-- 기존 데이터 자동 분류: RG 배송비가 있으면 RG 입고, 없으면 윙 입고
UPDATE cost_entries SET channel = 'rg'   WHERE unit_rg_shipping_fee > 0;
UPDATE cost_entries SET channel = 'wing' WHERE unit_rg_shipping_fee = 0;
```

- [ ] **Step 2: 마이그레이션 적용**

```bash
npx supabase db push
```

Expected: `Applying migration 068_cost_entries_channel.sql`

- [ ] **Step 3: 결과 확인**

```bash
npx supabase db execute --stdin <<'SQL'
SELECT channel, COUNT(*) FROM cost_entries GROUP BY channel;
SQL
```

Expected: `rg`와 `wing` 두 row (기존 데이터가 있으면)

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/068_cost_entries_channel.sql
git commit -m "feat(db): cost_entries에 channel 컬럼 추가 (rg/wing)"
```

---

### Task 2: 타입 확장 — SaleRow, CostEntryRow에 channel? 추가

**Files:**
- Modify: `src/lib/cost-management/fifo.ts`
- Modify: `src/lib/cost-management/calculations.ts`

채널 필터링은 route.ts에서 수행한다. 타입에만 optional channel을 추가해 컴파일 오류를 막는다.

- [ ] **Step 1: fifo.ts — SaleRow에 channel? 추가**

`src/lib/cost-management/fifo.ts`의 `SaleRow` 인터페이스를 수정한다:

```typescript
/** 판매 행 */
export interface SaleRow {
  id: string;
  /** 판매일 (ISO 8601 YYYY-MM-DD 문자열, Date 객체 불가) */
  sold_at: string;
  /** 판매 수량 */
  quantity: number;
  /** 판매 단가 (원) */
  selling_price: number;
  /** 판매 채널 — 채널별 FIFO 분리 시 필터링에 사용 */
  channel?: string;
}
```

- [ ] **Step 2: calculations.ts — CostEntryRow에 channel? 추가**

`src/lib/cost-management/calculations.ts`에서 `CostEntryRow` 인터페이스를 찾아 `channel?: string` 을 추가한다. (인터페이스 정의 위치에 맞게 삽입)

```typescript
export interface CostEntryRow {
  id: string;
  product_cost_id: string;
  received_at: string;
  quantity: number;
  unit_cost: number;
  unit_shipping_fee: number;
  unit_rg_shipping_fee: number;
  shipping_group_id: string | null;
  channel?: string;  // 'rg' | 'wing'
}
```

- [ ] **Step 3: 빌드 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add src/lib/cost-management/fifo.ts src/lib/cost-management/calculations.ts
git commit -m "feat(types): SaleRow, CostEntryRow에 channel 필드 추가"
```

---

### Task 3: products API — 채널 필터 + 채널별 FIFO 분리

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`

- [ ] **Step 1: entries/sales 쿼리에 channel 추가**

`products/route.ts`의 `allEntries` 쿼리를 수정한다 (라인 40):

```typescript
const { rows: allEntries } = await pool.query(
  `SELECT id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, shipping_group_id, channel
   FROM cost_entries WHERE user_id = $1`,
  [user.userId],
);
```

`allSales` 쿼리를 수정한다 (라인 46):

```typescript
const { rows: allSales } = await pool.query(
  `SELECT id, product_cost_id, sold_at, quantity, selling_price, channel FROM sale_records WHERE user_id = $1`,
  [user.userId],
);
```

- [ ] **Step 2: channel 파라미터 파싱 추가**

`searchParams`에서 `from`, `to`를 읽는 부분 바로 아래(라인 27)에 추가:

```typescript
const channelFilter = (searchParams.get('channel') ?? 'all') as 'all' | 'rg' | 'wing';
```

- [ ] **Step 3: 상품 목록 채널 필터링 추가**

`products` 쿼리 결과 바로 아래에 필터링 로직 추가:

```typescript
const filteredProducts = channelFilter === 'rg'
  ? products.filter((p) => p.vendor_item_id != null)
  : channelFilter === 'wing'
    ? products.filter((p) => p.seller_product_id != null)
    : products;
```

이후 `products.map(...)` 호출을 모두 `filteredProducts.map(...)` 으로 변경.

- [ ] **Step 4: entriesByProduct 구성 시 channel 포함**

기존 `list.push({...})` 부분에 `channel` 추가 (라인 76 부근):

```typescript
list.push({
  id: e.id,
  product_cost_id: e.product_cost_id,
  received_at: e.received_at instanceof Date ? e.received_at.toISOString().slice(0, 10) : String(e.received_at).slice(0, 10),
  quantity: Number(e.quantity),
  unit_cost: Number(e.unit_cost),
  unit_shipping_fee: Number(e.unit_shipping_fee),
  unit_rg_shipping_fee: Number(e.unit_rg_shipping_fee ?? 0),
  shipping_group_id: e.shipping_group_id,
  channel: e.channel ?? 'wing',
});
```

- [ ] **Step 5: salesByProduct 구성 시 channel 포함**

기존 `list.push({...})` 부분에 `channel` 추가 (라인 94 부근):

```typescript
list.push({
  id: s.id,
  sold_at: s.sold_at instanceof Date ? s.sold_at.toISOString().slice(0, 10) : String(s.sold_at).slice(0, 10),
  quantity: Number(s.quantity),
  selling_price: Number(s.selling_price),
  channel: s.channel ?? 'manual',
});
```

- [ ] **Step 6: filteredProducts.map 내부 — 채널별 FIFO 분리**

기존 `const pEntries = entriesByProduct.get(p.id) ?? [];` 바로 아래에 채널 필터 추가:

```typescript
const pEntries = entriesByProduct.get(p.id) ?? [];
const pSales = salesByProduct.get(p.id) ?? [];

// 채널별 분리: RG 판매 ↔ RG 입고, 윙 판매 ↔ 윙 입고
const batchesToUse = channelFilter === 'rg'
  ? pEntries.filter((e) => e.channel === 'rg')
  : channelFilter === 'wing'
    ? pEntries.filter((e) => e.channel === 'wing')
    : pEntries;

const salesToUse = channelFilter === 'rg'
  ? pSales.filter((s) => s.channel === 'rocket_growth')
  : channelFilter === 'wing'
    ? pSales.filter((s) => s.channel !== 'rocket_growth')
    : pSales;
```

이후 FIFO batches 구성 시 `pEntries` → `batchesToUse`, FIFO 호출 시 `pSales` → `salesToUse`로 변경:

```typescript
const batches: PurchaseBatch[] = batchesToUse.map((e) => ({
  id: e.id,
  received_at: e.received_at,
  quantity: e.quantity,
  unit_cost: e.unit_cost,
  unit_shipping_fee: e.unit_shipping_fee,
  unit_rg_shipping_fee: e.unit_rg_shipping_fee ?? 0,
}));
fifoResult = calculateFifo(batches, salesToUse, feeRate);
```

기간 필터된 판매 집계도 `salesToUse` 기반으로 변경:

```typescript
const pFilteredSales = salesToUse.filter((s) => filteredSaleIds.has(s.id));
```

기간 필터된 입고 집계도 `batchesToUse` 기반으로 변경:

```typescript
const pFilteredEntries = batchesToUse.filter((e) => filteredEntryIds.has(e.id));
```

- [ ] **Step 7: 빌드 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

- [ ] **Step 8: 수동 동작 확인**

```bash
# 로컬 dev 서버 실행 후
curl "http://localhost:3000/api/cost-management/products?channel=rg" -H "Cookie: ..." | jq '.data | length'
curl "http://localhost:3000/api/cost-management/products?channel=wing" -H "Cookie: ..." | jq '.data | length'
```

Expected: 각각 RG 상품 수, 윙 상품 수만 반환됨

- [ ] **Step 9: 커밋**

```bash
git add src/app/api/cost-management/products/route.ts
git commit -m "feat(api): products API에 channel 필터 + 채널별 FIFO 분리"
```

---

### Task 4: entries API — channel 필드 수용

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/entries/route.ts`

- [ ] **Step 1: body에서 channel 추출**

기존 body 파싱 부분(라인 50 부근)에서 `channel` 추출 추가:

```typescript
const { received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, shipping_group_id, channel } = body ?? {};
```

- [ ] **Step 2: INSERT 쿼리에 channel 추가**

```typescript
const { rows } = await pool.query(
  `INSERT INTO cost_entries
     (user_id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, channel)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
   RETURNING *`,
  [
    user.userId,
    id,
    received_at,
    quantity,
    unit_cost,
    unit_shipping_fee ?? 0,
    unit_rg_shipping_fee ?? 0,
    channel ?? 'wing',
  ],
);
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/products/\[id\]/entries/route.ts
git commit -m "feat(api): entries POST에 channel 필드 추가"
```

---

### Task 5: rg-inventory API 신규

**Files:**
- Create: `src/app/api/cost-management/rg-inventory/route.ts`

- [ ] **Step 1: 파일 생성**

```typescript
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCoupangClient } from '@/lib/listing/coupang-client';

// GET /api/cost-management/rg-inventory
// 사용자의 RG 상품에 대해 쿠팡 창고 실재고(totalOrderableQuantity)를 반환한다.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const pool = getSourcingPool();
  const { rows: rgProducts } = await pool.query(
    `SELECT id, vendor_item_id FROM product_costs
     WHERE user_id = $1 AND vendor_item_id IS NOT NULL`,
    [user.userId],
  );

  if (rgProducts.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  const targetIds = new Set(rgProducts.map((r) => Number(r.vendor_item_id)));

  try {
    const client = getCoupangClient();
    const stockMap = new Map<number, number>(); // vendorItemId → actualStock

    let nextToken: string | undefined;
    do {
      const result = await client.getRocketGrowthInventories(nextToken ? { nextToken } : undefined);
      for (const item of result.items) {
        if (targetIds.has(item.vendorItemId)) {
          stockMap.set(item.vendorItemId, item.totalOrderableQuantity);
        }
      }
      nextToken = result.nextToken ?? undefined;
    } while (nextToken);

    const data = rgProducts.map((p) => ({
      productCostId: p.id,
      vendorItemId: Number(p.vendor_item_id),
      actualStock: stockMap.get(Number(p.vendor_item_id)) ?? null,
    }));

    return NextResponse.json({ success: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: 수동 확인**

```bash
curl "http://localhost:3000/api/cost-management/rg-inventory" -H "Cookie: ..." | jq '.data'
```

Expected: `[{ productCostId: "...", vendorItemId: 123, actualStock: 30 }, ...]`

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/rg-inventory/route.ts
git commit -m "feat(api): RG 창고 실재고 조회 endpoint 추가"
```

---

### Task 6: wing-bulk-import API 신규

**Files:**
- Create: `src/app/api/cost-management/wing-bulk-import/route.ts`

`revenue-history` API의 `items[].sellerProductId` 를 `product_costs.seller_product_id` 에 직접 매핑한다. `coupang-client.getRevenueHistory()`는 이미 구현되어 있다.

- [ ] **Step 1: splitInto31DayChunks 헬퍼 작성 + 파일 생성**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCoupangClient } from '@/lib/listing/coupang-client';

// revenue-history는 최대 31일 조회 — 31일 단위로 분할
function splitInto31DayChunks(from: string, to: string): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  const toDate = new Date(to);
  let cursor = new Date(from);
  while (cursor <= toDate) {
    const end = new Date(cursor);
    end.setDate(end.getDate() + 30); // 31일 포함 (0~30 = 31일)
    if (end > toDate) end.setTime(toDate.getTime());
    chunks.push({
      from: cursor.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    });
    cursor = new Date(end);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

// POST /api/cost-management/wing-bulk-import
// Body: { from?: string, to?: string }  (YYYY-MM-DD, 기본값: 최근 90일)
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const KST = 9 * 60 * 60 * 1000;
  const today = new Date(Date.now() + KST).toISOString().slice(0, 10);
  // revenue-history는 당일 조회 불가 — recognitionDateTo는 어제까지
  const yesterday = new Date(Date.now() + KST - 86400000).toISOString().slice(0, 10);

  const body = await request.json().catch(() => null);
  const from = body?.from ?? new Date(Date.now() + KST - 90 * 86400000).toISOString().slice(0, 10);
  const rawTo = body?.to ?? today;
  const to = rawTo >= today ? yesterday : rawTo; // 오늘 이후면 어제로 clamp

  const pool = getSourcingPool();

  // sellerProductId → product_cost_id 맵 구성
  const { rows: wingProducts } = await pool.query(
    `SELECT id, seller_product_id FROM product_costs
     WHERE user_id = $1 AND seller_product_id IS NOT NULL`,
    [user.userId],
  );
  if (wingProducts.length === 0) {
    return NextResponse.json({ success: true, data: { imported: 0, skipped: 0, total: 0 } });
  }

  const sellerProductMap = new Map<number, string>(); // sellerProductId → product_cost_id
  for (const row of wingProducts) {
    sellerProductMap.set(Number(row.seller_product_id), row.id);
  }

  try {
    const client = getCoupangClient();
    const records: Array<{
      product_cost_id: string;
      sold_at: string;
      quantity: number;
      selling_price: number;
      coupang_order_item_id: string;
    }> = [];

    for (const chunk of splitInto31DayChunks(from, to)) {
      let token: string | undefined;
      do {
        const result = await client.getRevenueHistory({
          recognitionDateFrom: chunk.from,
          recognitionDateTo: chunk.to,
          maxPerPage: 50,
          token: token ?? '',
        });
        for (const order of result.items) {
          if (order.saleType !== 'SALE') continue; // 반품(REFUND) 제외
          for (const item of order.items) {
            const productCostId = sellerProductMap.get(item.sellerProductId);
            if (!productCostId) continue;
            if (item.quantity <= 0) continue;
            records.push({
              product_cost_id: productCostId,
              sold_at: order.saleDate.slice(0, 10),
              quantity: item.quantity,
              selling_price: item.salePrice,
              coupang_order_item_id: `wing-${order.orderId}-${item.vendorItemId}`,
            });
          }
        }
        token = result.nextToken ?? undefined;
      } while (token);
    }

    let imported = 0;
    let skipped = 0;
    for (const rec of records) {
      const result = await pool.query(
        `INSERT INTO sale_records
           (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id)
         VALUES ($1, $2, $3, $4, $5, 'coupang', $6)
         ON CONFLICT (coupang_order_item_id) DO NOTHING`,
        [user.userId, rec.product_cost_id, rec.sold_at, rec.quantity, rec.selling_price, rec.coupang_order_item_id],
      );
      if ((result.rowCount ?? 0) > 0) imported++;
      else skipped++;
    }

    return NextResponse.json({ success: true, data: { imported, skipped, total: records.length } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: 수동 확인**

```bash
curl -X POST "http://localhost:3000/api/cost-management/wing-bulk-import" \
  -H "Cookie: ..." \
  -H "Content-Type: application/json" \
  -d '{"from":"2026-05-01","to":"2026-05-21"}' | jq
```

Expected: `{ "success": true, "data": { "imported": N, "skipped": M, "total": N+M } }`

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/wing-bulk-import/route.ts
git commit -m "feat(api): revenue-history 기반 윙 판매 자동 가져오기 endpoint 추가"
```

---

### Task 7: CostManagementTab — 채널 필터 UI

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

- [ ] **Step 1: channelFilter state 추가**

컴포넌트 상단 state 선언부에 추가 (다른 `useState` 들과 함께):

```typescript
const [channelFilter, setChannelFilter] = useState<'all' | 'rg' | 'wing'>('all');
```

- [ ] **Step 2: products 조회 fetch URL에 channel 파라미터 전달**

기존 products fetch 호출에서 URL에 `&channel=${channelFilter}` 추가. 예시 (기존 fetch 패턴 유지):

```typescript
const url = new URL('/api/cost-management/products', window.location.origin);
if (from) url.searchParams.set('from', from);
if (to) url.searchParams.set('to', to);
if (channelFilter !== 'all') url.searchParams.set('channel', channelFilter);
```

`channelFilter`가 변경될 때도 재조회하도록 useEffect 의존성 배열에 `channelFilter` 추가.

- [ ] **Step 3: 채널 필터 버튼 UI 삽입**

기간 필터 UI 바로 아래에 채널 필터 버튼 그룹 추가:

```tsx
{/* 채널 필터 */}
<div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
  {(['all', 'wing', 'rg'] as const).map((ch) => (
    <button
      key={ch}
      onClick={() => setChannelFilter(ch)}
      style={{
        padding: '4px 12px',
        borderRadius: 6,
        border: '1px solid',
        fontSize: 13,
        cursor: 'pointer',
        borderColor: channelFilter === ch ? '#be0014' : '#d1d5db',
        background: channelFilter === ch ? '#fef2f2' : '#fff',
        color: channelFilter === ch ? '#be0014' : '#374151',
        fontWeight: channelFilter === ch ? 600 : 400,
      }}
    >
      {ch === 'all' ? '전체' : ch === 'wing' ? '윙판매' : 'RG'}
    </button>
  ))}
</div>
```

- [ ] **Step 4: 확인 + 커밋**

브라우저에서 채널 필터 버튼 클릭 시 상품 목록이 필터링되는지 확인.

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat(ui): 원가 탭 채널 필터 버튼 추가 (전체/윙/RG)"
```

---

### Task 8: CostEntryDrawer — 채널 선택 UI

**Files:**
- Modify: `src/components/orders/CostEntryDrawer.tsx`

윙과 RG 둘 다 연결된 상품(seller_product_id AND vendor_item_id 모두 있음)에서만 채널 선택을 보여준다.

- [ ] **Step 1: channel state 추가**

드로어의 입고 등록 form state에 추가:

```typescript
const [entryChannel, setEntryChannel] = useState<'rg' | 'wing'>('wing');
```

상품 props에서 `seller_product_id`와 `vendor_item_id`가 모두 있을 때만 선택 UI 표시. 하나만 있으면 해당 채널로 고정:

```typescript
// 드로어 오픈 시 기본값 결정
useEffect(() => {
  if (product?.vendor_item_id && !product?.seller_product_id) setEntryChannel('rg');
  else setEntryChannel('wing');
}, [product]);
```

- [ ] **Step 2: 채널 선택 라디오 UI 추가**

입고 등록 폼에서 `unit_rg_shipping_fee` 입력 필드 위에 추가 (윙+RG 동시 연결된 상품에만 표시):

```tsx
{product?.seller_product_id && product?.vendor_item_id && (
  <div style={{ marginBottom: 12 }}>
    <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
      입고 채널
    </label>
    <div style={{ display: 'flex', gap: 16 }}>
      {(['wing', 'rg'] as const).map((ch) => (
        <label key={ch} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="radio"
            name="entryChannel"
            value={ch}
            checked={entryChannel === ch}
            onChange={() => setEntryChannel(ch)}
          />
          <span style={{ fontSize: 13 }}>{ch === 'wing' ? '윙 보관 입고' : 'RG 창고 입고'}</span>
        </label>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 3: 입고 등록 API 호출 시 channel 전달**

기존 POST 호출 body에 `channel: entryChannel` 추가:

```typescript
const res = await fetch(`/api/cost-management/products/${product.id}/entries`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    received_at,
    quantity,
    unit_cost,
    unit_shipping_fee,
    unit_rg_shipping_fee,
    channel: entryChannel,
  }),
});
```

- [ ] **Step 4: 확인 + 커밋**

윙+RG 동시 연결 상품에서 입고 등록 시 채널 선택 라디오가 표시되는지 확인. 등록 후 DB에서 channel 값 확인.

```bash
git add src/components/orders/CostEntryDrawer.tsx
git commit -m "feat(ui): 입고 등록 시 채널 선택 UI 추가 (윙+RG 동시 연결 상품)"
```

---

### Task 9: RG 실재고 컬럼 + 윙 가져오기 버튼

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

- [ ] **Step 1: RG 실재고 state + fetch 추가**

```typescript
const [rgInventory, setRgInventory] = useState<Map<string, number | null>>(new Map());
const [rgInventoryLoading, setRgInventoryLoading] = useState(false);
```

`channelFilter === 'rg'`일 때 실재고 API 병렬 호출:

```typescript
useEffect(() => {
  if (channelFilter !== 'rg') { setRgInventory(new Map()); return; }
  setRgInventoryLoading(true);
  fetch('/api/cost-management/rg-inventory')
    .then((r) => r.json())
    .then((json) => {
      if (json.success) {
        const map = new Map<string, number | null>();
        for (const item of json.data) map.set(item.productCostId, item.actualStock);
        setRgInventory(map);
      }
    })
    .finally(() => setRgInventoryLoading(false));
}, [channelFilter]);
```

- [ ] **Step 2: RG 탭에서 테이블 헤더에 "RG 실재고" 컬럼 추가**

`channelFilter === 'rg'`일 때만 컬럼 표시. 기존 "재고" 헤더 `<th>` 다음에:

```tsx
{channelFilter === 'rg' && (
  <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
    RG 실재고
  </th>
)}
```

각 row에서도 "재고" `<td>` 다음에:

```tsx
{channelFilter === 'rg' && (
  <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 13 }}>
    {rgInventoryLoading ? '…' : (() => {
      const actual = rgInventory.get(p.id);
      if (actual === undefined) return '—';
      const diff = actual - p.current_stock;
      return (
        <span>
          {actual.toLocaleString()}개
          {diff !== 0 && (
            <span style={{ marginLeft: 4, color: '#f59e0b' }} title={`원가재고 ${p.current_stock}개 / 실재고 ${actual}개`}>
              ⚠️
            </span>
          )}
        </span>
      );
    })()}
  </td>
)}
```

- [ ] **Step 3: 윙 판매 가져오기 버튼 추가**

기존 RG "일괄 가져오기" 버튼 찾기 (`rg-bulk-import` fetch 호출 부분, 라인 220 부근). 그 버튼과 동일한 스타일로 옆에 추가:

```tsx
{(channelFilter === 'wing' || channelFilter === 'all') && (
  <button
    onClick={async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/cost-management/wing-bulk-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to }),
        });
        const json = await res.json();
        if (json.success) {
          alert(`윙 판매 가져오기 완료: ${json.data.imported}건 추가, ${json.data.skipped}건 중복 스킵`);
          await fetchProducts();
        } else {
          alert(`오류: ${json.error}`);
        }
      } finally {
        setLoading(false);
      }
    }}
    disabled={loading}
    style={{
      padding: '6px 12px',
      borderRadius: 6,
      border: '1px solid #be0014',
      background: '#fef2f2',
      color: '#be0014',
      fontSize: 13,
      cursor: 'pointer',
    }}
  >
    윙 판매 가져오기
  </button>
)}
```

- [ ] **Step 4: 빌드 확인 + 수동 검증**

```bash
npx tsc --noEmit
```

브라우저에서:
1. 채널 필터 → 'RG' 선택 → RG 상품 목록 + "RG 실재고" 컬럼 표시 확인
2. 원가재고 ≠ 실재고인 상품에 ⚠️ 표시 확인
3. '윙판매' 또는 '전체' 선택 → "윙 판매 가져오기" 버튼 표시 확인
4. 버튼 클릭 → 판매 가져오기 완료 toast 확인

- [ ] **Step 5: 커밋**

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat(ui): RG 실재고 비교 컬럼, 윙 판매 가져오기 버튼 추가"
```

---

## 완료 체크리스트

- [ ] `cost_entries.channel` 컬럼이 DB에 존재하고 기존 데이터가 분류되었다
- [ ] `GET /api/cost-management/products?channel=rg` 가 RG 상품만 반환하고 RG 입고 기반 재고를 계산한다
- [ ] `GET /api/cost-management/products?channel=wing` 이 윙 상품만 반환하고 윙 입고 기반 재고를 계산한다
- [ ] `GET /api/cost-management/products` (channel 없음)이 기존과 동일하게 동작한다
- [ ] `POST /api/cost-management/products/{id}/entries` body에 `channel` 전달 시 DB에 저장된다
- [ ] `GET /api/cost-management/rg-inventory` 가 RG 실재고를 반환한다
- [ ] `POST /api/cost-management/wing-bulk-import` 가 revenue-history 기반으로 sale_records를 생성한다
- [ ] 채널 필터 버튼이 상품 목록을 필터링한다
- [ ] RG 탭에서 실재고 컬럼이 표시되고 괴리 시 ⚠️ 아이콘이 나타난다
- [ ] 윙+RG 동시 연결 상품의 입고 등록 시 채널 선택 라디오가 표시된다
- [ ] "윙 판매 가져오기" 버튼이 윙/전체 탭에서 표시되고 동작한다
