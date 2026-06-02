# 로켓그로스 입고 이력 조회 기능 설계

**날짜:** 2026-06-02  
**위치:** 주문매출 메뉴 > 수익 원가 탭 (CostManagementTab)

---

## 1. 목표

로켓그로스 입고를 등록할 때마다 이벤트를 기록하고, "🕐" 아이콘 클릭 시 팝오버로 입고 이력을 조회할 수 있게 한다.

- **범위:** 구현 시점 이후 등록분부터 이력 누적 (기존 데이터 역추적 불가 — 허용됨)
- **조회 UI:** 팝오버 (모달/드로어 아님)
- **상세 수준:** 날짜 + 총 배송비 + 상품별 수량·단위배송비 인라인 표시 (클릭 없이)

---

## 2. 데이터 모델

### 신규 테이블 2개 (마이그레이션)

```sql
-- 입고 이벤트 (1회 등록 = 1행)
CREATE TABLE rg_shipment_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  shipped_at         date NOT NULL,
  total_shipping_fee integer NOT NULL CHECK (total_shipping_fee >= 0),
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX idx_rg_shipment_events_user
  ON rg_shipment_events (user_id, shipped_at DESC);

-- 입고 이벤트 상품 목록 (1이벤트 N개 상품)
CREATE TABLE rg_shipment_event_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_event_id uuid REFERENCES rg_shipment_events(id) ON DELETE CASCADE,
  product_cost_id   uuid NOT NULL,
  product_name      text NOT NULL,     -- 삭제·변경 대비 스냅샷
  quantity          integer NOT NULL CHECK (quantity > 0),
  unit_rg_fee       integer NOT NULL CHECK (unit_rg_fee >= 0)
);

CREATE INDEX idx_rg_shipment_event_items_event
  ON rg_shipment_event_items (shipment_event_id);
```

`product_name`을 스냅샷으로 저장해 상품 삭제·이름 변경 후에도 이력에서 원래 상품명을 확인할 수 있다.

---

## 3. API 변경

### 3-1. 기존 `POST /api/cost-management/rg-shipments` 수정

기존 트랜잭션 안에 이벤트 기록 INSERT를 추가한다. FIFO 처리와 이벤트 저장이 하나의 트랜잭션으로 묶여 실패 시 함께 롤백된다.

```
BEGIN
  1. (기존) 상품별 소유권·재고 확인
  2. (기존) FIFO 배치 ops 계산 → cost_entries UPDATE/INSERT
  3. (신규) rg_shipment_events INSERT → event_id 획득
  4. (신규) rg_shipment_event_items INSERT × items.length
             (product_name은 product_costs에서 조회)
COMMIT
```

응답은 기존과 동일 (`affected_entries`, `split_entries`). 이벤트 ID는 내부 기록용으로만 사용.

### 3-2. 신규 `GET /api/cost-management/rg-shipments`

```
GET /api/cost-management/rg-shipments?limit=20

응답:
{
  success: true,
  data: [
    {
      id: "uuid",
      shipped_at: "2026-05-28",
      total_shipping_fee: 22750,
      created_at: "2026-05-28T10:23:00Z",
      items: [
        { product_name: "여름 반팔 티셔츠 (화이트)", quantity: 100, unit_rg_fee: 152 },
        { product_name: "여름 반팔 티셔츠 (블랙)",   quantity: 30,  unit_rg_fee: 152 },
        { product_name: "린넨 반바지",               quantity: 20,  unit_rg_fee: 151 }
      ]
    },
    ...
  ]
}
```

- `shipped_at DESC` 정렬, 기본 20건
- `user_id` 필터 필수 (기존 패턴과 동일하게 `getCurrentUser()` 사용)

---

## 4. UI 변경

### 4-1. 버튼 그룹 변경 (`CostManagementTab.tsx`)

기존의 독립 버튼:
```
[📦 로켓그로스 입고 등록]
```

변경 후 — 두 버튼을 하나의 그룹으로 묶음:
```
[📦 로켓그로스 입고 등록 | 🕐]
```

- 왼쪽: 기존 `setShowRgModal(true)` 동작 유지
- 오른쪽 🕐: `showRgHistory` 상태를 토글 → 팝오버 열기/닫기
- 버튼 그룹은 `border: 1px solid #bae6fd`, `overflow: hidden`, `border-radius: 8px`로 감쌈

### 4-2. 신규 `RgShipmentHistoryPopover` 컴포넌트

**파일:** `src/components/orders/RgShipmentHistoryPopover.tsx`

```
Props:
  anchorRef: RefObject<HTMLDivElement>  // 버튼 그룹 ref (위치 기준)
  onClose: () => void

동작:
  - 마운트 시 GET /api/cost-management/rg-shipments?limit=20 호출
  - 외부 클릭(useEffect + mousedown listener) 시 onClose()
  - position: absolute, top: anchorRef 아래, left 정렬
```

**팝오버 레이아웃:**
- 너비: 340px 고정
- 헤더: "📋 로켓그로스 입고 이력" + "최근 20건" 레이블
- 이력 목록 (max-height: 360px, overflow-y: auto):
  - 입고일 (bold) + 총 배송비 뱃지 (파란 pill)
  - 상품 미니 테이블: 상품명 / 수량 / 단위배송비 (3열)
  - 총 수량 합계 (우측 정렬, 작은 글씨)
- 빈 상태: "아직 등록된 입고 이력이 없습니다"
- 로딩 상태: 스피너 또는 "불러오는 중..."

---

## 5. 파일 변경 목록

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `supabase/migrations/075_rg_shipment_events.sql` | 신규 | 테이블 2개 생성 |
| `src/app/api/cost-management/rg-shipments/route.ts` | 수정 | POST: 이벤트 INSERT 추가 / GET: 이력 조회 추가 |
| `src/components/orders/RgShipmentHistoryPopover.tsx` | 신규 | 팝오버 컴포넌트 |
| `src/components/orders/CostManagementTab.tsx` | 수정 | 버튼 그룹화 + 팝오버 렌더링 |

---

## 6. 에러 처리

- GET 실패 시: 팝오버 안에 에러 메시지 인라인 표시 (alert 불사용)
- POST 실패 시: 이벤트 INSERT 실패가 전체 트랜잭션 롤백을 유발 → 기존 에러 처리와 동일하게 `json.error` 표시

---

## 7. 범위 외

- 이력 삭제/수정 기능 — 이번 범위 외
- 이력 기반 통계(월별 입고 총량 등) — 이번 범위 외
- 페이지네이션 — 20건 limit으로 충분, 추후 필요 시 추가
