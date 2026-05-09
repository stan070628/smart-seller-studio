# 입고/판매 완전 분리 설계 스펙

**작성일:** 2026-05-09  
**상태:** 승인됨

---

## 목표

현재 `cost_entries.selling_price`에 판매 정보를 끼워 넣는 구조를 폐기하고, 입고(purchase)와 판매(sale)를 완전히 분리된 테이블로 관리한다. FIFO 원가 계산으로 각 판매 건의 실제 매입 원가를 추적하고, 쿠팡 Wing API로 판매 내역을 자동 수입한다.

---

## Section 1 — DB 스키마

### 변경 대상 테이블

#### `cost_entries` (입고 테이블) — 변경

제거:
- `selling_price` 컬럼 삭제

추가 없음. 입고 배치의 순수 매입 정보만 보유.

```sql
-- 기존 컬럼 유지
id, user_id, product_cost_id, received_at, quantity,
unit_cost, unit_shipping_fee, shipping_group_id, created_at
```

#### `sale_records` (판매 테이블) — 신규 생성

```sql
CREATE TABLE sale_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id),
  product_cost_id       uuid NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  sold_at               date NOT NULL,
  quantity              integer NOT NULL CHECK (quantity > 0),
  selling_price         integer NOT NULL CHECK (selling_price >= 0),
  channel               text NOT NULL DEFAULT 'manual',  -- 'coupang' | 'manual'
  coupang_order_item_id text UNIQUE,                     -- 쿠팡 중복 방지용
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX ON sale_records (product_cost_id, sold_at);
CREATE INDEX ON sale_records (user_id, sold_at);
```

### 마이그레이션 전략

기존 `cost_entries`에서 `selling_price > 0`인 행 → `sale_records`로 자동 이전 후 `selling_price` 컬럼 제거.

```sql
INSERT INTO sale_records (user_id, product_cost_id, sold_at, quantity, selling_price, channel)
SELECT user_id, product_cost_id, received_at, quantity, selling_price, 'manual'
FROM cost_entries
WHERE selling_price > 0;

ALTER TABLE cost_entries DROP COLUMN selling_price;
```

---

## Section 2 — FIFO 원가 계산

### 원칙

- 가장 오래된 입고 배치부터 순서대로 소진 (FIFO)
- 계산은 쿼리 타임에 수행 (별도 스냅샷 테이블 없음)
- 대상: 단일 상품의 전체 입고·판매 이력

### 계산 모델

1. `cost_entries`를 `received_at ASC` 정렬 → 입고 큐
2. `sale_records`를 `sold_at ASC` 정렬 → 판매 순서
3. 각 판매 건마다 입고 큐 앞에서 수량 차감
4. 판매 1건의 FIFO 원가 = 소진된 배치별 `(unit_cost + unit_shipping_fee) × 수량` 합산 / 판매 수량

### 결과로 계산되는 지표

| 지표 | 설명 |
|------|------|
| `fifo_cost_per_unit` | 판매 1건의 FIFO 배분 원가 |
| `realized_profit` | `selling_price − fifo_cost_per_unit − 수수료` |
| `current_stock` | 총 입고 수량 − 총 판매 수량 |
| `stock_value` | 남은 입고 배치별 `unit_cost × 잔여수량` 합계 |

---

## Section 3 — UI 레이아웃 (B. 좌우 분할)

`CostEntryDrawer`를 두 패널로 분할:

```
┌─────────────────────────────────────────┐
│ 컬럼비아 백팩                        ✕  │
├──────────┬──────────┬──────────────────-┤
│  재고    │  실현손익 │  재고가치         │
├──────────────┬──────────────────────────┤
│  📦 입고 내역 │  💰 판매 내역           │
│              │                          │
│  05-01  30개 │  05-08  16개  26,000원   │
│  15,000원    │  [쿠팡]  ✏ 🗑           │
│  ✏ 🗑      │                          │
│              │  + 판매 추가             │
│  + 입고 추가 │  ☁ 쿠팡 가져오기       │
└──────────────┴──────────────────────────┘
```

**상단 요약 카드** (3개): 현재 재고 / 실현손익(FIFO 기준) / 재고가치

**좌측 패널 — 입고 내역**
- 컬럼: 입고일, 수량, 단가(원가), 배송비, [그룹], ✏ 🗑
- "새 입고 건 추가" 버튼

**우측 패널 — 판매 내역**
- 컬럼: 판매일, 수량, 판매가, FIFO 원가, 실현손익, 채널 배지, ✏ 🗑
- "판매 추가" 버튼 (수동)
- "쿠팡 가져오기" 버튼

---

## Section 4 — 쿠팡 자동 연동

### 수입 플로우

1. 우측 패널 "☁ 쿠팡 가져오기" 클릭
2. 날짜 범위 입력 (기본: 최근 30일)
3. Wing API `GET /v2/providers/wing/apis/api/order-sync/...` 주문 목록 조회
4. 라인 아이템 `sellerProductId` ↔ `product_costs.seller_product_id` 매칭
5. 매칭 성공 → `sale_records` 삽입 (이미 `coupang_order_item_id` 존재 시 SKIP)
6. 매칭 실패 항목 → 목록 표시, 사용자가 수동으로 상품 연결하거나 무시

### `sale_records` 저장 필드 (쿠팡)

| 필드 | 값 |
|------|-----|
| `sold_at` | 주문 확정일 |
| `quantity` | 판매 수량 |
| `selling_price` | 실제 판매가 (할인 후) |
| `channel` | `'coupang'` |
| `coupang_order_item_id` | 주문 라인 아이템 ID (중복 방지) |

### 수정/삭제 규칙

- 쿠팡 가져오기로 생성된 행도 **수정 가능** (판매일, 수량, 판매가)
- `coupang_order_item_id` 보존 → 재수입 시 수동 수정 보존 (SKIP)
- 삭제 후 재수입하면 다시 가져올 수 있음
- 수동 입력 행: `channel = 'manual'`, `coupang_order_item_id = null`

---

## 영향받는 파일

### 신규 생성

| 파일 | 역할 |
|------|------|
| `supabase/migrations/058_sale_records.sql` | sale_records 테이블 생성 + 마이그레이션 |
| `src/app/api/cost-management/products/[id]/sales/route.ts` | GET(판매 목록), POST(수동 추가) |
| `src/app/api/cost-management/sales/[id]/route.ts` | PATCH(수정), DELETE(삭제) |
| `src/app/api/cost-management/products/[id]/coupang-import/route.ts` | 쿠팡 주문 수입 |
| `src/components/orders/SaleEntryPanel.tsx` | 우측 판매 패널 컴포넌트 |
| `src/lib/cost-management/fifo.ts` | FIFO 계산 순수 함수 |

### 수정

| 파일 | 변경 내용 |
|------|-----------|
| `src/components/orders/CostEntryDrawer.tsx` | 좌우 분할 레이아웃, 요약 카드 FIFO 지표 |
| `src/app/api/cost-management/products/[id]/entries/route.ts` | selling_price 필드 제거 |
| `src/app/api/cost-management/products/route.ts` | 요약 지표 FIFO 기반으로 교체 |
| `src/lib/cost-management/calculations.ts` | selling_price 관련 로직 제거, FIFO 연동 |

---

## 성공 기준

- [ ] 입고 추가/수정/삭제가 기존과 동일하게 동작
- [ ] 판매 수동 추가/수정/삭제 동작
- [ ] 쿠팡 가져오기로 판매 자동 수입, 중복 SKIP
- [ ] 쿠팡 가져온 행 수정/삭제 가능
- [ ] FIFO 기반 실현손익, 재고, 재고가치 정확히 표시
- [ ] 기존 selling_price > 0 데이터 sale_records로 마이그레이션 완료
