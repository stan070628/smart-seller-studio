# 코스트코 재고 인라인 확인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내 상품 조회(BrowseMode) 테이블에서 소싱 출처가 코스트코 온라인 URL인 상품의 재고 상태(재고있음/재고부족/품절)를 소싱 배지 아래에 인라인으로 표시하고, DB 캐시(6시간) + 수동 새로고침 버튼을 제공한다.

**Architecture:** product_sourcing 테이블에 costco_stock_status / costco_stock_checked_at 컬럼을 추가하고, 기존 GET /api/listing/sourcing 응답에 두 필드를 포함시킨다. 새로운 POST /api/listing/sourcing/check-costco-stock 라우트가 코스트코 URL에서 상품코드를 추출해 /api/sourcing/costco/lookup을 호출한 뒤 DB를 업데이트한다. SourcingBadge 컴포넌트가 상태를 표시하고 stale 감지 시 백그라운드 재확인을 트리거한다.

**Tech Stack:** Next.js App Router, node-postgres(pg), Zustand, Vitest, React 18

---

## 파일 구조

| Action | Path | Role |
|--------|------|------|
| DB 마이그레이션 | `product_sourcing` 테이블 | costco_stock_status, costco_stock_checked_at 컬럼 추가 |
| Modify | `src/app/api/sourcing/costco/lookup/route.ts` | LookupResult에 stockStatus 추가 + rowToResult/apiProductToLookupResult 매핑 |
| Modify | `src/app/api/listing/sourcing/route.ts` | GET SQL + 응답에 stock 필드 추가 |
| Create | `src/app/api/listing/sourcing/check-costco-stock/route.ts` | 단일 상품 재고 확인 + DB 업데이트 엔드포인트 |
| Modify | `src/store/useListingStore.ts` | sourcingMap 타입 확장 + checkCostcoStock 액션 |
| Modify | `src/components/listing/browse/BrowseMode.tsx` | SourcingBadge에 재고 배지 + 🔄 버튼 + outOfStock 행 강조 |
| Create | `src/__tests__/api/listing-sourcing-costco-stock.test.ts` | check-costco-stock route 단위 테스트 |

---

## Task 1: DB 마이그레이션

**Files:**
- (DB 직접 실행 — 파일 변경 없음)

- [ ] **Step 1: .env.local에서 SOURCING_DATABASE_URL 확인**

```bash
grep SOURCING_DATABASE_URL /Users/seungminlee/Desktop/projects/smart_seller_studio/.env.local
```

기대 출력: `SOURCING_DATABASE_URL=postgresql://...`

- [ ] **Step 2: 컬럼 추가 마이그레이션 실행**

```bash
psql "$SOURCING_DATABASE_URL" -c "
ALTER TABLE product_sourcing
  ADD COLUMN IF NOT EXISTS costco_stock_status TEXT
    CHECK (costco_stock_status IN ('inStock', 'outOfStock', 'lowStock')),
  ADD COLUMN IF NOT EXISTS costco_stock_checked_at TIMESTAMPTZ;
"
```

기대 출력: `ALTER TABLE`

- [ ] **Step 3: 컬럼 추가 확인**

```bash
psql "$SOURCING_DATABASE_URL" -c "\d product_sourcing"
```

기대 출력: `costco_stock_status`, `costco_stock_checked_at` 컬럼이 목록에 표시됨

---

## Task 2: lookup route에 stockStatus 추가

**Files:**
- Modify: `src/app/api/sourcing/costco/lookup/route.ts`

`LookupResult` 인터페이스에 `stockStatus`가 없어서 재고 정보를 아예 반환하지 않는 버그를 수정한다. `CostcoApiProduct`(types/costco.ts:94)와 `CostcoProductRow`(types/costco.ts:129) 모두 해당 필드를 가지고 있다.

- [ ] **Step 1: LookupResult 인터페이스에 stockStatus 추가**

`src/app/api/sourcing/costco/lookup/route.ts`의 `LookupResult` 인터페이스를 아래와 같이 수정한다 (기존 `baseUnit` 필드 아래에 추가):

```ts
export interface LookupResult {
  source: 'db' | 'api';
  productCode: string;
  title: string;
  imageUrl: string | null;
  categoryName: string | null;
  onlinePrice: number;
  averageRating: number | null;
  reviewCount: number;
  unitPriceLabel: string | null;
  unitPrice: number | null;
  marketLowestPrice: number | null;
  marketUnitPrice: number | null;
  productUrl: string;
  unitType: 'weight' | 'volume' | 'count' | null;
  totalQuantity: number | null;
  baseUnit: string | null;
  stockStatus: 'inStock' | 'outOfStock' | 'lowStock';  // 신규
}
```

- [ ] **Step 2: rowToResult에 stock_status 매핑 추가**

`rowToResult` 함수 끝에 `stockStatus` 필드 추가:

```ts
function rowToResult(row: CostcoProductRow): LookupResult {
  return {
    source: 'db',
    productCode: row.product_code,
    title: row.title,
    imageUrl: row.image_url,
    categoryName: row.category_name,
    onlinePrice: row.price,
    averageRating: row.average_rating ? parseFloat(row.average_rating) : null,
    reviewCount: row.review_count,
    unitPriceLabel: row.unit_price_label ?? null,
    unitPrice: row.unit_price ?? null,
    marketLowestPrice: row.market_lowest_price,
    marketUnitPrice: row.market_unit_price ?? null,
    productUrl: row.product_url,
    unitType: row.unit_type ?? null,
    totalQuantity: row.total_quantity ?? null,
    baseUnit: null,
    stockStatus: row.stock_status ?? 'inStock',  // 신규
  };
}
```

- [ ] **Step 3: apiProductToLookupResult에 stockStatus 매핑 추가**

```ts
function apiProductToLookupResult(product: CostcoApiProduct): LookupResult {
  return {
    source: 'api',
    productCode: product.productCode,
    title: product.title,
    imageUrl: product.imageUrl ?? null,
    categoryName: product.categoryName,
    onlinePrice: product.price,
    averageRating: product.averageRating ?? null,
    reviewCount: product.reviewCount,
    unitPriceLabel: null,
    unitPrice: null,
    marketLowestPrice: null,
    marketUnitPrice: null,
    productUrl: product.productUrl,
    unitType: null,
    totalQuantity: null,
    baseUnit: null,
    stockStatus: product.stockStatus,  // 신규
  };
}
```

- [ ] **Step 4: 타입 체크**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx tsc --noEmit 2>&1 | grep "lookup"
```

기대 출력: 오류 없음 (빈 출력)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/sourcing/costco/lookup/route.ts
git commit -m "fix(costco/lookup): LookupResult에 stockStatus 추가"
```

---

## Task 3: GET /api/listing/sourcing — stock 필드 반환

**Files:**
- Modify: `src/app/api/listing/sourcing/route.ts`

- [ ] **Step 1: 테스트 파일에 stock 필드 테스트 추가**

`src/__tests__/api/listing-sourcing.test.ts`의 기존 `'ids 배치 조회 후 map 반환'` 테스트 아래에 추가:

```ts
it('코스트코 소싱 상품은 stock 필드를 포함해 반환', async () => {
  mockQuery.mockResolvedValueOnce({
    rows: [
      {
        product_id: '333',
        sourcing_type: 'online',
        sourcing_value: 'https://www.costco.co.kr/p/1234567',
        costco_stock_status: 'outOfStock',
        costco_stock_checked_at: '2026-06-20T10:00:00Z',
      },
    ],
  });
  const req = new NextRequest('http://localhost/api/listing/sourcing?platform=coupang&ids=333');
  const res = await GET(req);
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.sourcing['333']).toEqual({
    type: 'online',
    value: 'https://www.costco.co.kr/p/1234567',
    costcoStockStatus: 'outOfStock',
    costcoStockCheckedAt: '2026-06-20T10:00:00Z',
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx vitest run src/__tests__/api/listing-sourcing.test.ts 2>&1 | tail -20
```

기대 출력: `costcoStockStatus` 관련 테스트 실패

- [ ] **Step 3: GET 핸들러 SQL + 응답 수정**

`src/app/api/listing/sourcing/route.ts`의 GET 핸들러에서 SQL과 응답 매핑을 수정한다:

```ts
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const sp = request.nextUrl.searchParams;
  const platform = sp.get('platform') ?? '';
  const idsRaw = sp.get('ids') ?? '';
  const ids = idsRaw.split(',').map((s) => s.trim()).filter(Boolean);

  if (!platform) return Response.json({ sourcing: {} });
  if (ids.length === 0) return Response.json({ sourcing: {} });

  try {
    const pool = getSourcingPool();
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
    const result = await pool.query(
      `SELECT product_id, sourcing_type, sourcing_value,
              costco_stock_status, costco_stock_checked_at
       FROM product_sourcing
       WHERE platform = $1 AND product_id IN (${placeholders})`,
      [platform, ...ids],
    );

    const sourcing: Record<string, {
      type: string;
      value: string;
      costcoStockStatus?: string | null;
      costcoStockCheckedAt?: string | null;
    }> = {};
    for (const row of result.rows) {
      sourcing[row.product_id] = {
        type: row.sourcing_type,
        value: row.sourcing_value,
        costcoStockStatus: row.costco_stock_status ?? null,
        costcoStockCheckedAt: row.costco_stock_checked_at
          ? (row.costco_stock_checked_at as Date).toISOString()
          : null,
      };
    }

    return Response.json({ sourcing });
  } catch (err) {
    console.error('[sourcing] GET error:', err);
    return Response.json({ success: false, error: '소싱 조회 실패' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx vitest run src/__tests__/api/listing-sourcing.test.ts 2>&1 | tail -10
```

기대 출력: `Tests X passed`

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/listing/sourcing/route.ts src/__tests__/api/listing-sourcing.test.ts
git commit -m "feat(sourcing): GET 응답에 costcoStockStatus/costcoStockCheckedAt 포함"
```

---

## Task 4: POST /api/listing/sourcing/check-costco-stock

**Files:**
- Create: `src/app/api/listing/sourcing/check-costco-stock/route.ts`
- Create: `src/__tests__/api/listing-sourcing-costco-stock.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

`src/__tests__/api/listing-sourcing-costco-stock.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

const mockQuery = vi.fn();
vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query: mockQuery }),
}));

const mockGet = vi.fn();
vi.mock('@/app/api/sourcing/costco/lookup/route', () => ({
  GET: mockGet,
}));

import { POST } from '@/app/api/listing/sourcing/check-costco-stock/route';

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe('POST /api/listing/sourcing/check-costco-stock', () => {
  it('인증 실패 시 401 반환', async () => {
    const { requireAuth } = await import('@/lib/supabase/auth');
    vi.mocked(requireAuth).mockResolvedValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 401 }) as never,
    );
    const req = new NextRequest('http://localhost/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      body: JSON.stringify({ platform: 'coupang', productId: '111', sourcingUrl: 'https://www.costco.co.kr/p/1234567' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('sourcingUrl 누락 시 400 반환', async () => {
    const req = new NextRequest('http://localhost/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      body: JSON.stringify({ platform: 'coupang', productId: '111' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('코스트코 URL이 아닌 경우 400 반환', async () => {
    const req = new NextRequest('http://localhost/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      body: JSON.stringify({ platform: 'coupang', productId: '111', sourcingUrl: 'https://detail.1688.com/xxx' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/코스트코/);
  });

  it('상품코드 추출 실패 시 422 반환', async () => {
    const req = new NextRequest('http://localhost/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      body: JSON.stringify({ platform: 'coupang', productId: '111', sourcingUrl: 'https://www.costco.co.kr/category' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it('lookup 성공 → DB 업데이트 → { status, checkedAt } 반환', async () => {
    mockGet.mockResolvedValueOnce(
      Response.json({ stockStatus: 'inStock', productCode: '1234567' }),
    );
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DB UPDATE

    const req = new NextRequest('http://localhost/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      body: JSON.stringify({ platform: 'coupang', productId: '111', sourcingUrl: 'https://www.costco.co.kr/p/1234567' }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe('inStock');
    expect(json.checkedAt).toBeTruthy();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE product_sourcing'),
      expect.arrayContaining(['inStock', 'coupang', '111']),
    );
  });

  it('lookup 404 → DB 업데이트 안 함, 422 반환', async () => {
    mockGet.mockResolvedValueOnce(Response.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 }));
    const req = new NextRequest('http://localhost/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      body: JSON.stringify({ platform: 'coupang', productId: '111', sourcingUrl: 'https://www.costco.co.kr/p/9999999' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('lookup 5xx → DB 업데이트 안 함, 502 반환', async () => {
    mockGet.mockResolvedValueOnce(Response.json({ error: 'API 조회 실패' }, { status: 500 }));
    const req = new NextRequest('http://localhost/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      body: JSON.stringify({ platform: 'coupang', productId: '111', sourcingUrl: 'https://www.costco.co.kr/p/1234567' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(502);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx vitest run src/__tests__/api/listing-sourcing-costco-stock.test.ts 2>&1 | tail -10
```

기대 출력: `Cannot find module` 또는 `POST is not a function` 오류

- [ ] **Step 3: route 구현**

`src/app/api/listing/sourcing/check-costco-stock/route.ts` 신규 생성:

```ts
/**
 * POST /api/listing/sourcing/check-costco-stock
 * 코스트코 소싱 URL로 단일 상품 재고 상태를 확인하고 product_sourcing 테이블을 업데이트한다.
 *
 * Body: { platform: 'coupang' | 'naver'; productId: string; sourcingUrl: string }
 * Response: { status: 'inStock' | 'outOfStock' | 'lowStock'; checkedAt: string }
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { GET as lookupGet } from '@/app/api/sourcing/costco/lookup/route';
import type { LookupResult } from '@/app/api/sourcing/costco/lookup/route';

export const runtime = 'nodejs';
export const maxDuration = 20;

/** 코스트코 URL에서 5~10자리 상품코드 추출 (lookup route Zod schema와 동일 범위) */
function extractCostcoCode(url: string): string | null {
  const m = url.match(/costco\.co\.kr\/.*?(\d{5,10})/);
  return m ? m[1] : null;
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = await request.json() as {
    platform?: string;
    productId?: string;
    sourcingUrl?: string;
  };

  const { platform, productId, sourcingUrl } = body;

  if (!platform || !productId || !sourcingUrl) {
    return Response.json({ error: 'platform, productId, sourcingUrl 필드가 필요합니다.' }, { status: 400 });
  }

  if (!sourcingUrl.includes('costco.co.kr')) {
    return Response.json({ error: '코스트코 URL이 아닙니다.' }, { status: 400 });
  }

  const code = extractCostcoCode(sourcingUrl);
  if (!code) {
    return Response.json({ error: '상품코드를 URL에서 추출할 수 없습니다.' }, { status: 422 });
  }

  // /api/sourcing/costco/lookup 내부 호출
  const lookupReq = new NextRequest(
    `http://localhost/api/sourcing/costco/lookup?code=${code}`,
    { headers: request.headers },
  );
  const lookupRes = await lookupGet(lookupReq);

  if (!lookupRes.ok) {
    if (lookupRes.status === 404) {
      return Response.json({ error: '코스트코에서 상품을 찾을 수 없습니다.' }, { status: 422 });
    }
    return Response.json({ error: '코스트코 API 조회 실패' }, { status: 502 });
  }

  const data = await lookupRes.json() as LookupResult;
  const stockStatus = data.stockStatus;
  const checkedAt = new Date().toISOString();

  // DB 업데이트
  try {
    const pool = getSourcingPool();
    await pool.query(
      `UPDATE product_sourcing
       SET costco_stock_status = $1, costco_stock_checked_at = $2
       WHERE platform = $3 AND product_id = $4`,
      [stockStatus, checkedAt, platform, productId],
    );
  } catch (err) {
    console.error('[check-costco-stock] DB 업데이트 실패:', err);
    return Response.json({ error: 'DB 업데이트 실패' }, { status: 500 });
  }

  return Response.json({ status: stockStatus, checkedAt });
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx vitest run src/__tests__/api/listing-sourcing-costco-stock.test.ts 2>&1 | tail -10
```

기대 출력: `Tests 7 passed`

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/listing/sourcing/check-costco-stock/route.ts src/__tests__/api/listing-sourcing-costco-stock.test.ts
git commit -m "feat: check-costco-stock 엔드포인트 추가 (재고 확인 + DB 업데이트)"
```

---

## Task 5: useListingStore — 타입 확장 + checkCostcoStock 액션

**Files:**
- Modify: `src/store/useListingStore.ts`

- [ ] **Step 1: SourcingEntry 타입 정의 + sourcingMap 타입 교체**

`src/store/useListingStore.ts`의 `ListingStore` 인터페이스에서 `sourcingMap` 타입을 수정한다.

파일 상단(imports 아래)에 타입 추가:

```ts
// ─── 소싱 출처 타입 ────────────────────────────────────────────────────────────
export type SourcingEntry = {
  type: 'online' | 'offline';
  value: string;
  costcoStockStatus?: 'inStock' | 'outOfStock' | 'lowStock' | null;
  costcoStockCheckedAt?: string | null;
};
```

`ListingStore` 인터페이스에서 `sourcingMap` 타입 변경:

```ts
// 변경 전
sourcingMap: Record<string, { type: 'online' | 'offline'; value: string } | null>;

// 변경 후
sourcingMap: Record<string, SourcingEntry | null>;
```

`checkCostcoStock` 액션 시그니처 추가 (deleteSourcing 아래):

```ts
checkCostcoStock: (
  platform: 'coupang' | 'naver',
  productId: string,
  sourcingUrl: string,
) => Promise<'inStock' | 'outOfStock' | 'lowStock' | null>;
```

- [ ] **Step 2: fetchSourcing 응답 매핑 수정**

`fetchSourcing` 액션에서 API 응답을 `SourcingEntry`로 매핑하도록 수정:

```ts
fetchSourcing: async (platform, ids) => {
  if (ids.length === 0) return;
  try {
    const res = await fetch(
      `/api/listing/sourcing?platform=${platform}&ids=${ids.join(',')}`,
    );
    const json = await res.json();
    if (!res.ok) return;
    set((s) => ({
      sourcingMap: {
        ...s.sourcingMap,
        ...Object.fromEntries(
          Object.entries(
            (json.sourcing ?? {}) as Record<string, {
              type: 'online' | 'offline';
              value: string;
              costcoStockStatus?: string | null;
              costcoStockCheckedAt?: string | null;
            }>
          ).map(([id, val]) => [
            `${platform}:${id}`,
            {
              type: val.type,
              value: val.value,
              costcoStockStatus: (val.costcoStockStatus as SourcingEntry['costcoStockStatus']) ?? null,
              costcoStockCheckedAt: val.costcoStockCheckedAt ?? null,
            } satisfies SourcingEntry,
          ]),
        ),
      },
    }), false, 'listing/fetchSourcing');
  } catch {
    // 소싱 조회 실패는 조용히 무시
  }
},
```

- [ ] **Step 3: checkCostcoStock 액션 구현**

`deleteSourcing` 액션 아래에 추가:

```ts
checkCostcoStock: async (platform, productId, sourcingUrl) => {
  const key = `${platform}:${productId}`;
  try {
    const res = await fetch('/api/listing/sourcing/check-costco-stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, productId, sourcingUrl }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { status: 'inStock' | 'outOfStock' | 'lowStock'; checkedAt: string };
    set((s) => {
      const existing = s.sourcingMap[key];
      if (!existing) return {};
      return {
        sourcingMap: {
          ...s.sourcingMap,
          [key]: { ...existing, costcoStockStatus: json.status, costcoStockCheckedAt: json.checkedAt },
        },
      };
    }, false, 'listing/checkCostcoStock');
    return json.status;
  } catch {
    return null;
  }
},
```

- [ ] **Step 4: 타입 체크**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx tsc --noEmit 2>&1 | grep "useListingStore\|SourcingEntry\|sourcingMap" | head -10
```

기대 출력: 오류 없음 (빈 출력)

- [ ] **Step 5: 커밋**

```bash
git add src/store/useListingStore.ts
git commit -m "feat(store): SourcingEntry 타입 확장 + checkCostcoStock 액션 추가"
```

---

## Task 6: SourcingBadge UI — 재고 배지 + 🔄 버튼 + 품절 행 강조

**Files:**
- Modify: `src/components/listing/browse/BrowseMode.tsx`

- [ ] **Step 1: SourcingBadge Props 확장 + 재고 배지 렌더링 추가**

`SourcingBadge` 컴포넌트 전체를 아래로 교체한다. 주요 변경:
- `checkCostcoStock` 액션 사용
- `useRef<Set<string>>`으로 중복 요청 방지
- 6시간 stale 감지 후 백그라운드 재확인
- 재고 상태 배지 렌더링

```tsx
// ─── 재고 상태 배지 상수 ──────────────────────────────────────────────────────
const STOCK_BADGE: Record<
  'inStock' | 'outOfStock' | 'lowStock',
  { label: string; bg: string; color: string; border: string }
> = {
  inStock:    { label: '✓ 재고있음', bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  lowStock:   { label: '⚡ 재고부족', bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
  outOfStock: { label: '⚠ 코스트코 품절', bg: '#fee2e2', color: '#b91c1c', border: '#fecaca' },
};

const STALE_MS = 6 * 60 * 60 * 1000; // 6시간

function isCostcoUrl(value: string) {
  return value.includes('costco.co.kr');
}

function formatCheckedAt(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  return `${Math.floor(hrs / 24)}일 전`;
}

// ─── 소싱 배지 ────────────────────────────────────────────────────────────────
interface SourcingBadgeProps {
  platform: 'coupang' | 'naver';
  productId: string;
  productName?: string;
}

function SourcingBadge({ platform, productId, productName }: SourcingBadgeProps) {
  const { sourcingMap, checkCostcoStock } = useListingStore();
  const [open, setOpen] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const checkingRef = React.useRef<Set<string>>(new Set());
  const key = `${platform}:${productId}`;
  const sourcing = sourcingMap[key] ?? null;

  const isCostco = sourcing?.type === 'online' && isCostcoUrl(sourcing.value);
  const stockStatus = isCostco ? (sourcing?.costcoStockStatus ?? null) : null;
  const checkedAt = isCostco ? (sourcing?.costcoStockCheckedAt ?? null) : null;

  // stale 감지 + 자동 백그라운드 재확인
  React.useEffect(() => {
    if (!isCostco || !sourcing?.value) return;
    const isStale = !checkedAt || Date.now() - new Date(checkedAt).getTime() > STALE_MS;
    if (!isStale) return;
    if (checkingRef.current.has(key)) return;

    checkingRef.current.add(key);
    checkCostcoStock(platform, productId, sourcing.value).finally(() => {
      checkingRef.current.delete(key);
    });
  }, [key, isCostco, checkedAt, platform, productId, sourcing?.value, checkCostcoStock]);

  const handleRefresh = async () => {
    if (!sourcing?.value || checkingRef.current.has(key)) return;
    checkingRef.current.add(key);
    setChecking(true);
    await checkCostcoStock(platform, productId, sourcing.value);
    setChecking(false);
    checkingRef.current.delete(key);
  };

  const badgeStyle: React.CSSProperties = sourcing
    ? sourcing.type === 'online'
      ? { background: '#e0f2fe', color: '#0369a1' }
      : { background: '#f0fdf4', color: '#15803d' }
    : { background: '#f9f9f9', color: '#aaa', border: '1px dashed #ddd' };

  const badgeLabel = sourcing
    ? sourcing.type === 'online'
      ? `🌐 ${getOnlineLabel(sourcing.value)}`
      : `🏪 ${sourcing.value}`
    : '＋ 소싱 출처';

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '3px 9px',
          borderRadius: '100px',
          fontSize: '11px',
          fontWeight: sourcing ? 700 : 400,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          border: 'none',
          ...badgeStyle,
        }}
      >
        {badgeLabel}
      </button>

      {/* 코스트코 재고 상태 배지 */}
      {isCostco && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
          {stockStatus ? (
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '100px',
                border: `1px solid ${STOCK_BADGE[stockStatus].border}`,
                background: STOCK_BADGE[stockStatus].bg,
                color: STOCK_BADGE[stockStatus].color,
                whiteSpace: 'nowrap',
              }}
            >
              {STOCK_BADGE[stockStatus].label}
              {checkedAt && (
                <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: '4px' }}>
                  · {formatCheckedAt(checkedAt)}
                </span>
              )}
            </span>
          ) : (
            <span style={{ fontSize: '10px', color: '#9ca3af' }}>
              {checking ? '확인 중...' : '미확인'}
            </span>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={checking}
            title="코스트코 재고 재확인"
            style={{
              background: 'none',
              border: 'none',
              cursor: checking ? 'not-allowed' : 'pointer',
              fontSize: '11px',
              color: checking ? '#d1d5db' : '#9ca3af',
              padding: '0 2px',
              lineHeight: 1,
            }}
          >
            🔄
          </button>
        </div>
      )}

      {open && (
        <SourcingPopover
          platform={platform}
          productId={productId}
          productName={productName}
          current={sourcing ? { type: sourcing.type, value: sourcing.value } : null}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: outOfStock 행 배경 강조 추가 (쿠팡 테이블)**

BrowseMode.tsx에서 쿠팡 상품 행을 렌더하는 `<tr>` 또는 `<div>` 에 배경색 조건 추가.

`SourcingBadge`가 있는 쿠팡 행(line ~748 근처)에서 해당 행의 컨테이너를 감싸는 style에 추가:

```tsx
// 쿠팡 행: p.sellerProductId 기준
// sourcing이 코스트코 outOfStock이면 행 배경 강조
const coupangSourcingKey = `coupang:${String(p.sellerProductId)}`;
const coupangSourcing = sourcingMap[coupangSourcingKey];
const isOutOfStock = coupangSourcing?.costcoStockStatus === 'outOfStock';

// 행 style에 추가:
// background: isOutOfStock ? '#fff5f5' : undefined
```

네이버 행에도 동일하게 적용 (`naver:${String(p.originProductNo)}`).

- [ ] **Step 3: 타입 체크**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx tsc --noEmit 2>&1 | grep "BrowseMode\|SourcingBadge" | head -10
```

기대 출력: 오류 없음 (빈 출력)

- [ ] **Step 4: 전체 테스트 실행**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx vitest run src/__tests__/api/listing-sourcing.test.ts src/__tests__/api/listing-sourcing-costco-stock.test.ts 2>&1 | tail -10
```

기대 출력: 모든 테스트 통과

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/browse/BrowseMode.tsx
git commit -m "feat(BrowseMode): SourcingBadge 코스트코 재고 배지 + 🔄 버튼 + 품절 행 강조"
```
