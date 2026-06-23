# 판매 내역 택배비 필드 추가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `sale_records` 테이블에 `shipping_fee` 컬럼을 추가하고, 채널이 쿠팡/네이버인 판매 내역에 택배비 3,500원을 기본값으로 설정하며 수정 가능하게 한다.

**Architecture:** DB 마이그레이션으로 컬럼을 추가하고 기존 레코드를 일괄 업데이트한 뒤, GET/POST/PATCH/coupang-import API에 `shipping_fee`를 반영하고, `SaleEntryPanel.tsx` UI에 택배비 컬럼을 추가한다.

**Tech Stack:** PostgreSQL, Next.js App Router API Routes, React (inline style)

---

## 파일 변경 목록

| 파일 | 변경 유형 |
|------|-----------|
| `src/app/api/cost-management/products/[id]/sales/route.ts` | Modify — GET SELECT·POST INSERT에 `shipping_fee` 추가 |
| `src/app/api/cost-management/sales/[id]/route.ts` | Modify — PATCH UPDATE에 `shipping_fee` 추가 |
| `src/app/api/cost-management/products/[id]/coupang-import/route.ts` | Modify — INSERT에 `shipping_fee` 채널별 값 추가 |
| `src/components/orders/SaleEntryPanel.tsx` | Modify — 타입·폼·테이블에 택배비 컬럼 추가 |

---

### Task 1: DB 마이그레이션 — `shipping_fee` 컬럼 추가 및 기존 레코드 업데이트

**Files:**
- 없음 (DB에 직접 SQL 실행)

- [ ] **Step 1: 마이그레이션 SQL 실행**

아래 SQL을 DB 클라이언트(psql, Supabase SQL Editor 등)에서 실행한다.

```sql
-- 컬럼 추가 (이미 존재하면 에러 — 한 번만 실행)
ALTER TABLE sale_records
  ADD COLUMN shipping_fee INTEGER NOT NULL DEFAULT 0;

-- 기존 쿠팡·네이버 레코드 3,500원으로 일괄 업데이트
UPDATE sale_records
  SET shipping_fee = 3500
  WHERE channel IN ('coupang', 'naver');
```

- [ ] **Step 2: 결과 확인**

```sql
SELECT channel, shipping_fee, COUNT(*)
FROM sale_records
GROUP BY channel, shipping_fee
ORDER BY channel;
```

기대 결과:
- `coupang` → `shipping_fee = 3500`
- `naver` → `shipping_fee = 3500`
- `rocket_growth`, `manual` → `shipping_fee = 0`

---

### Task 2: GET API — `shipping_fee` 포함 반환

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/sales/route.ts`

- [ ] **Step 1: GET 쿼리에 `shipping_fee` 추가**

`route.ts` 25~31번 줄의 SELECT 쿼리를 수정한다.

```ts
const { rows } = await pool.query(
  `SELECT id, sold_at, quantity, selling_price, channel, coupang_order_item_id, shipping_fee, created_at
   FROM sale_records
   WHERE product_cost_id = $1
   ORDER BY sold_at DESC, created_at DESC`,
  [id],
);
```

- [ ] **Step 2: 수동 검증**

브라우저 개발자 도구 또는 curl로 응답 확인:

```bash
curl -s http://localhost:3000/api/cost-management/products/<product_id>/sales \
  -H "Cookie: <세션 쿠키>" | jq '.[0].shipping_fee'
```

기대: 쿠팡/네이버 레코드는 `3500`, 로켓그로스/수동은 `0` 반환

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/products/\[id\]/sales/route.ts
git commit -m "feat(api): GET sales에 shipping_fee 컬럼 추가"
```

---

### Task 3: POST API — `shipping_fee` 수신 및 저장

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/sales/route.ts`

- [ ] **Step 1: POST 핸들러에서 `shipping_fee` 추출 및 유효성 검증 추가**

`route.ts` POST 핸들러의 body 파싱 부분을 수정한다 (현재 51번 줄):

```ts
const { sold_at, quantity, selling_price, shipping_fee: rawShipping } = body ?? {};
const shipping_fee = rawShipping != null ? Math.round(Number(rawShipping)) : 0;
```

유효성 검증 블록 하단(현재 63번 줄 이후)에 추가:

```ts
if (!Number.isInteger(shipping_fee) || shipping_fee < 0) {
  return NextResponse.json(
    { success: false, error: 'shipping_fee must be non-negative integer' },
    { status: 400 },
  );
}
```

- [ ] **Step 2: INSERT 쿼리에 `shipping_fee` 추가**

현재 83~88번 줄의 INSERT 쿼리를 수정한다:

```ts
const { rows } = await pool.query(
  `INSERT INTO sale_records (user_id, product_cost_id, sold_at, quantity, selling_price, channel, shipping_fee)
   VALUES ($1, $2, $3, $4, $5, 'manual', $6)
   RETURNING *`,
  [user.userId, id, sold_at, quantity, selling_price, shipping_fee],
);
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/products/\[id\]/sales/route.ts
git commit -m "feat(api): POST sales에 shipping_fee 저장"
```

---

### Task 4: PATCH API — `shipping_fee` 부분 업데이트

**Files:**
- Modify: `src/app/api/cost-management/sales/[id]/route.ts`

- [ ] **Step 1: body에서 `shipping_fee` 추출**

현재 16번 줄을 수정한다:

```ts
const { sold_at, quantity, selling_price, shipping_fee } = body ?? {};
```

- [ ] **Step 2: `shipping_fee` 유효성 검증 추가**

`selling_price` 검증 블록(현재 31~35번 줄) 아래에 추가:

```ts
if (shipping_fee !== undefined && (!Number.isInteger(shipping_fee) || shipping_fee < 0)) {
  return NextResponse.json(
    { success: false, error: 'shipping_fee must be non-negative integer' },
    { status: 400 },
  );
}
```

- [ ] **Step 3: "최소 한 필드" 검증에 `shipping_fee` 포함**

현재 38~41번 줄을 수정한다:

```ts
if (sold_at === undefined && quantity === undefined && selling_price === undefined && shipping_fee === undefined) {
  return NextResponse.json(
    { success: false, error: 'at least one field required' },
    { status: 400 },
  );
}
```

- [ ] **Step 4: UPDATE 쿼리에 `shipping_fee` 추가**

현재 49~56번 줄의 UPDATE 쿼리를 수정한다:

```ts
const { rows } = await pool.query(
  `UPDATE sale_records
   SET sold_at        = COALESCE($1, sold_at),
       quantity       = COALESCE($2, quantity),
       selling_price  = COALESCE($3, selling_price),
       shipping_fee   = COALESCE($4, shipping_fee)
   WHERE id = $5 AND user_id = $6
   RETURNING *`,
  [sold_at ?? null, quantity ?? null, selling_price ?? null, shipping_fee ?? null, id, user.userId],
);
```

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/cost-management/sales/\[id\]/route.ts
git commit -m "feat(api): PATCH sales에 shipping_fee 부분 업데이트"
```

---

### Task 5: coupang-import — 채널별 `shipping_fee` 자동 설정

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/coupang-import/route.ts`

- [ ] **Step 1: 합산 후 DB 저장 INSERT 쿼리 수정**

현재 268~278번 줄의 INSERT 쿼리를 수정한다. 각 `item`에 `shipping_fee`를 포함시킨다:

먼저 `allItems` 배열을 만드는 각 phase의 타입 정의에 `shipping_fee` 필드를 추가한다.

`generalItems` 배열 타입 (99번 줄):
```ts
const generalItems: Array<{
  sold_at: string; quantity: number; selling_price: number;
  coupang_order_item_id: string; channel: string; variant_name: string | null;
  shipping_fee: number;
}> = [];
```

`generalItems.push` 부분 (119번 줄 `.map` 내부):
```ts
.map((item) => ({
  sold_at: order.paidAt?.slice(0, 10) ?? order.orderedAt.slice(0, 10),
  quantity: item.shippingCount,
  selling_price: item.shippingCount > 0
    ? Math.round(item.orderPrice / item.shippingCount)
    : item.salesPrice,
  coupang_order_item_id: `${order.orderId}-${item.vendorItemId}`,
  channel: 'coupang',
  variant_name: variantsCache[String(item.vendorItemId)] ?? null,
  shipping_fee: 3500,
})),
```

`rgItems` 배열 타입 (163번 줄):
```ts
const rgItems: Array<{
  sold_at: string;
  quantity: number;
  selling_price: number;
  coupang_order_item_id: string;
  channel: string;
  variant_name: string | null;
  shipping_fee: number;
}> = [];
```

`orderItemMap.set` 부분 (206번 줄):
```ts
orderItemMap.set(key, {
  sold_at: paidDate,
  quantity: item.salesQuantity,
  selling_price: item.unitSalesPrice,
  coupang_order_item_id: key,
  channel: 'rocket_growth',
  variant_name: variantsCache[String(item.vendorItemId)] ?? null,
  shipping_fee: 0,
});
```

`naverItems` 배열 타입 (229번 줄):
```ts
const naverItems: Array<{
  sold_at: string; quantity: number; selling_price: number;
  coupang_order_item_id: string; channel: string; variant_name: string | null;
  shipping_fee: number;
}> = [];
```

`naverItems.push` 부분 (246번 줄):
```ts
naverItems.push({
  sold_at: soldAt,
  quantity: order.quantity,
  selling_price: order.quantity > 0
    ? Math.round(order.totalPaymentAmount / order.quantity)
    : order.totalPaymentAmount,
  coupang_order_item_id: `naver-${order.productOrderId}`,
  channel: 'naver',
  variant_name: null,
  shipping_fee: 3500,
});
```

- [ ] **Step 2: INSERT 쿼리에 `shipping_fee` 컬럼 추가**

현재 269~274번 줄:

```ts
const result = await pool.query(
  `INSERT INTO sale_records
     (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id, variant_name, shipping_fee)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
   ON CONFLICT (coupang_order_item_id) DO NOTHING`,
  [user.userId, id, item.sold_at, item.quantity, item.selling_price, item.channel, item.coupang_order_item_id, item.variant_name ?? null, item.shipping_fee],
);
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cost-management/products/\[id\]/coupang-import/route.ts
git commit -m "feat(api): coupang-import 시 채널별 shipping_fee 자동 설정"
```

---

### Task 6: SaleEntryPanel UI — 택배비 컬럼 추가

**Files:**
- Modify: `src/components/orders/SaleEntryPanel.tsx`

- [ ] **Step 1: 인터페이스에 `shipping_fee` 추가**

파일 상단 `SaleRecord` 인터페이스 (6번 줄):

```ts
interface SaleRecord {
  id: string;
  sold_at: string;
  quantity: number;
  selling_price: number;
  channel: string;
  coupang_order_item_id: string | null;
  variant_name?: string | null;
  shipping_fee: number;
}
```

`SaleForm` 인터페이스 (16번 줄):

```ts
interface SaleForm {
  sold_at: string;
  quantity: string;
  selling_price: string;
  shipping_fee: string;
}
```

`emptyForm()` 함수 (22번 줄):

```ts
function emptyForm(): SaleForm {
  return {
    sold_at: new Date().toISOString().slice(0, 10),
    quantity: '',
    selling_price: '',
    shipping_fee: '0',
  };
}
```

- [ ] **Step 2: 테이블 헤더에 '택배비' 컬럼 추가**

178번 줄의 헤더 배열을 수정한다:

```ts
{['판매일', '수량', '판매가', '채널', '사이즈', '택배비', ''].map((h, i) => (
  <th key={`${h}-${i}`} style={{ padding: '6px 8px', textAlign: h === '판매일' ? 'left' : 'right', fontWeight: 600, color: '#27272a' }}>{h}</th>
))}
```

- [ ] **Step 3: 인라인 편집 행에 택배비 input 추가**

인라인 편집 행(190번 줄 `editingId === s.id` 분기)에서 `colSpan={3}`인 마지막 `<td>` 직전에 택배비 `<td>`를 추가한다.

현재:
```tsx
<td colSpan={3} style={{ padding: '4px 6px' }}>
```

수정 후 (콜스팬을 2로 줄이고 택배비 td 삽입):

```tsx
<td style={{ padding: '4px 6px' }}>
  <input
    type="number"
    value={form.shipping_fee}
    onChange={(e) => setForm((f) => ({ ...f, shipping_fee: e.target.value }))}
    style={{ width: '70px', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }}
  />
</td>
<td colSpan={2} style={{ padding: '4px 6px' }}>
```

- [ ] **Step 4: `save()` 함수에서 `shipping_fee` 포함**

현재 72번 줄 `save()` 함수를 수정한다:

```ts
async function save() {
  const qty = Math.round(Number(form.quantity));
  const price = Math.round(Number(form.selling_price));
  const shippingFee = Math.max(0, Math.round(Number(form.shipping_fee)));
  if (!form.sold_at || qty <= 0) { alert('판매일과 수량을 입력해 주세요.'); return; }
  setSaving(true);
  try {
    const payload = { sold_at: form.sold_at, quantity: qty, selling_price: price, shipping_fee: shippingFee };
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
```

- [ ] **Step 5: `startEdit()` 함수에 `shipping_fee` 포함**

현재 111번 줄:

```ts
function startEdit(s: SaleRecord) {
  setEditingId(s.id);
  setAddingNew(false);
  setForm({
    sold_at: s.sold_at.slice(0, 10),
    quantity: String(s.quantity),
    selling_price: String(s.selling_price),
    shipping_fee: String(s.shipping_fee),
  });
}
```

- [ ] **Step 6: 표시 행에 택배비 컬럼 추가**

일반 표시 행(218번 줄)에서 사이즈 `<td>` 다음에 택배비 `<td>`를 추가한다:

현재 사이즈 td 이후:
```tsx
<td style={{ padding: '6px 8px', textAlign: 'right' }}>
  {s.variant_name
    ? <span style={{ ... }}>{s.variant_name}</span>
    : <span style={{ color: '#e5e5e5', fontSize: '10px' }}>—</span>}
</td>
<td style={{ padding: '6px 8px', textAlign: 'right' }}>
  <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
    ...버튼들
```

수정 후 (택배비 td 삽입):
```tsx
<td style={{ padding: '6px 8px', textAlign: 'right' }}>
  {s.variant_name
    ? <span style={{ background: '#f0fdf4', color: '#16a34a', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>{s.variant_name}</span>
    : <span style={{ color: '#e5e5e5', fontSize: '10px' }}>—</span>}
</td>
<td style={{ padding: '6px 8px', textAlign: 'right', color: s.shipping_fee > 0 ? '#27272a' : '#e5e5e5', fontSize: '11px' }}>
  {s.shipping_fee > 0 ? fmt(s.shipping_fee) : '—'}
</td>
<td style={{ padding: '6px 8px', textAlign: 'right' }}>
  <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
    ...버튼들
```

- [ ] **Step 7: 새 판매 추가 행(`addingNew`)에 택배비 input 추가**

246번 줄 새 추가 행에도 같은 방식으로 택배비 td 삽입 (편집 행과 동일):

```tsx
<td style={{ padding: '4px 6px' }}>
  <input
    type="number"
    value={form.shipping_fee}
    onChange={(e) => setForm((f) => ({ ...f, shipping_fee: e.target.value }))}
    style={{ width: '70px', padding: '3px 5px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '11px', color: '#18181b' }}
  />
</td>
<td colSpan={2} style={{ padding: '4px 6px' }}>
  <div style={{ display: 'flex', gap: '4px' }}>
    ...저장/취소 버튼
```

- [ ] **Step 8: 커밋**

```bash
git add src/components/orders/SaleEntryPanel.tsx
git commit -m "feat(ui): 판매 내역 택배비 컬럼 추가 및 인라인 편집"
```

---

## 수동 검증 체크리스트

- [ ] 판매 내역에서 쿠팡 레코드의 택배비가 `3,500`으로 표시되는지 확인
- [ ] 판매 내역에서 네이버 레코드의 택배비가 `3,500`으로 표시되는지 확인
- [ ] 로켓그로스 레코드의 택배비가 `—`으로 표시되는지 확인
- [ ] 편집 버튼 클릭 시 택배비 input에 현재 값이 채워지는지 확인
- [ ] 택배비 수정 후 저장 시 DB에 반영되는지 확인
- [ ] 새 판매 추가 시 택배비 기본값 0, 직접 입력 가능한지 확인
- [ ] "판매 가져오기" 실행 후 새로 가져온 쿠팡/네이버 레코드의 택배비가 3,500인지 확인
