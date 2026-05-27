# 사이즈별 재고 추적 (Variant Inventory) 설계

## 개요

의류 등 사이즈/옵션이 여러 개인 상품에서 **사이즈별 잔여 재고**를 추적한다.
현재는 product_cost 1개 = 전체 재고 합산만 표시되어 사이즈별 현황 파악 불가.

## 전제 조건

- 사이즈별 매입 수량이 다름 (S 20개, M 30개 등)
- 사이즈별 매입 단가는 동일
- FIFO 원가 계산은 기존 전체 통합 방식 유지 (변경 없음)
- 사이즈 정보(variant)는 `vendorItemId` ↔ `variant_name` 매핑으로 관리

---

## 1. DB 변경

### 마이그레이션 (신규 파일)

```sql
-- cost_entries, sale_records에 variant_name 추가 (nullable, 하위 호환)
ALTER TABLE cost_entries  ADD COLUMN IF NOT EXISTS variant_name text;
ALTER TABLE sale_records  ADD COLUMN IF NOT EXISTS variant_name text;

-- product_costs에 variants 캐시 (vendorItemId → variant_name JSON 맵)
ALTER TABLE product_costs ADD COLUMN IF NOT EXISTS variants jsonb;
-- 예: {"95304537912": "화이트 S", "95304537913": "화이트 M", ...}
```

### variants 컬럼 역할

임포트 시 매번 `getProductDetail` API를 호출하는 대신,
한 번 조회한 `vendorItemId → 사이즈명` 매핑을 캐시로 저장.
variants가 null이거나 비어있을 때만 API 재조회.

---

## 2. 임포트 로직 변경

**파일:** `src/app/api/cost-management/products/[id]/coupang-import/route.ts`

### Step 1 — variants 캐시 갱신

판매 가져오기 실행 시:
1. `product_costs.variants`가 null이거나 빈 객체이면 `getProductDetail(sellerProductId)` 호출
2. 각 item의 `vendorItemId` + `itemName`(또는 옵션 속성)을 추출
3. `{"vendorItemId": "variant_name", ...}` 형태로 product_costs.variants 업데이트
4. 이후 동일 임포트 실행 시 DB 캐시 사용 (API 재호출 없음)

### Step 2 — sale_records 저장 시 variant_name 채우기

```
RG 주문:  item.vendorItemId → variants 캐시 조회 → sale_records.variant_name
Wing 주문: item.vendorItemId → variants 캐시 조회 → sale_records.variant_name
매핑 없음: variant_name = null (기존 데이터 호환)
```

### Step 3 — 기존 레코드 소급 적용

판매 가져오기 실행 시, variant_name이 null인 기존 sale_records에 대해:
- `coupang_order_item_id`에서 vendorItemId 추출
  - RG: `rg-{orderId}-{vendorItemId}` → 마지막 숫자
  - Wing: `{orderId}-{vendorItemId}` → 마지막 숫자
- variants 캐시로 역매핑 → variant_name 업데이트

---

## 3. 입고 등록 UI 변경

**파일:** `src/components/orders/CostEntryDrawer.tsx`

### 변경 사항

- `product_costs.variants`가 있는 상품에만 사이즈 선택 드롭다운 표시
- 입고 행 추가 시 사이즈 선택 가능 (선택 안 하면 "전체/미분류")
- 사이즈별로 행을 따로 추가 (S 20개 / M 30개 / L 25개 / XL 15개 = 4행)
- `cost_entries.variant_name`에 저장

### UI 레이아웃 (variants 있는 상품)

```
[수령일] [수량] [단가] [배송비] [사이즈 ▼]
                               화이트 S
                               화이트 M
                               화이트 L
                               화이트 XL
                               (미분류)
```

---

## 4. 재고 표시

**파일:** `src/components/orders/CostManagementTab.tsx`

### 계산 방식

```
사이즈별 잔여 재고 = Σ cost_entries.quantity (variant_name 기준)
                  - Σ sale_records.quantity (variant_name 기준)
```

FIFO 단가·손익은 기존 전체 통합 유지.

### 표시 위치 및 형태

상품 목록 테이블의 재고 칸 또는 드로어 상단에 breakdown 표시:

```
전체 45개
  화이트 S    8개
  화이트 M   12개
  화이트 L   15개
  화이트 XL  10개
  미분류       0개
```

variants가 없는 상품은 기존과 동일하게 전체 합산만 표시.

---

## 5. variants 초기 설정 API

**신규 엔드포인트:** `POST /api/cost-management/products/[id]/fetch-variants`

- Coupang `getProductDetail` 호출
- vendorItemId → itemName(사이즈명) 매핑 추출
- `product_costs.variants` 저장
- 응답: `{ variants: {"95304537912": "화이트 S", ...} }`

CostManagementTab의 채널 편집 UI에 "variants 불러오기" 버튼 추가.

---

## 6. 영향 범위

| 파일 | 변경 내용 |
|------|---------|
| `supabase/migrations/073_variant_name.sql` | cost_entries, sale_records에 variant_name 추가; product_costs에 variants 추가 |
| `src/app/api/cost-management/products/[id]/coupang-import/route.ts` | variants 캐시 갱신 + sale_records.variant_name 저장 + 소급 적용 |
| `src/app/api/cost-management/products/[id]/fetch-variants/route.ts` | 신규 — Coupang API에서 variants 조회 및 저장 |
| `src/app/api/cost-management/products/[id]/route.ts` (PATCH) | variants 필드 업데이트 허용 |
| `src/components/orders/CostEntryDrawer.tsx` | 입고 행에 사이즈 선택 드롭다운 추가 |
| `src/components/orders/CostManagementTab.tsx` | 재고 breakdown 표시 + variants 불러오기 버튼 |
| `src/components/orders/SaleEntryPanel.tsx` | 판매 행에 variant_name 표시 (읽기 전용) |

---

## 7. 검증

1. 커클랜드 반팔 티셔츠에 variants 불러오기 실행 → S/M/L/XL 매핑 저장 확인
2. 판매 가져오기 재실행 → sale_records.variant_name 채워짐 확인
3. 입고 등록 시 사이즈 선택 → cost_entries.variant_name 저장 확인
4. 재고 breakdown이 올바르게 표시되는지 확인
5. variants 없는 기존 상품은 기존과 동일하게 동작하는지 확인
