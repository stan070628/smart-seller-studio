# Channel Unit Multiplier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `product_cost_channels`에 `unit_multiplier` 컬럼을 추가해, 2개입·3개입 세트 옵션 판매 시 재고가 개수 단위로 정확히 차감되도록 한다.

**Architecture:** DB 마이그레이션으로 `unit_multiplier` 컬럼을 추가하고, 채널 API(GET/POST)에서 이를 처리한다. ChannelEditPopover UI에 `×` 배수 입력 필드를 추가하고, rg-bulk-import·wing-bulk-import에서 `quantity × multiplier`를 적용한다.

**Tech Stack:** PostgreSQL (Render), Next.js API Routes, React (inline styles)

---

## 파일 구조

| 파일 | 변경 내용 |
|------|---------|
| `supabase/migrations/081_channel_unit_multiplier.sql` | 신규: unit_multiplier 컬럼 추가 |
| `src/app/api/cost-management/products/[id]/channels/route.ts` | GET/POST에 unit_multiplier 처리 |
| `src/components/orders/ChannelEditPopover.tsx` | × 입력 필드 + ×N 배지 |
| `src/components/orders/CostManagementTab.tsx` | ChannelEntry 타입에 unit_multiplier 추가 |
| `src/components/orders/ChannelCell.tsx` | ChannelEntry 타입에 unit_multiplier 추가 |
| `src/app/api/cost-management/rg-bulk-import/route.ts` | vendorItemMap 구조 변경, quantity × multiplier |
| `src/app/api/cost-management/wing-bulk-import/route.ts` | 동일 패턴 적용 |

---

## Task 1: DB 마이그레이션 작성 및 적용

**Files:**
- Create: `supabase/migrations/081_channel_unit_multiplier.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- supabase/migrations/081_channel_unit_multiplier.sql
ALTER TABLE product_cost_channels
  ADD COLUMN unit_multiplier INTEGER NOT NULL DEFAULT 1
  CHECK (unit_multiplier >= 1);

COMMENT ON COLUMN product_cost_channels.unit_multiplier IS
  '판매 1건당 소비되는 단품 개수. 1개입=1(기본), 2개입=2, 3개입=3.';
```

- [ ] **Step 2: Render PostgreSQL에 적용**

```bash
SOURCING_DATABASE_URL=$(grep SOURCING_DATABASE_URL /Users/seungminlee/Desktop/projects/smart_seller_studio/.env.local | cut -d= -f2-)
psql "$SOURCING_DATABASE_URL" -f supabase/migrations/081_channel_unit_multiplier.sql
```

Expected output:
```
ALTER TABLE
COMMENT
```

- [ ] **Step 3: 적용 확인**

```bash
psql "$SOURCING_DATABASE_URL" -c "\d product_cost_channels" | grep unit_multiplier
```

Expected: `unit_multiplier | integer | not null | 1`

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/081_channel_unit_multiplier.sql
git commit -m "feat(db): product_cost_channels에 unit_multiplier 컬럼 추가"
```

---

## Task 2: 채널 API GET/POST 수정

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/channels/route.ts`

- [ ] **Step 1: GET — unit_multiplier 포함하도록 SELECT 수정**

`route.ts` 19-27줄의 GET 핸들러에서 SELECT 수정:

```typescript
  const { rows } = await pool.query(
    `SELECT id, channel_type, external_id, unit_multiplier, created_at
     FROM product_cost_channels
     WHERE product_cost_id = $1 AND user_id = $2
     ORDER BY created_at ASC`,
    [id, user.userId],
  );
```

- [ ] **Step 2: POST — unit_multiplier 수신·검증·저장**

`route.ts` 30-80줄의 POST 핸들러 전체를 아래로 교체:

```typescript
// POST: 새 채널 항목 추가
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { channel_type, external_id, unit_multiplier = 1 } = body ?? {};

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
  if (!Number.isInteger(unit_multiplier) || unit_multiplier < 1) {
    return NextResponse.json(
      { success: false, error: 'unit_multiplier must be a positive integer >= 1' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  try {
    const { rows: owned } = await pool.query(
      `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (owned.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const { rows } = await pool.query(
      `INSERT INTO product_cost_channels (user_id, product_cost_id, channel_type, external_id, unit_multiplier)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, channel_type, external_id) DO UPDATE
         SET product_cost_id = EXCLUDED.product_cost_id,
             unit_multiplier = EXCLUDED.unit_multiplier
       RETURNING id, channel_type, external_id, unit_multiplier, created_at`,
      [user.userId, id, channel_type, external_id, unit_multiplier],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/products/[id]/channels/route.ts
git commit -m "feat(api): channels GET/POST에 unit_multiplier 처리 추가"
```

---

## Task 3: ChannelEntry 타입 + ChannelEditPopover UI

**Files:**
- Modify: `src/components/orders/ChannelEditPopover.tsx`
- Modify: `src/components/orders/CostManagementTab.tsx`
- Modify: `src/components/orders/ChannelCell.tsx`

- [ ] **Step 1: ChannelEditPopover — ChannelEntry 타입에 unit_multiplier 추가**

`ChannelEditPopover.tsx` 5-9줄의 `ChannelEntry` 인터페이스 수정:

```typescript
interface ChannelEntry {
  id: string;
  channel_type: 'coupang_rg' | 'coupang_wing' | 'naver';
  external_id: number;
  unit_multiplier: number;
}
```

- [ ] **Step 2: ChannelEditPopover — newUnitMultiplier state 추가**

기존 state 선언부(40-45줄 근처)에 추가:

```typescript
  const [newUnitMultiplier, setNewUnitMultiplier] = useState('1');
```

- [ ] **Step 3: ChannelEditPopover — handleAdd에 unit_multiplier 포함**

`handleAdd` 함수(79줄~)에서 파싱 및 전송 수정:

```typescript
  async function handleAdd() {
    const extId = parseInt(newExternalId.replace(/[^0-9]/g, ''), 10);
    const multiplier = parseInt(newUnitMultiplier, 10);
    if (!newChannelType || isNaN(extId) || extId <= 0) {
      setAddError('유효한 ID를 입력하세요.');
      return;
    }
    if (isNaN(multiplier) || multiplier < 1) {
      setAddError('판매 단위는 1 이상 정수여야 합니다.');
      return;
    }
    setAddError(null);
    setAdding(true);
    try {
      const res = await fetch(`/api/cost-management/products/${product.id}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_type: newChannelType, external_id: extId, unit_multiplier: multiplier }),
      });
      const json = await res.json();
      if (json.success) {
        const entry = json.data as ChannelEntry;
        setChannels((prev) => [...prev, entry]);
        onChannelAdded(entry);
        setNewExternalId('');
        setNewUnitMultiplier('1');
      } else {
        setAddError(json.error ?? '추가 실패');
      }
    } catch {
      setAddError('네트워크 오류');
    } finally {
      setAdding(false);
    }
  }
```

- [ ] **Step 4: ChannelEditPopover — 채널 추가 폼에 × 입력 필드 추가**

기존 채널 추가 폼의 input 행(193-212줄 근처)을 아래로 교체:

```tsx
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <select
            value={newChannelType}
            onChange={(e) => { setNewChannelType(e.target.value); setAddError(null); }}
            style={{
              padding: '4px 6px', fontSize: 11, border: '1px solid #d4d4d8',
              borderRadius: 5, color: '#18181b', background: '#fff', outline: 'none', flexShrink: 0,
            }}
          >
            <option value="coupang_rg">RG</option>
            <option value="coupang_wing">쿠팡 윙</option>
            <option value="naver">네이버</option>
          </select>
          <input
            style={inputStyle}
            placeholder={CHANNEL_LABELS[newChannelType]?.placeholder ?? 'ID 입력'}
            value={newExternalId}
            onChange={(e) => { setNewExternalId(e.target.value); setAddError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: '#52525b' }}>×</span>
            <input
              type="number"
              min={1}
              value={newUnitMultiplier}
              onChange={(e) => { setNewUnitMultiplier(e.target.value); setAddError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              style={{ width: 36, padding: '4px 4px', fontSize: 11, border: '1px solid #d4d4d8', borderRadius: 5, color: '#18181b', outline: 'none', textAlign: 'center' }}
            />
          </div>
        </div>
```

- [ ] **Step 5: ChannelEditPopover — 채널 목록에 ×N 배지 추가**

채널 목록 렌더(156-188줄 근처)에서 external_id 표시 span 옆에 배지 추가:

```tsx
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#18181b', flex: 1 }}>{ch.external_id}</span>
            {ch.unit_multiplier > 1 && (
              <span style={{ fontSize: 9, color: '#0369a1', background: '#e0f2fe', padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>
                ×{ch.unit_multiplier}
              </span>
            )}
```

- [ ] **Step 6: CostManagementTab — ChannelEntry 타입 수정**

`CostManagementTab.tsx` 15-20줄의 `ChannelEntry` 인터페이스에 `unit_multiplier` 추가:

```typescript
interface ChannelEntry {
  id: string;
  channel_type: 'coupang_rg' | 'coupang_wing' | 'naver';
  external_id: number;
  unit_multiplier: number;
}
```

- [ ] **Step 7: ChannelCell — ChannelEntry 타입 수정**

`ChannelCell.tsx` 5-10줄의 `ChannelEntry` 인터페이스에 `unit_multiplier` 추가:

```typescript
interface ChannelEntry {
  id: string;
  channel_type: 'coupang_rg' | 'coupang_wing' | 'naver';
  external_id: number;
  unit_multiplier: number;
}
```

- [ ] **Step 8: 타입 에러 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep -v ".next/"
```

Expected: 에러 없음 (또는 기존 .next 관련 에러만)

- [ ] **Step 9: 커밋**

```bash
git add src/components/orders/ChannelEditPopover.tsx \
        src/components/orders/CostManagementTab.tsx \
        src/components/orders/ChannelCell.tsx
git commit -m "feat(ui): ChannelEditPopover에 unit_multiplier × 입력 필드 및 ×N 배지 추가"
```

---

## Task 4: rg-bulk-import — unit_multiplier 적용

**Files:**
- Modify: `src/app/api/cost-management/rg-bulk-import/route.ts`

- [ ] **Step 1: rgChannels 쿼리에 unit_multiplier 추가**

35-40줄의 rgChannels 쿼리 수정:

```typescript
  const { rows: rgChannels } = await pool.query(
    `SELECT product_cost_id, external_id, unit_multiplier
     FROM product_cost_channels
     WHERE user_id = $1 AND channel_type = 'coupang_rg'`,
    [user.userId],
  );
```

- [ ] **Step 2: vendorItemMap 구조 변경**

48-56줄의 vendorItemMap 선언 및 구성 로직 수정:

```typescript
  const vendorItemMap = new Map<number, { id: string; multiplier: number }>();
  // fallback 먼저 (낮은 우선순위, unit_multiplier=1 고정)
  for (const row of rgProducts) {
    vendorItemMap.set(Number(row.vendor_item_id), { id: row.id, multiplier: 1 });
  }
  // product_cost_channels 우선 (덮어씌움, unit_multiplier 적용)
  for (const ch of rgChannels) {
    vendorItemMap.set(Number(ch.external_id), { id: ch.product_cost_id, multiplier: ch.unit_multiplier ?? 1 });
  }
```

- [ ] **Step 3: 판매 quantity에 multiplier 적용**

86-103줄의 order item 처리 로직 수정:

```typescript
          for (const item of order.orderItems) {
            const match = vendorItemMap.get(item.vendorItemId);
            if (!match) continue;
            if (item.salesQuantity <= 0) continue;
            const key = `rg-${order.orderId}-${item.vendorItemId}`;
            const existing = orderItemMap.get(key);
            const quantity = item.salesQuantity * match.multiplier;
            if (existing) {
              existing.quantity += quantity;
            } else {
              orderItemMap.set(key, {
                product_cost_id: match.id,
                sold_at: soldAt,
                quantity,
                selling_price: item.unitSalesPrice,
                coupang_order_item_id: key,
              });
            }
          }
```

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/cost-management/rg-bulk-import/route.ts
git commit -m "feat(import): rg-bulk-import에 unit_multiplier 적용 — 세트 판매 재고 정확 차감"
```

---

## Task 5: wing-bulk-import — unit_multiplier 적용

**Files:**
- Modify: `src/app/api/cost-management/wing-bulk-import/route.ts`

현재 wing-bulk-import는 `wingChannels`, `vendorItemMap`, `sellerProductMap` 세 가지 맵을 사용한다.
`wingChannels`(coupang_wing) 및 vendorItemMap(product_costs.vendor_item_id)에 unit_multiplier를 적용한다.

- [ ] **Step 1: wingChannels 쿼리에 unit_multiplier 추가**

현재 wingChannels 쿼리 수정:

```typescript
  const { rows: wingChannels } = await pool.query(
    `SELECT product_cost_id, external_id, unit_multiplier
     FROM product_cost_channels
     WHERE user_id = $1 AND channel_type = 'coupang_wing'`,
    [user.userId],
  );
```

- [ ] **Step 2: vendorItemMap을 `{ id, multiplier }` 구조로 변경**

현재 `vendorItemMap = new Map<number, string>()` 구조를 교체:

```typescript
  const vendorItemMap = new Map<number, { id: string; multiplier: number }>();
  for (const row of productRows) {
    if (row.vendor_item_id) vendorItemMap.set(Number(row.vendor_item_id), { id: row.id, multiplier: 1 });
  }
  for (const ch of wingChannels) {
    vendorItemMap.set(Number(ch.external_id), { id: ch.product_cost_id, multiplier: ch.unit_multiplier ?? 1 });
  }
```

- [ ] **Step 3: sellerProductMap은 기존 `Map<number, string>` 유지 (unit_multiplier=1 고정)**

sellerProductMap은 레거시 fallback이므로 multiplier 적용 없이 유지:

```typescript
  const sellerProductMap = new Map<number, string>();
  for (const row of productRows) {
    if (row.seller_product_id > 0) sellerProductMap.set(Number(row.seller_product_id), row.id);
  }
  for (const row of junctionRows) {
    sellerProductMap.set(Number(row.seller_product_id), row.id);
  }
```

- [ ] **Step 4: 판매 quantity에 multiplier 적용**

order item 처리 루프(104줄 근처)에서 매칭 로직 수정:

```typescript
          for (const item of order.items) {
            if (order.saleType !== 'SALE') continue;  // 이미 바깥에서 필터되지만 안전하게
            const match = vendorItemMap.get(item.vendorItemId);
            const productCostId = match?.id ?? sellerProductMap.get(item.sellerProductId);
            const multiplier = match?.multiplier ?? 1;
            if (!productCostId) continue;
            if (item.quantity <= 0) continue;
            const soldAt = order.saleDate?.slice(0, 10);
            if (!soldAt) continue;
            records.push({
              product_cost_id: productCostId,
              sold_at: soldAt,
              quantity: item.quantity * multiplier,
              selling_price: item.salePrice,
              coupang_order_item_id: `wing-${order.orderId}-${item.vendorItemId}`,
            });
          }
```

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/cost-management/wing-bulk-import/route.ts
git commit -m "feat(import): wing-bulk-import에 unit_multiplier 적용 — 세트 판매 재고 정확 차감"
```

---

## Verification

1. **UI 확인**: 원가 관리 탭 → 상품 추가 → 등록상품ID 16262230452 선택 → 추가  
   → ChannelEditPopover 열기 → RG 채널 추가 시 `×` 입력 필드 표시 확인  
   → 1개입 옵션ID 추가 (×1), 2개입 옵션ID 추가 (×2), 3개입 옵션ID 추가 (×3)  
   → 채널 목록에 ×2, ×3 배지 표시 확인

2. **임포트 확인**: 원가 관리 탭 → "RG 임포트" 실행  
   → 2개입 옵션 1건 판매 → `sale_records.quantity = 2` 확인  
   ```bash
   psql "$SOURCING_DATABASE_URL" -c "
     SELECT sr.quantity, pcc.external_id, pcc.unit_multiplier
     FROM sale_records sr
     JOIN product_costs pc ON pc.id = sr.product_cost_id
     JOIN product_cost_channels pcc ON pcc.product_cost_id = pc.id
     WHERE pc.seller_product_id = 16262230452
     LIMIT 10;"
   ```
