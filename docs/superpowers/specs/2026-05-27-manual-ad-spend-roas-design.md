# 수동 광고비 입력 + ROAS 자동 계산

**날짜**: 2026-05-27  
**상태**: 승인됨

## 배경

쿠팡 공식 Ads API가 없어 광고비 데이터는 로컬 Playwright 스크래퍼로만 수집 가능하다. 스크래퍼가 작동하지 않으면 `ad_spend`/`ad_roas`가 모두 빈값으로 표시된다. 상품별로 월 단위 광고비를 직접 입력하고 ROAS를 자동 계산하는 기능이 필요하다.

## 목표

- 수익 원가 탭 테이블에서 상품별 광고비 셀을 인라인으로 클릭 편집
- 월 단위로 저장 (기간 필터에 연동)
- 광고비 입력 즉시 ROAS 자동 계산 표시

## 데이터 모델

### 새 테이블: `product_ad_spend`

```sql
CREATE TABLE product_ad_spend (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  year_month   CHAR(7) NOT NULL,  -- 'YYYY-MM' 형식, 예: '2026-05'
  ad_spend     NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, product_id, year_month)
);

-- RLS: user_id = auth.uid()
ALTER TABLE product_ad_spend ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user owns rows" ON product_ad_spend
  USING (user_id = auth.uid());
```

- `year_month`: 기간 필터에서 추출한 월 목록과 매칭
- 기간이 복수 월에 걸치면 해당 월들의 `ad_spend` 합산
- `UNIQUE (user_id, product_id, year_month)` → upsert로 수정

## API

### PATCH `/api/cost-management/products/[id]/ad-spend`

광고비 저장 (upsert).

```ts
// Request
{ year_month: "2026-05", ad_spend: 150000 }

// Response
{ success: true, data: { id, product_id, year_month, ad_spend } }
```

처리: `product_ad_spend` 테이블에 `ON CONFLICT (user_id, product_id, year_month) DO UPDATE SET ad_spend = EXCLUDED.ad_spend`.

### GET `/api/cost-management/products` 수정

기존 `ad_strategy_cache` 매칭 로직을 `product_ad_spend` JOIN으로 대체.

- 기간 필터에서 `year_month` 목록 추출 (예: `['2026-03', '2026-04', '2026-05']`)
- 해당 월들의 `ad_spend` 합산값을 `ad_spend` 필드에 포함
- `ad_spend`가 없으면 0 반환

## ROAS 계산 (프론트엔드)

별도 API 없이 이미 응답에 포함된 값으로 프론트에서 계산:

```ts
const adRoas = ad_spend > 0 ? (total_sales_amount / ad_spend) * 100 : 0;
```

- `ad_spend = 0` → `—` 표시
- 손익분기 ROAS(`breakeven_roas`) 대비 색상:
  - `adRoas ≥ breakeven_roas` → 초록
  - `adRoas < breakeven_roas` → 빨강

## UI — 인라인 편집

**광고비 셀 동작:**
1. 평상시: 저장된 합산값 표시 (`—` 또는 `150,000원`)
2. **단일 월 기간** (이번 달 / 지난 달 / 직접 입력 단일 월): 셀 클릭 → 숫자 input 전환, 현재 값 pre-fill
3. Enter / blur → `PATCH /api/cost-management/products/[id]/ad-spend` 호출
4. 저장 완료 → ROAS 컬럼 즉시 재계산 표시
5. Escape → 편집 취소 (원래 값 복원)

**복수 월 기간** (최근 3개월 / 6개월 / 전체):
- 광고비 셀 클릭 비활성화 (읽기 전용)
- 호버 시 툴팁: "단일 월을 선택하면 편집할 수 있습니다"

**편집 가능 여부 판단 (프론트):**
```ts
const isEditablePeriod =
  preset === 'this_month' ||
  preset === 'last_month' ||
  (preset === 'custom' && customFrom && customTo &&
    customFrom.slice(0, 7) === customTo.slice(0, 7));
```

## 파일 변경 목록

| 파일 | 작업 |
|---|---|
| `supabase/migrations/073_product_ad_spend.sql` | NEW — `product_ad_spend` 테이블 생성 |
| `src/app/api/cost-management/products/[id]/ad-spend/route.ts` | NEW — PATCH upsert |
| `src/app/api/cost-management/products/route.ts` | MODIFY — `ad_spend` 소스를 `product_ad_spend` JOIN으로 변경 |
| `src/components/orders/CostManagementTab.tsx` | MODIFY — 인라인 편집 상태 관리, 셀 클릭 핸들러, ROAS 프론트 계산 |

## 범위 외

- 복수 월에 걸친 기간에서 월별 개별 편집 (추후)
- 네이버/쿠팡 플랫폼별 광고비 분리
- 광고비 이력 조회
