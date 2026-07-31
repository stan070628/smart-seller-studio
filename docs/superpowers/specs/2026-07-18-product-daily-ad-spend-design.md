# 상품별×날짜별 광고비 — 설계

작성일: 2026-07-18
대상 탭: 수익 원가 (`CostManagementTab`) + 정산 서브탭

## 배경 / 목적

현재 광고비는 두 곳에 따로 저장된다.

- **수익원가 탭** `product_ad_spend` — 상품별 **월 총액**(`year_month`). 이번 달/지난 달만 편집 가능.
- **정산 탭** `daily_expenses.ad_spend` — 하루 **총 광고비**(상품 구분 없음), 일별 손익에 반영.

목적은 **일일 정산 정확도**다. 어느 날 어떤 상품에 광고비가 얼마 들었는지를 날짜 단위로 기록해, 정산의 일별 손익에 정확히 반영한다.

## 핵심 결정

1. **단일 소스**: 상품별×날짜별 광고비 테이블이 광고비의 단일 소스가 된다.
2. **정산 자동 반영**: 정산의 하루 광고비 = 그날 상품별 광고비 합계. 정산 탭의 수동 "광고비 총액" 입력은 은퇴한다.
3. **수익원가 기간 합계**: 수익원가 탭의 상품별 광고비/ROAS = 선택 기간 내 날짜별 합계. 이제 모든 기간 프리셋(3·6개월·직접입력)에서 정확히 집계된다(기존은 월 단위만).
4. **UI**: 상품 행을 펼치면 상세 패널에서 날짜별 리스트로 입력한다.

## 1. 데이터 모델

새 테이블 `product_ad_spend_daily`. Render PostgreSQL(`SOURCING_DATABASE_URL`)에 적용, 기존 `product_ad_spend` 패턴 동일(user_id는 FK 없이 uuid).

마이그레이션 파일: `supabase/migrations/091_product_ad_spend_daily.sql`

```sql
CREATE TABLE IF NOT EXISTS product_ad_spend_daily (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES product_costs(id) ON DELETE CASCADE,
  ad_date    DATE NOT NULL,
  ad_spend   NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id, ad_date)
);

CREATE INDEX IF NOT EXISTS product_ad_spend_daily_user_date_idx
  ON product_ad_spend_daily (user_id, ad_date);
CREATE INDEX IF NOT EXISTS product_ad_spend_daily_user_product_date_idx
  ON product_ad_spend_daily (user_id, product_id, ad_date);

CREATE TRIGGER trg_product_ad_spend_daily_updated_at
  BEFORE UPDATE ON product_ad_spend_daily
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
```

`(user_id, product_id, ad_date)` 유니크로 upsert.

## 2. 기존 월별 데이터 이관

기존 `product_ad_spend`(월 총액)는 날짜 정보가 없어 날짜별로 쪼갤 수 없다. **월 총액을 그달 1일자 한 건으로 이관**한다.

- 근거: 이관해도 수익원가 기간 합계는 보존된다. 정산은 이 브랜치의 신규 기능이라 과거 월 데이터가 1일에 몰려도 실무 영향이 없다.
- 이관은 같은 마이그레이션 091 안에서 수행:

```sql
INSERT INTO product_ad_spend_daily (user_id, product_id, ad_date, ad_spend)
SELECT user_id, product_id, (year_month || '-01')::date, ad_spend
FROM product_ad_spend
WHERE ad_spend > 0
ON CONFLICT (user_id, product_id, ad_date) DO NOTHING;
```

- 이관 후 `product_ad_spend`(구 테이블)는 **읽지 않는다**. 코드에서 참조 제거. 테이블 자체는 안전을 위해 즉시 DROP하지 않고 남겨둔다(후속 정리 대상).

## 3. API

### 3.1 상품 광고비 upsert (변경)
`PATCH /api/cost-management/products/[id]/ad-spend`
(기존 라우트/메서드 유지, 바디 필드만 `year_month` → `ad_date`로 변경 — 프론트 영향 최소화.)

- 바디: `{ ad_date: 'YYYY-MM-DD', ad_spend: number }`
- 검증: `ad_date`는 `^\d{4}-\d{2}-\d{2}$`, `ad_spend`는 음이 아닌 숫자.
- 소유권 검증: `product_costs.id = $id AND user_id = $user` 존재할 때만 insert(기존 패턴 유지).
- `ON CONFLICT (user_id, product_id, ad_date) DO UPDATE`.

### 3.2 상품 광고비 조회 (신규)
`GET /api/cost-management/products/[id]/ad-spend?from=YYYY-MM-DD&to=YYYY-MM-DD`

- 상세 패널이 펼쳐질 때 그 상품의 기간 내 날짜별 광고비 목록을 반환(입력값 표시용).
- 반환: `{ success: true, data: [{ ad_date, ad_spend }, ...] }` (값 있는 날짜만; 없는 날짜는 프론트에서 0으로 표시).

### 3.3 수익원가 상품 목록 (변경)
`GET /api/cost-management/products`

- 광고비 합산을 `product_ad_spend_daily`에서 날짜 범위로 변경:

```sql
SELECT product_id, SUM(ad_spend)::float AS total_ad_spend
FROM product_ad_spend_daily
WHERE user_id = $1 AND ad_date BETWEEN $2 AND $3
GROUP BY product_id
```

- `getYearMonths()` 기반 월 집계 로직 제거, `from`/`to` 날짜 파라미터로 대체.
- 전체 기간(`all`) 선택 시 날짜 필터 없이 전체 합산.
- ROAS 계산은 기존과 동일(`ad_spend`만 소스 교체).

## 4. 정산 연동

### 4.1 일별 광고비 소스 교체
`GET /api/settlement/daily` (그리고 `computeDailySettlement` 호출부):

- 그날 광고비를 `product_ad_spend_daily`의 날짜별 합계로 계산한다:

```sql
SELECT ad_date, SUM(ad_spend)::int AS ad_spend
FROM product_ad_spend_daily
WHERE user_id = $1 AND ad_date BETWEEN $2 AND $3
GROUP BY ad_date
```

- 이 합계를 `SettlementExpense.ad_spend`로 주입. `daily_expenses.ad_spend`는 더 이상 정산 계산에 쓰지 않는다.
- `computeDailySettlement`의 시그니처/로직은 유지(입력 `expenses`의 `ad_spend`가 상품 합계로 채워질 뿐). 박스비·택배차액은 기존대로 `daily_expenses`에서.

### 4.2 정산 탭 UI
`SettlementTab` / `PUT /api/settlement/expenses/[date]`:

- 정산 탭의 수동 "광고비 총액" 입력칸 **제거**. 대신 그날 광고비는 상품별 합계(읽기 전용)로 표시.
- 박스비·택배차액·메모 입력은 유지.
- `daily_expenses.ad_spend` 컬럼은 스키마에 남기되 미사용(후속 정리 대상). `expenses/[date]` upsert에서 ad_spend 필드 무시 또는 제거.

## 5. UI — 상세 패널 날짜별 리스트

`ProductDetailPanel`의 현재 "광고비 [입력]" 버튼을 날짜별 리스트로 대체한다.

```
광고비 (2026-07)
  07-15  ₩ 12,000
  07-16  ₩  8,500
  07-17  ₩ 15,000   ← 셀 클릭 → 인라인 편집
  07-18  ₩      0
  ─────────────────
  합계    ₩ 35,500
```

- **표시 날짜 범위** = 현재 선택된 기간 필터(`getDateRange`). 패널이 펼쳐질 때 3.2 GET으로 그 상품의 날짜별 값을 로드.
- **긴 기간 처리**(3·6개월): 리스트가 길어지므로 스크롤 컨테이너로 표시. 초기 버전은 단순 스크롤; 필요 시 "값 있는 날 + 최근 N일만" 압축은 후속.
- **인라인 편집**: 각 날짜 셀 클릭 → number input, Enter 저장/Esc 취소/blur 저장(기존 월별 입력 인터랙션 재사용). 저장 시 3.1 PATCH 호출.
- **낙관적 업데이트**: 저장 성공 시 리스트 합계 및 상품 행의 기간 광고비/ROAS/winner_status 재계산(기존 `saveAdSpend`의 재계산 로직 확장).
- **편집 가능 기간**: 기존 `isEditablePeriod`(이번달/지난달만) 제약을 **날짜 단위로 완화** — 선택 기간 내 모든 날짜 편집 허용.

### 배선 변경
- `CostManagementTab.saveAdSpend(productId, value)` → `saveAdSpend(productId, adDate, value)`로 시그니처 확장.
- `ProductRowComponent` / `ProductDetailPanel`의 `onSaveAdSpend` prop 시그니처 동반 변경.
- 상세 패널에 날짜별 값 로드 상태(로딩/데이터) 추가.

## 6. 테스트

- **정산 `calculate.ts`**: 상품별 날짜 합계가 그날 `adSpend`로 정확히 들어가는지(기존 테스트에 상품 합계 주입 케이스 추가).
- **ad-spend API**: 날짜 upsert, `(user,product,date)` 유니크 충돌 시 갱신, 소유권 없는 상품 404, 잘못된 날짜/음수 400.
- **products API**: 임의 기간 범위 날짜 합산 → ROAS 계산.
- **마이그레이션 이관**: 월별 → 1일자 이관 후 기간 합계 보존.

## 범위 밖 (YAGNI)

- 쿠팡 광고 API 자동 임포트(수동 입력만).
- 긴 기간 압축 표시/가상 스크롤(초기엔 단순 스크롤).
- 구 `product_ad_spend` / `daily_expenses.ad_spend` 컬럼 물리 DROP(안전을 위해 후속 정리).
