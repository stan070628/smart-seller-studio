# 채널 판매 단위 배수 (unit_multiplier) 설계

**날짜:** 2026-06-21  
**기능 영역:** CostManagementTab — 채널별 판매 단위 배수, 판매 자동 임포트 재고 차감

---

## 1. 배경

다슈 울트라하드 왁스(등록상품ID: 16262230452)처럼 단품 재고 하나를 1개·2개·3개 세트로 묶어서 판매하는 경우, 현재 시스템은 쿠팡 주문 `quantity`를 그대로 `sale_records.quantity`에 저장한다. 이렇게 하면 "2개입 1건 판매" 시 재고가 1개만 차감되어 재고·원가 계산이 틀어진다.

**요구사항:**
- 입고는 단품 단위(1개)로 기록
- 판매 자동 임포트 시 옵션별 세트 크기(배수)만큼 재고 차감
- 배수는 옵션ID(`product_cost_channels.external_id`) 단위로 설정

---

## 2. 데이터 모델

### 2-1. Migration 081 — `product_cost_channels.unit_multiplier` 추가

```sql
ALTER TABLE product_cost_channels
  ADD COLUMN unit_multiplier INTEGER NOT NULL DEFAULT 1
  CHECK (unit_multiplier >= 1);

COMMENT ON COLUMN product_cost_channels.unit_multiplier IS
  '판매 1건당 소비되는 단품 개수. 1개입=1(기본), 2개입=2, 3개입=3.';
```

- 기존 행: `DEFAULT 1` → 기존 데이터 호환
- Render PostgreSQL에 psql로 직접 적용 (앱은 Render DB 사용)

---

## 3. API 변경

### 3-1. GET `/api/cost-management/products/[id]/channels`

`unit_multiplier` 컬럼을 응답에 포함:
```sql
SELECT id, channel_type, external_id, unit_multiplier, created_at
FROM product_cost_channels ...
```

### 3-2. POST `/api/cost-management/products/[id]/channels`

요청 body에서 `unit_multiplier` 수용 (선택, 기본 1):
```typescript
const { channel_type, external_id, unit_multiplier = 1 } = body ?? {};

// 검증 추가
if (!Number.isInteger(unit_multiplier) || unit_multiplier < 1) {
  return 400 error;
}

// INSERT에 unit_multiplier 추가
INSERT INTO product_cost_channels
  (user_id, product_cost_id, channel_type, external_id, unit_multiplier)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id, channel_type, external_id) DO UPDATE
  SET product_cost_id = EXCLUDED.product_cost_id,
      unit_multiplier = EXCLUDED.unit_multiplier
RETURNING id, channel_type, external_id, unit_multiplier, created_at
```

---

## 4. UI 변경 — ChannelEditPopover

### 4-1. 채널 추가 폼

옵션ID 입력 옆에 `unit_multiplier` 숫자 입력 추가:

```
[RG ▼] [옵션ID___________] [×__]
```

- 레이블: `×` (판매 단위 배수)
- 기본값: 1
- 최소값: 1, 정수만 허용
- 너비: 40px 고정

### 4-2. 채널 목록 표시

`unit_multiplier > 1` 인 항목만 배지 표시:

```
RG  | 95401822935       [복사] [삭제]   ← ×1, 표시 없음
RG  | 95401822936  ×2   [복사] [삭제]   ← 2개입
RG  | 95401822937  ×3   [복사] [삭제]   ← 3개입
```

### 4-3. ChannelEntry 타입 확장

```typescript
interface ChannelEntry {
  id: string;
  channel_type: 'coupang_rg' | 'coupang_wing' | 'naver';
  external_id: number;
  unit_multiplier: number; // 추가
}
```

---

## 5. 판매 자동 임포트 변경

### 5-1. rg-bulk-import

채널 조회 시 `unit_multiplier` 포함:
```sql
SELECT product_cost_id, external_id, unit_multiplier
FROM product_cost_channels
WHERE user_id = $1 AND channel_type = 'coupang_rg'
```

`vendorItemMap` 구조 변경:
```typescript
// 기존: Map<number, string>  (vendorItemId → product_cost_id)
// 변경: Map<number, { id: string; multiplier: number }>
const vendorItemMap = new Map<number, { id: string; multiplier: number }>();
```

판매 quantity 계산:
```typescript
// 기존
const productCostId = vendorItemMap.get(item.vendorItemId);
records.push({ product_cost_id: productCostId, quantity: item.quantity, ... });

// 변경
const match = vendorItemMap.get(item.vendorItemId);
records.push({
  product_cost_id: match.id,
  quantity: item.quantity * match.multiplier,  // 배수 적용
  ...
});
```

### 5-2. wing-bulk-import

동일한 패턴 적용. `wingChannels` 맵도 `{ id, multiplier }` 구조로 변경.

---

## 6. 적용 예시 — 다슈 울트라하드 왁스

```
product_costs 행 1개:
  product_name = "다슈 울트라하드 왁스"
  seller_product_id = 16262230452

product_cost_channels:
  RG  | 옵션ID(1개입) | unit_multiplier=1
  RG  | 옵션ID(2개입) | unit_multiplier=2
  RG  | 옵션ID(3개입) | unit_multiplier=3
  윙  | 옵션ID(1개입) | unit_multiplier=1
  윙  | 옵션ID(2개입) | unit_multiplier=2
  윙  | 옵션ID(3개입) | unit_multiplier=3

입고:
  박스 1개(왁스 3개) 사입 → cost_entries.quantity = 3

판매 임포트 결과:
  1개입 1건 → sale_records.quantity = 1×1 = 1 차감
  2개입 1건 → sale_records.quantity = 1×2 = 2 차감 ✅
  3개입 2건 → sale_records.quantity = 2×3 = 6 차감 ✅
```

---

## 7. 변경 파일 목록

| 파일 | 변경 내용 |
|------|---------|
| `supabase/migrations/081_channel_unit_multiplier.sql` | 신규: unit_multiplier 컬럼 추가 |
| `src/app/api/cost-management/products/[id]/channels/route.ts` | GET/POST에 unit_multiplier 처리 |
| `src/components/orders/ChannelEditPopover.tsx` | 채널 추가 폼 × 입력 필드, 목록 ×N 배지 |
| `src/app/api/cost-management/rg-bulk-import/route.ts` | vendorItemMap 구조 변경, quantity × multiplier |
| `src/app/api/cost-management/wing-bulk-import/route.ts` | 동일 패턴 적용 |

신규 파일: 0개 (migration 제외)

---

## 8. 제외 스코프

- 수동 판매 입력(`/api/.../sales` POST): 사용자가 직접 소비 개수를 입력하므로 변경 없음
- naver 채널 임포트: `unit_multiplier` 컬럼은 추가되나 네이버 임포트 로직은 이번 스코프 밖
- 기존 `sale_records` 소급 수정: 기존 데이터는 건드리지 않음 (migration 적용 후 신규 임포트부터 반영)
