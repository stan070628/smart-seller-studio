# 수익·원가 탭 — 라인 숨김 & 채널 코드 팝오버 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수익·원가 탭에 (1) 행 숨김/복원 기능과 (2) 채널 코드 편집 팝오버를 추가한다.

**Architecture:** DB에 `hidden` 컬럼을 추가하고, GET API에서 기본적으로 숨김 행을 제외한다. 채널 코드 편집은 인라인 폼(테이블 레이아웃 파괴)을 `position: fixed` 팝오버로 교체한다.

**Tech Stack:** Next.js App Router, PostgreSQL (pg), React hooks, lucide-react, vitest

**Spec:** `docs/superpowers/specs/2026-06-21-cost-management-hide-and-channel-edit-design.md`

---

## 파일 변경 목록

| 파일 | 역할 |
|------|------|
| `supabase/migrations/078_product_costs_hidden.sql` | `hidden` 컬럼 추가 |
| `src/app/api/cost-management/products/[id]/route.ts` | PATCH에 `hidden` 처리 추가 |
| `src/app/api/cost-management/products/route.ts` | `show_hidden` 필터 + `hidden_count` 반환 |
| `src/components/orders/ChannelEditPopover.tsx` | 신규 팝오버 컴포넌트 |
| `src/components/orders/ChannelCell.tsx` | `onEditChannel` prop 타입 변경 |
| `src/components/orders/CostManagementTab.tsx` | 팝오버 교체 + 숨김 기능 |
| `src/__tests__/api/cost-management-hidden.test.ts` | PATCH/GET hidden 테스트 |

---

## Task 1: DB 마이그레이션 — `hidden` 컬럼

**Files:**
- Create: `supabase/migrations/078_product_costs_hidden.sql`

- [ ] **Step 1: 마이그레이션 파일 생성**

```sql
-- supabase/migrations/078_product_costs_hidden.sql
ALTER TABLE product_costs
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: 마이그레이션 적용**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
node scripts/group-vendor-items.mjs --help 2>/dev/null || true
# DB에 직접 적용
node -e "
const pg = require('pg');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });
const pool = new pg.Pool({ connectionString: process.env.SOURCING_DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sql = fs.readFileSync('supabase/migrations/078_product_costs_hidden.sql', 'utf8');
pool.query(sql).then(() => { console.log('✅ 마이그레이션 완료'); pool.end(); }).catch(e => { console.error(e); pool.end(); });
"
```

Expected: `✅ 마이그레이션 완료`

- [ ] **Step 3: 컬럼 존재 확인**

```bash
node -e "
const pg = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new pg.Pool({ connectionString: process.env.SOURCING_DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query(\"SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='product_costs' AND column_name='hidden'\").then(r => { console.log(r.rows); pool.end(); });
"
```

Expected: `[ { column_name: 'hidden', data_type: 'boolean', column_default: 'false' } ]`

- [ ] **Step 4: 커밋**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
git add supabase/migrations/078_product_costs_hidden.sql
git commit -m "feat(db): product_costs에 hidden 컬럼 추가"
```

---

## Task 2: PATCH API — `hidden` 필드 처리

**Files:**
- Modify: `src/app/api/cost-management/products/[id]/route.ts`
- Create: `src/__tests__/api/cost-management-hidden.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// src/__tests__/api/cost-management-hidden.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function makePatchRequest(id: string, body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/cost-management/products/${id}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
}

describe('PATCH /api/cost-management/products/[id] — hidden 필드', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-uuid', email: 'test@example.com' });
    mockQuery = vi.fn().mockResolvedValue({
      rows: [{ id: 'prod-uuid', seller_product_id: null, vendor_item_id: null, naver_channel_product_no: null, variants: null, hidden: true }],
      rowCount: 1,
    });
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('hidden: true 로 숨김 처리', async () => {
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/route');
    const res = await PATCH(makePatchRequest('prod-uuid', { hidden: true }), { params: Promise.resolve({ id: 'prod-uuid' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // hidden: true 가 쿼리 파라미터로 전달됐는지 확인
    const call = mockQuery.mock.calls[0];
    expect(call[1]).toContain(true); // hidden 값
  });

  it('hidden: false 로 복원 처리 (falsy 함정 방지)', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'prod-uuid', seller_product_id: null, vendor_item_id: null, naver_channel_product_no: null, variants: null, hidden: false }],
      rowCount: 1,
    });
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/route');
    const res = await PATCH(makePatchRequest('prod-uuid', { hidden: false }), { params: Promise.resolve({ id: 'prod-uuid' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // false 가 null로 변환되지 않고 그대로 전달됐는지 확인
    const call = mockQuery.mock.calls[0];
    expect(call[1]).toContain(false);
  });

  it('hidden 미전달 시 기존 값 유지 (null 전달)', async () => {
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/route');
    await PATCH(makePatchRequest('prod-uuid', { seller_product_id: 12345 }), { params: Promise.resolve({ id: 'prod-uuid' }) });
    const call = mockQuery.mock.calls[0];
    // hidden 파라미터 위치에 null이 전달돼야 COALESCE가 기존 값을 유지
    const hiddenParam = call[1].find((v: unknown) => v === null || v === false || v === true);
    // hidden 관련 파라미터가 null임을 확인 (undefined가 아닌 null)
    expect(call[1]).toContain(null);
  });

  it('hidden 값이 boolean이 아니면 400', async () => {
    const { PATCH } = await import('@/app/api/cost-management/products/[id]/route');
    const res = await PATCH(makePatchRequest('prod-uuid', { hidden: 'yes' }), { params: Promise.resolve({ id: 'prod-uuid' }) });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx vitest run src/__tests__/api/cost-management-hidden.test.ts 2>&1 | tail -20
```

Expected: FAIL (hidden 관련 코드 아직 없음)

- [ ] **Step 3: PATCH route에 `hidden` 추가**

`src/app/api/cost-management/products/[id]/route.ts` 의 PATCH 핸들러를 수정한다.

```typescript
// body 구조 분해에 hidden 추가
const { seller_product_id, vendor_item_id, naver_channel_product_no, variants, hidden } = body ?? {};

// hidden 유효성 검사 추가 (기존 seller_product_id 검사 블록 다음에 추가)
if (hidden !== undefined && typeof hidden !== 'boolean') {
  return NextResponse.json({ success: false, error: 'hidden must be a boolean' }, { status: 400 });
}

// SQL 쿼리 수정 — hidden 컬럼 추가
// 기존:
//   SET seller_product_id = COALESCE($3, seller_product_id), ...
//   WHERE id = $1 AND user_id = $2
//   [..., seller_product_id ?? null, vendor_item_id ?? null, naver_channel_product_no ?? null, variants ? JSON.stringify(variants) : null]

// 변경 후:
const { rows } = await pool.query(
  `UPDATE product_costs
   SET seller_product_id          = COALESCE($3, seller_product_id),
       vendor_item_id             = COALESCE($4, vendor_item_id),
       naver_channel_product_no   = COALESCE($5, naver_channel_product_no),
       variants                   = COALESCE($6, variants),
       hidden                     = COALESCE($7, hidden)
   WHERE id = $1 AND user_id = $2
   RETURNING id, seller_product_id, vendor_item_id, naver_channel_product_no, variants, hidden`,
  [
    id,
    user.userId,
    seller_product_id ?? null,
    vendor_item_id ?? null,
    naver_channel_product_no ?? null,
    variants ? JSON.stringify(variants) : null,
    hidden === undefined ? null : hidden,   // ← false도 null이 되지 않도록
  ],
);
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx vitest run src/__tests__/api/cost-management-hidden.test.ts 2>&1 | tail -20
```

Expected: 4 tests PASS

- [ ] **Step 5: 타입 체크**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
```

Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
git add src/app/api/cost-management/products/\[id\]/route.ts \
        src/__tests__/api/cost-management-hidden.test.ts
git commit -m "feat(api): PATCH products/[id]에 hidden 필드 추가"
```

---

## Task 3: GET API — `show_hidden` 필터 + `hidden_count`

**Files:**
- Modify: `src/app/api/cost-management/products/route.ts`

- [ ] **Step 1: GET route 수정**

`src/app/api/cost-management/products/route.ts` 에서 다음 3군데를 수정한다.

**① searchParams 파싱 (기존 `channelFilter` 파싱 바로 다음)**

```typescript
const showHidden = searchParams.get('show_hidden') === 'true';
```

**② products 쿼리 수정 — `hidden` 컬럼 SELECT + WHERE 필터 추가**

```typescript
// 기존:
const { rows: products } = await pool.query(
  `SELECT id, product_name, seller_product_id, vendor_item_id, naver_channel_product_no,
          variants, naver_variants, naver_origin_product_no,
          platform, platform_fee_rate,
          subdivision_unit, subdivision_carryover, subdivision_carryover_unit_cost, created_at
   FROM product_costs
   WHERE user_id = $1
   ORDER BY created_at DESC`,
  [user.userId],
);

// 변경 후:
const { rows: products } = await pool.query(
  `SELECT id, product_name, seller_product_id, vendor_item_id, naver_channel_product_no,
          variants, naver_variants, naver_origin_product_no,
          platform, platform_fee_rate,
          subdivision_unit, subdivision_carryover, subdivision_carryover_unit_cost, created_at,
          hidden
   FROM product_costs
   WHERE user_id = $1
     ${showHidden ? '' : 'AND hidden = false'}
   ORDER BY created_at DESC`,
  [user.userId],
);
```

**③ hidden_count 쿼리 추가 — products 쿼리 바로 다음**

```typescript
const { rows: hiddenCountRows } = await pool.query(
  `SELECT COUNT(*)::int AS hidden_count
   FROM product_costs
   WHERE user_id = $1 AND hidden = true`,
  [user.userId],
);
const hiddenCount: number = hiddenCountRows[0]?.hidden_count ?? 0;
```

**④ data 배열에 `hidden` 필드 추가 — `return { id: p.id, ... }` 블록**

```typescript
// 기존 return 객체 마지막에 추가:
hidden: p.hidden as boolean ?? false,
```

**⑤ summary에 `hidden_count` 추가**

```typescript
// 기존:
const summary = {
  total_purchase_amount: ...,
  total_sales_amount: ...,
  total_realized_profit: ...,
};

// 변경 후:
const summary = {
  total_purchase_amount: data.reduce((s, p) => s + p.total_purchase_amount, 0),
  total_sales_amount: data.reduce((s, p) => s + p.total_sales_amount, 0),
  total_realized_profit: data.reduce((s, p) => s + p.total_realized_profit, 0),
  hidden_count: hiddenCount,
};
```

- [ ] **Step 2: 타입 체크**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
git add src/app/api/cost-management/products/route.ts
git commit -m "feat(api): GET products에 show_hidden 필터 및 hidden_count 추가"
```

---

## Task 4: `ChannelEditPopover` 신규 컴포넌트

**Files:**
- Create: `src/components/orders/ChannelEditPopover.tsx`

- [ ] **Step 1: 컴포넌트 파일 생성**

```typescript
// src/components/orders/ChannelEditPopover.tsx
'use client';

import React, { useState, useEffect, useRef } from 'react';

interface ProductSnapshot {
  id: string;
  seller_product_id: number | null;
  vendor_item_id: number | null;
  naver_channel_product_no: number | null;
}

interface ChannelEditPopoverProps {
  product: ProductSnapshot;
  anchorEl: HTMLElement;
  onClose: () => void;
  onSaved: (updates: Partial<ProductSnapshot>) => void;
}

export default function ChannelEditPopover({ product: p, anchorEl, onClose, onSaved }: ChannelEditPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [sellerProductId, setSellerProductId] = useState(p.seller_product_id ? String(p.seller_product_id) : '');
  const [vendorItemId, setVendorItemId] = useState(p.vendor_item_id ? String(p.vendor_item_id) : '');
  const [naverChannelProductNo, setNaverChannelProductNo] = useState(p.naver_channel_product_no ? String(p.naver_channel_product_no) : '');
  const [saving, setSaving] = useState(false);
  const [fetchingVariants, setFetchingVariants] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // 위치 계산
  useEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    const popoverWidth = 260;
    const left = rect.left + popoverWidth > window.innerWidth - 8
      ? rect.right - popoverWidth
      : rect.left;
    setPos({ top: rect.bottom + 4, left: Math.max(8, left) });
  }, [anchorEl]);

  // 외부 클릭 닫힘 + Esc + 스크롤/리사이즈 닫힘
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if (anchorEl.contains(e.target as Node)) return; // anchor 재클릭 토글 방지
      onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function handleClose() { onClose(); }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('resize', handleClose);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('resize', handleClose);
    };
  }, [anchorEl, onClose]);

  function parseId(val: string): number | null {
    const n = parseInt(val.replace(/[^0-9]/g, ''), 10);
    return isNaN(n) || n <= 0 ? null : n;
  }

  async function handleSave() {
    const body: Record<string, unknown> = {};
    const sid = parseId(sellerProductId);
    const vid = parseId(vendorItemId);
    const nid = parseId(naverChannelProductNo);
    if (sid !== null) body.seller_product_id = sid;
    if (vid !== null) body.vendor_item_id = vid;
    if (nid !== null) body.naver_channel_product_no = nid;
    if (Object.keys(body).length === 0) { onClose(); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/cost-management/products/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        onSaved({ seller_product_id: sid, vendor_item_id: vid, naver_channel_product_no: nid });
        onClose();
      } else {
        alert(json.error ?? '저장 실패');
      }
    } catch {
      alert('네트워크 오류');
    } finally {
      setSaving(false);
    }
  }

  async function handleFetchVariants() {
    if (!parseId(sellerProductId)) return;
    setFetchingVariants(true);
    try {
      const res = await fetch(`/api/cost-management/products/${p.id}/fetch-variants`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        const count = Object.keys(json.data.variants as Record<string, string>).length;
        alert(`사이즈 ${count}개 매핑 저장 완료`);
        onSaved({ seller_product_id: parseId(sellerProductId) });
        onClose();
      } else {
        alert(json.error ?? 'variants 조회 실패');
      }
    } catch {
      alert('네트워크 오류');
    } finally {
      setFetchingVariants(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '4px 8px', fontSize: '12px',
    border: '1px solid #d4d4d8', borderRadius: '5px',
    boxSizing: 'border-box', color: '#18181b', outline: 'none',
  };

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: 260,
        background: '#fff',
        border: '1px solid #e5e5e5',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        padding: 14,
        zIndex: 1000,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: '#18181b', marginBottom: 10 }}>채널 코드 수정</div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: '#be0014', fontWeight: 600, marginBottom: 2 }}>윙 판매자상품ID</div>
        <div style={{ fontSize: 9, color: '#71717a', marginBottom: 4 }}>Wing 셀러센터 → 상품관리 → 판매자상품ID</div>
        <input
          style={{ ...inputStyle, borderColor: '#fca5a5' }}
          placeholder="예: 12345678"
          value={sellerProductId}
          onChange={(e) => setSellerProductId(e.target.value)}
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: '#0369a1', fontWeight: 600, marginBottom: 2 }}>RG vendorItemId</div>
        <div style={{ fontSize: 9, color: '#71717a', marginBottom: 4 }}>쿠팡 URL의 vendorItemId= 값 (URL 붙여넣기 가능)</div>
        <input
          style={{ ...inputStyle, borderColor: '#7dd3fc' }}
          placeholder="예: 95346957211"
          value={vendorItemId}
          onChange={(e) => {
            const v = e.target.value;
            const match = v.match(/[?&]vendorItemId=(\d+)/);
            setVendorItemId(match ? match[1] : v);
          }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: '#03c75a', fontWeight: 600, marginBottom: 2 }}>네이버 채널상품번호</div>
        <div style={{ fontSize: 9, color: '#71717a', marginBottom: 4 }}>스마트스토어 URL의 /products/숫자 (URL 붙여넣기 가능)</div>
        <input
          style={{ ...inputStyle, borderColor: '#86efac' }}
          placeholder="예: 5012345678"
          value={naverChannelProductNo}
          onChange={(e) => {
            const v = e.target.value;
            const match = v.match(/\/products\/(\d+)/);
            setNaverChannelProductNo(match ? match[1] : v);
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, background: '#18181b', color: '#fff', border: 'none', borderRadius: 5, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
        >
          {saving ? '저장 중...' : '저장'}
        </button>
        <button
          onClick={onClose}
          style={{ padding: '5px 10px', fontSize: 11, background: '#f4f4f5', color: '#71717a', border: 'none', borderRadius: 5, cursor: 'pointer' }}
        >
          취소
        </button>
        {parseId(sellerProductId) && (
          <button
            onClick={handleFetchVariants}
            disabled={fetchingVariants}
            style={{ padding: '5px 10px', fontSize: 11, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 5, cursor: fetchingVariants ? 'not-allowed' : 'pointer' }}
          >
            {fetchingVariants ? '불러오는 중...' : 'variants 불러오기'}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
git add src/components/orders/ChannelEditPopover.tsx
git commit -m "feat: ChannelEditPopover 신규 컴포넌트 추가"
```

---

## Task 5: `ChannelCell` — `onEditChannel` prop 타입 변경

**Files:**
- Modify: `src/components/orders/ChannelCell.tsx`

- [ ] **Step 1: prop 타입 및 버튼 onClick 변경**

`src/components/orders/ChannelCell.tsx` 에서 두 군데를 수정한다.

**① interface 수정**

```typescript
// 기존:
interface ChannelCellProps {
  product: ProductData;
  onEditChannel: () => void;
  onProductUpdate: (updates: Partial<ProductData>) => void;
}

// 변경 후:
interface ChannelCellProps {
  product: ProductData;
  onEditChannel: (anchorEl: HTMLElement) => void;
  onProductUpdate: (updates: Partial<ProductData>) => void;
}
```

**② 연필 버튼 onClick 변경 (파일 하단 return문 안)**

```typescript
// 기존:
<button
  onClick={onEditChannel}
  title="채널 ID 편집"
  ...
>

// 변경 후:
<button
  onClick={(e) => onEditChannel(e.currentTarget as HTMLElement)}
  title="채널 ID 편집"
  ...
>
```

- [ ] **Step 2: 타입 체크**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
```

Expected: `CostManagementTab.tsx` 에서 타입 불일치 에러 발생 (다음 Task에서 수정)

- [ ] **Step 3: 커밋**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
git add src/components/orders/ChannelCell.tsx
git commit -m "refactor: ChannelCell onEditChannel prop에 anchorEl 전달하도록 변경"
```

---

## Task 6: `CostManagementTab` — 채널 편집 팝오버로 교체

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

- [ ] **Step 1: import 추가**

파일 상단 import 블록에 추가:

```typescript
import ChannelEditPopover from './ChannelEditPopover';
```

- [ ] **Step 2: 제거할 state 4개 및 관련 함수 삭제**

다음을 삭제한다:

```typescript
// 삭제
const [editChannelId, setEditChannelId] = useState<string | null>(null);
const [editSellerProductId, setEditSellerProductId] = useState('');
const [editVendorItemId, setEditVendorItemId] = useState('');
const [editNaverChannelProductNo, setEditNaverChannelProductNo] = useState('');

// 삭제: openEditChannel 함수 전체
function openEditChannel(p: ProductRow) { ... }

// 삭제: saveEditChannel 함수 전체
async function saveEditChannel(id: string) { ... }

// 삭제: fetchVariants 함수 전체 (ChannelEditPopover 내부로 이전됨)
async function fetchVariants(productId: string) { ... }
```

- [ ] **Step 3: 새 state 추가**

삭제한 state 자리에 추가:

```typescript
const [channelEditTarget, setChannelEditTarget] = useState<{
  product: ProductRow;
  anchorEl: HTMLElement;
} | null>(null);
```

- [ ] **Step 4: `load()` 함수에 팝오버 닫기 추가**

`load` 콜백 함수 최상단에 한 줄 추가:

```typescript
const load = useCallback(async () => {
  setChannelEditTarget(null); // 로드 시 팝오버 닫기
  setLoading(true);
  // ... 기존 코드
}, [preset, customFrom, customTo, channelFilter]);
```

- [ ] **Step 5: `renderProductRow` 내 인라인 편집 분기 교체**

`renderProductRow` 함수 안에서 `editChannelId === p.id` 분기를 제거하고 `ChannelCell` 호출만 남긴다:

```typescript
// 기존:
<td style={{ ... }}>
  {editChannelId === p.id ? (
    <div style={{ ... }}>
      {/* 긴 인라인 폼 */}
    </div>
  ) : (
    <ChannelCell
      product={p}
      onEditChannel={() => openEditChannel(p)}
      onProductUpdate={(updates) => handleProductUpdate(p.id, updates as Partial<ProductRow>)}
    />
  )}
</td>

// 변경 후:
<td style={{ padding: `10px ${firstTdPaddingLeft}`, textAlign: 'center', whiteSpace: 'nowrap' }}>
  <ChannelCell
    product={p}
    onEditChannel={(anchorEl) => setChannelEditTarget({ product: p, anchorEl })}
    onProductUpdate={(updates) => handleProductUpdate(p.id, updates as Partial<ProductRow>)}
  />
</td>
```

- [ ] **Step 6: 컴포넌트 최하단에 `ChannelEditPopover` 렌더 추가**

`return` 블록의 마지막 `</div>` 바로 위에 추가:

```tsx
{channelEditTarget && (
  <ChannelEditPopover
    product={channelEditTarget.product}
    anchorEl={channelEditTarget.anchorEl}
    onClose={() => setChannelEditTarget(null)}
    onSaved={(updates) => {
      handleProductUpdate(channelEditTarget.product.id, updates as Partial<ProductRow>);
      setChannelEditTarget(null);
    }}
  />
)}
```

- [ ] **Step 7: 타입 체크**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
```

Expected: 에러 없음

- [ ] **Step 8: 커밋**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat: 채널 코드 편집 인라인 폼을 ChannelEditPopover로 교체"
```

---

## Task 7: `CostManagementTab` — 라인 숨김 기능

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

- [ ] **Step 1: lucide-react import에 Eye, EyeOff 추가**

```typescript
// 기존:
import { Plus, Truck, Package, Search, Trash2, TrendingUp, TrendingDown, AlertCircle, CloudDownload } from 'lucide-react';

// 변경 후:
import { Plus, Truck, Package, Search, Trash2, TrendingUp, TrendingDown, AlertCircle, CloudDownload, Eye, EyeOff } from 'lucide-react';
```

- [ ] **Step 2: `ProductRow` 인터페이스에 `hidden` 필드 추가**

```typescript
interface ProductRow {
  // ... 기존 필드들
  hidden: boolean;
  [key: string]: unknown;
}
```

- [ ] **Step 3: 숨김 관련 state 추가**

기존 state 선언부에 추가:

```typescript
const [showHidden, setShowHidden] = useState(false);
const [hiddenCount, setHiddenCount] = useState(0);
```

- [ ] **Step 4: `load()` 함수 수정 — `show_hidden` 파라미터 + `hidden_count` 읽기**

```typescript
// load 함수 내 params 구성 부분:
if (channelFilter !== 'all') params.set('channel', channelFilter);
if (showHidden) params.set('show_hidden', 'true');  // ← 추가

// json.summary 처리 부분:
setSummary(json.summary ?? { total_purchase_amount: 0, total_sales_amount: 0, total_realized_profit: 0 });
setHiddenCount(json.summary?.hidden_count ?? 0);  // ← 추가
```

`load` 의존성 배열에 `showHidden` 추가:

```typescript
}, [preset, customFrom, customTo, channelFilter, showHidden]);
```

- [ ] **Step 5: 숨김 토글 함수 추가**

```typescript
async function toggleHide(p: ProductRow) {
  const newHidden = !p.hidden;
  // 낙관적 업데이트
  setProducts((prev) => prev.filter((x) => x.id !== p.id || showHidden));
  if (showHidden) {
    setProducts((prev) => prev.map((x) => x.id === p.id ? { ...x, hidden: newHidden } : x));
  }
  try {
    const res = await fetch(`/api/cost-management/products/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: newHidden }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error ?? '실패');
    setHiddenCount((c) => newHidden ? c + 1 : Math.max(0, c - 1));
  } catch (e) {
    // 실패 시 원복
    load();
    alert(`숨김 처리 실패: ${e instanceof Error ? e.message : '오류'}`);
  }
}
```

- [ ] **Step 6: `renderProductRow` — Eye/EyeOff 아이콘 추가**

삭제 버튼 `<td>` 바로 앞에 Eye 토글 `<td>` 추가:

```tsx
{/* Eye 토글 */}
<td style={{ padding: '10px 4px', textAlign: 'right' }}>
  <button
    onClick={() => toggleHide(p)}
    title={p.hidden ? '숨김 해제' : '이 행 숨기기'}
    style={{
      border: 'none', background: 'none', cursor: 'pointer',
      padding: '4px', borderRadius: '4px', opacity: 0.25,
    }}
    onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
    onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.25')}
  >
    {p.hidden ? <EyeOff size={13} color="#71717a" /> : <Eye size={13} color="#71717a" />}
  </button>
</td>
{/* 기존 삭제 버튼 td */}
```

`renderProductRow`에서 `isChild`일 때의 `rowStyle`에 숨김 행 스타일 반영:

```typescript
const rowStyle: React.CSSProperties = isChild
  ? { borderBottom: '1px solid #f4f4f5', background: '#fafafa', borderLeft: '3px solid #fca5a5', opacity: p.hidden ? 0.5 : 1 }
  : { borderBottom: '1px solid #f0f0f0', background: p.hidden ? '#fafafa' : '#fff', opacity: p.hidden ? 0.5 : 1 };
```

- [ ] **Step 7: thead에 Eye 열 헤더 추가**

```typescript
// 기존 헤더 배열 마지막에 빈 문자열 하나 추가 (Eye 열):
{['채널', '상품명', '원가(가중평균)', '배송비(배분)', 'RG배송비', '재고', '재고가치', '실현손익', '마진율', '광고비', 'ROAS', '위너', '입고', '판매', '내역', '', ''].map(...)}
// 뒤의 ''는 Eye 열, 그 다음 ''는 기존 삭제 버튼 열
```

- [ ] **Step 8: 숨김 토글 버튼 — 테이블 위에 추가**

기존 `{loadError && ...}` 블록 바로 위에 추가:

```tsx
{/* 숨김 토글 버튼 */}
{hiddenCount > 0 && (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
    <button
      onClick={() => setShowHidden((prev) => !prev)}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        padding: '5px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
        border: `1px solid ${showHidden ? '#71717a' : '#e5e5e5'}`,
        background: showHidden ? '#f4f4f5' : '#fff',
        color: '#52525b',
      }}
    >
      {showHidden ? <EyeOff size={12} /> : <Eye size={12} />}
      {showHidden ? `숨김 ${hiddenCount}개 숨기기` : `숨김 ${hiddenCount}개 표시하기`}
    </button>
  </div>
)}
```

- [ ] **Step 9: 빈 상태 메시지 수정**

```tsx
// 기존:
{search ? '검색 결과가 없습니다.' : '상품을 추가해주세요.'}

// 변경 후:
{search
  ? '검색 결과가 없습니다.'
  : hiddenCount > 0
    ? `모든 상품이 숨겨져 있습니다. 위의 "숨김 ${hiddenCount}개 표시하기" 버튼으로 복원할 수 있습니다.`
    : '상품을 추가해주세요.'
}
```

- [ ] **Step 10: 타입 체크**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
```

Expected: 에러 없음

- [ ] **Step 11: 전체 테스트 실행**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx vitest run 2>&1 | tail -15
```

Expected: 기존 테스트 포함 전체 PASS

- [ ] **Step 12: 커밋**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat: 수익·원가 탭 라인 숨김/복원 기능 추가"
```

---

## Task 8: 수동 동작 확인

- [ ] **Step 1: 개발 서버 시작**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npm run dev
```

- [ ] **Step 2: 채널 코드 팝오버 확인**

1. 브라우저에서 `/orders` (주문매출 탭) → 수익·원가 탭 이동
2. 임의 상품 행의 연필(✏) 아이콘 클릭
3. 팝오버가 테이블 레이아웃을 깨지 않고 고정 위치에 뜨는지 확인
4. 채널 ID 입력 → 저장 클릭 → 데이터 업데이트 확인
5. Esc 키로 닫히는지 확인
6. 연필 아이콘 재클릭 시 토글(닫힘 → 열림)이 올바른지 확인

- [ ] **Step 3: 라인 숨김 확인**

1. 임의 상품 행 오른쪽의 Eye 아이콘에 마우스 올려 hover 상태 확인
2. 클릭 시 행이 즉시 사라지는지 확인
3. 상단에 "숨김 1개 표시하기" 버튼 노출 확인
4. 토글 클릭 → 숨김 행이 흐릿하게(opacity 0.5) 나타나는지 확인
5. EyeOff 클릭 → 행 복원 확인
6. 페이지 새로고침 후에도 숨김 상태 유지되는지 확인 (DB 저장 검증)
