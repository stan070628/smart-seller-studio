# 원가 채널 분리 설계 — RG / 윙 입고·재고·손익 완전 분리

## 배경

현재 `cost_entries`(입고)는 채널 구분 없이 하나의 pool로 관리된다. 동일 상품이 윙과 RG에 동시 연결된 경우, FIFO 계산이 채널 구분 없이 섞여 채널별 재고·손익을 파악할 수 없다. RG는 쿠팡 물류센터에 입고하므로 원가 계산 기준이 윙과 다르고, 양 채널의 재고 풀도 물리적으로 분리된다.

**해결하는 문제:**
- 윙 입고와 RG 입고가 같은 원가 pool에서 FIFO 소진됨
- 채널별 재고·손익을 분리해 볼 수 없음
- 윙 판매가 수동 입력이라 RG와 달리 데이터 신뢰성이 낮음
- RG 창고 실재고와 원가재고 괴리를 감지할 방법이 없음

**구현하지 않는 것:** 채널 간 재고 이동 기능, 윙 주문·배송 상태 연동, 정산 금액 대사

---

## DB 변경

### `cost_entries.channel` 컬럼 추가

```sql
ALTER TABLE cost_entries
  ADD COLUMN channel TEXT NOT NULL DEFAULT 'wing';

-- 기존 데이터 자동 분류
UPDATE cost_entries SET channel = 'rg'   WHERE unit_rg_shipping_fee > 0;
UPDATE cost_entries SET channel = 'wing' WHERE unit_rg_shipping_fee = 0;
```

가능한 값: `'rg'` | `'wing'`

`sale_records.channel`은 기존 값(`'rocket_growth'` / `'manual'` / `'coupang'`) 그대로 유지. 추가 변경 없음.

---

## FIFO 로직 분리

파일: `src/lib/cost-management/fifo.ts`

FIFO 계산 시 판매 채널에 따라 소진할 입고 풀을 필터링한다.

| 판매 채널 (sale_records.channel) | 소진 대상 입고 (cost_entries.channel) |
|---|---|
| `'rocket_growth'` | `'rg'` |
| `'manual'`, `'coupang'` | `'wing'` |

`/api/cost-management/products` 엔드포인트도 동일하게 채널별 분리 계산을 적용한다.

**엣지 케이스:**
- channel='wing' 입고가 없는데 윙 판매가 있으면 → 손익 0으로 처리 (재고 부족 경고)
- 마이그레이션 후 channel 미분류 데이터 발생 시 → 기본값 'wing' 유지

---

## API 변경

### 기존: `GET /api/cost-management/products`

쿼리 파라미터 `channel` 추가 (`'all'` | `'rg'` | `'wing'`, 기본값 `'all'`).

- `'rg'`: `vendor_item_id IS NOT NULL`인 상품만 반환
- `'wing'`: `seller_product_id IS NOT NULL`인 상품만 반환
- `'all'`: 기존 동작 유지

각 상품의 `current_stock`, `total_realized_profit` 등 집계 값은 채널별 입고/판매만 사용해 계산.

---

### 신규: `GET /api/cost-management/rg-inventory`

`rg/inventory/summaries` API를 호출해 RG 창고 실재고를 반환한다.

**내부 동작:**
1. user의 `product_costs`에서 `vendor_item_id IS NOT NULL`인 목록 조회
2. 각 `vendorItemId`로 `GET .../rg/inventory/summaries?vendorItemId={id}` 호출
3. `totalOrderableQuantity` 반환

**응답:**
```json
{
  "data": [
    { "vendorItemId": 123456, "actualStock": 30 }
  ]
}
```

---

### 신규: `POST /api/cost-management/wing-bulk-import`

`revenue-history` API로 윙 판매를 자동 가져온다.

**Body:**
```json
{ "from": "2026-05-01", "to": "2026-05-31" }
```

**내부 동작:**
1. Wing `GET /seller-products?status=APPROVED&maxPerPage=100` 페이지네이션 전체 호출 → `sellerProductId → vendorItemId[]` 매핑 테이블 구성 (상품별 개별 호출 대신 목록 1회 조회)
2. user의 `product_costs`에서 `seller_product_id IS NOT NULL`인 목록으로 매핑 테이블 필터링
3. `revenue-history` API 호출 (31일 초과 시 `splitInto30DayChunks` 분할 병렬 호출)
4. `recognitionDateTo` = min(to, 어제) 자동 조정 (당일 조회 불가 제약)
5. 각 item의 `vendorItemId`로 product_costs 연결 → `sale_records` INSERT
6. `coupang_order_item_id = "wing-{orderId}-{vendorItemId}"` 형태로 중복 방지 (`ON CONFLICT DO NOTHING`)

**응답:**
```json
{ "imported": 12, "skipped": 3 }
```

**엣지 케이스:**
- vendorItemId 매핑 실패 시 해당 item 스킵 (로그만 남김)
- `token=` 빈값 필수 (누락 시 400 — revenue-history 제약)
- `recognitionDateTo`가 오늘이면 자동으로 어제로 보정

---

## UI 변경

### CostManagementTab

**① 채널 필터 버튼** — 기간 필터 옆에 추가
```
[전체]  [윙판매]  [RG]
```
- 선택 시 `GET /api/cost-management/products?channel={value}` 재요청

**② RG 탭 — 실재고 비교 컬럼**
- 채널 필터 'RG' 선택 시 `rg-inventory` API 병렬 호출
- 기존 "재고" 컬럼 오른쪽에 "RG 실재고" 컬럼 추가
- 원가재고 ≠ 실재고 시 ⚠️ 아이콘 표시 (툴팁: "원가재고 N개 / 실재고 M개")

**③ 윙 판매 가져오기 버튼**
- 기존 RG "일괄 가져오기" 버튼과 동일한 위치에 "윙 판매 가져오기" 버튼 추가
- 채널 필터가 '윙' 또는 '전체'일 때 활성화
- 클릭 시 현재 기간으로 `wing-bulk-import` 호출, 완료 후 토스트 알림

### CostEntryDrawer (입고 등록)

**④ 채널 선택 UI**
- `vendor_item_id`만 있는 RG 전용 상품: 'RG 창고 입고' 고정 (선택 불필요)
- `seller_product_id`만 있는 윙 전용 상품: 'Wing 보관 입고' 고정
- 둘 다 있는 상품: "입고 채널" 라디오 버튼 표시 → `cost_entries.channel` 설정

---

## 데이터 흐름

```
채널 필터 변경
  ├─ channel='rg'  → products API (RG 입고 기반 FIFO) + rg-inventory 병렬 호출
  ├─ channel='wing' → products API (Wing 입고 기반 FIFO) + 윙 판매 가져오기 버튼 표시
  └─ channel='all' → products API (기존 동작)

입고 등록 (CostEntryDrawer)
  └─ 채널 선택 → cost_entries.channel 설정

윙 판매 가져오기
  └─ seller-products API (vendorItemId 매핑) → revenue-history → sale_records INSERT

RG 판매 가져오기 (기존)
  └─ rg/orders API → sale_records INSERT (channel='rocket_growth')
```

---

## 구현 파일 목록

| 파일 | 변경 유형 |
|------|---------|
| `supabase/migrations/068_cost_entries_channel.sql` | 신규 — channel 컬럼 추가 + 기존 데이터 마이그레이션 |
| `src/lib/cost-management/fifo.ts` | 수정 — 채널별 입고 필터링 |
| `src/app/api/cost-management/products/route.ts` | 수정 — channel 파라미터 처리 |
| `src/app/api/cost-management/rg-inventory/route.ts` | 신규 — RG 실재고 조회 |
| `src/app/api/cost-management/wing-bulk-import/route.ts` | 신규 — 윙 판매 자동 가져오기 |
| `src/components/orders/CostManagementTab.tsx` | 수정 — 채널 필터, RG 실재고 컬럼, 윙 가져오기 버튼 |
| `src/components/orders/CostEntryDrawer.tsx` | 수정 — 채널 선택 UI |
| `src/lib/listing/coupang-client.ts` | 수정 불필요 — `getRevenueHistory()` 이미 구현됨 |
