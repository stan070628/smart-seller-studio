# 로켓그로스 입고 배송비 설계 스펙

**작성일:** 2026-05-09  
**상태:** 승인됨

---

## 목표

셀러가 여러 종류의 상품을 쿠팡 로켓그로스 물류센터로 보낼 때 발생하는 배송비를 기록하고, 수량 비례로 각 상품에 배분해 FIFO 원가 계산에 반영한다.

현재 `shipping_groups`로 처리하는 소싱 배송비(1688/도매꾹 → 국내)와 구분된 별도 단계로 관리한다.

---

## Section 1 — DB 스키마

### `cost_entries` — 컬럼 추가

```sql
ALTER TABLE cost_entries
  ADD COLUMN unit_rg_shipping_fee integer NOT NULL DEFAULT 0;
```

FIFO 원가 계산 기준:
```
unit_total_cost = unit_cost + unit_shipping_fee + unit_rg_shipping_fee
```

### 입고 배치 분할 규칙

로켓그로스로 입고 배치의 일부 수량만 보낼 때 해당 배치를 두 행으로 분할한다.

예: cost_entry(quantity=30) → 20개만 로켓그로스로 보낼 때
```
BEFORE: cost_entry(id=A, quantity=30, unit_rg_shipping_fee=0)

AFTER:
  cost_entry(id=A,   quantity=20, unit_rg_shipping_fee=650)  ← RG 출고분
  cost_entry(id=NEW, quantity=10, unit_rg_shipping_fee=0)    ← 나머지
  (id=NEW는 원본 A의 모든 필드 복사, quantity만 차감)
```

전체 수량을 보낼 때는 분할 없이 `unit_rg_shipping_fee`만 업데이트한다.

### 마이그레이션

파일: `supabase/migrations/059_rg_shipping_fee.sql`

```sql
BEGIN;
ALTER TABLE cost_entries
  ADD COLUMN IF NOT EXISTS unit_rg_shipping_fee integer NOT NULL DEFAULT 0;
COMMIT;
```

---

## Section 2 — 비즈니스 로직

### 배분 방식

현재 `shipping_groups`와 동일한 수량 비례 배분을 사용한다.

```
상품별 unit_rg_fee = floor(총배송비 × 해당수량 / 전체수량)
반올림 오차(나머지) → 첫 번째 상품의 unit_rg_fee에 더함
```

### 배치 소진 순서

각 상품에서 "보낼 수량"을 채울 때 `received_at ASC` 순서(FIFO)로 배치를 소진한다.

예: 상품A 20개 보내기 / 배치: [05-01에 30개]
→ 배치 30개에서 20개 차감 → 배치를 20개(RG) + 10개(나머지)로 분할

예: 상품A 25개 보내기 / 배치: [04-01에 10개, 05-01에 30개]
→ 04-01 배치(10개) 전량 RG → 05-01 배치에서 15개만 RG(분할)

### API 트랜잭션 처리

모든 분할 및 업데이트는 단일 트랜잭션으로 원자적으로 처리한다.

각 item에 대해:
1. `cost_entries WHERE product_cost_id = $id ORDER BY received_at ASC`로 배치 목록 조회
2. 보낼 수량만큼 FIFO 소진:
   - 배치 전량 = 보낼 수량 → `unit_rg_shipping_fee` UPDATE
   - 배치 일부만 필요 → 해당 배치 분할 후 앞쪽에 `unit_rg_shipping_fee` UPDATE
3. 소진 후 남은 배치는 변경 없음

---

## Section 3 — API

### `POST /api/cost-management/rg-shipments`

요청 body:
```json
{
  "shipped_at": "2026-05-09",
  "total_shipping_fee": 22750,
  "items": [
    { "product_cost_id": "uuid-a", "quantity": 20, "unit_rg_fee": 650 },
    { "product_cost_id": "uuid-b", "quantity": 15, "unit_rg_fee": 650 }
  ]
}
```

- `total_shipping_fee`: 참고용 기록 (배분은 `unit_rg_fee`로 이미 계산된 값 사용)
- `unit_rg_fee`: 클라이언트에서 미리보기 계산 후 전달
- 서버에서 `sum(quantity × unit_rg_fee)`와 `total_shipping_fee`가 일치하는지 검증

응답:
```json
{ "success": true, "data": { "affected_entries": 3, "split_entries": 1 } }
```

유효성 검사:
- `shipped_at`: `YYYY-MM-DD` 형식
- `items` 비어있으면 400
- 각 item `quantity > 0`, `unit_rg_fee >= 0`
- 각 product_cost_id 소유권 확인 (`user_id` 일치)
- 상품별 로켓그로스로 보낼 수량 > 현재 재고(`SUM(quantity) from cost_entries`) → 400

---

## Section 4 — UI

### `RocketGrowthShipmentModal` (신규)

진입점: `CostManagementTab` 상단 "🚚 로켓그로스 입고 등록" 버튼

모달 레이아웃:
```
┌─────────────────────────────────────────┐
│  🚚 로켓그로스 입고 등록              ✕  │
├─────────────────────────────────────────┤
│  입고일: [날짜 입력]                     │
│  총 배송비: [금액 입력]                  │
├─────────────────────────────────────────┤
│  상품명          재고   이번 수량  unit배송비│
│  컬럼비아 백팩   14개   [  20  ]  650원  │
│  나이키 후드     30개   [   0  ]   —     │
│  ...                                    │
├─────────────────────────────────────────┤
│  합계: 20개 / 배송비 13,000원            │
│                         [취소] [등록]    │
└─────────────────────────────────────────┘
```

- 총 배송비 + 수량 입력 시 실시간으로 `unit_rg_fee` 미리보기 계산
- 수량 0인 상품은 배분 제외
- "등록" 클릭 → `POST /api/cost-management/rg-shipments`

### `CostEntryDrawer` — 입고 패널 컬럼 추가

기존 헤더: `입고일 | 수량 | 단가 | 배송비 | [그룹] | 액션`  
변경 후: `입고일 | 수량 | 단가 | 배송비 | RG배송비 | [그룹] | 액션`

- `unit_rg_shipping_fee === 0`이면 `—` 표시
- 0보다 크면 파란색으로 표시 (예: `650`)

### `CostManagementTab` — 버튼 추가

기존 액션 버튼 행에 추가:
```
[+ 상품 추가]  [배송비 그룹 생성]  [🚚 로켓그로스 입고 등록]
```

---

## 영향받는 파일

### 신규 생성

| 파일 | 역할 |
|------|------|
| `supabase/migrations/059_rg_shipping_fee.sql` | `unit_rg_shipping_fee` 컬럼 추가 |
| `src/app/api/cost-management/rg-shipments/route.ts` | 로켓그로스 입고 등록 API |
| `src/components/orders/RocketGrowthShipmentModal.tsx` | 입고 등록 모달 컴포넌트 |

### 수정

| 파일 | 변경 내용 |
|------|-----------|
| `src/lib/cost-management/fifo.ts` | `PurchaseBatch`에 `unit_rg_shipping_fee` 추가, 원가 합산 반영 |
| `src/lib/cost-management/__tests__/fifo.test.ts` | rg_fee 포함 테스트 케이스 추가 |
| `src/components/orders/CostManagementTab.tsx` | "로켓그로스 입고 등록" 버튼 + 모달 연결 |
| `src/components/orders/CostEntryDrawer.tsx` | 입고 패널에 RG배송비 컬럼 추가 |
| `src/app/api/cost-management/products/[id]/entries/route.ts` | GET 응답에 `unit_rg_shipping_fee` 포함 |
| `src/app/api/cost-management/entries/[id]/route.ts` | PATCH에서 `unit_rg_shipping_fee` 수정 허용 |
| `src/app/api/cost-management/products/[id]/fifo-summary/route.ts` | `unit_rg_shipping_fee` 전달 |
| `src/app/api/cost-management/products/route.ts` | `unit_rg_shipping_fee` 전달 |

---

## 성공 기준

- [ ] 로켓그로스 입고 등록 모달에서 여러 상품 선택 + 총 배송비 입력 → 수량 비례 배분 미리보기 표시
- [ ] 등록 시 FIFO 순서로 배치 소진, 일부 수량이면 자동 분할
- [ ] 분할된 배치가 CostEntryDrawer 입고 패널에 올바르게 표시됨
- [ ] FIFO 원가 = `unit_cost + unit_shipping_fee + unit_rg_shipping_fee` 합산 정확
- [ ] 보낼 수량 > 현재 재고 시 400 오류
- [ ] TypeScript 컴파일 오류 없음
- [ ] fifo.ts 테스트 모두 통과
