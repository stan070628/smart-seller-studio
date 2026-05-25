# 채널 간 재고 이동 & 네이버 판매 채널 추가 설계

**날짜:** 2026-05-25  
**범위:** 수익·원가 탭 — 채널 이동 기능 + 네이버 채널 전면 지원

---

## 배경 및 목표

현재 원가관리는 입고 채널로 `wing`(쿠팡 윙)과 `rg`(로켓그로스) 두 가지만 지원한다. 사용자가 윙으로 입고한 재고를 네이버 채널에서 판매하려 할 때, 채널 간 재고 이동 수단이 없다. 또한 네이버는 주문 조회만 가능하고 원가관리와 연동이 안 되어 있다.

목표:
1. 상품 행에서 재고를 다른 채널로 분할 이동하는 기능 추가
2. 네이버를 원가관리의 정식 채널로 추가 (입고·판매·필터·매출 요약)

---

## 1. 데이터 구조

### 새 테이블: `channel_transfers`

```sql
CREATE TABLE channel_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  product_cost_id UUID NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  from_channel    TEXT NOT NULL CHECK (from_channel IN ('wing', 'rg', 'naver')),
  to_channel      TEXT NOT NULL CHECK (to_channel IN ('wing', 'rg', 'naver')),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost       NUMERIC(12,2) NOT NULL,
  transferred_at  DATE NOT NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_channel_transfers_product ON channel_transfers(product_cost_id);
CREATE INDEX idx_channel_transfers_user ON channel_transfers(user_id);
```

- `unit_cost`: API가 이동 시점의 `from_channel` FIFO 단가를 자동 계산해서 기록
- 이동 취소는 레코드 삭제로 처리 (소프트 삭제 불필요)

### 기존 테이블 변경

**`cost_entries.channel` CHECK 제약 확장:**
```sql
ALTER TABLE cost_entries
  DROP CONSTRAINT cost_entries_channel_check,
  ADD CONSTRAINT cost_entries_channel_check
    CHECK (channel IN ('wing', 'rg', 'naver'));
```

### FIFO 채널 처리 방식

채널 이동은 **가상 입고/차감**으로 처리한다. 실제 `cost_entries`는 변경하지 않는다.

- `from_channel`: 이동 날짜 기준으로 FIFO에서 오래된 배치부터 해당 수량을 차감
- `to_channel`: 동일 단가(`unit_cost`)로 이동 날짜에 신규 입고된 것처럼 처리
- `fifo-summary` API에서 `channel_transfers`를 조인하여 채널별 재고를 계산

---

## 2. API 설계

### 신규 엔드포인트

#### `POST /api/cost-management/products/[id]/channel-transfer`
재고를 채널 간 이동한다.

**Request body:**
```json
{
  "from_channel": "wing",
  "to_channel": "naver",
  "quantity": 30,
  "transferred_at": "2026-05-25",
  "note": "네이버 채널 전환 (선택)"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "from_channel": "wing",
    "to_channel": "naver",
    "quantity": 30,
    "unit_cost": 8500,
    "transferred_at": "2026-05-25"
  }
}
```

**에러 케이스:**
- `from_channel` 재고 부족 → 400 `{ error: "wing 채널 재고가 부족합니다. 현재 재고: N개" }`
- `from_channel === to_channel` → 400

#### `GET /api/cost-management/products/[id]/channel-transfers`
이동 이력 목록 반환. 최신순 정렬.

#### `DELETE /api/cost-management/channel-transfers/[transferId]`
이동 취소. `user_id` 소유 확인 후 삭제.

### 기존 API 변경

| 엔드포인트 | 변경 내용 |
|---|---|
| `GET /api/cost-management/products` | `channel=naver` 필터 지원 |
| `POST /api/cost-management/products/[id]/entries` | `channel: 'naver'` 값 허용 |
| `GET /api/cost-management/products/[id]/fifo-summary` | `channel_transfers` 반영한 채널별 재고 계산 |
| `GET /api/cost-management/products/[id]/sales` | 네이버 판매 임포트 지원 |

### 네이버 판매 자동 연동

`GET /api/orders/naver` 응답을 원가관리 판매 내역으로 임포트하는 버튼. 기존 `SaleEntryPanel`의 쿠팡 판매 가져오기(`/api/cost-management/products/[id]/coupang-import`)와 동일 패턴으로 `/api/cost-management/products/[id]/naver-import` 신규 구현.

### 코드 상수 변경

```typescript
// src/lib/cost-management/fifo.ts
export const ENTRY_CHANNEL = {
  RG: 'rg',
  WING: 'wing',
  NAVER: 'naver',   // 추가
} as const;

export const SALE_CHANNEL = {
  ROCKET_GROWTH: 'rocket_growth',
  MANUAL: 'manual',
  COUPANG: 'coupang',
  NAVER: 'naver',   // 추가
} as const;
```

---

## 3. UI 설계

### CostManagementTab — 채널 필터

현재: `모두 | RG | 윙`  
변경: **`모두 | 윙 | RG | 네이버`**

네이버 선택 시 RG 실재고 조회 로직(`rg-inventory`)은 실행하지 않음.

### CostManagementTab — 상품 테이블

**헤더 변경:** `... | 재고 | 실현손익 | 마진율 | 광고비 | ROAS | 위너 | 입고 | 판매 | **이동** | 내역`

**행 변경:**
- 각 행 마지막에 `→` 아이콘 버튼 추가
- `current_stock === 0` 이면 버튼 비활성화(opacity 0.3, cursor default)

### 신규 컴포넌트: `ChannelTransferModal`

위치: `src/components/orders/ChannelTransferModal.tsx`

```
┌─────────────────────────────────────┐
│  📦 채널 간 재고 이동                   │
│  상품명: [상품명]                       │
│                                       │
│  이동할 수량     [____] 개              │
│  이동 날짜       [2026-05-25]          │
│                                       │
│  출발 채널 [wing ▼]  →  도착 채널 [naver ▼]│
│                                       │
│  출발 채널 현재 재고: 100개              │
│  이동 후: wing 70개 / naver 30개        │
│                                       │
│  메모 (선택)  [___________________]    │
│                                       │
│         [취소]        [이동 확인]        │
└─────────────────────────────────────┘
```

**동작:**
- 출발 채널 변경 시 해당 채널의 현재 재고를 API에서 실시간 조회
- 수량 > 출발 채널 재고 시 인라인 에러 표시, 이동 버튼 비활성화
- 이동 완료 후 `onChanged()` 콜백으로 상품 목록 새로고침

### CostEntryDrawer — 입고 채널

현재 wing/rg 토글 → **wing / RG / 네이버** 3개 토글로 확장.

### SaleEntryPanel — 네이버 판매 가져오기

기존 "쿠팡 판매 가져오기" 버튼 옆에 **"네이버 판매 가져오기"** 버튼 추가.  
동일한 날짜 범위 입력 폼 공유, 임포트 후 판매 내역 새로고침.

### 네이버 매출 요약 카드

CostManagementTab 상단 요약 카드에 네이버 매출·주문 수 카드 추가.  
기존 `naverRevenue`, `naverOrders` 값은 이미 API에서 계산되므로 UI만 추가.

---

## 4. 에러 처리

- 채널 이동 시 재고 부족: 모달 내 인라인 에러 (레드 텍스트)
- 이동 API 실패: toast/alert로 사용자 안내
- 네이버 판매 임포트 실패: 기존 쿠팡 임포트와 동일한 에러 처리 패턴
- `channel_transfers` 삭제 시 존재하지 않거나 타인 소유: 404

---

## 5. 구현 순서

1. DB 마이그레이션 (새 테이블 + constraint 변경)
2. `fifo.ts` 상수 확장 (`ENTRY_CHANNEL.NAVER`, `SALE_CHANNEL.NAVER`)
3. 채널 이동 API 3개 구현
4. 네이버 입고/판매 채널 기존 API에 반영
5. 네이버 판매 임포트 API (`naver-import`)
6. `ChannelTransferModal` 컴포넌트
7. CostManagementTab UI 변경 (필터·테이블 이동 버튼·네이버 카드)
8. CostEntryDrawer 채널 확장
9. SaleEntryPanel 네이버 임포트 버튼
