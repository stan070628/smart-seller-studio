# 상품 그룹핑 & 스마트 추가 플로우 디자인

**날짜:** 2026-06-21  
**기능 영역:** CostManagementTab (비용 관리 탭)  
**Opus 4.8 검토 반영:** 2026-06-21

---

## 1. 배경

쿠팡에서 동일한 등록상품(`seller_product_id`)에 여러 옵션(색상, 사이즈 등)이 존재할 수 있다.  
현재 테이블은 옵션별 row를 독립적으로 나열해 같은 상품이 여러 줄로 표시된다.

**요구사항:**
- 동일한 `seller_product_id`를 가진 row들을 하나의 그룹으로 묶어 표시
- 상품 추가 시 기존 드롭다운에서 상품 선택 → 옵션 목록을 체크박스로 다중 선택

---

## 2. 데이터 구조

### 2-1. 그룹핑 기준

`seller_product_id` (쿠팡 Wing 등록상품 ID)를 기준으로 그룹화.  
`seller_product_id`가 없거나 `null`인 row는 독립 행(standalone)으로 처리.

**엣지케이스:**
- `children.length === 1`인 그룹 → 그룹 UI 불필요, standalone으로 평탄화
- 채널 필터(`rg`/`wing`/`naver`) 변경 시 현재 필터링된 `products` 배열 기준으로만 그룹핑
- 그룹의 채널이 혼재할 수 있음 → 부모 배지는 children 채널 목록에서 동적 결정

### 2-2. 테이블 행 타입

실제 타입명은 `ProductRow` (`CostManagementTab.tsx:13-39`).

```ts
// 실제 필드명 참조: src/components/orders/CostManagementTab.tsx:13-39
type GroupRow = {
  kind: 'group';
  sellerProductId: string;
  productName: string;
  children: ProductRow[];  // ProductCost가 아님 — 실제 타입명 확인
  // 집계 지표
  totalStock: number;       // current_stock 합산
  totalStockValue: number;  // stock_value 합산 (FIFO 잔여 원가)
  totalProfit: number;      // total_realized_profit 합산
  totalSalesAmount: number; // total_sales_amount 합산 (마진율 계산용)
  avgCost: number;          // stock_value 합 ÷ current_stock 합
  groupMarginRate: number;  // totalProfit ÷ totalSalesAmount
};

type StandaloneRow = {
  kind: 'standalone';
  product: ProductRow;
};

type TableItem = GroupRow | StandaloneRow;
```

### 2-3. 클라이언트 사이드 그룹핑

```ts
const tableItems = useMemo(() => {
  const grouped = new Map<string, ProductRow[]>();
  const standalone: ProductRow[] = [];

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
    // 옵션 1개짜리 그룹은 아코디언 불필요 → 평탄화
    if (children.length === 1) {
      standalone.push(children[0]);
      continue;
    }

    const totalStock = children.reduce((s, c) => s + (c.current_stock ?? 0), 0);
    // 원가 가중평균: stock_value(FIFO 잔여 원가 합) ÷ 재고 합
    const totalStockValue = children.reduce((s, c) => s + (c.stock_value ?? 0), 0);
    const avgCost = totalStock > 0 ? totalStockValue / totalStock : 0;

    // 실현손익 합산 (기간 필터 적용된 값)
    const totalProfit = children.reduce((s, c) => s + (c.total_realized_profit ?? 0), 0);
    // 마진율: 매출액 기반 (산술평균 X)
    const totalSalesAmount = children.reduce((s, c) => s + (c.total_sales_amount ?? 0), 0);
    const groupMarginRate = totalSalesAmount > 0 ? (totalProfit / totalSalesAmount) * 100 : 0;

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
}, [products]);
```

**주의:** `totalProfit`은 기간 필터 적용된 값, `totalStock`은 전체 기간 값. UI에서 각각 기간 기준을 명시.

**정렬 유의:** 그룹핑 후 정렬 순서가 달라짐. 기존 `created_at DESC` 정렬은 children[0] 기준으로 그룹 순서를 결정하거나 별도 정렬 로직 추가.

**검색 필터 동작:** 검색어가 자식 row의 product_name/vendor_item_id에 매칭되면 해당 그룹 전체를 표시 (부모 포함). 매칭 자식이 없는 그룹은 숨김.

---

## 3. 아코디언 UI

### 3-1. 부모 행 (GroupRow)

- **기본 상태:** 접힘(collapsed)
- **토글:** 클릭 시 펼침/접힘. `Set<string>` (`expandedGroups`) state로 관리
- **스타일:** `background: #fff7f7`, 왼쪽 빨간 테두리 `border-left: 3px solid #be0014`
- **옵션 추가 후:** 추가된 그룹은 자동 펼침 상태로 전환

부모 행 표시 항목:
| 컬럼 | 내용 | 기준 |
|------|------|------|
| 채널/상품 | 쿠팡 배지 + `seller_product_id` + 상품명 + ▾/▴ + "옵션 N개" | — |
| 원가 | `avgCost` + "(재고평균)" 서브텍스트 | FIFO 잔여 원가 기반 |
| 배송비 | 빈 칸 (옵션별 상이) | — |
| 재고 | `totalStock` + "(합계)" | 전체 기간 |
| 재고가치 | `totalStockValue` | FIFO 잔여 원가 합 |
| 실현손익 | `totalProfit` + "(합계, 기간)" | 선택한 기간 |
| 마진율 | `groupMarginRate` + "(손익/매출)" | 선택한 기간 |
| 입고/판매 | 빈 칸 (자식 행에서 관리) | — |

### 3-2. 자식 행 (ChildRow)

- **스타일:** `padding-left: 22px`, `border-left: 3px solid #fca5a5`, `background: #fafafa`
- **채널 칸:** vendor_item_id만 표시 (seller_product_id는 부모에 있으므로 중복 제거)
- **나머지 컬럼:** 현재와 동일
- **입고/판매/보기 버튼:** 유지

### 3-3. 독립 행 (StandaloneRow)

현재와 동일한 레이아웃. 변경 없음.

### 3-4. 삭제 동작

그룹 부모 행의 삭제: children 각각 개별 삭제. 일괄 삭제 기능은 이번 스코프 외.

---

## 4. 상품 추가 모달 (쿠팡 탭)

### 4-1. 기존 플로우 확장

**변경 방향:** 기존 드롭다운(상품 선택)→옵션 자동 불러오기 흐름이 이미 `AddProductModal.tsx:112-122`에 구현돼 있음.  
**단일 선택 → 다중 체크박스 선택**으로 확장.

**Before:** 드롭다운으로 상품 선택 → 단일 옵션 선택 → 추가  
**After:** 드롭다운으로 상품 선택 → 옵션 목록에 이미 추가된 항목 마킹 → **다중 체크박스** 선택 → 일괄 추가

### 4-2. UI 상태 흐름

```
드롭다운에서 상품 선택 (기존 sellerProductId 선택 방식 유지)
  → 기존 coupang-product-options API 호출 + alreadyAdded 마킹 추가
  → 옵션 목록 (체크박스)
    - 이미 추가됨: 회색 체크, 비활성화, "이미 추가됨" 배지
    - 미추가: 선택 가능 체크박스
    - 모든 옵션이 이미 추가됨: "모든 옵션이 이미 추가됐습니다" 안내 + 추가 버튼 비활성
  → 수수료율 입력 (기본 10.8% — UI 표시는 %, 내부 변환은 /100)
  → "선택한 N개 옵션 추가" 버튼
```

### 4-3. 일괄 추가 방식

선택한 옵션마다 기존 `POST /api/cost-management/products`를 `Promise.allSettled`로 병렬 호출.

각 호출 payload:
```json
{
  "channel": "coupang",
  "vendor_item_id": "95501923100",
  "seller_product_id": "16182237839",
  "product_name": "커클랜드 극세사 타월 10장 — 그린",
  "platform_fee_rate": 0.108
}
```

**주의:**
- `commission_rate`가 아닌 `platform_fee_rate` (실제 API 검증 필드)
- UI 입력값 `10.8` → `Number(feeRate) / 100` 변환 후 전송 (기존 AddProductModal.tsx:169 패턴 그대로)
- `product_name`: `{sellerProductName} — {itemName}` 형태로 자동 생성

### 4-4. 부분 실패 처리

```ts
const results = await Promise.allSettled(
  selectedOptions.map(opt => addProduct({ ...payload, vendor_item_id: opt.vendorItemId }))
);
const succeeded = results.filter(r => r.status === 'fulfilled').length;
const failed = results.filter(r => r.status === 'rejected').length;
// toast: "N개 추가 완료" or "N개 추가, M개 실패"
```

추가 완료 후 추가된 그룹을 자동 펼침 상태로 전환.

---

## 5. 기존 API 확장 (신규 엔드포인트 불필요)

### `GET /api/cost-management/coupang-product-options` (기존 엔드포인트 확장)

**기존 동작:** sellerProductId → 쿠팡 API → vendorItemId/itemName/salePrice 반환  
**추가 사항:** `productName` 필드 + 각 옵션의 `alreadyAdded` 마킹

**현재 응답 → 확장 응답:**
```json
{
  "productName": "커클랜드 극세사 타월 10장",
  "options": [
    { "vendorItemId": "95373359497", "name": "옐로우", "salePrice": 15900, "alreadyAdded": true },
    { "vendorItemId": "95401822934", "name": "블루",   "salePrice": 15900, "alreadyAdded": true },
    { "vendorItemId": "95501923100", "name": "그린",   "salePrice": 15900, "alreadyAdded": false }
  ]
}
```

**`alreadyAdded` 마킹 구현:**
```ts
// Render DB에서 현재 유저의 vendor_item_id 목록 조회
const { rows } = await db.query(
  'SELECT vendor_item_id FROM product_costs WHERE user_id = $1',
  [userId]
);
const existingIds = new Set(rows.map(r => String(r.vendor_item_id)));
// 각 옵션에 alreadyAdded 마킹
options.map(opt => ({ ...opt, alreadyAdded: existingIds.has(String(opt.vendorItemId)) }))
```

---

## 6. 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `src/components/orders/CostManagementTab.tsx` | `tableItems` useMemo 추가, 아코디언 렌더링, `expandedGroups` state |
| `src/app/api/cost-management/coupang-product-options/route.ts` | `productName` + `alreadyAdded` 필드 추가 |
| `src/components/orders/AddProductModal.tsx` | 단일 선택 → 다중 체크박스, `Promise.allSettled` 부분 실패 처리 |

DB 마이그레이션: **없음**  
신규 API 파일: **없음** (기존 엔드포인트 확장)

---

## 7. 구현 메모

### 쿠팡 API 옵션 추출 경로

기존 `coupang-product-options/route.ts:22`가 이미 `i.vendorItemId`(최상위)로 올바르게 추출 중.  
`item.rocketGrowthItemData.vendorItemId` (중첩) 경로는 **사용하지 말 것** — 기존 동작 경로 우선.

### ProductRow 실제 필드 참조

구현 시 `src/components/orders/CostManagementTab.tsx:13-39`의 `ProductRow` 타입을 반드시 확인하고 필드명 일치시킬 것. 스펙의 `useMemo` 코드는 의사 코드 수준이며 실제 필드명은 해당 타입 정의가 기준.

### HTTP 상태 코드 컨벤션

기존 `coupang-product-options` 쿠팡 API 실패는 500 반환. 확장 시 기존 컨벤션 유지 (502로 바꾸지 않음).
