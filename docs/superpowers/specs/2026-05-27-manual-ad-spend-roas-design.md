# 수동 광고비 입력 + ROAS 자동 계산

**날짜**: 2026-05-27  
**상태**: 승인됨

## 배경

쿠팡 공식 Ads API가 없어 광고비 데이터는 로컬 Playwright 스크래퍼(`scripts/ad-scraper`)로만 수집 가능하다. 스크래퍼가 작동하지 않으면 `ad_spend`/`ad_roas`가 빈값으로 표시된다. 광고를 수시로 상품을 바꿔가며 운영하므로 수동 입력 + 이력 관리가 필요하다.

## 목표

- 비용관리 탭에서 복수 상품을 선택하고 기간 + 총 광고비를 입력
- Wing API 실제 매출 자동 조회 → ROAS 자동 계산
- 과거 광고 이력 저장 및 최신 1건을 행에 표시

## 데이터 모델

### 새 테이블: `product_ad_records` (Render PostgreSQL)

```sql
CREATE TABLE product_ad_records (
  id              SERIAL PRIMARY KEY,
  product_cost_id INTEGER NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  period_from     DATE NOT NULL,
  period_to       DATE NOT NULL,
  ad_spend        NUMERIC NOT NULL,           -- 균등 분배된 상품별 광고비 (원)
  revenue         NUMERIC NOT NULL DEFAULT 0, -- Wing API 자동 조회 매출
  roas            NUMERIC GENERATED ALWAYS AS
                    (CASE WHEN ad_spend > 0 THEN revenue / ad_spend * 100 ELSE NULL END)
                    STORED,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON product_ad_records (product_cost_id, created_at DESC);
CREATE INDEX ON product_ad_records (user_id, created_at DESC);
```

- `ad_spend`: 총 광고비를 선택 상품 수로 균등 분배한 값
- `roas`: DB generated column, 저장 시 자동 계산
- 상품당 여러 기록 누적 가능

## API

### POST `/api/cost-management/ad-records`

```ts
body: {
  product_cost_ids: number[]  // 선택된 상품 ID 목록
  period_from: string         // 'YYYY-MM-DD'
  period_to: string           // 'YYYY-MM-DD'
  total_ad_spend: number      // 총 광고비 (원)
}
```

처리 흐름:
1. `total_ad_spend ÷ product_cost_ids.length` 로 상품별 광고비 계산
2. 각 상품의 `vendor_item_id`를 `product_costs` 테이블에서 조회
3. Wing API `getRevenueHistory`를 기간 한 번 호출 → 전체 응답을 `vendorItemId`로 필터링해 상품별 매출 계산 (Wing API는 상품별 필터 미지원)
4. `product_ad_records`에 상품별 레코드 INSERT (`roas`는 API에서 계산 후 저장)
5. 저장된 레코드 목록 반환

> **참고**: `roas` 컬럼은 DB generated column 대신 INSERT 시 서버에서 계산해 저장하는 방식으로 구현해도 무방. Render PostgreSQL 버전에 따라 generated column 지원 여부 확인 필요.

### GET `/api/cost-management/ad-records?product_cost_id=xxx`

- 해당 상품의 광고 이력 전체 반환 (최신순)
- 드로어 이력 섹션에서 사용

### DELETE `/api/cost-management/ad-records/[id]`

- 잘못 입력한 레코드 삭제

### GET `/api/cost-management/products` 수정

- 기존: `ad_strategy_cache` 스크래퍼 데이터로 `ad_spend`/`ad_roas` 채움
- 변경: `product_ad_records` 최신 1건을 LEFT JOIN으로 함께 조회
  - 수동 입력 기록이 있으면 우선 사용
  - 없으면 기존 스크래퍼 캐시 폴백

## UI

### 비용관리 탭

- 각 상품 행 좌측에 체크박스 추가
- 1개 이상 선택 시 테이블 상단 툴바에 "광고비 입력" 버튼 활성화
- 기존 광고비/ROAS 셀은 `product_ad_records` 최신 1건값 표시
  - 없으면 `—` (기존 동작 유지)
  - 셀 호버 시 입력 기간 툴팁 표시

### 광고비 입력 드로어

```
┌──────────────────────────────────────┐
│ 광고비 입력 (3개 상품 선택됨)         │
├──────────────────────────────────────┤
│ 광고 기간                             │
│  [2025-05-01] ~ [2025-05-31]         │
│                                       │
│ 총 광고비                             │
│  [________] 원  ÷ 3 = 20만원/상품    │
├──────────────────────────────────────┤
│ 상품명        매출(Wing) ROAS         │
│ ○ 에어팟케이스  ₩620,000  310%  ✅  │
│ ○ 충전케이블    ₩180,000   90%  🔴  │
│ ○ 마우스패드    ₩410,000  205%  ⚠️  │
├──────────────────────────────────────┤
│          [취소]        [저장]         │
└──────────────────────────────────────┘
```

동작:
- 기간 + 광고비 입력 완료 시 → Wing API 자동 조회 (디바운스 500ms)
- 상품별 매출·ROAS 실시간 미리보기 업데이트
- ROAS 색상: `breakeven_roas` 초과 시 초록, 미달 시 빨강, 근접(±20%) 시 주황
- 저장 시 상품별 레코드 N개 생성

### 이력 섹션 (단일 상품 선택 시 드로어 하단)

- 해당 상품의 과거 광고 기록 목록 (최신순)
- 각 행: 기간 / 광고비 / ROAS / 삭제 버튼

## 컴포넌트 구조

```
src/
  components/orders/
    CostManagementTab.tsx         -- 체크박스 + 툴바 버튼 추가
    AdSpendDrawer.tsx             -- 신규: 광고비 입력 드로어
  app/api/cost-management/
    ad-records/
      route.ts                    -- GET, POST
      [id]/
        route.ts                  -- DELETE
```

## 에러 처리

- Wing API 매출 조회 실패 시: 해당 상품 ROAS를 `—`로 표시하고 저장은 허용 (`revenue=0`)
- 기간이 겹치는 기록 존재 시: 저장 허용 (덮어쓰지 않고 이력 누적, 사용자가 직접 오래된 것 삭제)

## 범위 외

- 광고비 자동 균등 분배가 아닌 상품별 개별 입력 (추후 고려)
- 쿠팡 외 플랫폼(네이버) 광고비 입력
