# 일일 정산 (일일 손익) — 설계

> 작성일: 2026-07-17
> 개정: 2026-07-17 — Fable 5 코드 대조 검토 결과 반영. **정산 대조 섹션 전면 삭제**, 계산식 수정, 선행 의존 명시.
> 대상: `/orders` → `settlement`(정산) 서브탭 신설, `src/app/api/settlement/*`, `src/lib/settlement/*`

## 1. 배경

매일 전일 기준으로 판매·매입·광고비·택배비·박스비를 확정해 "어제 하루 얼마 벌었나"를 매일 확인한다.

**해결하는 문제**

- A. 어제 하루 실제로 얼마 벌었는지 매일 확인할 곳이 없다.
- B. 박스비/포장비를 기록할 곳이 아예 없다.
- C. 광고비가 상품별 × **월별**(`product_ad_spend`)로만 있어 일 단위 손익을 낼 수 없다.

**구현하지 않는 것 (YAGNI)**

- **쿠팡 정산 대조** — §3 참조. 현 코드 구조에서 성립하지 않는다. 별도 스펙으로 분리.
- 쿠팡 광고 API/스크래퍼 연동 (광고비는 일별 총액 수동 입력)
- 네이버 채널 (쿠팡 윙 + RG만)
- 상품별 비용 배분 (광고비·박스비 모두 일별 총액)
- 일별 스냅샷 테이블/배치 (계산은 런타임)
- 일자 잠금(lock)/마감 처리

## 2. 기존 자산

| 항목 | 현황 |
|---|---|
| 매출 | `sale_records` (판매일·수량·판매가·채널·`coupon_discount`·`voided_at`·`shipping_fee`) |
| 매입 | `cost_entries` (입고일·수량·`unit_cost`·`unit_shipping_fee`·`unit_rg_shipping_fee`) |
| 플랫폼 수수료율 | `product_costs.platform_fee_rate` (기본 0.1080) |
| 택배비 | `sale_records.shipping_fee` — 임포트 시 확정 저장, 수동 수정 가능 (`fifo.ts:141`, `fifo-summary/route.ts:32`) |
| 광고비 | `product_ad_spend` (상품별 × 월별) — 일별 없음. 정산 탭과 **별개로 유지** |
| 박스비 | **없음** |
| 서브탭 딥링크 | `OrdersClient.tsx:25-39` — `?tab=` 쿼리로 이미 구현 |

## 3. 정산 대조를 제외한 이유 (중요)

초안은 "내 장부(`sale_records`) vs 쿠팡 `revenue-history`" 대조를 포함했다. **코드 대조 검증 결과 이 전제가 거짓임이 확인되어 삭제한다.**

**윙 `sale_records`가 바로 그 `revenue-history`로 임포트된다** (`src/app/api/cost-management/wing-bulk-import/route.ts:104`). 즉 "내 장부"는 쿠팡 데이터의 사본이고, 대조는 **자기 자신과의 비교**다. 초안의 "건수 일치 = 인식 완료" 판정은 양쪽이 같은 소스라 항상 일치하므로 **미완료인 날도 완료로 오판**한다(fail-open).

부수적으로 확인된 것들:

- revenue-history는 **ordersheet 단위** 페이징이고 각 건이 inner `items[]`(vendorItem 단위)를 가진다 (`coupang-client.ts:589-590`). `sale_records`는 (orderId × vendorItemId) 단위 (`wing-bulk-import:131`). 건수 단위 자체가 다르다.
- 임포트는 **매핑된 상품만 저장**한다 (`wing-bulk-import:119` 미매칭 `continue`). 미매핑 상품이 팔린 날은 영구 불일치가 된다.
- **RG 취소는 무효화 대상에서 제외**되어 있다 (`2026-07-06-cancel-return-voiding-design.md` §4). RG 취소 1건이면 그날은 영영 "인식 중"으로 남는다.
- 월 지급 배너가 참조하려던 `settlement-histories`는 **구현 자체가 없다** — `2026-05-21-settlement-dashboard-design.md`는 설계만 있고 `coupang-client.ts`에 해당 메서드가 없다.

**대조를 하려면** 윙 판매를 revenue-history가 아닌 독립 소스(`ordersheets` API 등)로 임포트하도록 바꾸는 선행 작업이 필요하다. 이 스펙의 3배 규모이며 성격이 다르므로 분리한다. (§9 후속)

**성립이 확인된 것 (대조 재개 시 재사용 가능)**: `saleDate` 재분류는 가능하다 — 응답에 `saleDate`가 있고(`coupang-client.ts:589`) 매핑이 보존하며(`:644`), `wing-bulk-import:121`이 이미 `order.saleDate`를 `sold_at`으로 쓴다. 인식일 조회 제약과 어제 clamp도 사실이다(`:593-594`, `settlement-clients.ts:23-27`).

## 4. 선행 의존 (이 스펙 착수 전 해결 필요)

검토에서 드러난 **기존 코드의 정합성 결함**이다. 일일 손익은 이 위에 서므로 먼저 고쳐야 한다.

### 4.1 `unit_multiplier` 매출 왜곡 — **별도 선행 스펙**

`product_cost_channels.unit_multiplier`는 "판매 1건당 소비되는 **단품 개수**"다 (마이그 081 주석). 임포트는 `quantity = 주문수량 × multiplier`(재고 축, 단품 개수), `selling_price = 팩 단가`(판매 축)로 저장한다 (`wing-bulk-import:129-130`, `rg-bulk-import:94-100`, `coupang-import:184-187`).

따라서 `selling_price × quantity` = 팩단가 × 팩수 × multiplier = **실매출 × multiplier**. 2개입 상품의 매출이 2배가 된다.

**이는 `fifo.ts:131-144`도 동일하다** — `effective_price × quantity`로 계산하므로 **원가 탭의 실현손익도 2개입 상품에서 부풀려져 있다.** 로드맵이 P2로 지목한 "숫자가 실제로 틀리는 버그"에 해당한다.

**계약**: 선행 스펙이 `sale_records`에서 **그날의 실매출 총액을 정확히 구할 수 있는 상태**를 만든다. 정규화 방식(단품 단가로 환산 / 판매금액 총액 컬럼 추가 / 기타)과 기존 데이터 보정은 그 스펙이 정한다. 본 스펙 §6의 매출·수수료 식은 **그 계약이 충족된 뒤에만 유효하다.**

### 4.2 `sale_records.shipping_fee` 마이그레이션 부재

`fifo.ts:141`과 `fifo-summary/route.ts:32`가 이 컬럼을 읽는데, **056~086 전수 확인 결과 컬럼을 추가하는 마이그레이션이 저장소에 없다.** SQL은 `2026-06-21-sale-shipping-fee-design.md` 문서에만 존재한다. 운영 DB에는 수동 적용된 것으로 보이며, **신선한 DB에서는 재현되지 않는다.**

본 스펙의 택배비 집계가 이 컬럼에 의존하므로, 087 작성 전 **누락 마이그레이션을 복구**한다 (`ADD COLUMN IF NOT EXISTS`라 운영 DB에는 무해).

### 4.3 `coupon_discount` 단위 모순 — 알려진 한계로 수용

- 임포트는 즉시할인 총액 + 다운로드쿠폰을 **건당 1회** 저장한다 (`coupang-import:338-340`).
- `fifo.ts:131`은 `selling_price`(**단가**)에서 차감한다 → 수량>1이면 과차감.
- **bulk 임포트는 `coupon_discount = 0` 고정**이다 (`2026-07-05-shipping-fee-consistency-design.md` §6).

기존 코드부터 모순이다. 본 스펙은 이를 고치지 않고 **`fifo.ts`와 동일하게 동작**시켜 두 탭의 숫자를 일치시킨다(§6). 쿠폰이 손익에 부정확하게 반영되는 것은 **알려진 한계**로 두고, 일일 손익 화면 안내 문구에 "쿠폰 반영은 일괄 임포트분에서 누락될 수 있음"을 명시한다. 정합성 수정은 §9 후속.

## 5. 결정 사항

| 항목 | 결정 |
|---|---|
| 위치 | `/orders`에 `정산` 서브탭 신설 (`?tab=settlement`). 원가 탭=상품 축, 정산 탭=날짜 축 |
| 채널 | 쿠팡 윙(`coupang`) + RG(`rocket_growth`)만 |
| 비용 단위 | 전부 일별 총액 (상품별 배분 없음) |
| 매입 | `cost_entries`에서 자동 집계 (정산 탭에서 직접 입력 불가) |
| 택배비 | **`Σ(sale_records.shipping_fee)`** — 기존 확정 저장값 사용. 실제 청구서 차액은 `parcel_adjustment`로 일별 입력 |
| 박스비 | **구매한 날 일괄 비용**. 건당 배분 없음 (크기·단가가 제각각이라 건당 단가는 가짜 정밀도) |
| 광고비 | 일별 총액 수동 입력 |
| 저장 전략 | 계산은 런타임 (외부 API 호출 없음) |
| 레이아웃 | 일일 손익 단일 표 |

**초안에서 철회한 결정**: `product_cost_channels.unit_parcel_fee` 컬럼 추가 및 `sale-shipping.ts` 하드코딩 전환. 이유 —
- `resolveSaleShippingFee(source)`(`sale-shipping.ts:11-13`)에 **상품/채널 컨텍스트가 없어** 6개 임포트 경로 시그니처를 전면 변경해야 한다.
- 택배 단가는 **유저 단위 계약** 문제인데 상품×채널 행(수천 행에 3500 중복)은 잘못된 위치다.
- 무엇보다 `sale_records.shipping_fee`에 **임포트 시점 값이 이미 확정 저장**되므로, 런타임 재계산은 이중 소스이고 설정 변경 시 과거 손익이 소급 변동한다.

실제 청구액 반영은 `parcel_adjustment` 하나로 충분하다. 하드코딩 정리는 §9 후속.

## 6. 계산 로직 — `src/lib/settlement/`

순수 함수로 두고 단위 테스트로 고정한다.

대상: 그날 `sale_records` 중 `channel IN ('coupang','rocket_growth')` **AND** `voided_at IS NULL`.

```
매출         = Σ(그날 판매의 실매출 총액)          -- §4.1 계약에 의존
쿠폰할인      = Σ(coupon_discount)                -- §4.3 한계 있음
플랫폼수수료   = Σ( round((selling_price - coupon_discount) × 상품.platform_fee_rate) × quantity )
택배비        = Σ(sale_records.shipping_fee)      -- 건당 1회, 확정 저장값
매입         = Σ(cost_entries: quantity × (unit_cost + unit_shipping_fee + unit_rg_shipping_fee))
순이익        = 매출 - 쿠폰할인 - 플랫폼수수료 - 매입 - 택배비 - 광고비 - 박스비 + 택배비정산차
```

**수수료 반올림은 `fifo.ts:134`와 정확히 일치시킨다** — 단가에서 쿠폰을 뺀 뒤 수수료율을 곱해 **먼저 반올림하고, 그다음 수량을 곱한다.** 순서를 바꾸면 같은 날 두 탭의 수수료 합계가 원 단위로 갈린다. (초안의 "건별 round 후 합산"은 FIFO와 어긋나 철회.)

**수수료는 반드시 상품별로 계산**한다. 상품마다 `platform_fee_rate`가 다르므로 총액에 한 번 곱하면 틀린다.

모든 금액 필드는 정수 원 단위. `cost_entries.quantity`는 `numeric(10,1)`(소분 대응, 마이그 064)이므로 매입액은 최종 `Math.round()`.

### `channel='manual'` 제외의 의미

058 마이그레이션이 레거시 판매를 전부 `'manual'`로 이전했고, 수기 입력도 `'manual'`이다. 위 필터는 이들을 **제외**하므로 정산 탭 매출이 원가 탭보다 작을 수 있다. 의도된 동작이며(플랫폼 확정 판매만 대상), 안내 문구에 포함한다.

### 원가 탭과 순이익이 다른 이유 (의도된 차이)

- **원가 탭**: FIFO — 물건이 **팔린 날** 그 물건의 원가를 인식
- **정산 탭**: 현금 — 물건을 **산 날** 돈이 나간 것으로 인식

매입한 날은 정산 탭 순이익이 꺼지고(박스비도 같은 이유), 그 재고가 팔리는 날엔 원가가 0으로 잡힌다. 버그가 아니라 현금 관점이며, 요구사항("매입을 등록한다")이 이 관점이다.

**필수**: 일일 손익 표 상단 고정 안내 —
> "현금 기준 — 물건 산 날 비용을 인식합니다. 쿠팡 윙·로켓그로스 판매만 집계하며, 수기 입력분은 제외됩니다. 일괄 임포트분은 쿠폰이 반영되지 않을 수 있습니다. 상품별 손익은 수익·원가 탭을 보세요."

이 문구가 없으면 원가 탭이 겪은 "어느 숫자가 진짜냐" 혼란(로드맵 §1.1)이 그대로 재발한다.

## 7. 데이터 모델

신규 테이블 **1개**. 기존 테이블 변경 없음.

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
- `INDEX (user_id, expense_date DESC)`
- `updated_at`은 기존 `handle_updated_at()` 트리거 재사용
- **RLS**: 054가 기존 테이블 RLS를 정리한 전례를 따라 동일 패턴 적용

항목별 행이 아니라 **하루 한 행 × 항목별 컬럼**. 항목이 4개로 고정이고 늘릴 계획이 없어 유연한 스키마는 불필요한 복잡도다.

## 8. API·화면

### `GET /api/settlement/daily?from=&to=`

**외부 API를 호출하지 않는다.** 병렬 집계 후 날짜로 병합:
1. `sale_records` — `sold_at` 기준, 채널·무효 필터 (§6)
2. `cost_entries` — `received_at` 기준 매입액
3. `daily_expenses` — 수동 비용

```json
{
  "rows": [{
    "date": "2026-07-16",
    "revenue": 1840000,
    "couponDiscount": 62000,
    "platformFee": 192024,
    "purchase": 0,
    "parcelFee": 94500,
    "parcelAdjustment": 0,
    "adSpend": 85000,
    "boxCost": 0,
    "netProfit": 1406476,
    "orderCount": 47
  }],
  "monthTotal": { "...": "동일 필드 합계" }
}
```

(예시의 `platformFee`는 쿠폰 차감 후 기준 — §6 식과 일치시킨 값. 초안 예시는 gross 기준이라 식과 모순이었으므로 수정.)

### `PUT /api/settlement/expenses/:date`

수동 비용 upsert. body: `{ adSpend, boxCost, boxMemo, parcelAdjustment, memo }`. `UNIQUE (user_id, expense_date)`로 중복 클릭·동시 입력에 안전.

### 화면 — `/orders?tab=settlement`

날짜 행 × 9열: `날짜 · 매출 · 쿠폰 · 수수료 · 매입 · 택배비 · 광고비 · 박스비 · 순이익`

- **흰 셀** = 자동 계산, 수정 불가
- **파란 셀**(광고비·박스비) = 클릭해 즉시 수정 → `PUT expenses/:date`
- 하단 월 합계 고정. 기본 30일, 월 단위 이동
- 상단에 §6 안내 문구
- 박스비는 **별도 열로 분리** — 매입일에 순이익이 꺼지는 이유가 바로 보이도록
- 서브탭은 `OrdersClient.tsx:25-39`의 기존 `?tab=` 구조를 확장

### 에러 처리

외부 API에 의존하지 않으므로 실패 지점이 적다. 저장 실패 시 기존 `Toaster` 인프라로 알리고 셀 값을 되돌린다. 광고비를 `product_ad_spend`(월별)와 `daily_expenses`(일별) 두 곳에 입력하게 되므로, **월 합계가 크게 어긋나면 경고**를 표시한다(차단하지 않음).

## 9. 후속 (이 스펙 밖)

우선순위순:

1. **`unit_multiplier` 정합성 수정** — §4.1. **본 스펙의 선행 의존.** 별도 스펙 필요 (기존 데이터 보정 방식이 핵심 쟁점).
2. **`sale_records.shipping_fee` 누락 마이그레이션 복구** — §4.2. 작고 독립적.
3. **`coupon_discount` 단위 통일** — §4.3. 임포트/FIFO 양쪽 수정 + bulk 임포트의 쿠폰 0 고정 해소.
4. **정산 대조** — §3. 윙 판매를 `ordersheets` 등 독립 소스로 임포트하는 선행 작업 필요. `settlement-histories` 클라이언트·라우트도 신설해야 함.
5. **윙 단건/일괄 키 불일치** — `{orderId}-{vid}` vs `wing-{orderId}-{vid}` (`coupang-import:188` vs `wing-bulk-import:131`)로 같은 판매가 2행이 될 수 있다. 알려진 이슈(`2026-07-06` 스펙 §8)이나 정산 탭이 매출 과대로 이를 노출한다.
6. **쿠팡 광고 스크래퍼**(`scripts/ad-scraper/`)를 일별 광고비 자동 입력으로 확장. **쿠키 만료·화면 변경으로 깨지는 경로이므로 수동 입력을 정상 경로로 유지**한 채 보조로만.
7. `sale-shipping.ts` 하드코딩 3,500 정리 — 유저 단위 설정으로.
8. 일별 스냅샷 테이블 (런타임 집계가 실제로 느려지면). 현 설계는 이 길을 막지 않는다.
9. 네이버 채널 확장.

## 10. 구현 순서

**선행**: §9의 1(multiplier 스펙 완료)과 2(shipping_fee 마이그레이션 복구).

1. 마이그레이션 087 — `daily_expenses` (+ RLS)
2. `src/lib/settlement/` 계산 함수 + 단위 테스트 (TDD)
3. `GET daily` + `PUT expenses/:date`
4. 일일 손익 섹션 UI

## 11. 테스트

`src/lib/settlement/`의 순수 함수에 집중.

- 상품별 수수료율이 섞인 하루의 수수료 합계
- **반올림이 `fifo.ts:134`와 일치하는지** — 단가 round 후 ×quantity. 합산 후 round와 결과가 다른 케이스로 고정
- `voided_at`이 찍힌 건의 제외
- `channel='manual'` 건의 제외
- 쿠폰할인이 수수료 계산에 선반영되는지
- `shipping_fee`가 NULL인 레거시 건의 0 처리
- 매입·박스비가 있는 날의 순이익
- `parcel_adjustment` 음수 처리
- 소수 `quantity`(소분 상품) 매입액의 최종 반올림
- 판매가 없는 날에 수동 비용만 있는 경우(순이익 음수)

**실행**: `npx vitest run src/__tests__/lib/settlement` — 인자 없이 돌리면 무관한 실패가 쏟아진다.
