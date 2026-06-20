# 상품 그룹핑 & 스마트 추가 플로우 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 동일한 `seller_product_id`를 가진 상품 옵션들을 아코디언 그룹으로 묶어 표시하고, 상품 추가 시 옵션 다중 선택으로 일괄 추가하는 기능 구현

**Architecture:** 클라이언트 사이드 그룹핑(`useMemo`)으로 DB 변경 없이 `products` 배열을 `TableItem[]`으로 변환. 기존 `coupang-product-options` API에 `alreadyAdded` 마킹 추가. `AddProductModal` 쿠팡 탭에서 단일 옵션 선택 → 다중 체크박스 선택으로 확장. `Promise.allSettled`로 부분 실패 처리.

**Tech Stack:** React (`useMemo`, `useState`, `Set`), Next.js App Router API Route, TypeScript, Vitest

---

## 파일 구조

| 파일 | 역할 |
|------|------|
| `src/components/orders/CostManagementTab.tsx` | `GroupRow`/`StandaloneRow` 타입 추가, `tableItems` useMemo, `expandedGroups` state, 아코디언 렌더링 |
| `src/app/api/cost-management/coupang-product-options/route.ts` | `alreadyAdded` 마킹 + `productName` 반환 |
| `src/components/orders/AddProductModal.tsx` | 단일 `selectedOption` → 다중 `selectedOptions: Set<number>`, 부분 실패 처리 |
| `src/components/orders/ProductGroupRow.tsx` | 신규: 부모 행(GroupRow) 렌더링 컴포넌트 (CostManagementTab 파일 축소 목적) |
| `src/__tests__/api/coupang-product-options.test.ts` | 신규: API 테스트 |
| `src/__tests__/lib/product-grouping.test.ts` | 신규: 그룹핑 유틸 함수 테스트 |

---

## Task 1: 그룹핑 유틸 함수 추출 및 테스트

그룹핑 로직을 순수 함수로 분리해 테스트 가능하게 만든다.

**Files:**
- Create: `src/lib/cost-management/product-grouping.ts`
- Create: `src/__tests__/lib/product-grouping.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

`src/__tests__/lib/product-grouping.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildTableItems } from '@/lib/cost-management/product-grouping';

// 최소한의 ProductRow 형태 (실제 타입은 CostManagementTab.tsx:13-39 참조)
type MinProduct = {
  id: string;
  product_name: string;
  seller_product_id: number | null;
  current_stock: number;
  stock_value: number;
  total_realized_profit: number;
  total_sales_amount: number;
  margin_rate: number;
  weighted_avg_cost: number;
  weighted_avg_shipping: number;
  weighted_avg_rg_shipping: number;
  [key: string]: unknown;
};

function makeProduct(overrides: Partial<MinProduct>): MinProduct {
  return {
    id: 'id-1',
    product_name: '테스트',
    seller_product_id: null,
    current_stock: 10,
    stock_value: 50000,
    total_realized_profit: 20000,
    total_sales_amount: 100000,
    margin_rate: 20,
    weighted_avg_cost: 5000,
    weighted_avg_shipping: 0,
    weighted_avg_rg_shipping: 0,
    ...overrides,
  };
}

describe('buildTableItems', () => {
  it('seller_product_id가 null인 상품은 standalone으로 처리', () => {
    const p = makeProduct({ id: 'p1', seller_product_id: null });
    const result = buildTableItems([p] as never[]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('standalone');
  });

  it('옵션이 1개뿐인 그룹은 standalone으로 평탄화', () => {
    const p = makeProduct({ id: 'p1', seller_product_id: 111 });
    const result = buildTableItems([p] as never[]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('standalone');
  });

  it('같은 seller_product_id 2개는 group으로 묶임', () => {
    const p1 = makeProduct({ id: 'p1', seller_product_id: 111, current_stock: 10, stock_value: 50000, total_realized_profit: 20000, total_sales_amount: 100000 });
    const p2 = makeProduct({ id: 'p2', seller_product_id: 111, current_stock: 20, stock_value: 80000, total_realized_profit: 30000, total_sales_amount: 120000 });
    const result = buildTableItems([p1, p2] as never[]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('group');
    if (result[0].kind === 'group') {
      expect(result[0].children).toHaveLength(2);
      expect(result[0].totalStock).toBe(30);
      // avgCost = (50000+80000) / (10+20) = 4333.33
      expect(result[0].avgCost).toBeCloseTo(4333.33, 1);
      // groupMarginRate = (20000+30000) / (100000+120000) * 100 = 22.72...
      expect(result[0].groupMarginRate).toBeCloseTo(22.72, 1);
    }
  });

  it('totalStock이 0이면 avgCost는 0', () => {
    const p1 = makeProduct({ id: 'p1', seller_product_id: 222, current_stock: 0, stock_value: 0 });
    const p2 = makeProduct({ id: 'p2', seller_product_id: 222, current_stock: 0, stock_value: 0 });
    const result = buildTableItems([p1, p2] as never[]);
    if (result[0].kind === 'group') {
      expect(result[0].avgCost).toBe(0);
    }
  });

  it('totalSalesAmount가 0이면 groupMarginRate는 0', () => {
    const p1 = makeProduct({ id: 'p1', seller_product_id: 333, total_sales_amount: 0 });
    const p2 = makeProduct({ id: 'p2', seller_product_id: 333, total_sales_amount: 0 });
    const result = buildTableItems([p1, p2] as never[]);
    if (result[0].kind === 'group') {
      expect(result[0].groupMarginRate).toBe(0);
    }
  });

  it('다른 seller_product_id는 각각 별도 그룹', () => {
    const p1 = makeProduct({ id: 'p1', seller_product_id: 111 });
    const p2 = makeProduct({ id: 'p2', seller_product_id: 111 });
    const p3 = makeProduct({ id: 'p3', seller_product_id: 222 });
    const p4 = makeProduct({ id: 'p4', seller_product_id: 222 });
    const result = buildTableItems([p1, p2, p3, p4] as never[]);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.kind === 'group')).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx vitest run src/__tests__/lib/product-grouping.test.ts
```

예상: `FAIL — Cannot find module '@/lib/cost-management/product-grouping'`

- [ ] **Step 3: 유틸 함수 구현**

`src/lib/cost-management/product-grouping.ts`:
```typescript
// ProductRow의 핵심 필드만 의존 (CostManagementTab.tsx:13-39 참조)
interface GroupableProduct {
  id: string;
  product_name: string;
  seller_product_id: number | null;
  current_stock: number;
  stock_value: number;
  total_realized_profit: number;
  total_sales_amount: number;
  [key: string]: unknown;
}

export interface GroupRow<T extends GroupableProduct = GroupableProduct> {
  kind: 'group';
  sellerProductId: string;
  productName: string;
  children: T[];
  totalStock: number;
  totalStockValue: number;
  totalProfit: number;
  totalSalesAmount: number;
  avgCost: number;
  groupMarginRate: number;
}

export interface StandaloneRow<T extends GroupableProduct = GroupableProduct> {
  kind: 'standalone';
  product: T;
}

export type TableItem<T extends GroupableProduct = GroupableProduct> =
  | GroupRow<T>
  | StandaloneRow<T>;

export function buildTableItems<T extends GroupableProduct>(
  products: T[],
): TableItem<T>[] {
  const grouped = new Map<string, T[]>();
  const standalone: T[] = [];

  for (const p of products) {
    if (p.seller_product_id != null) {
      const key = String(p.seller_product_id);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    } else {
      standalone.push(p);
    }
  }

  const result: TableItem<T>[] = [];

  for (const [sellerProductId, children] of grouped) {
    // 옵션 1개짜리 그룹은 standalone으로 평탄화
    if (children.length === 1) {
      standalone.push(children[0]);
      continue;
    }

    const totalStock = children.reduce((s, c) => s + (c.current_stock ?? 0), 0);
    const totalStockValue = children.reduce((s, c) => s + (c.stock_value ?? 0), 0);
    const avgCost = totalStock > 0 ? totalStockValue / totalStock : 0;
    const totalProfit = children.reduce((s, c) => s + (c.total_realized_profit ?? 0), 0);
    const totalSalesAmount = children.reduce((s, c) => s + (c.total_sales_amount ?? 0), 0);
    const groupMarginRate =
      totalSalesAmount > 0 ? (totalProfit / totalSalesAmount) * 100 : 0;

    result.push({
      kind: 'group',
      sellerProductId,
      productName: children[0].product_name ?? '',
      children,
      totalStock,
      totalStockValue,
      totalProfit,
      totalSalesAmount,
      avgCost,
      groupMarginRate,
    });
  }

  for (const p of standalone) {
    result.push({ kind: 'standalone', product: p });
  }

  return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/product-grouping.test.ts
```

예상: `PASS — 6 tests passed`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/cost-management/product-grouping.ts src/__tests__/lib/product-grouping.test.ts
git commit -m "feat: 상품 그룹핑 유틸 함수 + 테스트 추가"
```

---

## Task 2: coupang-product-options API에 alreadyAdded 마킹 추가

기존 API를 확장해 `productName`과 `alreadyAdded` 필드를 응답에 추가한다.

**Files:**
- Modify: `src/app/api/cost-management/coupang-product-options/route.ts`
- Create: `src/__tests__/api/coupang-product-options.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

`src/__tests__/api/coupang-product-options.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/listing/coupang-client', () => ({ getCoupangClient: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetCoupangClient = getCoupangClient as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

function makeRequest(sellerProductId?: string): NextRequest {
  const url = sellerProductId
    ? `http://localhost/api/cost-management/coupang-product-options?sellerProductId=${sellerProductId}`
    : `http://localhost/api/cost-management/coupang-product-options`;
  return new NextRequest(url);
}

describe('GET /api/cost-management/coupang-product-options', () => {
  let mockGetProductDetail: ReturnType<typeof vi.fn>;
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-1' });

    mockGetProductDetail = vi.fn().mockResolvedValue({
      sellerProductName: '테스트 상품',
      items: [
        { vendorItemId: 111, itemName: '옐로우', salePrice: 15000 },
        { vendorItemId: 222, itemName: '블루', salePrice: 15000 },
      ],
    });
    mockGetCoupangClient.mockReturnValue({ getProductDetail: mockGetProductDetail });

    mockQuery = vi.fn().mockResolvedValue({
      rows: [{ vendor_item_id: '111' }], // 111은 이미 추가됨
    });
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('인증 없으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/cost-management/coupang-product-options/route');
    const res = await GET(makeRequest('123'));
    expect(res.status).toBe(401);
  });

  it('sellerProductId 없으면 400', async () => {
    const { GET } = await import('@/app/api/cost-management/coupang-product-options/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
  });

  it('productName과 options 반환, alreadyAdded 마킹', async () => {
    const { GET } = await import('@/app/api/cost-management/coupang-product-options/route');
    const res = await GET(makeRequest('16182237839'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.productName).toBe('테스트 상품');
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toMatchObject({ vendorItemId: 111, alreadyAdded: true });
    expect(json.data[1]).toMatchObject({ vendorItemId: 222, alreadyAdded: false });
  });

  it('vendorItemId가 0인 항목 필터링', async () => {
    mockGetProductDetail.mockResolvedValue({
      sellerProductName: '테스트',
      items: [
        { vendorItemId: 0, itemName: '옵션없음', salePrice: 0 },
        { vendorItemId: 333, itemName: '그린', salePrice: 15000 },
      ],
    });
    const { GET } = await import('@/app/api/cost-management/coupang-product-options/route');
    const res = await GET(makeRequest('999'));
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].vendorItemId).toBe(333);
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
npx vitest run src/__tests__/api/coupang-product-options.test.ts
```

예상: `FAIL — productName 필드 없음, alreadyAdded 없음`

- [ ] **Step 3: API 수정**

`src/app/api/cost-management/coupang-product-options/route.ts` 전체 교체:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getSourcingPool } from '@/lib/sourcing/db';

// GET /api/cost-management/coupang-product-options?sellerProductId=12345678
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const sellerProductId = Number(request.nextUrl.searchParams.get('sellerProductId'));
  if (!sellerProductId || sellerProductId <= 0) {
    return NextResponse.json({ success: false, error: 'sellerProductId required' }, { status: 400 });
  }

  try {
    const client = getCoupangClient();
    const detail = await client.getProductDetail(sellerProductId) as Record<string, unknown>;
    const productName = String(detail.sellerProductName ?? '');
    const rawItems = Array.isArray(detail.items) ? detail.items as Record<string, unknown>[] : [];

    const options = rawItems
      .map((i) => ({
        vendorItemId: Number(i.vendorItemId ?? 0),
        itemName: String(i.itemName ?? i.vendorItemName ?? ''),
        salePrice: Number(i.salePrice ?? i.originalPrice ?? 0),
      }))
      .filter((i) => i.vendorItemId > 0);

    // 현재 유저의 등록된 vendor_item_id 목록 조회 → alreadyAdded 마킹
    const pool = getSourcingPool();
    const { rows } = await pool.query(
      `SELECT vendor_item_id FROM product_costs WHERE user_id = $1`,
      [user.userId],
    );
    const existingIds = new Set(rows.map((r) => String(r.vendor_item_id)));

    const data = options.map((opt) => ({
      ...opt,
      alreadyAdded: existingIds.has(String(opt.vendorItemId)),
    }));

    return NextResponse.json({ success: true, productName, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/coupang-product-options.test.ts
```

예상: `PASS — 4 tests passed`

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/cost-management/coupang-product-options/route.ts \
        src/__tests__/api/coupang-product-options.test.ts
git commit -m "feat: coupang-product-options API에 productName + alreadyAdded 마킹 추가"
```

---

## Task 3: AddProductModal 쿠팡 탭 — 다중 선택 + 부분 실패 처리

단일 `selectedOption` → `selectedOptions: Set<number>` 다중 체크박스로 확장.

**Files:**
- Modify: `src/components/orders/AddProductModal.tsx`

- [ ] **Step 1: 상태 변수 교체 (쿠팡 탭 옵션 선택 관련)**

`AddProductModal.tsx`에서 기존 단일 선택 상태를 다중 선택으로 교체.

`const [selectedOption, setSelectedOption] = useState<CoupangOption | null>(null);` 제거 후 아래로 교체:

```typescript
// 기존 (제거):
// const [selectedOption, setSelectedOption] = useState<CoupangOption | null>(null);

// 신규:
const [selectedOptions, setSelectedOptions] = useState<Set<number>>(new Set());
const [coupangProductName, setCoupangProductName] = useState('');
```

- [ ] **Step 2: `CoupangOption` 타입에 `alreadyAdded` 추가**

파일 상단 `interface CoupangOption` 수정:
```typescript
interface CoupangOption {
  vendorItemId: number;
  itemName: string;
  salePrice: number;
  alreadyAdded: boolean;  // 추가
}
```

- [ ] **Step 3: `handleSelectCoupang` 수정 — API 응답에서 productName 파싱**

기존:
```typescript
function handleSelectCoupang(p: CoupangProduct) {
  setSelectedCoupang(p);
  setSelectedOption(null);
  setCoupangOptions([]);
  setLoadingOptions(true);
  fetch(`/api/cost-management/coupang-product-options?sellerProductId=${p.seller_product_id}`)
    .then((r) => r.json())
    .then((j) => { if (j.success) setCoupangOptions(j.data); })
    .catch(() => {})
    .finally(() => setLoadingOptions(false));
}
```

교체:
```typescript
function handleSelectCoupang(p: CoupangProduct) {
  setSelectedCoupang(p);
  setSelectedOptions(new Set());
  setCoupangOptions([]);
  setCoupangProductName('');
  setLoadingOptions(true);
  fetch(`/api/cost-management/coupang-product-options?sellerProductId=${p.seller_product_id}`)
    .then((r) => r.json())
    .then((j) => {
      if (j.success) {
        setCoupangOptions(j.data);
        setCoupangProductName(j.productName ?? p.seller_product_name);
      }
    })
    .catch(() => {})
    .finally(() => setLoadingOptions(false));
}
```

- [ ] **Step 4: `add` 함수 — 다중 추가 + `Promise.allSettled` 부분 실패 처리**

기존 `mode === 'coupang'` 분기를 교체:

```typescript
async function add() {
  if (mode === 'coupang') {
    if (!selectedCoupang || selectedOptions.size === 0) return;
    setSaving(true);
    try {
      const optionsToAdd = coupangOptions.filter(
        (opt) => selectedOptions.has(opt.vendorItemId) && !opt.alreadyAdded,
      );

      const results = await Promise.allSettled(
        optionsToAdd.map((opt) =>
          fetch('/api/cost-management/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              product_name: `${coupangProductName} — ${opt.itemName}`,
              seller_product_id: selectedCoupang.seller_product_id,
              vendor_item_id: opt.vendorItemId,
              platform_fee_rate: Number(feeRate) / 100,
              ...(subdivisionUnit.trim() !== '' && { subdivision_unit: Number(subdivisionUnit) }),
            }),
          }).then((r) => r.json()),
        ),
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      onAdded();
      if (failed > 0) {
        alert(`${succeeded}개 추가 완료, ${failed}개 실패`);
      }
      onClose();
    } finally {
      setSaving(false);
    }
    return;
  }

  // 나머지 탭(rg, naver, manual) — 기존 로직 그대로
  if (mode === 'rg' && !selectedRg) return;
  if (mode === 'naver' && !selectedNaver) return;
  if (mode === 'manual' && !manualName.trim()) return;

  setSaving(true);
  try {
    let body: Record<string, unknown>;
    if (mode === 'rg') {
      body = {
        product_name: rgCustomName.trim(),
        vendor_item_id: selectedRg!.vendor_item_id,
        platform_fee_rate: Number(feeRate) / 100,
        ...(subdivisionUnit.trim() !== '' && { subdivision_unit: Number(subdivisionUnit) }),
      };
    } else if (mode === 'naver') {
      body = {
        product_name: selectedNaver!.name,
        platform_fee_rate: Number(feeRate) / 100,
        ...(subdivisionUnit.trim() !== '' && { subdivision_unit: Number(subdivisionUnit) }),
      };
    } else {
      body = {
        product_name: manualName.trim(),
        platform_fee_rate: Number(feeRate) / 100,
        ...(subdivisionUnit.trim() !== '' && { subdivision_unit: Number(subdivisionUnit) }),
      };
    }

    const res = await fetch('/api/cost-management/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) { onAdded(); onClose(); }
    else { alert(json.error ?? '상품 추가에 실패했습니다.'); }
  } finally {
    setSaving(false);
  }
}
```

- [ ] **Step 5: `canSave` 조건 수정**

기존:
```typescript
const canSave =
  (mode === 'coupang' && !!selectedCoupang) ||
```

교체:
```typescript
const canSave =
  (mode === 'coupang' && !!selectedCoupang && selectedOptions.size > 0) ||
```

- [ ] **Step 6: 쿠팡 탭 옵션 UI 렌더링 수정 — 체크박스 다중 선택**

AddProductModal.tsx에서 쿠팡 탭의 옵션 렌더링 부분을 찾아 단일 선택(`onClick: setSelectedOption`) → 다중 체크박스(`onChange: selectedOptions.has/add/delete`)로 교체.

기존 옵션 선택 UI를 grep으로 확인 후 (`grep -n "selectedOption\|coupangOptions.map\|setSelectedOption" src/components/orders/AddProductModal.tsx`) 해당 블록을 아래로 교체:

```tsx
{/* 옵션 목록 */}
{selectedCoupang && !loadingOptions && coupangOptions.length > 0 && (
  <div style={{ border: '1px solid #e4e4e7', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px' }}>
    <div style={{
      padding: '6px 10px', background: '#f4f4f5',
      fontSize: '11px', color: '#71717a', fontWeight: 600,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <span>{coupangProductName || selectedCoupang.seller_product_name}</span>
      <button
        onClick={() => {
          const available = coupangOptions.filter((o) => !o.alreadyAdded).map((o) => o.vendorItemId);
          setSelectedOptions(new Set(available));
        }}
        style={{ fontSize: '10px', color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        전체 선택
      </button>
    </div>
    {coupangOptions.map((opt) => {
      const isSelected = selectedOptions.has(opt.vendorItemId);
      return (
        <div
          key={opt.vendorItemId}
          style={{
            padding: '8px 10px',
            borderBottom: '1px solid #f4f4f5',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: opt.alreadyAdded ? '#fafafa' : isSelected ? '#f5f3ff' : '#fff',
            opacity: opt.alreadyAdded ? 0.6 : 1,
            cursor: opt.alreadyAdded ? 'default' : 'pointer',
          }}
          onClick={() => {
            if (opt.alreadyAdded) return;
            setSelectedOptions((prev) => {
              const next = new Set(prev);
              if (next.has(opt.vendorItemId)) next.delete(opt.vendorItemId);
              else next.add(opt.vendorItemId);
              return next;
            });
          }}
        >
          <div style={{
            width: '14px', height: '14px',
            background: opt.alreadyAdded ? '#d4d4d8' : isSelected ? '#7c3aed' : 'transparent',
            border: opt.alreadyAdded || isSelected ? 'none' : '1.5px solid #d4d4d8',
            borderRadius: '3px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {(opt.alreadyAdded || isSelected) && (
              <span style={{ color: '#fff', fontSize: '9px' }}>✓</span>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', fontWeight: opt.alreadyAdded ? 400 : 500, color: '#18181b' }}>
              {opt.itemName}
            </div>
            <div style={{ fontSize: '10px', color: '#0369a1', fontFamily: 'monospace' }}>
              {opt.vendorItemId}
            </div>
          </div>
          {opt.alreadyAdded ? (
            <span style={{ fontSize: '10px', background: '#f4f4f5', color: '#71717a', padding: '1px 6px', borderRadius: '10px' }}>
              이미 추가됨
            </span>
          ) : (
            <span style={{ fontSize: '10px', background: '#dcfce7', color: '#16a34a', padding: '1px 6px', borderRadius: '10px' }}>
              미추가
            </span>
          )}
        </div>
      );
    })}
    {coupangOptions.every((o) => o.alreadyAdded) && (
      <div style={{ padding: '10px', textAlign: 'center', fontSize: '11px', color: '#71717a' }}>
        모든 옵션이 이미 추가됐습니다
      </div>
    )}
  </div>
)}
```

- [ ] **Step 7: 저장 버튼 텍스트 수정**

쿠팡 탭의 저장 버튼:
```tsx
// 기존 버튼 텍스트 부분 찾아서 수정
// 쿠팡 탭에서 선택 수 표시
{mode === 'coupang' && selectedOptions.size > 0
  ? `${selectedOptions.size}개 옵션 추가`
  : '추가'}
```

- [ ] **Step 8: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit
```

예상: 에러 없음

- [ ] **Step 9: 커밋**

```bash
git add src/components/orders/AddProductModal.tsx
git commit -m "feat: AddProductModal 쿠팡 탭 다중 옵션 선택 + 부분 실패 처리"
```

---

## Task 4: CostManagementTab — 아코디언 그룹 렌더링

`CostManagementTab.tsx`에 그룹핑 로직과 아코디언 UI를 추가한다.

**Files:**
- Modify: `src/components/orders/CostManagementTab.tsx`

- [ ] **Step 1: import 추가**

`CostManagementTab.tsx` 상단 import에 추가:
```typescript
import { buildTableItems, type TableItem, type GroupRow } from '@/lib/cost-management/product-grouping';
```

- [ ] **Step 2: `expandedGroups` state 추가**

`const [search, setSearch] = useState('');` 바로 아래에 추가:
```typescript
const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

function toggleGroup(sellerProductId: string) {
  setExpandedGroups((prev) => {
    const next = new Set(prev);
    if (next.has(sellerProductId)) next.delete(sellerProductId);
    else next.add(sellerProductId);
    return next;
  });
}
```

- [ ] **Step 3: `filtered` 계산을 `tableItems`로 교체**

기존:
```typescript
const filtered = products
  .filter((p) => p.product_name.toLowerCase().includes(search.toLowerCase()))
  .sort((a, b) => b.sale_count - a.sale_count);
```

교체:
```typescript
const filteredProducts = products
  .filter((p) => p.product_name.toLowerCase().includes(search.toLowerCase()))
  .sort((a, b) => b.sale_count - a.sale_count);

const tableItems = React.useMemo(
  () => buildTableItems(filteredProducts),
  [filteredProducts],
);
```

- [ ] **Step 4: 그룹 행 렌더링 함수 추가**

`handleProductUpdate` 함수 아래에 추가:
```typescript
function renderGroupRow(group: GroupRow<ProductRow>) {
  const isExpanded = expandedGroups.has(group.sellerProductId);
  return (
    <React.Fragment key={`group-${group.sellerProductId}`}>
      {/* 부모 행 */}
      <tr
        style={{
          borderBottom: isExpanded ? 'none' : '2px solid #fca5a5',
          background: '#fff7f7',
          cursor: 'pointer',
          borderLeft: '3px solid #be0014',
        }}
        onClick={() => toggleGroup(group.sellerProductId)}
      >
        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
            <span style={{
              background: '#fef2f2', color: '#be0014',
              padding: '1px 5px', borderRadius: '3px',
              fontSize: '8px', fontWeight: 700,
            }}>
              쿠팡
            </span>
            <span style={{ color: '#52525b', fontSize: '10px', fontFamily: 'monospace' }}>
              {group.sellerProductId}
            </span>
          </div>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#18181b', marginBottom: '2px' }}>
            {group.productName}
          </div>
          <div style={{ fontSize: '10px', color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>{isExpanded ? '▴' : '▾'}</span>
            <span>옵션 {group.children.length}개</span>
          </div>
        </td>
        {/* 원가 — 재고 가중평균 */}
        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#52525b' }}>
          <div style={{ fontSize: '11px' }}>{fmt(Math.round(group.avgCost))}</div>
          <div style={{ fontSize: '8px', color: '#a1a1aa' }}>재고평균</div>
        </td>
        {/* 배송비 — 빈 칸 */}
        <td style={{ padding: '8px 12px' }} />
        {/* RG 배송비 — 빈 칸 */}
        <td style={{ padding: '8px 12px' }} />
        {/* 재고 합산 */}
        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#16a34a' }}>{fmt(group.totalStock)}</div>
          <div style={{ fontSize: '8px', color: '#a1a1aa' }}>합계</div>
        </td>
        {/* 재고가치 */}
        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '11px', color: '#52525b' }}>
          {fmt(Math.round(group.totalStockValue))}
        </td>
        {/* 실현손익 합산 */}
        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
          <div style={{
            fontSize: '11px', fontWeight: 600,
            color: group.totalProfit >= 0 ? '#16a34a' : '#ef4444',
          }}>
            {fmt(Math.round(group.totalProfit))}
          </div>
          <div style={{ fontSize: '8px', color: '#a1a1aa' }}>합계(기간)</div>
        </td>
        {/* 마진율 */}
        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '11px', color: '#16a34a' }}>
          {group.groupMarginRate.toFixed(1)}%
        </td>
        {/* 광고비, ROAS — 빈 칸 */}
        <td style={{ padding: '8px 12px' }} />
        <td style={{ padding: '8px 12px' }} />
        {/* 입고/판매 — 빈 칸 */}
        <td style={{ padding: '8px 12px' }} />
        <td style={{ padding: '8px 12px' }} />
        <td style={{ padding: '8px 12px' }} />
      </tr>
      {/* 자식 행들 (펼쳐진 경우) */}
      {isExpanded && group.children.map((p) => renderChildRow(p))}
      {/* 그룹 하단 구분선 */}
      {isExpanded && (
        <tr>
          <td colSpan={13} style={{ borderBottom: '2px solid #fca5a5', padding: 0 }} />
        </tr>
      )}
    </React.Fragment>
  );
}

function renderChildRow(p: ProductRow) {
  return (
    <tr
      key={p.id}
      style={{
        borderBottom: '1px solid #f4f4f5',
        background: '#fafafa',
        borderLeft: '3px solid #fca5a5',
      }}
    >
      <td style={{ padding: '6px 12px 6px 22px', textAlign: 'center', whiteSpace: 'nowrap' }}>
        {editChannelId === p.id ? (
          // 기존 editChannel UI (CostManagementTab.tsx:759-810 그대로)
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button onClick={() => setEditChannelId(null)} style={{ fontSize: '9px', color: '#71717a', background: 'none', border: 'none', cursor: 'pointer' }}>취소</button>
          </div>
        ) : (
          <ChannelCell
            product={p}
            onEditChannel={() => openEditChannel(p)}
            onProductUpdate={(updates) => handleProductUpdate(p.id, updates as Partial<ProductRow>)}
          />
        )}
      </td>
      <td style={{ padding: '6px 12px', fontWeight: 500, color: p.entry_count === 0 ? '#999' : '#18181b', fontSize: '11px' }}>
        {p.product_name}
      </td>
      <td style={{ padding: '6px 12px', textAlign: 'right', color: p.entry_count === 0 ? '#ccc' : '#ef4444', fontSize: '11px' }}>
        {p.entry_count === 0 ? '—' : fmt(p.weighted_avg_cost)}
      </td>
      <td style={{ padding: '6px 12px', textAlign: 'right', color: p.entry_count === 0 ? '#ccc' : '#f97316', fontSize: '11px' }}>
        {p.entry_count === 0 ? '—' : fmt(p.weighted_avg_shipping)}
      </td>
      <td style={{ padding: '6px 12px', textAlign: 'right', color: p.weighted_avg_rg_shipping > 0 ? '#0369a1' : '#ccc', fontSize: '11px' }}>
        {p.weighted_avg_rg_shipping > 0 ? fmt(p.weighted_avg_rg_shipping) : '—'}
      </td>
      <td style={{ padding: '6px 12px', textAlign: 'right', color: '#18181b', fontSize: '11px' }}>{fmt(p.current_stock)}</td>
      <td style={{ padding: '6px 12px', textAlign: 'right', color: '#18181b', fontSize: '11px' }}>{fmt(Math.round(p.stock_value))}</td>
      <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: '11px', color: p.total_realized_profit >= 0 ? '#16a34a' : '#ef4444', fontWeight: 600 }}>
        {fmt(Math.round(p.total_realized_profit))}
      </td>
      <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: '11px', color: p.margin_rate >= 0 ? '#16a34a' : '#ef4444' }}>
        {p.margin_rate.toFixed(1)}%
      </td>
      {/* 광고비, ROAS, 입고/판매/보기 버튼은 기존 filtered.map 로직과 동일하게 복사 */}
      <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: '11px', color: '#52525b' }}>—</td>
      <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: '11px', color: '#52525b' }}>—</td>
      <td style={{ padding: '6px 12px', textAlign: 'right' }} />
      <td style={{ padding: '6px 12px', textAlign: 'right' }} />
      <td style={{ padding: '6px 12px' }}>
        <button
          onClick={() => setDetailProduct(p)}
          style={{ padding: '2px 6px', fontSize: '10px', background: '#f4f4f5', color: '#71717a', border: '1px solid #e4e4e7', borderRadius: '3px', cursor: 'pointer' }}
        >
          보기
        </button>
      </td>
    </tr>
  );
}
```

> **주의:** 실제 컬럼 수는 CostManagementTab.tsx의 `<thead>` 확인 후 `colSpan`과 `<td>` 수를 맞출 것.

- [ ] **Step 5: `filtered.map` → `tableItems` 기반 렌더링으로 교체**

기존:
```typescript
{filtered.map((p) => (
  <tr key={p.id} ...>
    ...
  </tr>
))}
```

교체:
```typescript
{tableItems.map((item) =>
  item.kind === 'group'
    ? renderGroupRow(item)
    : <tr key={item.product.id} style={{ borderBottom: '1px solid #f0f0f0', background: '#fff' }}>
        {/* 기존 filtered.map 내부의 tr 내용 그대로 (item.product로 변수명 변경) */}
        ...
      </tr>
)}
```

> **주의:** 기존 `filtered.map((p) => ...)` 블록을 통째로 복사해 `p` → `item.product`로 일괄 치환. 기존 코드를 완전히 삭제하지 말고 standalone row 렌더링에 재활용.

- [ ] **Step 6: TypeScript 컴파일 + 기존 테스트 통과 확인**

```bash
npx tsc --noEmit
npx vitest run src/__tests__/lib/product-grouping.test.ts src/__tests__/api/coupang-product-options.test.ts
```

예상: 에러 없음, 테스트 모두 PASS

- [ ] **Step 7: 커밋**

```bash
git add src/components/orders/CostManagementTab.tsx
git commit -m "feat: CostManagementTab 아코디언 그룹핑 렌더링 추가"
```

---

## Task 5: 통합 확인 및 최종 테스트

브라우저에서 전체 기능 동작을 확인한다.

**확인 항목:**

- [ ] **Step 1: dev 서버 기동**

```bash
npm run dev
```

- [ ] **Step 2: 브라우저 확인 체크리스트**

비용관리 탭(`/cost-management` 또는 해당 탭) 에서:

1. `seller_product_id`가 동일한 상품 2개 이상 → 부모 행으로 묶여 표시되는지
2. 부모 행 클릭 → 펼침/접힘 토글 동작
3. 부모 행 집계: 재고 합산, 손익 합산, 마진율 Σprofit/Σsales 방식 표시
4. 옵션 1개짜리 그룹 → standalone으로 표시 (아코디언 없음)
5. "상품 추가" → 쿠팡 탭 → 상품 선택 → 옵션 목록에 `이미 추가됨`/`미추가` 배지 표시
6. 미추가 옵션 다중 체크 → "N개 옵션 추가" 버튼 활성화 → 추가 후 테이블 갱신

- [ ] **Step 3: 전체 테스트 통과**

```bash
npx vitest run src/__tests__/lib/product-grouping.test.ts \
              src/__tests__/api/coupang-product-options.test.ts
```

예상: 모두 PASS

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git status  # 불필요한 파일 없는지 확인
git commit -m "feat: 상품 그룹핑 & 스마트 추가 플로우 완료"
```

---

## 자가 검토

**스펙 커버리지:**
- ✅ 섹션 2: `buildTableItems` 유틸 함수 (Task 1)
- ✅ 섹션 3: 아코디언 UI `renderGroupRow` / `renderChildRow` (Task 4)
- ✅ 섹션 4: 다중 체크박스 + 부분 실패 `Promise.allSettled` (Task 3)
- ✅ 섹션 5: `coupang-product-options` API 확장 (Task 2)
- ✅ 옵션 1개 그룹 평탄화 (Task 1 `buildTableItems`)
- ✅ 모든 옵션 추가됨 안내 (Task 3 Step 6)
- ✅ `platform_fee_rate: Number(feeRate) / 100` (Task 3 Step 4)

**누락 없음.** 검색 필터(`filtered` 계산 내 search 포함), 정렬(`sale_count DESC`)은 기존 로직 유지.
