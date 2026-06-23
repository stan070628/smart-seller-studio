# 사이즈별 재고 추적 (Variant Inventory) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 의류 등 사이즈별 상품에서 vendorItemId → 사이즈명 매핑을 캐시하고, 입고·판매 레코드에 variant_name을 저장하여 사이즈별 잔여 재고를 표시한다.

**Architecture:** DB에 nullable 컬럼 추가(하위 호환)로 기존 데이터에 영향 없이 새 필드만 추가. 쿠팡 getProductDetail API 결과를 product_costs.variants(jsonb)에 캐시하여 반복 API 호출 방지. FIFO 원가 계산은 기존 전체 통합 방식 그대로 유지.

**Tech Stack:** Next.js App Router API Routes, PostgreSQL (getSourcingPool), Coupang getCoupangClient, React inline style 패턴

---

## 파일 구조

| 파일 | 역할 |
|------|------|
| `supabase/migrations/073_variant_name.sql` | 신규 — DB 컬럼 추가 |
| `src/app/api/cost-management/products/[id]/fetch-variants/route.ts` | 신규 — Coupang API에서 variants 조회·저장 |
| `src/app/api/cost-management/products/[id]/route.ts` | 수정 — PATCH에 variants 필드 허용 |
| `src/app/api/cost-management/products/[id]/coupang-import/route.ts` | 수정 — variants 캐시 갱신 + variant_name 저장 + 소급 |
| `src/components/orders/CostEntryDrawer.tsx` | 수정 — 입고 행에 사이즈 선택 드롭다운 |
| `src/components/orders/CostManagementTab.tsx` | 수정 — 재고 breakdown + variants 불러오기 버튼 |
| `src/components/orders/SaleEntryPanel.tsx` | 수정 — 판매 행에 variant_name 표시(읽기 전용) |

---

## Task 1: DB 마이그레이션

**Files:**
- Create: `supabase/migrations/073_variant_name.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- cost_entries, sale_records에 variant_name 추가 (nullable, 하위 호환)
ALTER TABLE cost_entries  ADD COLUMN IF NOT EXISTS variant_name text;
ALTER TABLE sale_records  ADD COLUMN IF NOT EXISTS variant_name text;

-- product_costs에 variants 캐시 (vendorItemId → variant_name JSON 맵)
ALTER TABLE product_costs ADD COLUMN IF NOT EXISTS variants jsonb;
-- 예: {"95304537912": "화이트 S", "95304537913": "화이트 M", ...}
```

- [ ] **Step 2: 마이그레이션 적용 (Supabase MCP 또는 CLI)**

```bash
# Supabase MCP apply_migration 사용 시:
# name: "073_variant_name"
# SQL: 위 내용 그대로

# 또는 로컬 CLI:
supabase db push
```

Expected: 오류 없이 완료. cost_entries, sale_records, product_costs 세 테이블에 컬럼 추가됨.

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/073_variant_name.sql
git commit -m "feat: DB 마이그레이션 — variant_name, variants 컬럼 추가"
```

---

## Task 2: fetch-variants API 엔드포인트 신규 생성

**Files:**
- Create: `src/app/api/cost-management/products/[id]/fetch-variants/route.ts`

- [ ] **Step 1: 파일 생성**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  const { rows } = await pool.query(
    `SELECT id, seller_product_id FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (rows.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const sellerProductId = rows[0].seller_product_id;
  if (!sellerProductId) {
    return NextResponse.json({ success: false, error: '윙 판매자상품ID(seller_product_id)가 없습니다.' }, { status: 400 });
  }

  try {
    const client = getCoupangClient();
    const detail = await client.getProductDetail(Number(sellerProductId)) as Record<string, unknown>;
    const items = Array.isArray(detail.items) ? detail.items as Record<string, unknown>[] : [];

    if (items.length === 0) {
      return NextResponse.json({ success: false, error: 'getProductDetail 응답에 items가 없습니다.' }, { status: 422 });
    }

    // vendorItemId → 사이즈명 매핑 구성
    const variants: Record<string, string> = {};
    for (const item of items) {
      const vendorItemId = String(item.vendorItemId ?? '');
      if (!vendorItemId) continue;

      // itemName 또는 attributes 배열에서 사이즈명 추출
      const itemName = String(item.itemName ?? '');
      const attrs = Array.isArray(item.attributes) ? item.attributes as Record<string, unknown>[] : [];
      const sizeAttr = attrs.find((a) => {
        const key = String(a.attributeTypeName ?? '').toLowerCase();
        return key.includes('사이즈') || key.includes('size') || key.includes('색상') || key.includes('color');
      });
      const variantName = sizeAttr ? String(sizeAttr.attributeValueName ?? '') : itemName;
      if (variantName) variants[vendorItemId] = variantName;
    }

    if (Object.keys(variants).length === 0) {
      return NextResponse.json({ success: false, error: '사이즈/옵션 정보를 추출할 수 없습니다.' }, { status: 422 });
    }

    await pool.query(
      `UPDATE product_costs SET variants = $1 WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(variants), id, user.userId],
    );

    return NextResponse.json({ success: true, data: { variants } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/cost-management/products/[id]/fetch-variants/route.ts
git commit -m "feat: fetch-variants API — Coupang getProductDetail에서 사이즈 매핑 조회·저장"
```

---

## Task 3: PATCH API에 variants 필드 허용

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/route.ts`

현재 PATCH는 seller_product_id, vendor_item_id, naver_channel_product_no만 처리함. variants 필드를 직접 업데이트할 수 있도록 추가 (fetch-variants 없이 수동 편집 가능).

- [ ] **Step 1: route.ts 수정**

`src/app/api/cost-management/products/[id]/route.ts`의 PATCH 핸들러에서 body 추출 부분을:

```typescript
const { seller_product_id, vendor_item_id, naver_channel_product_no } = body ?? {};
```

아래로 교체:

```typescript
const { seller_product_id, vendor_item_id, naver_channel_product_no, variants } = body ?? {};
```

그리고 pool.query 부분을:

```typescript
const { rows } = await pool.query(
  `UPDATE product_costs
   SET seller_product_id          = COALESCE($3, seller_product_id),
       vendor_item_id             = COALESCE($4, vendor_item_id),
       naver_channel_product_no   = COALESCE($5, naver_channel_product_no)
   WHERE id = $1 AND user_id = $2
   RETURNING id, seller_product_id, vendor_item_id, naver_channel_product_no`,
  [id, user.userId, seller_product_id ?? null, vendor_item_id ?? null, naver_channel_product_no ?? null],
);
```

아래로 교체:

```typescript
const { rows } = await pool.query(
  `UPDATE product_costs
   SET seller_product_id          = COALESCE($3, seller_product_id),
       vendor_item_id             = COALESCE($4, vendor_item_id),
       naver_channel_product_no   = COALESCE($5, naver_channel_product_no),
       variants                   = COALESCE($6, variants)
   WHERE id = $1 AND user_id = $2
   RETURNING id, seller_product_id, vendor_item_id, naver_channel_product_no, variants`,
  [id, user.userId, seller_product_id ?? null, vendor_item_id ?? null, naver_channel_product_no ?? null, variants ? JSON.stringify(variants) : null],
);
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/cost-management/products/[id]/route.ts
git commit -m "feat: PATCH product API에 variants 필드 업데이트 허용"
```

---

## Task 4: coupang-import에 variants 캐시 + variant_name 저장 + 소급 적용

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/coupang-import/route.ts`

현재 import 로직은 sale_records에 variant_name을 저장하지 않음. 이 태스크에서:
1. product_costs.variants를 로드하고, null이면 getProductDetail로 갱신
2. allItems에 variant_name 필드 추가
3. INSERT 쿼리에 variant_name 포함
4. 기존 variant_name=null 레코드 소급 적용

- [ ] **Step 1: route.ts 수정**

파일 상단에서 `const { id } = await params;` 이후, 현재 DB 조회 부분을:

```typescript
const { rows: products } = await pool.query(
  `SELECT id, seller_product_id, vendor_item_id, product_name, naver_channel_product_no FROM product_costs WHERE id = $1 AND user_id = $2`,
  [id, user.userId],
);
```

아래로 교체 (variants 컬럼 추가):

```typescript
const { rows: products } = await pool.query(
  `SELECT id, seller_product_id, vendor_item_id, product_name, naver_channel_product_no, variants FROM product_costs WHERE id = $1 AND user_id = $2`,
  [id, user.userId],
);
```

- [ ] **Step 2: variants 캐시 로드 로직 추가**

`sellerProductId`, `storedVendorItemId` 등 변수 선언 이후, `try {` 블록 진입 직전에 아래 코드 추가:

```typescript
// variants 캐시 로드 (없으면 getProductDetail로 갱신)
let variantsCache: Record<string, string> = {};
const storedVariants = products[0].variants;
if (storedVariants && Object.keys(storedVariants).length > 0) {
  variantsCache = storedVariants as Record<string, string>;
} else if (sellerProductId) {
  try {
    const client0 = getCoupangClient();
    const detail0 = await client0.getProductDetail(Number(sellerProductId)) as Record<string, unknown>;
    const items0 = Array.isArray(detail0.items) ? detail0.items as Record<string, unknown>[] : [];
    for (const item of items0) {
      const vid = String(item.vendorItemId ?? '');
      if (!vid) continue;
      const attrs = Array.isArray(item.attributes) ? item.attributes as Record<string, unknown>[] : [];
      const sizeAttr = attrs.find((a) => {
        const key = String(a.attributeTypeName ?? '').toLowerCase();
        return key.includes('사이즈') || key.includes('size') || key.includes('색상') || key.includes('color');
      });
      const variantName = sizeAttr ? String(sizeAttr.attributeValueName ?? '') : String(item.itemName ?? '');
      if (variantName) variantsCache[vid] = variantName;
    }
    if (Object.keys(variantsCache).length > 0) {
      await pool.query(
        `UPDATE product_costs SET variants = $1 WHERE id = $2`,
        [JSON.stringify(variantsCache), id],
      );
      console.log(`[import] variants 캐시 갱신: ${Object.keys(variantsCache).length}개`);
    }
  } catch (e) {
    console.warn('[import] variants 캐시 갱신 실패 (스킵):', e instanceof Error ? e.message : e);
  }
}
```

- [ ] **Step 3: allItems 타입에 variant_name 추가 + INSERT 쿼리 수정**

`allItems` 합산 후 DB 저장 부분에서:

```typescript
for (const item of allItems) {
  const result = await pool.query(
    `INSERT INTO sale_records
       (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (coupang_order_item_id) DO NOTHING`,
    [user.userId, id, item.sold_at, item.quantity, item.selling_price, item.channel, item.coupang_order_item_id],
  );
```

아래로 교체:

```typescript
for (const item of allItems) {
  const result = await pool.query(
    `INSERT INTO sale_records
       (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id, variant_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (coupang_order_item_id) DO NOTHING`,
    [user.userId, id, item.sold_at, item.quantity, item.selling_price, item.channel, item.coupang_order_item_id, item.variant_name ?? null],
  );
```

- [ ] **Step 4: generalItems, rgItems, naverItems에 variant_name 필드 추가**

각 items 배열 타입 선언에 `variant_name?: string | null` 추가하고, 값 할당 시 variantsCache에서 조회:

`generalItems` 항목 생성 부분 (`.map((item) => ({`) 에서 `channel: 'coupang'` 뒤에 추가:
```typescript
variant_name: variantsCache[String(item.vendorItemId)] ?? null,
```

`rgItems` `orderItemMap.set(key, {` 블록에서 `channel: 'rocket_growth'` 뒤에 추가:
```typescript
variant_name: variantsCache[String(item.vendorItemId)] ?? null,
```

`naverItems` push 블록에서 `channel: 'naver'` 뒤에 추가 (네이버는 vendorItemId 없으므로 null):
```typescript
variant_name: null,
```

- [ ] **Step 5: 기존 레코드 소급 적용**

`return NextResponse.json({ success: true, ... })` 직전에 추가:

```typescript
// 기존 variant_name=null 레코드 소급 적용
if (Object.keys(variantsCache).length > 0) {
  const { rows: nullRows } = await pool.query(
    `SELECT id, coupang_order_item_id FROM sale_records
     WHERE product_cost_id = $1 AND variant_name IS NULL AND coupang_order_item_id IS NOT NULL`,
    [id],
  );
  let backfilled = 0;
  for (const row of nullRows) {
    const key: string = row.coupang_order_item_id;
    // key 형식: rg-{orderId}-{vendorItemId} 또는 {orderId}-{vendorItemId}
    const parts = key.split('-');
    const vendorItemId = parts[parts.length - 1];
    const variantName = variantsCache[vendorItemId];
    if (variantName) {
      await pool.query(
        `UPDATE sale_records SET variant_name = $1 WHERE id = $2`,
        [variantName, row.id],
      );
      backfilled++;
    }
  }
  if (backfilled > 0) console.log(`[import] 소급 적용: ${backfilled}건`);
}
```

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/cost-management/products/[id]/coupang-import/route.ts
git commit -m "feat: coupang-import에 variants 캐시 갱신 + variant_name 저장 + 소급 적용"
```

---

## Task 5: CostManagementTab — variants 조회 버튼 + 재고 breakdown 표시

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

### 변경 1: ProductRow 타입에 variants 추가

현재 `interface ProductRow` 정의에 아래 필드 추가:

```typescript
variants: Record<string, string> | null;
```

### 변경 2: fetch-variants 호출 함수 추가

`saveEditChannel` 함수 아래에 추가:

```typescript
async function fetchVariants(productId: string) {
  const res = await fetch(`/api/cost-management/products/${productId}/fetch-variants`, {
    method: 'POST',
  });
  const json = await res.json();
  if (json.success) {
    const count = Object.keys(json.data.variants as Record<string, string>).length;
    alert(`사이즈 ${count}개 매핑 저장 완료`);
    load();
  } else {
    alert(json.error ?? 'variants 조회 실패');
  }
}
```

### 변경 3: 채널 편집 UI에 "variants 불러오기" 버튼 추가

채널 편집 저장/취소 버튼 행 (`<div style={{ display: 'flex', gap: '4px' }}>` 안) 에서 취소 버튼 뒤에 추가:

```tsx
{p.seller_product_id && (
  <button
    onClick={() => fetchVariants(p.id)}
    style={{ padding: '2px 8px', fontSize: '10px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '4px', cursor: 'pointer' }}
  >
    variants 불러오기
  </button>
)}
```

### 변경 4: 재고 칸에 variant breakdown 표시

현재 재고 칸:

```tsx
<td style={{ padding: '10px 12px', textAlign: 'right', color: '#18181b' }}>
  {fmt(p.current_stock)}개
</td>
```

아래로 교체:

```tsx
<td style={{ padding: '10px 12px', textAlign: 'right', color: '#18181b' }}>
  <div>{fmt(p.current_stock)}개</div>
  {p.variants && Object.keys(p.variants).length > 0 && (
    <VariantStockBreakdown productId={p.id} variants={p.variants} />
  )}
</td>
```

### 변경 5: VariantStockBreakdown 컴포넌트 추가

파일 최상단(imports 아래, `interface ProductRow` 위)에 추가:

```tsx
function VariantStockBreakdown({
  productId,
  variants,
}: {
  productId: string;
  variants: Record<string, string>;
}) {
  const [breakdown, setBreakdown] = React.useState<Record<string, number> | null>(null);

  React.useEffect(() => {
    fetch(`/api/cost-management/products/${productId}/variant-stock`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setBreakdown(json.data as Record<string, number>);
      })
      .catch(() => null);
  }, [productId]);

  if (!breakdown) return null;

  const variantNames = Object.values(variants);
  const hasData = variantNames.some((name) => (breakdown[name] ?? 0) !== 0);
  if (!hasData) return null;

  return (
    <div style={{ fontSize: '9px', color: '#71717a', marginTop: '3px', textAlign: 'left' }}>
      {variantNames.map((name) => {
        const qty = breakdown[name] ?? 0;
        return (
          <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
            <span>{name}</span>
            <span style={{ color: qty > 0 ? '#16a34a' : qty < 0 ? '#ef4444' : '#a1a1aa' }}>{qty}개</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 1: 위 변경 1~5 적용**

- [ ] **Step 2: 커밋**

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat: CostManagementTab에 variants 조회 버튼 + 재고 breakdown 표시"
```

---

## Task 6: variant-stock API 엔드포인트 신규 생성

**Files:**
- Create: `src/app/api/cost-management/products/[id]/variant-stock/route.ts`

VariantStockBreakdown 컴포넌트가 호출할 API. 사이즈별 (입고 - 판매) 계산 반환.

- [ ] **Step 1: 파일 생성**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  // 소유권 확인
  const { rows: owns } = await pool.query(
    `SELECT 1 FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (owns.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  // 사이즈별 입고 합산
  const { rows: entryRows } = await pool.query(
    `SELECT variant_name, SUM(quantity)::int AS total
     FROM cost_entries
     WHERE product_cost_id = $1 AND variant_name IS NOT NULL
     GROUP BY variant_name`,
    [id],
  );

  // 사이즈별 판매 합산
  const { rows: saleRows } = await pool.query(
    `SELECT variant_name, SUM(quantity)::int AS total
     FROM sale_records
     WHERE product_cost_id = $1 AND variant_name IS NOT NULL
     GROUP BY variant_name`,
    [id],
  );

  const stock: Record<string, number> = {};
  for (const row of entryRows) {
    stock[row.variant_name] = (stock[row.variant_name] ?? 0) + Number(row.total);
  }
  for (const row of saleRows) {
    stock[row.variant_name] = (stock[row.variant_name] ?? 0) - Number(row.total);
  }

  return NextResponse.json({ success: true, data: stock });
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/cost-management/products/[id]/variant-stock/route.ts
git commit -m "feat: variant-stock API — 사이즈별 잔여 재고 계산 반환"
```

---

## Task 7: CostEntryDrawer — 입고 행에 사이즈 선택 드롭다운 추가

**Files:**
- Modify: `src/components/orders/CostEntryDrawer.tsx`

### 변경 개요

- Props에 `variants?: Record<string, string> | null` 추가
- `EntryForm`에 `variant_name?: string` 추가
- 일반 입고 행(addingNew + entryType === 'normal')에 사이즈 선택 `<select>` 추가
- 기존 입고 행 표시에 variant_name 배지 추가
- save() 페이로드에 variant_name 포함
- 입고 행 테이블 헤더에 "사이즈" 컬럼 추가

- [ ] **Step 1: Props 타입 수정**

```typescript
interface Props {
  productId: string;
  productName: string;
  sellerProductId: number | null;
  vendorItemId?: number | null;
  naverChannelProductNo?: number | null;
  subdivisionUnit?: number | null;
  variants?: Record<string, string> | null;  // 추가
  onClose: () => void;
  onChanged: () => void;
}
```

함수 시그니처도 `variants` 추가:

```typescript
export default function CostEntryDrawer({ productId, productName, sellerProductId, vendorItemId, naverChannelProductNo, subdivisionUnit, variants, onClose, onChanged }: Props) {
```

- [ ] **Step 2: EntryForm 타입 수정**

```typescript
interface EntryForm {
  received_at: string;
  quantity: string;
  unit_cost: string;
  unit_shipping_fee: string;
  variant_name: string;  // 추가
}
```

`emptyForm()` 함수도 업데이트:

```typescript
function emptyForm(): EntryForm {
  return { received_at: new Date().toISOString().slice(0, 10), quantity: '', unit_cost: '', unit_shipping_fee: '0', variant_name: '' };
}
```

- [ ] **Step 3: save() 페이로드에 variant_name 포함**

`save()` 함수의 `basePayload` 선언 부분에서:

```typescript
const basePayload = { received_at: form.received_at, quantity: qty, unit_cost: cost, unit_shipping_fee: Math.round(Number(form.unit_shipping_fee)) };
```

아래로 교체:

```typescript
const basePayload = {
  received_at: form.received_at,
  quantity: qty,
  unit_cost: cost,
  unit_shipping_fee: Math.round(Number(form.unit_shipping_fee)),
  ...(form.variant_name ? { variant_name: form.variant_name } : {}),
};
```

- [ ] **Step 4: 테이블 헤더에 "사이즈" 추가**

```tsx
{['입고일', '수량', '단가', '배송비', 'RG배송비', ...(variants ? ['사이즈'] : []), ''].map((h) => (
  <th key={h} style={{ padding: '6px 8px', textAlign: h === '입고일' ? 'left' : 'right', fontWeight: 600, color: '#27272a' }}>{h}</th>
))}
```

- [ ] **Step 5: 기존 입고 행에 variant_name 배지 추가**

일반 표시 행 (`<tr key={e.id}`) 내 배송비 `<td>` 뒤에 추가 (variants가 있는 경우만):

```tsx
{variants && (
  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
    {e.variant_name
      ? <span style={{ background: '#f0fdf4', color: '#16a34a', padding: '1px 5px', borderRadius: '4px', fontSize: '9px' }}>{e.variant_name}</span>
      : <span style={{ color: '#e5e5e5', fontSize: '9px' }}>—</span>}
  </td>
)}
```

Entry 인터페이스에도 `variant_name?: string | null` 추가:

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
  purchase_quantity: number | null;
  subdivision_unit: number | null;
  variant_name?: string | null;  // 추가
}
```

- [ ] **Step 6: 신규 입고 행에 사이즈 선택 드롭다운 추가**

`addingNew && !editingId && entryType === 'normal'`인 입고 입력 행 (`<tr style={{ background: '#f0fdf4' }}>`) 에서 unit_shipping_fee 입력 `<td>` 뒤에 추가:

```tsx
{variants && Object.keys(variants).length > 0 && (
  <td style={{ padding: '4px 6px' }}>
    <select
      value={form.variant_name}
      onChange={(ev) => setForm((f) => ({ ...f, variant_name: ev.target.value }))}
      style={{ width: '100%', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b', boxSizing: 'border-box' }}
    >
      <option value="">미분류</option>
      {Object.values(variants).map((name) => (
        <option key={name} value={name}>{name}</option>
      ))}
    </select>
  </td>
)}
```

- [ ] **Step 7: 커밋**

```bash
git add src/components/orders/CostEntryDrawer.tsx
git commit -m "feat: CostEntryDrawer에 사이즈 선택 드롭다운 추가"
```

---

## Task 8: CostManagementTab에서 CostEntryDrawer에 variants 전달

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

CostEntryDrawer를 렌더링하는 부분에 `variants={drawerProduct.variants}` prop 추가.

- [ ] **Step 1: drawerProduct 찾기 로직 추가**

현재 CostEntryDrawer 렌더링 부분을 찾는다. `drawerProductId`로 products 배열에서 찾아 `drawerProduct`를 구성:

기존 drawer 렌더링 부분 (파일 하단 `{drawerProductId && (` 부분)에서:

```tsx
{drawerProductId && (
  <CostEntryDrawer
    productId={drawerProductId}
    productName={products.find((p) => p.id === drawerProductId)?.product_name ?? ''}
    sellerProductId={products.find((p) => p.id === drawerProductId)?.seller_product_id ?? null}
    vendorItemId={products.find((p) => p.id === drawerProductId)?.vendor_item_id}
    naverChannelProductNo={products.find((p) => p.id === drawerProductId)?.naver_channel_product_no}
    subdivisionUnit={products.find((p) => p.id === drawerProductId)?.subdivision_unit}
    onClose={() => setDrawerProductId(null)}
    onChanged={load}
  />
)}
```

이 패턴(정확한 코드는 파일에서 확인 후)에서 `variants` prop 추가:

```tsx
variants={products.find((p) => p.id === drawerProductId)?.variants ?? null}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat: CostEntryDrawer에 variants prop 전달"
```

---

## Task 9: SaleEntryPanel — 판매 행에 variant_name 표시 (읽기 전용)

**Files:**
- Modify: `src/components/orders/SaleEntryPanel.tsx`

- [ ] **Step 1: SaleRecord 인터페이스에 variant_name 추가**

```typescript
interface SaleRecord {
  id: string;
  sold_at: string;
  quantity: number;
  selling_price: number;
  channel: string;
  coupang_order_item_id: string | null;
  variant_name?: string | null;  // 추가
}
```

- [ ] **Step 2: 테이블 헤더에 "사이즈" 추가**

현재:
```tsx
{['판매일', '수량', '판매가', '채널', ''].map((h) => (
```

교체:
```tsx
{['판매일', '수량', '판매가', '채널', '사이즈', ''].map((h) => (
```

- [ ] **Step 3: 판매 행에 variant_name 배지 추가**

일반 표시 행에서 채널 `<td>` 뒤에 추가:

```tsx
<td style={{ padding: '6px 8px', textAlign: 'right' }}>
  {s.variant_name
    ? <span style={{ background: '#f0fdf4', color: '#16a34a', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>{s.variant_name}</span>
    : <span style={{ color: '#e5e5e5', fontSize: '10px' }}>—</span>}
</td>
```

- [ ] **Step 4: 커밋**

```bash
git add src/components/orders/SaleEntryPanel.tsx
git commit -m "feat: SaleEntryPanel에 variant_name 사이즈 표시"
```

---

## Task 10: entries API — variant_name 필드 저장 허용

**Files:**
- Read: `src/app/api/cost-management/products/[id]/entries/route.ts`

현재 entries POST API가 variant_name을 받아 저장하는지 확인 후, 없으면 추가.

- [ ] **Step 1: entries POST API 확인 및 수정**

파일을 읽어 INSERT 쿼리 확인. variant_name이 없으면:

```typescript
// body에서 variant_name 추출 추가
const { received_at, quantity, unit_cost, unit_shipping_fee, channel, variant_name, ... } = body ?? {};
```

INSERT 쿼리에 variant_name 컬럼·값 추가:

```sql
INSERT INTO cost_entries
  (user_id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, channel, variant_name)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING ...
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/cost-management/products/[id]/entries/route.ts
git commit -m "feat: entries API에 variant_name 저장 허용"
```

---

## Task 11: 검증

- [ ] **Step 1: 커클랜드 반팔 티셔츠에 variants 불러오기 실행**

CostManagementTab → 해당 상품 연필 아이콘 → "variants 불러오기" 클릭
Expected: "사이즈 4개 매핑 저장 완료" alert

- [ ] **Step 2: variants 확인**

DB에서:
```sql
SELECT variants FROM product_costs WHERE product_name LIKE '%커클랜드%';
```
Expected: `{"95304537912": "화이트 S", "95304537913": "화이트 M", ...}` 형태

- [ ] **Step 3: 판매 가져오기 재실행**

해당 상품 드로어 → 판매 가져오기 → 날짜 범위 실행
Expected: sale_records.variant_name이 채워짐

- [ ] **Step 4: 재고 breakdown 확인**

상품 목록에서 해당 상품의 재고 칸에 사이즈별 breakdown 표시 확인:
```
45개
화이트 S   8개
화이트 M  12개
...
```

- [ ] **Step 5: 입고 등록 시 사이즈 선택 확인**

드로어 → 입고 내역 → 새 입고 건 추가 → 사이즈 드롭다운 표시 확인
Expected: 화이트 S / 화이트 M / 화이트 L / 화이트 XL / 미분류 옵션

- [ ] **Step 6: variants 없는 기존 상품 정상 동작 확인**

variants 없는 다른 상품에서:
- 재고 칸: 전체 합산만 표시 (breakdown 없음)
- 입고 등록: 사이즈 드롭다운 없음
- 판매 행: 사이즈 칸 — 표시
