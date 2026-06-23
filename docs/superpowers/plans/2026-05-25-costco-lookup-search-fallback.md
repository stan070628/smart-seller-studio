# 코스트코 Lookup OCC Search 폴백 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코스트코 상품코드 조회 시 DB·OCC product detail 모두 실패하면 OCC search API로 3단계 폴백해 상품을 찾고 DB에 자동 저장한다.

**Architecture:** `upsertProduct` 함수를 공유 모듈(`costco-upsert.ts`)로 추출한 뒤, `costco-client.ts`에 `fetchCostcoProductBySearch`를 추가하고, `lookup/route.ts`에 search 폴백 step을 삽입한다.

**Tech Stack:** Next.js App Router API Routes, TypeScript, pg (PostgreSQL), Vitest

---

## 파일 목록

| 파일 | 변경 |
|---|---|
| `src/lib/sourcing/costco-upsert.ts` | 신규 생성 — `upsertCostcoProduct` 공유 함수 |
| `src/lib/sourcing/costco-client.ts` | `fetchCostcoProductBySearch` 추가 |
| `src/app/api/sourcing/costco/route.ts` | `upsertProduct` 제거 → `upsertCostcoProduct` import |
| `src/app/api/sourcing/costco/lookup/route.ts` | Step 3 추가, `apiProductToLookupResult` 헬퍼 추가 |
| `src/__tests__/api/costco-lookup-handler.test.ts` | search fallback 케이스 3개 추가 |

---

## Task 1: `costco-upsert.ts` 공유 모듈 생성

**Files:**
- Create: `src/lib/sourcing/costco-upsert.ts`
- Modify: `src/app/api/sourcing/costco/route.ts`

- [ ] **Step 1: `costco-upsert.ts` 파일 생성**

`src/lib/sourcing/costco-upsert.ts` 파일을 아래 내용으로 생성한다. 이 코드는 현재 `route.ts`의 `upsertProduct` 함수와 동일하다:

```typescript
import type { Pool } from 'pg';
import type { CostcoApiProduct } from '@/types/costco';
import { parseProductUnit } from './unit-parser';

export async function upsertCostcoProduct(pool: Pool, product: CostcoApiProduct): Promise<void> {
  const unitResult = parseProductUnit(product.title);
  const unitType       = unitResult.success ? unitResult.parsed.unitType       : null;
  const totalQuantity  = unitResult.success ? unitResult.parsed.totalQuantity  : null;
  const baseUnit       = unitResult.success ? unitResult.parsed.baseUnit       : null;
  const unitPriceLabel = unitResult.success ? unitResult.parsed.unitPriceLabel : null;
  const unitPrice =
    unitResult.success && totalQuantity && totalQuantity > 0
      ? Math.round((product.price / totalQuantity) * unitResult.parsed.unitPriceDivisor * 100) / 100
      : null;

  await pool.query(
    `INSERT INTO public.costco_products
       (product_code, title, category_name, category_code, price, original_price,
        image_url, product_url, brand,
        average_rating, review_count, stock_status,
        first_price, lowest_price,
        unit_type, total_quantity, base_unit, unit_price, unit_price_label,
        is_active, collected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$5,$5,$13,$14,$15,$16,$17,true,now())
     ON CONFLICT (product_code) DO UPDATE SET
       title            = EXCLUDED.title,
       category_name    = EXCLUDED.category_name,
       category_code    = EXCLUDED.category_code,
       price            = EXCLUDED.price,
       original_price   = EXCLUDED.original_price,
       image_url        = EXCLUDED.image_url,
       product_url      = EXCLUDED.product_url,
       brand            = EXCLUDED.brand,
       average_rating   = EXCLUDED.average_rating,
       review_count     = EXCLUDED.review_count,
       stock_status     = EXCLUDED.stock_status,
       first_price      = COALESCE(costco_products.first_price, EXCLUDED.price),
       lowest_price     = LEAST(COALESCE(costco_products.lowest_price, EXCLUDED.price), EXCLUDED.price),
       unit_type        = EXCLUDED.unit_type,
       total_quantity   = EXCLUDED.total_quantity,
       base_unit        = EXCLUDED.base_unit,
       unit_price       = EXCLUDED.unit_price,
       unit_price_label = EXCLUDED.unit_price_label,
       is_active        = true,
       collected_at     = now(),
       updated_at       = now()`,
    [
      product.productCode,
      product.title,
      product.categoryName,
      product.categoryCode,
      product.price,
      product.originalPrice ?? null,
      product.imageUrl ?? null,
      product.productUrl,
      product.brand ?? null,
      product.averageRating ?? null,
      product.reviewCount,
      product.stockStatus,
      unitType,
      totalQuantity,
      baseUnit,
      unitPrice,
      unitPriceLabel,
    ],
  );
}
```

- [ ] **Step 2: `route.ts`에서 `upsertProduct` 제거 후 import로 교체**

`src/app/api/sourcing/costco/route.ts` 파일을 수정한다.

파일 상단 import 블록에 추가:
```typescript
import { upsertCostcoProduct } from '@/lib/sourcing/costco-upsert';
```

`parseProductUnit` import 줄을 제거한다 (costco-upsert.ts로 이동했으므로):
```typescript
// 제거:
import { parseProductUnit } from '@/lib/sourcing/unit-parser';
```

POST 핸들러 내부의 `for (const product of result.products)` 루프를 수정:
```typescript
// 변경 전:
for (const product of result.products) {
  await upsertProduct(pool, product);
}

// 변경 후:
for (const product of result.products) {
  await upsertCostcoProduct(pool, product);
}
```

파일 하단의 `async function upsertProduct(pool: Pool, product: CostcoApiProduct)` 함수 전체(약 55줄)를 삭제한다.  
(`upsertCostcoProduct`로 대체됐으므로)

- [ ] **Step 3: TypeScript 컴파일 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep -E "costco-upsert|route\.ts" | head -20
```

오류 없으면 다음 단계 진행.

- [ ] **Step 4: 커밋**

```bash
git add src/lib/sourcing/costco-upsert.ts src/app/api/sourcing/costco/route.ts
git commit -m "refactor: upsertProduct를 costco-upsert.ts 공유 모듈로 추출"
```

---

## Task 2: `fetchCostcoProductBySearch` 추가

**Files:**
- Modify: `src/lib/sourcing/costco-client.ts`

- [ ] **Step 1: `costco-client.ts` 파일 끝에 함수 추가**

`src/lib/sourcing/costco-client.ts` 파일 끝에 아래 함수를 추가한다 (`fetchCostcoProduct` 함수 바로 뒤):

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// 검색 API 기반 단일 상품 조회 (product detail API 실패 시 폴백)
// OCC search endpoint에서 code 정확 매칭으로 탐색
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchCostcoProductBySearch(
  code: string,
): Promise<CostcoApiProduct | null> {
  const params = new URLSearchParams({
    query: code,
    fields: COSTCO_API_DEFAULTS.fields,
    lang: COSTCO_API_DEFAULTS.lang,
    curr: COSTCO_API_DEFAULTS.curr,
    pageSize: '10',
    currentPage: '0',
  });

  const url = `${COSTCO_API_BASE}/products/search?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as OccSearchResponse;
  const match = (data.products ?? []).find((p) => p.code === code) ?? null;
  if (!match) return null;

  const categoryCode =
    (match as unknown as { categories?: { code?: string }[] })?.categories?.[0]?.code ?? '';
  const categoryName = OCC_CODE_TO_CATEGORY[categoryCode] ?? '기타';

  return occProductToApi(match, categoryName, categoryCode);
}
```

- [ ] **Step 2: TypeScript 컴파일 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep "costco-client" | head -10
```

오류 없으면 다음 단계 진행.

- [ ] **Step 3: 커밋**

```bash
git add src/lib/sourcing/costco-client.ts
git commit -m "feat: fetchCostcoProductBySearch — OCC search API 폴백 함수 추가"
```

---

## Task 3: `lookup/route.ts` Step 3 폴백 추가

**Files:**
- Modify: `src/app/api/sourcing/costco/lookup/route.ts`

- [ ] **Step 1: import 블록 수정**

`src/app/api/sourcing/costco/lookup/route.ts` 상단 import를 수정한다:

```typescript
// 기존:
import { fetchCostcoProduct } from '@/lib/sourcing/costco-client';

// 변경 후:
import { fetchCostcoProduct, fetchCostcoProductBySearch } from '@/lib/sourcing/costco-client';
import { upsertCostcoProduct } from '@/lib/sourcing/costco-upsert';
import type { CostcoApiProduct } from '@/types/costco';
```

- [ ] **Step 2: `apiProductToLookupResult` 헬퍼 함수 추가**

`rowToResult` 함수 바로 뒤에 아래 함수를 추가한다:

```typescript
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
  };
}
```

- [ ] **Step 3: GET 핸들러에서 `if (!product)` 블록과 인라인 매핑을 교체**

현재 파일의 약 119~142줄 블록:
```typescript
// 현재:
  if (!product) {
    return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });
  }

  const result: LookupResult = {
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
  };
  return NextResponse.json(result);
```

위 블록 전체를 아래로 교체한다:

```typescript
  if (!product) {
    // 3. OCC search API fallback — product detail에서도 찾지 못할 때
    let searchProduct: CostcoApiProduct | null;
    try {
      searchProduct = await fetchCostcoProductBySearch(code);
    } catch (err) {
      console.error('[costco/lookup] OCC search 조회 실패:', err);
      return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });
    }
    if (!searchProduct) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });
    }

    // DB 저장 — 다음 조회부터 step 1에서 즉시 반환됨
    // upsert 실패해도 이번 조회 결과는 정상 반환 (fire-and-forget)
    try {
      const pool = getSourcingPool();
      await upsertCostcoProduct(pool, searchProduct);
    } catch (err) {
      console.error('[costco/lookup] search 결과 upsert 실패:', err);
    }

    return NextResponse.json(apiProductToLookupResult(searchProduct));
  }

  // OCC product detail 성공
  return NextResponse.json(apiProductToLookupResult(product));
```

**구조 설명:** step 3 전체 로직이 `if (!product)` 블록 안에 위치한다. product detail이 성공한 경우(=`product`가 truthy)는 블록을 통과해 마지막 줄에서 반환된다.

- [ ] **Step 4: TypeScript 컴파일 오류 확인**

```bash
npx tsc --noEmit 2>&1 | grep "lookup" | head -10
```

오류 없으면 다음 단계 진행.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/sourcing/costco/lookup/route.ts
git commit -m "feat: costco lookup에 OCC search API 3단계 폴백 추가"
```

---

## Task 4: 테스트 업데이트

**Files:**
- Modify: `src/__tests__/api/costco-lookup-handler.test.ts`

- [ ] **Step 1: mock에 `fetchCostcoProductBySearch`·`upsertCostcoProduct` 추가**

파일 상단 mock 블록을 수정한다.

`vi.mock('@/lib/sourcing/costco-client', ...)` 블록을 아래로 교체:
```typescript
vi.mock('@/lib/sourcing/costco-client', () => ({
  fetchCostcoProduct: vi.fn(),
  fetchCostcoProductBySearch: vi.fn(),
}));
```

`vi.mock('@/lib/supabase/auth', ...)` 블록 바로 뒤에 추가:
```typescript
vi.mock('@/lib/sourcing/costco-upsert', () => ({
  upsertCostcoProduct: vi.fn().mockResolvedValue(undefined),
}));
```

import 블록에 새 mock 변수 추가:
```typescript
import { fetchCostcoProduct, fetchCostcoProductBySearch } from '@/lib/sourcing/costco-client';
import { upsertCostcoProduct } from '@/lib/sourcing/costco-upsert';

const mockFetchCostcoProductBySearch = fetchCostcoProductBySearch as ReturnType<typeof vi.fn>;
const mockUpsertCostcoProduct = upsertCostcoProduct as ReturnType<typeof vi.fn>;
```

- [ ] **Step 2: 기존 "OCC API null → 404" 테스트 수정**

현재 아래 테스트는 search 폴백이 추가되면서 동작이 바뀐다. search도 null을 반환해야 404가 된다:

```typescript
it('DB에 상품이 없고 OCC API가 null을 반환하면 404를 반환한다', async () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
  mockGetSourcingPool.mockReturnValue({ query: mockQuery });
  mockFetchCostcoProduct.mockResolvedValue(null);
  // search도 null 반환해야 최종 404
  mockFetchCostcoProductBySearch.mockResolvedValue(null);

  const res = await GET(makeRequest('1234567'));

  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error).toBeDefined();
});
```

- [ ] **Step 3: search fallback 성공 케이스 테스트 추가**

`describe` 블록 안에 아래 3개 테스트를 추가한다:

```typescript
it('DB·OCC detail 모두 실패하고 search가 상품을 반환하면 source:"api"로 200을 반환한다', async () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
  mockGetSourcingPool.mockReturnValue({ query: mockQuery });
  mockFetchCostcoProduct.mockResolvedValue(null);
  mockFetchCostcoProductBySearch.mockResolvedValue({
    ...OCC_PRODUCT,
    title: 'Search Found Product',
    categoryName: '식품',
    categoryCode: 'cos_10',
    stockStatus: 'inStock',
  });

  const res = await GET(makeRequest('1234567'));

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.source).toBe('api');
  expect(body.title).toBe('Search Found Product');
  expect(mockUpsertCostcoProduct).toHaveBeenCalledOnce();
});

it('DB·OCC detail 모두 실패하고 search도 null이면 404를 반환한다', async () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
  mockGetSourcingPool.mockReturnValue({ query: mockQuery });
  mockFetchCostcoProduct.mockResolvedValue(null);
  mockFetchCostcoProductBySearch.mockResolvedValue(null);

  const res = await GET(makeRequest('1234567'));

  expect(res.status).toBe(404);
  expect(mockUpsertCostcoProduct).not.toHaveBeenCalled();
});

it('search가 상품을 찾았지만 upsert가 실패해도 200 응답은 정상 반환된다', async () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
  mockGetSourcingPool.mockReturnValue({ query: mockQuery });
  mockFetchCostcoProduct.mockResolvedValue(null);
  mockFetchCostcoProductBySearch.mockResolvedValue({
    ...OCC_PRODUCT,
    categoryName: '식품',
    categoryCode: 'cos_10',
    stockStatus: 'inStock',
  });
  mockUpsertCostcoProduct.mockRejectedValue(new Error('DB upsert 실패'));

  const res = await GET(makeRequest('1234567'));

  // upsert 실패해도 조회 결과는 정상 반환
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.source).toBe('api');
});
```

- [ ] **Step 4: 테스트 실행**

```bash
npx vitest run src/__tests__/api/costco-lookup-handler.test.ts
```

Expected output: 모든 테스트 PASS (기존 7개 + 신규 3개 = 10개)

- [ ] **Step 5: 커밋**

```bash
git add src/__tests__/api/costco-lookup-handler.test.ts
git commit -m "test: costco lookup search fallback 케이스 테스트 추가"
```

---

## Task 5: 전체 테스트 확인 및 마무리

- [ ] **Step 1: 전체 관련 테스트 실행**

```bash
npx vitest run src/__tests__/api/costco-lookup-handler.test.ts src/__tests__/api/costco-lookup-route.test.ts src/__tests__/api/sourcing-costco-route.test.ts
```

Expected: 모든 테스트 PASS

- [ ] **Step 2: TypeScript 전체 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: 오류 없음

- [ ] **Step 3: 기능 동작 확인 포인트**

개발 서버(`npm run dev`)에서 아래를 직접 확인:
- 모바일 소싱 화면(`/m/costco`)에서 DB에 있는 상품코드 입력 → 정상 표시 (source: db)
- DB에 없는 코드 입력 → "상품 조회 중..." 후 상품 정보 표시 또는 "찾을 수 없습니다" 표시
- 찾은 상품이 DB에 저장됐는지: 같은 코드 재입력 시 로딩이 훨씬 빠르면 DB 캐시 동작 중

