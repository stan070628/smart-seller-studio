# 상품 그룹핑 & 스마트 추가 플로우 디자인

**날짜:** 2026-06-21  
**기능 영역:** CostManagementTab (비용 관리 탭)

---

## 1. 배경

쿠팡에서 동일한 등록상품(`seller_product_id`)에 여러 옵션(색상, 사이즈 등)이 존재할 수 있다.  
현재 테이블은 옵션별 row를 독립적으로 나열해 같은 상품이 여러 줄로 표시된다.

**요구사항:**
- 동일한 `seller_product_id`를 가진 row들을 하나의 그룹으로 묶어 표시
- 상품 추가 시 등록상품 ID를 입력하면 쿠팡 API에서 옵션 목록을 불러와 다중 선택으로 추가

---

## 2. 데이터 구조

### 2-1. 그룹핑 기준

`seller_product_id` (쿠팡 Wing 등록상품 ID)를 기준으로 그룹화.  
`seller_product_id`가 없거나 `null`인 row는 독립 행(standalone)으로 처리.

### 2-2. 테이블 행 타입

```ts
type GroupRow = {
  kind: 'group';
  sellerProductId: string;
  productName: string;
  children: ProductCost[];  // 같은 sellerProductId를 공유하는 DB rows
  // 집계 지표 (children에서 계산)
  totalStock: number;       // 재고 합산
  totalProfit: number;      // 실현손익 합산
  avgCost: number;          // 원가 가중평균 (재고 기준)
  avgMargin: number;        // 마진율 평균
};

type StandaloneRow = {
  kind: 'standalone';
  product: ProductCost;
};

type TableItem = GroupRow | StandaloneRow;
```

### 2-3. 클라이언트 사이드 그룹핑

DB 스키마 변경 없음. `seller_product_id` 컬럼은 기존에 존재.  
`useMemo`로 `products[]` → `TableItem[]` 변환:

```ts
const tableItems = useMemo(() => {
  const grouped = new Map<string, ProductCost[]>();
  const standalone: ProductCost[] = [];

  for (const p of products) {
    if (p.seller_product_id) {
      const key = String(p.seller_product_id);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    } else {
      standalone.push(p);
    }
  }

  const result: TableItem[] = [];

  for (const [sellerProductId, children] of grouped) {
    const totalStock = children.reduce((s, c) => s + (c.current_stock ?? 0), 0);
    const totalProfit = children.reduce((s, c) => s + (c.realized_profit ?? 0), 0);
    const totalCostWeight = children.reduce(
      (s, c) => s + (c.cost_price ?? 0) * (c.current_stock ?? 0), 0
    );
    const avgCost = totalStock > 0 ? totalCostWeight / totalStock : 0;
    const avgMargin =
      children.reduce((s, c) => s + (c.margin_rate ?? 0), 0) / children.length;

    result.push({
      kind: 'group',
      sellerProductId,
      productName: children[0].product_name ?? '',
      children,
      totalStock,
      totalProfit,
      avgCost,
      avgMargin,
    });
  }

  for (const p of standalone) {
    result.push({ kind: 'standalone', product: p });
  }

  return result;
}, [products]);
```

---

## 3. 아코디언 UI

### 3-1. 부모 행 (GroupRow)

- **기본 상태:** 접힘(collapsed)
- **토글:** 클릭 시 펼침/접힘. `Set<string>` (`expandedGroups`) state로 관리
- **스타일:** `background: #fff7f7`, 왼쪽 빨간 테두리 `border-left: 3px solid #be0014`

부모 행 표시 항목:
| 컬럼 | 내용 |
|------|------|
| 채널/상품 | 쿠팡 배지 + `seller_product_id` + 상품명 + ▾/▴ + "옵션 N개" |
| 원가 | 가중평균 + "(평균)" 서브텍스트 |
| 배송비 | 빈 칸 (옵션별 상이) |
| 재고 | 합산 + "(합계)" 서브텍스트 |
| 재고가치 | 합산 |
| 실현손익 | 합산 + "(합계)" 서브텍스트 |
| 마진율 | 평균 |
| 입고/판매 | 빈 칸 (자식 행에서 관리) |
| 액션 | "보기" 버튼 (해당 없음, 빈 칸) |

### 3-2. 자식 행 (ChildRow)

- **스타일:** `padding-left: 22px`, `border-left: 3px solid #fca5a5` (연한 빨강), `background: #fafafa`
- **채널 칸:** vendor_item_id만 표시 (seller_product_id는 부모에 있으므로 중복 제거)
- **나머지 컬럼:** 현재와 동일
- **입고/판매/보기 버튼:** 유지

### 3-3. 독립 행 (StandaloneRow)

현재와 동일한 레이아웃. 변경 없음.

---

## 4. 상품 추가 모달 (쿠팡 탭)

### 4-1. 기존 플로우 → 새 플로우

**Before:** seller_product_id + vendorItemId + 상품명 + 수수료율 직접 입력  
**After:** seller_product_id 입력 → API 옵션 목록 불러오기 → 다중 선택 → 일괄 추가

### 4-2. UI 상태 흐름

```
초기 상태:
  [seller_product_id 입력란] + [옵션 불러오기 버튼]

불러오는 중:
  → 로딩 인디케이터

불러오기 완료:
  → 옵션 목록 (체크박스)
    - 이미 추가됨: 회색 체크, 비활성화
    - 미추가: 선택 가능 체크박스
  → 수수료율 입력 (기본 10.8%)
  → "선택한 N개 옵션 추가" 버튼

추가 완료:
  → 테이블 리프레시 (테이블에 즉시 반영)
```

### 4-3. 일괄 추가 방식

선택한 옵션마다 기존 `POST /api/cost-management/products`를 순차 호출.  
새로운 추가 엔드포인트 불필요.

각 호출 payload:
```json
{
  "channel": "coupang",
  "vendor_item_id": "95501923100",
  "seller_product_id": "16182237839",
  "product_name": "커클랜드 극세사 타월 10장 — 그린",
  "commission_rate": 10.8
}
```

`product_name`은 `{상품명} — {옵션명}` 형태로 자동 생성.

---

## 5. 새 API 엔드포인트

### `GET /api/cost-management/fetch-options`

**Query param:** `sellerProductId` (필수)

**인증:** Supabase auth (기존 엔드포인트와 동일)

**동작:**
1. Supabase auth → userId 확인 (401 if 없음)
2. `sellerProductId` 없으면 400
3. 쿠팡 API `getProductDetail(sellerProductId)` 호출
4. 실패 시 502 + 에러 메시지
5. Render DB에서 현재 유저의 `vendor_item_id` 목록 조회 (`WHERE user_id = $1`)
6. 옵션별 `alreadyAdded` 마킹 후 반환

**성공 응답 (200):**
```json
{
  "productName": "커클랜드 극세사 타월 10장",
  "sellerProductId": "16182237839",
  "options": [
    { "vendorItemId": "95373359497", "name": "옐로우", "alreadyAdded": true },
    { "vendorItemId": "95401822934", "name": "블루",   "alreadyAdded": true },
    { "vendorItemId": "95501923100", "name": "그린",   "alreadyAdded": false }
  ]
}
```

**에러 응답:**
| 상황 | 상태 |
|------|------|
| 인증 없음 | 401 |
| `sellerProductId` 누락 | 400 |
| 쿠팡 API 실패 | 502 |

**구현 위치:** `src/app/api/cost-management/fetch-options/route.ts`

---

## 6. 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `src/components/orders/CostManagementTab.tsx` | `tableItems` useMemo 추가, 아코디언 렌더링, `expandedGroups` state |
| `src/app/api/cost-management/fetch-options/route.ts` | 신규 GET 엔드포인트 |
| `src/components/orders/AddProductModal.tsx` (또는 해당 modal 파일) | 쿠팡 탭 UI 새 플로우 적용 |

DB 마이그레이션: **없음**  
기존 API 변경: **없음** (POST products 그대로)

---

## 7. 구현 메모

### 쿠팡 API 옵션 추출 경로

`src/lib/listing/coupang-client.ts` — `getProductDetail(sellerProductId: number)` 확인 완료.

응답 구조:
```ts
const product = await coupangClient.getProductDetail(sellerProductId) as Record<string, unknown>;
const items = product.items as Array<Record<string, unknown>>;

for (const item of items) {
  const itemName = item.itemName as string;
  const rgData = item.rocketGrowthItemData as Record<string, unknown> | undefined;
  const vendorItemId = rgData ? Number(rgData.vendorItemId) : 0;
  // vendorItemId + itemName 으로 옵션 목록 구성
}
```

### 모달 파일 경로

구현 시 `grep -r "AddProduct\|addProduct\|추가 모달" src/` 로 탐색.
