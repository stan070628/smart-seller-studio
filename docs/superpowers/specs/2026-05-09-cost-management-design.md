# 원가관리 메뉴 설계

**작성일:** 2026-05-09  
**상태:** 승인됨

---

## 1. 개요

상품별 매입 원가를 건별로 수기 입력하고, 판매가·배송비·플랫폼 수수료를 고려해 가중평균 기준 순이익·마진율을 계산·표시하는 관리 메뉴.

**위치:** 주문/매출(`/orders`) 메뉴 안 "원가관리" 탭 추가

---

## 2. 핵심 요구사항

- 상품 소스: 쿠팡 윙 등록 상품 자동 연동 + 수동 추가 병행
- 재고 차감: 완전 수동 (자동 차감 없음)
- 가중평균 계산: 판매가·원가·배송비 모두 건별 수량 가중평균
- 로켓그로스 배송비 공동 배분: 여러 상품을 체크박스로 묶어 총 배송비를 수량 비례 자동 배분
- 표시 지표: 판매가(가중평균) / 원가(가중평균) / 배송비(배분) / 수수료 / 순이익 / 마진율 / 재고

---

## 3. 아키텍처 — Entry-first + Shipping Group 태그

### 3.1 데이터 모델

```sql
-- 배송비 그룹 (로켓그로스 공동 배분) — cost_entries보다 먼저 정의
CREATE TABLE shipping_groups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name              text,                -- 예: "2026-05-09 로켓그로스 입고"
  total_shipping_fee int NOT NULL CHECK (total_shipping_fee >= 0),
  created_at        timestamptz DEFAULT now()
);

-- 상품 마스터
CREATE TABLE product_costs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_product_id bigint,              -- nullable, 쿠팡 등록 상품 연동
  product_name      text NOT NULL,
  platform          text DEFAULT 'coupang',
  platform_fee_rate decimal(5,4) DEFAULT 0.1080, -- 수수료율 (로켓그로스 기본 10.8%, 사용자 수정 가능)
  current_stock     int DEFAULT 0,       -- 수동 관리 재고 (입고 건 추가 시 자동 증가하지 않음)
  created_at        timestamptz DEFAULT now()
);

-- 건별 입고 내역
CREATE TABLE cost_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  product_cost_id   uuid REFERENCES product_costs(id) ON DELETE CASCADE,
  received_at       date NOT NULL,
  quantity          int NOT NULL CHECK (quantity > 0),
  unit_cost         int NOT NULL CHECK (unit_cost >= 0),   -- 원가 단가
  unit_shipping_fee int DEFAULT 0,                         -- 배분된 배송비 (개당)
  selling_price     int NOT NULL CHECK (selling_price > 0),
  shipping_group_id uuid REFERENCES shipping_groups(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now()
);
```

### 3.2 계산 로직

상품 목록 테이블에 표시할 값은 모두 `cost_entries` 집계:

| 지표 | 계산식 |
|------|--------|
| 가중평균 원가 | `Σ(unit_cost × quantity) / Σ(quantity)` |
| 가중평균 배송비 | `Σ(unit_shipping_fee × quantity) / Σ(quantity)` |
| 가중평균 판매가 | `Σ(selling_price × quantity) / Σ(quantity)` |
| 수수료 | `가중평균 판매가 × platform_fee_rate` |
| 순이익 | `가중평균 판매가 - 가중평균 원가 - 가중평균 배송비 - 수수료` |
| 마진율 | `순이익 / 가중평균 판매가 × 100` |

### 3.3 배송비 그룹 배분 로직

1. 그룹에 속한 entries의 총수량 = `Σ(quantity)`
2. 각 entry의 `unit_shipping_fee` = `total_shipping_fee × (entry.quantity / 총수량)` (정수 반올림)
3. 반올림 오차는 첫 번째 entry에 흡수

---

## 4. UI 컴포넌트 구성

```
/orders 페이지
└── OrdersClient.tsx          (서브탭에 '원가관리' 추가)
    └── CostManagementTab.tsx (메인 탭 — 요약 카드 + 상품 테이블)
        ├── CostEntryDrawer.tsx      (건별 입고 내역 사이드 패널)
        ├── ShippingGroupModal.tsx   (배송비 그룹 생성 팝업)
        └── AddProductModal.tsx      (상품 추가 — 쿠팡 연동 or 수동 입력)
```

> **재고 관리 방식:** `current_stock`은 입고 건 추가·삭제와 자동 연동하지 않음. 별도 재고 수정 버튼(PATCH `/stock`)으로만 변경. 입고 건은 원가/배송비 계산용이고 재고는 독립적으로 수동 관리.

> **수수료율:** 상품 추가 시 기본값 10.8% 적용, AddProductModal에서 직접 수정 가능. 플랫폼별 수수료 차이는 사용자가 직접 관리.

### 4.1 CostManagementTab (메인)

- **요약 카드 4종:** 관리 상품 수 / 총 매입금액 / 평균 마진율 / 마진 위험 상품 수(마진율 5% 미만)
- **액션 버튼:** `+ 상품 추가` / `배송비 그룹 생성` / 상품명 검색
- **상품 테이블:** 체크박스 | 상품명 | 판매가(가중평균) | 원가(가중평균) | 배송비(배분) | 수수료 | 순이익 | 마진율 | 재고 | 내역 버튼
- 마진율 음수 행은 연한 빨간 배경 강조
- "📋 N건" 버튼 클릭 → CostEntryDrawer 오픈
- 원가 미입력 쿠팡 등록 상품은 목록 하단에 회색으로 표시

### 4.2 CostEntryDrawer (건별 입고 내역)

- 상단: 가중평균 원가·배송비·마진율 요약 카드
- 건별 테이블: 입고일 / 수량 / 단가(원가) / 배송비(배분값 + 그룹 태그) / 판매가 / 편집 버튼
- 배송그룹 소속 → 파란 태그, 개별 입고 → 회색 태그
- 하단: `+ 새 입고 건 추가` 버튼

### 4.3 ShippingGroupModal (배송비 그룹 생성)

- 상품 체크박스 목록 (수량 미입력 상품 비활성)
- 총 배송비 입력 필드
- 수량 비례 자동 배분 미리보기 (실시간 계산)
- `그룹 생성 & 배분 적용` → 해당 entries의 `unit_shipping_fee` / `shipping_group_id` 일괄 업데이트

---

## 5. API Routes

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/cost-management/products` | 상품 목록 + 가중평균 집계 |
| POST | `/api/cost-management/products` | 상품 추가 (수동) |
| GET | `/api/cost-management/products/[id]/entries` | 건별 입고 내역 |
| POST | `/api/cost-management/products/[id]/entries` | 입고 건 추가 |
| PATCH | `/api/cost-management/entries/[id]` | 입고 건 수정 |
| DELETE | `/api/cost-management/entries/[id]` | 입고 건 삭제 |
| PATCH | `/api/cost-management/products/[id]/stock` | 재고 수동 수정 |
| POST | `/api/cost-management/shipping-groups` | 배송비 그룹 생성 + 배분 적용 |

---

## 6. 범위 외 (이번 구현 제외)

- 판매 연동 자동 재고 차감
- 쿠팡 판매 데이터 기반 실제 판매수량 반영
- 엑셀 일괄 업로드
- 손익분기가(BEP) 계산 표시
