# 일일 정산 — 설계

> 작성일: 2026-07-17
> 대상: `/orders` → `settlement`(정산) 서브탭 신설, `src/app/api/settlement/*`, `src/lib/settlement/*`

## 1. 배경

매일 전일 기준으로 판매·매입·광고비·택배비·박스비를 확정하고, 쿠팡 정산 금액과 대조해 차이를 찾아내고 싶다.

**해결하는 문제**

- A. 어제 하루 실제로 얼마 벌었는지 매일 확인할 곳이 없다.
- B. 쿠팡이 준 돈이 내 장부와 맞는지 검증할 방법이 없다. 차이가 나도 원인을 못 찾는다.
- C. 택배비가 3,500원으로 하드코딩되어 있어 실제 청구액을 반영할 수 없다 (`src/lib/cost-management/sale-shipping.ts`).
- D. 박스비/포장비를 기록할 곳이 아예 없다.

**구현하지 않는 것 (YAGNI)**

- 쿠팡 광고 API/스크래퍼 연동 (광고비는 일별 총액 수동 입력. 자동화는 별도 후속 작업)
- 네이버 채널 (정산 탭은 쿠팡 윙 + RG만 대상)
- 상품별 비용 배분 (광고비·박스비·택배비 모두 일별 총액)
- 일별 스냅샷 테이블/배치 (계산은 런타임, 외부 API 응답만 캐시)
- 일자 잠금(lock)/마감 처리

## 2. 기존 자산과 갭

| 항목 | 현황 |
|---|---|
| 매출 | `sale_records` (판매일·수량·판매가·채널·`coupon_discount`·`voided_at`) — **있음** |
| 매입 | `cost_entries` (입고일·수량·단가·`unit_shipping_fee`·`unit_rg_shipping_fee`) — **있음** |
| 쿠폰비 | `sale_records.coupon_discount` — **있음** |
| 플랫폼 수수료율 | `product_costs.platform_fee_rate` (기본 0.1080) — **있음** |
| 택배비 | `sale-shipping.ts`에 3,500 **하드코딩** (RG=0) — 설정값으로 승격 필요 |
| 광고비 | `product_ad_spend` (상품별 × **월별**) — 일별 없음. 정산 탭과는 **별개로 유지** |
| 박스비 | **없음** |
| 쿠팡 정산 API | `settlement-clients.ts` / `coupang-client.ts:586-629` — **있으나 대시보드에만 연결**, 원가 계산과 단절 |

## 3. 핵심 제약 — 대조는 지연된다

`revenue-history`는 **`recognitionDate`(인식일) 기준으로만 조회**되고 조회 상한이 어제다 (`coupang-client.ts:586-597`). 인식일은 판매일이 아니라 구매확정 시점이므로:

- 어제 판매된 주문은 아직 인식되지 않아 revenue-history에 **나타나지 않는다.**
- 따라서 **어제 판매분의 쿠팡 숫자는 어제 알 수 없다.**

빠져나갈 구멍: API 응답 각 건에 `recognitionDate`와 **`saleDate`가 둘 다** 들어 있다 (검증된 응답 구조, `:586-591`). **조회는 인식일로 하되 저장은 판매일로 재분류**하면 `sale_records.sold_at`과 같은 축이 되어 대조가 성립한다.

**결론**: 일일 손익은 매일 확정되지만 대조는 며칠 뒤 채워진다. 두 시간축을 한 표에 섞지 않고 **섹션을 분리**한다.

## 4. 결정 사항

| 항목 | 결정 |
|---|---|
| 위치 | `/orders`에 `정산` 서브탭 신설 (`?tab=settlement`). 원가 탭=상품 축, 정산 탭=날짜 축 |
| 채널 | 쿠팡 윙 + RG만. 네이버 제외 |
| 비용 단위 | 전부 일별 총액 (상품별 배분 없음) |
| 매입 | `cost_entries`에서 자동 집계 (정산 탭에서 직접 입력 불가) |
| 택배비 | 채널별 단가 설정값 × 건수. 실제 청구서 차액은 `parcel_adjustment`로 별도 입력 |
| 박스비 | **구매한 날 일괄 비용**. 건당 배분 없음 (박스 크기·단가가 제각각이라 건당 단가는 가짜 정밀도) |
| 광고비 | 일별 총액 수동 입력 |
| 저장 전략 | 계산은 런타임, **쿠팡 API 응답만 캐시** |
| 레이아웃 | 2섹션 — ① 일일 손익(매일) / ② 정산 대조(인식 완료분만) |

## 5. 데이터 모델

신규 테이블 2개. 기존 테이블은 컬럼 1개 추가.

### `daily_expenses` — 일별 수동 비용

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `user_id` | uuid | FK 없음 (기존 커스텀 `auth_users` 패턴) |
| `expense_date` | date NOT NULL | |
| `ad_spend` | int NOT NULL default 0 | 광고비 일별 총액 |
| `box_cost` | int NOT NULL default 0 | 박스 구매액 (산 날에만 값) |
| `box_memo` | text | 예: "중박스 500개" |
| `parcel_adjustment` | int NOT NULL default 0 | 택배비 정산차. **음수 허용** |
| `memo` | text | |
| `created_at` / `updated_at` | timestamptz default now() | |

- `UNIQUE (user_id, expense_date)` — 하루 한 행 강제, upsert 대상
- `updated_at`은 기존 `handle_updated_at()` 트리거 재사용

항목별 행이 아니라 **하루 한 행 × 항목별 컬럼**. 항목이 4개로 고정이고 늘릴 계획이 없어 유연한 스키마는 불필요한 복잡도다.

### `coupang_revenue_daily` — revenue-history 캐시 (판매일 기준)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `sale_date` | date NOT NULL | **판매일** (응답의 `saleDate`로 재분류) |
| `sale_amount` | int NOT NULL default 0 | 쿠팡 기준 매출 |
| `service_fee` | int NOT NULL default 0 | 쿠팡이 뗀 수수료 (`saleAmount - settlementAmount`) |
| `settlement_amount` | int NOT NULL default 0 | 정산 대상액 |
| `order_item_count` | int NOT NULL default 0 | 인식 건수 — **완료 판정에 사용** |
| `raw` | jsonb | 원본 응답 배열 (차이 원인 추적) |
| `fetched_at` | timestamptz default now() | |

- `UNIQUE (user_id, sale_date)` — 재조회 시 upsert
- `INDEX (user_id, sale_date DESC)`

`raw` 보관 이유: 차이가 났을 때 **쿠팡이 뭐라고 말했는지 다시 볼 수 없으면 원인을 못 찾는다.**

### `product_cost_channels` 변경

```sql
ALTER TABLE product_cost_channels
  ADD COLUMN unit_parcel_fee int NOT NULL DEFAULT 3500 CHECK (unit_parcel_fee >= 0);
UPDATE product_cost_channels SET unit_parcel_fee = 0 WHERE channel_type = 'coupang_rg';
```

`sale-shipping.ts`의 `DEFAULT_PARCEL_SHIPPING_FEE = 3500` 하드코딩이 이 값을 읽도록 변경한다. 채널 행이 없으면 기존 상수를 폴백으로 유지해 회귀를 막는다. (관련: `2026-07-05-shipping-fee-consistency-design.md`)

## 6. API 레이어

`src/app/api/settlement/` 아래 라우트 4개. **조회와 동기화를 분리하고, 서로 다른 시간축을 한 엔드포인트에 묶지 않는다.**

### `GET /api/settlement/daily?from=&to=`

일일 손익. **외부 API를 호출하지 않는다** (캐시/DB만).

병렬 집계 후 날짜로 병합:
1. `sale_records` — `sold_at` 기준, `channel IN ('coupang','rocket_growth')`, `voided_at IS NULL`
2. `cost_entries` — `received_at` 기준 매입액
3. `daily_expenses` — 수동 비용

```json
{
  "rows": [{
    "date": "2026-07-16",
    "revenue": 1840000,
    "couponDiscount": 62000,
    "platformFee": 198720,
    "purchase": 0,
    "parcelFee": 94500,
    "parcelAdjustment": 0,
    "adSpend": 85000,
    "boxCost": 0,
    "netProfit": 1399780,
    "orderCount": 47
  }],
  "monthTotal": { "...": "동일 필드 합계" }
}
```

### `PUT /api/settlement/expenses/:date`

수동 비용 upsert. body: `{ adSpend, boxCost, boxMemo, parcelAdjustment, memo }`. `UNIQUE (user_id, expense_date)`로 중복 클릭/동시 입력에 안전.

### `GET /api/settlement/reconcile?from=&to=`

정산 대조. `coupang_revenue_daily` 캐시와 `sale_records`를 판매일로 조인하되, **인식 완료된 판매일만** 반환.

```json
{
  "rows": [{
    "saleDate": "2026-07-05",
    "mine":    { "revenue": 1420000, "fee": 153360, "count": 39 },
    "coupang": { "revenue": 1408000, "fee": 152064, "count": 39 },
    "diff":    { "revenue": -12000, "fee": -1296 },
    "causes": [{ "vendorItemId": 123, "name": "...", "mine": 30000, "coupang": 18000, "diff": -12000 }]
  }],
  "pendingFrom": "2026-07-07",
  "lastSyncedAt": "2026-07-16T09:20:00Z"
}
```

`pendingFrom` 이후 판매일은 인식 미완료라 `rows`에 없다. 캐시가 비면 `rows: []`, `lastSyncedAt: null`.

### `POST /api/settlement/sync`

`revenue-history`를 **인식일 기준 최근 60일**로 조회해 `coupang_revenue_daily`에 upsert. 각 건을 `saleDate`로 재분류해 담는다.

- `recognitionDateTo`는 어제로 clamp (`settlement-clients.ts:16-35`의 KST 처리 재사용)
- 31일 초과 시 30일 청크 분할 후 병렬 호출
- `token`은 빈 문자열이라도 명시 전송 (누락 시 400), `nextToken` 끝까지 페이징
- 응답: `{ recognizedCount, updatedDates, newlyReconcilable, failedChunks }`

**60일인 이유**: 인식일로 조회하므로 과거 판매일을 채우려면 인식 지연 기간보다 넉넉해야 한다.

### 월 지급 확정 배너

`settlement-histories`(월별 `finalAmount`, `settlementDate`)는 대조 섹션 하단 배너에만 쓴다. 데이터 없으면 배너를 숨긴다. (`2026-05-21-settlement-dashboard-design.md` §신규1 참조)

## 7. 계산 로직 — `src/lib/settlement/`

순수 함수로 두고 단위 테스트로 고정한다. 계산 규칙이 여러 곳에 흩어지면 "무엇을 무엇에서 빼는가"가 어긋난다.

### 일일 손익

```
매출         = Σ(selling_price × quantity)                    -- 취소 제외
쿠폰할인      = Σ(coupon_discount)
플랫폼수수료   = Σ((selling_price - coupon_discount) × 상품.platform_fee_rate)
택배비        = Σ(채널.unit_parcel_fee)                        -- 건별, RG는 0
매입         = Σ(cost_entries: quantity × (unit_cost + unit_shipping_fee + unit_rg_shipping_fee))
순이익        = 매출 - 쿠폰할인 - 플랫폼수수료 - 매입 - 택배비
              - 광고비 - 박스비 + 택배비정산차
```

**수수료는 반드시 건별로 계산**한다. 상품마다 `platform_fee_rate`가 달라 총액에 한 번 곱하면 틀린다.

**반올림**: `cost_entries.quantity`는 `numeric(10,1)`(소분 대응, 마이그 064)이고 `platform_fee_rate`도 소수라 중간값에 소수가 생긴다. **건별로 `Math.round()` 한 뒤 합산**한다 (합산 후 반올림하면 쿠팡 건별 계산과 원 단위로 어긋난다). 모든 금액 필드는 정수 원 단위다.

### 원가 탭과 순이익이 다른 이유 (의도된 차이)

- **원가 탭**: FIFO — 물건이 **팔린 날** 그 물건의 원가를 인식
- **정산 탭**: 현금 — 물건을 **산 날** 돈이 나간 것으로 인식

그래서 매입한 날은 정산 탭 순이익이 꺼지고(박스비도 같은 이유), 그 재고가 팔리는 날엔 원가가 0으로 잡힌다. 버그가 아니라 현금 관점이며, 요구사항("매입을 등록한다")이 이 관점이다.

**필수**: 일일 손익 표 상단에 고정 안내 문구를 넣는다 —
> "현금 기준 — 물건 산 날 비용을 인식합니다. 상품별 손익은 수익·원가 탭을 보세요."

이 문구가 없으면 원가 탭이 겪은 "어느 숫자가 진짜냐" 혼란(로드맵 §1.1)이 그대로 재발한다.

### 인식 완료 판정

쿠팡은 "이 날짜 다 끝났다"고 알려주지 않는다. **건수로 판단한다.**

```
완료(saleDate) := sale_records 건수(취소 제외) == coupang_revenue_daily.order_item_count
```

하나라도 모자라면 인식 중 → 대조 표에서 제외. 취소된 주문은 영영 인식되지 않는데 `voided_at`으로 이미 제외되므로 건수가 맞아떨어진다 (`2026-07-06-cancel-return-voiding-design.md`의 무효화 구조에 의존).

`pendingFrom` = 완료되지 않은 판매일 중 가장 이른 날.

### 차이 원인 추적

차이가 난 판매일은 `raw` jsonb의 건별 항목을 `vendorItemId`로 내 `sale_records`와 대조해 상품별 차이를 낸다. `product_cost_channels`(`channel_type='coupang_rg'` → `external_id`=vendorItemId)로 상품을 찾는다.

## 8. 화면 — `/orders?tab=settlement`

두 섹션을 세로로 배치. 서브탭 URL 딥링크는 `OrdersClient.tsx:27-35`에 이미 구현되어 있어 그대로 확장한다.

### ① 일일 손익

날짜 행 × 9열: `날짜 · 매출 · 쿠폰 · 수수료 · 매입 · 택배비 · 광고비 · 박스비 · 순이익`

- **흰 셀** = 자동 계산, 수정 불가
- **파란 셀**(광고비·박스비) = 클릭해 즉시 수정 → `PUT /api/settlement/expenses/:date`
- 하단에 월 합계 고정. 기본 30일, 월 단위 이동
- 상단에 현금 기준 안내 문구(§7)
- 박스비는 **별도 열로 분리** — 매입일에 순이익이 꺼지는 이유가 바로 보이도록

### ② 정산 대조

판매일 행 × `내 매출 · 쿠팡 매출 · 차이 · 내 수수료 · 쿠팡 수수료 · 원인`

- **인식 완료된 판매일만** 표시. `pendingFrom` 이후는 "아직 인식 중"으로 안내
- 상단 기간 요약 바, 하단 월 지급 확정 배너
- "쿠팡 정산 불러오기" 버튼 → `POST /api/settlement/sync`
- 차이 행의 `원인` 열 클릭 시 상품별 내역 펼침

## 9. 에러 처리

**원칙: 쿠팡 API가 죽어도 일일 손익은 멀쩡히 보인다.**

- `GET daily`는 외부 API를 부르지 않으므로 영향 없음
- `sync` 실패 시 캐시 미갱신. 대조 섹션은 마지막 성공 데이터 + `lastSyncedAt` 표시
- 자격증명 없으면 기존 패턴대로 `available: false` → "API 미연동" 표시, 일일 손익만 렌더
- **청크 부분 실패 시 성공분만 저장**하고 실패 구간을 알림 (전부 롤백하면 매번 처음부터 다시 긁어야 함)
- sync 완료 시 결과 요약 토스트: "7/01~7/16 인식분 1,240건 갱신 · 신규 3일 대조 가능". 기존 `Toaster`/`confirmDialog` 인프라 재사용 (로드맵 §1.2가 P1으로 지적한 임포트 피드백 부재 대응)

## 10. 테스트

`src/lib/settlement/`의 순수 함수에 집중. 쿠팡 API는 MSW 목킹, 픽스처는 `coupang-client.ts:586-591` 주석의 검증된 응답 구조 기준.

**계산**
- 상품별 수수료율이 섞인 하루의 수수료 합계
- RG(택배비 0) + 윙(단가 적용)이 섞인 날의 택배비
- `voided_at`이 찍힌 건의 제외
- 쿠폰할인이 수수료 계산에 선반영되는지
- 매입·박스비가 있는 날의 순이익
- `parcel_adjustment` 음수 처리
- 소수 `quantity`(소분 상품)와 소수 수수료율의 건별 반올림 — 합산 후 반올림과 결과가 다른 케이스로 고정

**대조**
- 인식일로 조회한 응답이 **판매일로 올바로 재분류**되는지
- 건수 일치 판정이 취소 건을 포함해 정확한지
- 부분 인식된 날이 대조 표에서 빠지고 `pendingFrom`이 맞는지
- 캐시가 비었을 때 대조 섹션이 빈 상태로 정상 렌더되는지
- 청크 부분 실패 시 성공분이 저장되는지

**실행**: `npx vitest run src/__tests__/lib/settlement` — 인자 없이 돌리면 무관한 실패가 쏟아진다.

## 11. 구현 순서

1. 마이그레이션 087 — `daily_expenses`, `coupang_revenue_daily`, `product_cost_channels.unit_parcel_fee`
2. `src/lib/settlement/` 계산 함수 + 단위 테스트 (TDD)
3. `GET daily` + `PUT expenses/:date`
4. 일일 손익 섹션 UI (여기까지로 "매일 손익 확인"이 동작)
5. `POST sync` + 판매일 재분류 + 테스트
6. `GET reconcile` + 인식 완료 판정 + 테스트
7. 정산 대조 섹션 UI + 월 지급 배너
8. `sale-shipping.ts` 하드코딩 → `unit_parcel_fee` 전환 (회귀 주의: 폴백 유지)

4번까지로 독립적인 가치가 나온다. 5~7번이 대조, 8번은 정리다.

## 12. 후속 (이 스펙 밖)

- 쿠팡 광고 스크래퍼(`scripts/ad-scraper/`)를 일별 광고비 자동 입력으로 확장. **쿠키 만료·화면 변경으로 깨지는 경로이므로 수동 입력을 정상 경로로 유지**한 채 보조로만 붙인다.
- 일별 스냅샷 테이블 (런타임 집계가 실제로 느려지면). 현 설계는 이 길을 막지 않는다.
- 네이버 채널 확장
