# 소분 판매 원가 자동 계산 설계

**날짜:** 2026-05-22  
**범위:** 수익 원가 탭 — 소분 판매 상품 입고 시 개당 원가 자동 계산 + 이월 잔여 관리

---

## 1. 배경 및 목적

셀러가 대량 포장 단위로 사입한 상품을 소량으로 소분하여 판매하는 경우(예: 세차타월 36개 묶음 → 10개씩 소분), 현재 입고 폼에서 팩당 원가를 수동 계산해야 한다. 소분 갯수가 사입 총량을 나누어 떨어지지 않는 경우(나머지 발생) 잔여 수량 관리도 어렵다.

이 기능은 사입 총량과 소분 갯수를 입력하면 팩당 원가와 이월 잔여를 자동 계산하여 입력 오류를 줄이고 원가 정확도를 높인다.

---

## 2. 핵심 결정 사항

| 결정 항목 | 선택 | 이유 |
|---|---|---|
| 소분 비율 설정 위치 | 상품 기본값 + 입고 건 오버라이드 | 기본값 편의성 + 배치별 변경 유연성 |
| 나머지 처리 | 이월 (다음 입고에 합산) | 가장 정확한 재고/원가 반영 |
| 이월 저장 방식 | product_costs에 carryover 컬럼 | 단순 구조, 기존 FIFO 호환 |
| 이월 역산(수정/삭제) | v1에서는 경고만, 자동 역산은 v2 | 복잡도 대비 사용 빈도 낮음 |

---

## 3. DB 변경

### 마이그레이션: `069_subdivision.sql`

```sql
-- product_costs: 소분 기본 설정 + 이월 상태
ALTER TABLE product_costs
  ADD COLUMN subdivision_unit              INT,                        -- 기본 소분 갯수 (null = 소분 없음)
  ADD COLUMN subdivision_carryover         INT NOT NULL DEFAULT 0,     -- 이월 잔여 수량
  ADD COLUMN subdivision_carryover_unit_cost INT NOT NULL DEFAULT 0;  -- 이월 단가 (개당, 원)

-- cost_entries: 소분 입고 원본 정보 보존 (FIFO 역추적용)
ALTER TABLE cost_entries
  ADD COLUMN purchase_quantity  INT,  -- 사입 총량 (null = 소분 없음)
  ADD COLUMN subdivision_unit   INT;  -- 이 건의 소분 갯수
```

기존 데이터는 모두 `null` → 소분 없음으로 처리. FIFO 로직 영향 없음.

---

## 4. 계산 로직

### 소분 입고 계산 (서버사이드)

```
입력:
  purchase_quantity  = 36      (사입 총량)
  unit_cost_input    = 21,490  (묶음 총 구매가 — API 필드명은 unit_cost 유지)
  subdivision_unit   = 10      (소분 갯수)
  carryover          = 6       (product_costs.subdivision_carryover)
  carryover_unit_cost= 597     (product_costs.subdivision_carryover_unit_cost)

계산:
  개당 사입 원가     = unit_cost_input / purchase_quantity         = 597원
  총 사용 가능       = carryover + purchase_quantity               = 42개
  판매 팩 수         = floor(총 사용 가능 / subdivision_unit)       = 4팩
  새 이월 수량       = 총 사용 가능 % subdivision_unit              = 2개
  이월 총 원가       = carryover × carryover_unit_cost             = 3,582원
  신규 총 원가       = unit_cost_input                             = 21,490원
  합산 총 원가       = 이월 총 원가 + 신규 총 원가                  = 25,072원
  팩당 원가          = (합산 총 원가 / 총 사용 가능) × subdivision_unit = 5,969원
  새 이월 단가       = 합산 총 원가 / 총 사용 가능                  = 597원

저장:
  cost_entries: quantity=4, unit_cost=5969, purchase_quantity=36, subdivision_unit=10
  product_costs: subdivision_carryover=2, subdivision_carryover_unit_cost=597
```

---

## 5. API 변경

### POST /api/cost-management/products

`subdivision_unit` 필드 추가 (선택, 양의 정수 또는 null).

```ts
body: {
  product_name: string
  seller_product_id?: number
  vendor_item_id?: number
  platform_fee_rate?: number
  subdivision_unit?: number   // NEW
}
```

### POST /api/cost-management/products/:id/entries

`purchase_quantity`가 있으면 소분 모드로 처리. 서버가 위 계산 로직을 수행 후 `quantity`, `unit_cost`를 계산값으로 저장한다. `subdivision_unit` 미전달 시 product의 기본값 사용.

```ts
body: {
  received_at: string
  unit_cost: number           // 묶음 총 구매가 (소분 모드) 또는 개당 단가 (일반 모드)
  unit_shipping_fee: number
  channel?: string
  purchase_quantity?: number  // NEW — 있으면 소분 모드
  subdivision_unit?: number   // NEW — product 기본값 오버라이드
}
```

응답에 `carryover_out` (새 이월 수량) 포함하여 UI에서 확인 가능하게 한다.

### PATCH /api/cost-management/entries/:id

소분 입고 건(`purchase_quantity != null`)을 수정할 경우 이월값 역산 없이 저장. **v1에서는 경고만 반환** (`warning: "subdivision_carryover_stale"`). 자동 역산은 v2.

### DELETE /api/cost-management/entries/:id

소분 입고 건 삭제 시 동일하게 경고 반환.

---

## 6. UI 변경

### AddProductModal

플랫폼 수수료율 아래에 소분 갯수 필드 추가:

```
소분 갯수 (선택)  [ ___ ]  개
← 비워두면 소분 없음. 입력하면 입고 시 개당 원가가 자동 계산됩니다.
```

### CostEntryDrawer — 소분 입고 폼

상품에 `subdivision_unit`이 설정된 경우 "새 입고 건 추가" 행이 소분 모드로 렌더링된다.

**입력 필드 (사용자 입력):**

| 필드 | 라벨 | 비고 |
|---|---|---|
| received_at | 입고일 | 기존과 동일 |
| unit_cost | 묶음 총 구매가 (원) | 라벨만 변경, 필드명 동일 |
| purchase_quantity | 사입 총량 (개) | NEW |
| subdivision_unit | 소분 갯수 (개) | product 기본값 자동 입력, 수정 가능 |
| unit_shipping_fee | 배송비 | 기존과 동일 |

**자동 계산 미리보기 (읽기 전용, 실시간):**

```
이월 잔여   6개 (개당 597원)
──────────────────────────
총 사용    42개
판매 팩 수  4팩   ← 저장될 수량
팩당 원가  5,969원 ← 저장될 단가
새 이월    2개
```

계산 미리보기는 입력값이 충분할 때만 표시 (purchase_quantity > 0 && subdivision_unit > 0).

**입고 내역 테이블 표시:**

소분 입고 건은 수량 셀에 원본 정보를 서브텍스트로 표시:
```
4팩
사입36/소분10
```

**수정/삭제 경고:**

소분 입고 건 수정·삭제 시 폼 상단에 배너:
> "소분 입고 건을 수정하면 이월 잔여가 부정확해질 수 있습니다. 저장 후 이월값을 확인하세요."

---

## 7. 범위 외 (v2)

- 소분 입고 건 수정/삭제 시 이월 자동 역산
- 이월 이력 조회 UI
- 이월 수동 조정 기능
