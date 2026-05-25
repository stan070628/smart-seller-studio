# 코스트코 상품코드 조회 — OCC Search API 3단계 폴백 설계

**날짜**: 2026-05-25  
**범위**: 코스트코 모바일 소싱 > 상품코드 조회 기능  
**상태**: 승인됨

---

## 배경 및 문제

코스트코 모바일 소싱 화면에서 상품코드(6~7자리)를 입력하면 `MobileCodeSearchCard`가 표시되고, `/api/sourcing/costco/lookup` 엔드포인트를 통해 상품 정보를 조회한다.

현재 조회 순서:
1. DB (`costco_products`) 조회
2. OCC product detail API (`/products/{code}`) 조회
3. 둘 다 실패 → 404 반환

문제: 일부 상품은 www.costco.co.kr 웹사이트에서는 확인되지만, DB에 없고 OCC product detail 엔드포인트에서도 404를 반환한다. 이 경우 사용자는 "해당 상품코드를 찾을 수 없습니다" 오류만 보고 더 이상 진행할 수 없다.

---

## 목표

- DB에도 없고 OCC product detail에도 없는 상품을 OCC search API로 추가 탐색한다.
- 찾으면 DB에 upsert해 다음 조회부터는 step 1에서 즉시 반환되게 한다.
- 프론트엔드 변경 없이 백엔드 폴백 레이어만 추가한다.

---

## 설계

### 새로운 조회 흐름

```
[1] DB 조회 (costco_products WHERE product_code = code AND is_active = true)
         ↓ 없음
[2] OCC product detail API (GET /products/{code}?fields=FULL&lang=ko&curr=KRW)
         ↓ 없음 또는 non-2xx
[3] OCC search API (GET /products/search?query={code}&pageSize=10&fields=FULL)
    → data.products 중 p.code === code 인 항목 필터
         ↓ 일치 항목 있음
    DB upsert (upsertCostcoProduct)
    → LookupResult 반환 (source: 'api')
         ↓ 일치 항목 없음
    404 반환
```

---

## 변경 파일

### 1. `src/lib/sourcing/costco-upsert.ts` (신규)

`route.ts`의 `upsertProduct(pool, product)` 함수를 이 파일로 이동한다. 기존 로직 변경 없이 위치만 이동.

```typescript
export async function upsertCostcoProduct(pool: Pool, product: CostcoApiProduct): Promise<void>
```

- `parseProductUnit(product.title)`로 단위 파싱
- `costco_products` 테이블에 ON CONFLICT (product_code) DO UPDATE
- `first_price`는 최초 수집값 유지, `lowest_price`는 더 낮은 값으로 갱신

### 2. `src/lib/sourcing/costco-client.ts`

`fetchCostcoProductBySearch(code)` 함수를 추가한다.

```typescript
export async function fetchCostcoProductBySearch(code: string): Promise<CostcoApiProduct | null>
```

- `GET ${COSTCO_API_BASE}/products/search?query={code}&pageSize=10&fields=FULL&lang=ko&curr=KRW`
- 기존 `fetchCostcoProduct`와 동일한 헤더/타임아웃(15s) 사용
- `data.products.find(p => p.code === code)`로 정확한 코드 매칭
- 일치 항목 없으면 `null` 반환
- `occProductToApi(match, categoryName, categoryCode)`로 정규화

### 3. `src/app/api/sourcing/costco/route.ts`

`upsertProduct` 인라인 함수를 제거하고 `upsertCostcoProduct` import로 교체.  
로직 변경 없음.

### 4. `src/app/api/sourcing/costco/lookup/route.ts`

Step 2 실패 후 Step 3 블록 추가:

```typescript
// Step 3: OCC search fallback
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

// DB 저장 (실패해도 이번 조회는 계속 진행)
try {
  await upsertCostcoProduct(pool, searchProduct);
} catch (err) {
  console.error('[costco/lookup] search 결과 upsert 실패:', err);
}

return NextResponse.json(apiProductToLookupResult(searchProduct));
```

`apiProductToLookupResult(product)` 헬퍼를 추가해 현재 step 2의 인라인 매핑을 함수로 추출:

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
    unitPriceLabel: null,   // search로 찾은 경우 단위 파싱은 upsert 후 재조회 시 반영
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

---

## 프론트엔드 영향

변경 없음. `MobileCodeSearchCard`는 `source: 'api'` 응답을 이미 처리하며, `unitPrice`/`marketLowestPrice`가 null인 경우도 정상 렌더링된다. 단위가 정보가 없으면 절감율 뱃지가 표시되지 않는 기존 동작과 동일.

---

## 에러 핸들링

| 시나리오 | 처리 |
|---|---|
| OCC search API non-2xx | `null` 반환 → 404 |
| 검색 결과에 코드 없음 | `null` 반환 → 404 |
| DB upsert 실패 | 로그 출력 후 조회 결과는 정상 반환 (fire-and-forget) |
| OCC search 타임아웃(15s) | 에러 catch → 404 |

---

## 테스트 전략

- `fetchCostcoProductBySearch`: OCC search mock으로 (a) 일치 코드 있음, (b) 없음, (c) non-2xx 케이스 단위 테스트
- `lookup/route`: DB miss + product detail miss + search hit 경로 통합 테스트, upsert 호출 확인
- 기존 `costco-lookup-route.test.ts`, `costco-lookup-handler.test.ts` 업데이트

---

## 범위 제외

- 소싱 스코어 재계산: search로 upsert된 상품은 다음 스케줄 cron 실행 시 자연히 포함됨
- 네이버 시장가 자동 수집: 기존 naver-prices cron이 새로 추가된 상품도 처리
- 프론트엔드 "온라인 조회" 뱃지: 불필요 — source 필드는 내부 추적용
