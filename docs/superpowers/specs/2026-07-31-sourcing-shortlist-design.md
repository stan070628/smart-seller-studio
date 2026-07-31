# 소싱 쇼트리스트 탭 설계

- 작성일: 2026-07-31
- 브랜치: `feat-sourcing-shortlist`

## 배경

2026-07-31 도매꾹 소싱 후보를 뽑는 작업에서 두 가지 결함이 드러났다.

**1) 수집 데이터가 낡았고 판매 상태를 추적하지 않는다.** 후보 10건을 `sourcing_items`에서 뽑았는데, 도매꾹 API로 실시간 조회하니 4건이 이미 사라져 있었다.

| 상품 | item_no | 실제 상태 |
|---|---|---|
| 오토바이 방한 우비 | 61843637 | 삭제됨 |
| 보냉가방 쿨러백 | 55458355 | 삭제됨 |
| 캠핑 그릴 수납가방 | 59333441 | 판매종료 (재고 18) |
| 캠핑 로프 도르래 | 64484712 | 판매종료 (재고 0) |

후보 10건 모두 2026-04 수집, 2026-05-01 이후 갱신이 없었다. `sourcing_items.status` 컬럼은 45만 건 전량 NULL이다.

**2) 시세 기준이 틀렸다.** 네이버 쇼핑 검색 결과의 25분위를 시세로 썼으나 쿠팡 실판가의 2~3배였다. 접이식 쓰레기통이 대표 사례다 — 네이버 25분위 15,160원, 실제 쿠팡 판매가 5,490원. 마진율 판정이 59.8%에서 11.7%로 뒤집혀 손익분기(7,671원)에 미달한다.

원인은 검색어였다. 도매꾹 상품명은 키워드 나열형이라 앞 4단어만 잘라 쓰면 상품 정체를 놓친다. `"접이식 쓰레기통 걸이형휴지통…"`이 `"캠핑 쓰레기통"`으로 검색되어 캠핑용 대형 트래쉬박스(중앙값 36,580원)를 잡았다.

**3) 배송비가 원가에서 빠져 있었다.** `sourcing_items.deli_fee`는 45만 건 중 2,539건(0.6%)만 채워져 있어, 후보 선별에서 배송비를 아예 무시했다. 10개 사입 기준 개당 300원이 누락된 셈이다. 접이식 쓰레기통은 이를 반영하면 마진이 276원에서 **−24원**으로, 적자가 확정된다.

**결론: 검증한 후보를 담아둘 곳이 없고, 담아도 낡고, 원가도 덜 잡혔다.** 후보는 채팅 로그에만 남았다.

## 목표

소싱 후보를 담아두고, 담는 순간과 매일 새벽에 자동으로 재검증하는 화면을 만든다. 동시에 실제로 사용하지 않는 소싱 UI를 걷어낸다.

## 범위 1 — 기존 소싱 UI 삭제

사용자 확인(2026-07-31): 니치 분석·아이템위너를 포함해 아래 전부 미사용.

### 삭제 대상

| 대상 | 규모 | 비고 |
|---|---|---|
| `components/sourcing/DomeggookTab.tsx` | 2,629줄 | 신규 쇼트리스트 탭이 대체 |
| `components/sourcing/KeywordTrackerTab.tsx` | 714줄 | |
| `components/sourcing/ProductDiscoveryTab.tsx` | 95줄 | |
| `components/sourcing/DeepKeywordEngine.tsx` | 77줄 | |
| `components/niche/` | 9개 파일 | 니치 키워드 분석 |
| `components/winner/` | 2개 파일 | 아이템위너 |
| `app/sourcing/` 하위 페이지 6개 | | 키워드옵티마이저·상표권사전점검·입고체크리스트·협상가이드·리뷰인센티브·위너대시보드 |
| 위 UI 전용 API·lib | | 역참조 확인 후 |
| `vercel.json`의 `/api/sourcing/agent/run` | | 라우트가 없어 매일 실패 중인 깨진 cron |

### 유지 대상 — 삭제하면 안 되는 것

`lib/sourcing/`은 **상품등록(listing)과 텔레그램 봇이 의존**한다. 통째로 지우면 두 기능이 죽는다.

| 모듈 | 의존하는 곳 |
|---|---|
| `lib/sourcing/db.ts` | 텔레그램 봇, listing 3곳 |
| `lib/sourcing/domeggook-client.ts` | 텔레그램 봇, listing |
| `lib/sourcing/domeggook-pricing.ts` | 텔레그램 봇, listing |
| `lib/sourcing/naver-shopping.ts` | 텔레그램 봇 |
| `lib/sourcing/ai-keyword-extract.ts` | 텔레그램 봇 |
| `lib/sourcing/margin-1688.ts` | `sourcing-agent/china-matcher` |
| `lib/sourcing/costco-client.ts`, `deli-parser.ts`, `shared/` | listing |

기능 단위 유지 대상:

- **텔레그램 봇** — `lib/sourcing-agent/`, `lib/telegram/`, `api/telegram/`, `SourcingAgentTab`, `api/sourcing/agent/results`
- **유튜브 트렌드 발굴** — `lib/sourcing/trend-discovery.ts`, `api/sourcing/cron/trend-seeds`
- **코스트코** — `CostcoTab`, `CostcoMemoTab`, `/m/costco`, costco API·cron
- **도매꾹 수집** — `api/sourcing/cron/snapshot` (쇼트리스트가 `sourcing_items`를 계속 참조)
- `SourcingDashboard` 셸 — 코스트코 UI 진입점

### 삭제 절차

되돌리기 어려우므로 순서를 고정한다.

1. 파일별 역참조를 `grep`으로 확인한다. 예상 못 한 의존이 나오면 **멈추고 보고**한다.
2. UI → API → lib 순으로 삭제한다(의존 방향의 역순).
3. 각 단계마다 `npm run build`와 `vitest` 통과를 확인한다.
4. 단계별로 커밋을 분리해 되돌리기 쉽게 한다.

**DB는 건드리지 않는다.** `sourcing_items` 45만 건과 기존 테이블은 그대로 둔다. 코드만 지운다.

## 범위 2 — 소싱 쇼트리스트 탭 신규

### 탭 구조

유지 대상이 3개뿐이라 기존 3단(발굴/검증/실행) 구조는 무의미해진다. 단층으로 편다.

```
소싱 ▸ [소싱리스트]  코스트코  봇결과  메모
```

`소싱리스트`가 기본 탭이다.

### 데이터 모델 — `sourcing_shortlist`

마이그레이션 `094_sourcing_shortlist.sql`. 적용 대상은 Render DB(`SOURCING_DATABASE_URL`), 실행은 `node scripts/migrate-sourcing.mjs 094`.

`sourcing_items`에 컬럼을 붙이지 않고 별도 테이블로 둔다. 이유는 둘이다.

- 45만 건 수집 풀과 직접 고른 수십 건은 수명주기가 다르다.
- **도매꾹에서 삭제된 상품도 리스트에는 남아야 한다.** 왜 탈락했는지 기록이 없으면 같은 후보를 다시 뽑는다.

```sql
CREATE TABLE IF NOT EXISTS public.sourcing_shortlist (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_no            integer NOT NULL UNIQUE,
  title              text    NOT NULL,
  memo               text,
  added_at           timestamptz NOT NULL DEFAULT now(),

  -- 도매꾹 실시간 스냅샷
  dome_status        text,     -- 판매중 | 판매종료 | 삭제됨
  dome_price         integer,
  dome_inventory     integer,
  dome_moq           integer,

  -- 배송비 정책 (deli 필드 파싱 결과)
  deli_is_free       boolean,
  deli_type          text,     -- fixed | tiered
  deli_unit_qty      integer,  -- tiered일 때 구간 수량. fixed면 NULL
  deli_fee           integer,  -- 구간 요금 또는 고정 요금

  -- 쿠팡 시세 추정
  coupang_p25        integer,
  coupang_sample_n   smallint,

  -- 판정
  order_qty          integer NOT NULL DEFAULT 10,        -- 검증 사입 수량
  unit_deli_fee      integer,                            -- 개당 배송비 (파생)
  effective_cost     integer,                            -- 도매가 + 개당 배송비
  logistics_size     text    NOT NULL DEFAULT 'xsmall',  -- xsmall | small | medium
  break_even_price   integer,
  margin             integer,
  margin_rate        numeric(5,1),
  verdict            text,     -- pass | fail | dead | unknown
  verified_at        timestamptz,

  is_archived        boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
```

`verdict` 값의 뜻:

| 값 | 조건 |
|---|---|
| `pass` | 쿠팡 p25 ≥ 손익분기가 |
| `fail` | 쿠팡 p25 < 손익분기가 |
| `dead` | 도매꾹에서 판매종료 또는 삭제 |
| `unknown` | 쿠팡 표본 3건 미만이라 판정 불가 |

`unknown`을 `fail`로 뭉치지 않는다. 판정 불가와 탈락은 다르다.

### 검증 로직 — `lib/sourcing/coupang-price.ts`

2026-07-31 실측으로 검증한 방법을 그대로 옮긴다.

**`estimateCoupangPrice(title)`**

1. 상품명에서 `[판매자태그]`, `(부가설명)`, 모델코드를 제거한다.
2. 남은 단어를 앞·중간·뒤 4단어씩 최대 4구간으로 쪼갠다.
3. 각 구간으로 네이버 쇼핑 API를 검색한다(`display=100`, `sort=sim`).
4. `mallName === '쿠팡'`인 항목만 추려 누적한다.
5. 표본 3건 미만이면 `null`을 반환한다.
6. **하위 25%**를 반환한다.

최저가와 중앙값을 쓰지 않는 이유를 주석으로 남긴다. 실측 오차는 다음과 같았다.

| 기준 | 오차 |
|---|---|
| 최저가 | −34% ~ −73% |
| **하위 25%** | **−11% ~ +9%** |
| 중앙값 | 0% ~ +324% |

### 배송비 — `lib/sourcing/deli-policy.ts`

도매꾹 `deli.dome`은 두 형태로 내려온다. 실제 응답으로 확인했다.

| 형태 | 예시 | 뜻 |
|---|---|---|
| `type: "고정배송비"` | `{fee: "3000"}` | 수량과 무관하게 3,000원 |
| `type: "수량별비례"` | `{tbl: "30+3000\|30+3000"}` | **30개당** 3,000원 |

`deli.pay === "무료"`(구형은 `deli.who === "S"`)면 배송비가 없다.

**개당 배송비는 주문 수량에 따라 달라진다.** `"30+3000"`을 10개 주문하면 개당 300원이지만 30개 주문하면 개당 100원이다. 따라서 검증 사입 수량(`order_qty`)을 입력받아 계산한다.

```
총배송비 = 고정      → fee
           수량별비례 → ceil(orderQty / unitQty) × fee
개당배송비 = 올림(총배송비 / orderQty)
실효원가   = 도매가 + 개당배송비
```

`order_qty` 기본값은 **10**이다. 근거는 `20-wiki/outputs/도매꾹 선검증 1688 후소싱 설계 2026-07-29`의 검증 파라미터(테스트 물량 5~10개)다.

기존 `deli-parser.ts`의 `parseEffectiveDeliFee`는 **구간 요금**(위 표의 `fee`)을 반환한다. `api/listing/domeggook/prepare`가 이를 총원가에 1회 더하는 용법은 소량 주문에서 올바르므로 **건드리지 않는다.** 쇼트리스트는 개당 환산이 필요하므로 별도 모듈을 둔다.

- `parseDeliPolicy(deli)` → `{ isFree, type, unitQty, fee }`
- `unitDeliveryFee(policy, orderQty)` → 개당 배송비

`tbl`의 두 번째 이후 구간은 무시한다. 실제 응답이 `"30+3000|30+3000"`처럼 동일 구간 반복이었고, 검증 물량(10개 내외)에서는 첫 구간을 넘지 않는다. 주문 수량이 첫 구간을 넘으면 `ceil` 배수로 근사한다. **도매꾹 주문 화면과 대조해 검증이 필요하다**(미해결 질문 참조).

**`breakEvenPrice(effectiveCost, logisticsSize)`**

두 조건을 모두 만족하는 최소 판매가. 큰 쪽을 취하고 **올림**한다. 원가는 배송비를 반영한 실효원가를 쓴다.

- 마진율 30% 이상 → `(실효원가 + 물류비) / (1 − 0.108 − 0.30)`
- 개당 마진 ≥ 물류비 × 1.5 → `(실효원가 + 물류비 × 2.5) / (1 − 0.108)`

근거는 `20-wiki/outputs/1688 진입 카테고리 필터 2026-07-28`이다.

물류비는 사이즈별로 다르다(`20-wiki/sources/로켓그로스 요금표 2026-07-28`).

| 사이즈 | 입출고비 | 배송비 | 합 |
|---|---:|---:|---:|
| 극소형 `xsmall` | 600 | 1,125 | **1,725** |
| 소형 `small` | 650 | 1,250 | **1,900** |
| 중형 `medium` | 1,240 | 1,500 | **2,740** |

판매수수료는 10.8%로 고정한다.

### 물류비 사이즈 선택

사이즈에 따라 손익분기가 1,000원 이상 움직여 판정이 뒤집힌다. 행마다 드롭다운을 두고 즉시 재계산하며, 선택값은 `logistics_size`에 저장한다. 기본값은 `xsmall`.

자동 판별은 하지 않는다. 최종 사이즈는 물류센터 입고 시 실측으로 결정되므로(요금표 문서), 코드가 추정해봐야 틀린다.

### API

| 엔드포인트 | 역할 |
|---|---|
| `GET /api/sourcing/shortlist` | 목록 조회 |
| `POST /api/sourcing/shortlist` | 추가 (item_no 또는 도매꾹 URL) — 추가 즉시 1회 검증 |
| `DELETE /api/sourcing/shortlist/[itemNo]` | 삭제 |
| `PATCH /api/sourcing/shortlist/[itemNo]` | memo·logistics_size·order_qty 수정 (수정 시 개당 배송비·손익분기 재계산) |
| `PATCH /api/sourcing/shortlist` | order_qty 일괄 적용 |
| `POST /api/sourcing/shortlist/verify` | 재검증. body에 `itemNo` 없으면 전체 |
| `GET /api/sourcing/cron/shortlist-verify` | 매일 새벽 자동 검증 |

URL 파싱은 기존 `lib/sourcing/domeggook-url-parser.ts`를 재사용한다.

cron은 `vercel.json`에 추가한다. 기존 스케줄과 겹치지 않는 시간을 고른다(`0 16 * * *`, KST 새벽 1시).

### UI — `components/sourcing/ShortlistTab.tsx`

```
소싱 리스트                          사입수량 [10]개   [+ 추가]  [전체 재검증]
──────────────────────────────────────────────────────────────────────
상품              도매가  배송  실효원가  쿠팡p25  손익분기  마진율  사이즈   상태
메쉬 반장갑        3,300  +300   3,600    9,900    8,995    35%  극소형▾  ✅
플란넬 무릎담요     2,800  +300   3,100    9,600    8,801    37%  소형▾    ✅
책상 정리 트레이    3,100  +300   3,400   13,100    8,658    50%  극소형▾  ✅
접이식 쓰레기통     2,530  +300   2,830    5,080    8,008    −0%  극소형▾  ❌
캠핑 그릴 수납가방   4,500     —      —        —        —      —  극소형▾  ⚠ 판매종료
반려동물 유골함     3,500  +300   3,800       —        —      —  극소형▾  ⚠ 표본부족
```

- 상단 입력창에 도매꾹 상품번호 또는 URL을 붙여넣어 추가한다.
- **사입 수량은 입력하면 모든 행에 일괄 적용된다.** 바꾸면 개당 배송비와 손익분기가 전 행에서 재계산된다. 값은 행마다 `order_qty`에 저장하므로 나중에 행별 조정을 붙일 여지를 남긴다.
- 배송비 열에 마우스를 올리면 정책 원문을 보여준다(`30개당 3,000원` / `고정 3,000원` / `무료`).
- 각 행은 도매꾹 상품 페이지로 링크한다.
- `dead` 행은 흐리게 처리하되 지우지 않는다. 아카이브 토글로 숨긴다.
- 마지막 검증 시각을 표시한다. 24시간이 지났으면 경고색으로 보여준다.
- 정렬 기본값은 마진율 내림차순.

### 에러 처리

| 상황 | 처리 |
|---|---|
| 네이버 API 실패·표본부족 | `verdict='unknown'`, 다음 cron에서 재시도 |
| 도매꾹 API 실패 | **기존 값을 유지하고 `verified_at`을 갱신하지 않는다.** 일시적 오류를 "삭제됨"으로 오판하면 안 된다 |
| 도매꾹이 명시적으로 상품 없음 응답 | `verdict='dead'`, `dome_status='삭제됨'` |
| cron 타임아웃 | 1회 처리 상한을 둔다. 기존 `SNAPSHOT_BATCH_LIMIT` 패턴을 따른다 |

도매꾹 API 실패와 "상품이 실제로 없음"을 구분하는 것이 핵심이다. 응답의 `errors.dcode === 'ITEM_ERROR'`가 후자다.

### 테스트

`src/__tests__/lib/sourcing/coupang-price.test.ts`

**손익분기 계산** — 순수 함수라 전량 단위 테스트로 덮는다.

| 실효원가 | 사이즈 | 기대 손익분기가 |
|---:|---|---:|
| 2,500 | 극소형 | 7,638 |
| 3,300 | 극소형 | 8,535 |
| 4,000 | 극소형 | 9,671 |
| 3,180 | 소형 | 8,891 |

**배송비 파싱과 개당 환산** — 실제 API 응답을 픽스처로 쓴다.

| 입력 | 주문수량 | 기대 개당 배송비 |
|---|---:|---:|
| `{type:"수량별비례", tbl:"30+3000\|30+3000"}` | 10 | 300 |
| `{type:"수량별비례", tbl:"30+3000\|30+3000"}` | 30 | 100 |
| `{type:"수량별비례", tbl:"30+3000\|30+3000"}` | 31 | 194 |
| `{type:"고정배송비", fee:"3000"}` | 10 | 300 |
| `{pay:"무료"}` | 10 | 0 |
| `{who:"S"}` (구형) | 10 | 0 |

31개 케이스는 `ceil(31/30)=2` → 6,000원 → 개당 194원으로, 구간을 넘길 때 배수 적용을 검증한다.

**쿠팡가 추정** — 네이버 API 응답을 픽스처로 고정하고, 2026-07-31 실측값과 대조한다.

| 상품 | 실제 쿠팡 판매가 |
|---|---:|
| 접이식 쓰레기통 | 5,490 |
| 패딩 겨울귀마개 | 5,600 |
| 작업용 무릎보호대 | 5,180 |

통과 기준은 오차 ±15% 이내(실측은 ±11%). 표본 2건 이하 입력 시 `null` 반환도 함께 검증한다.

**검색어 생성** — `[한원산업]` 같은 판매자 태그와 모델코드가 제거되는지, 쓰레기통 사례에서 실제 정체를 잡는 구간이 생성되는지 확인한다.

## 비범위 (YAGNI)

- **소싱 파이프라인 상태 추적**(후보→발주→입고→판매검증) — 다음 단계. 쇼트리스트가 자리 잡은 뒤 판단한다.
- **쿠팡 파트너스 오픈API 연동** — 파트너스 최종승인(누적 판매 15만원)이 필요해 현재 발급 불가. 네이버 기반으로 ±11% 정확도가 나오므로 당장 필요 없다. `scripts/fill-coupang-prices.mjs`에 파트너스 경로를 미리 만들어 두었고, 키가 생기면 그때 붙인다.
- **1688 자동 역검색** — 기존 `sourcing-agent/china-matcher`가 있으나 쇼트리스트와의 연결은 다음 단계로 미룬다.
- **물류비 사이즈 자동 판별** — 실측으로 결정되므로 추정하지 않는다.

## 미해결 질문

- `tbl`의 두 번째 이후 구간이 무슨 뜻인지 확정되지 않았다. 실제 응답이 `"30+3000|30+3000"`처럼 동일 구간 반복이라 첫 구간만 보고 `ceil` 배수로 근사했다. 도매꾹 주문 화면에서 31개 주문 시 배송비가 실제로 6,000원인지 대조해 확인해야 한다. 검증 물량(10개 내외)에서는 첫 구간을 넘지 않아 당장 영향은 없다.
- 배송비의 제주·도서산간 할증(`feeExtra`)은 반영하지 않았다. 일반 지역 기준으로만 계산한다.
- 쿠팡 표본이 3~5건인 구간의 신뢰도. 현재는 3건을 하한으로 두었으나 근거가 얇다. 운영하며 `coupang_sample_n`과 실제 진입 결과를 대조해 보정한다.
