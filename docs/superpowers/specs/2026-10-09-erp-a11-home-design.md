# ERP A11 오늘 할 일 · A12 매출 추이 — 홈 화면 설계

> **TL;DR** `/dashboard`(앱 첫 화면)를 **「오늘 할 일」 카드 5개 → 오늘 흐름 → 매출 추이 → 플랜·상품 수**로 바꾼다. 숫자는 전부 ERP DB(`erp.*`)에서 읽어 1초 안에 뜨게 하고, 화면을 열 때마다 쿠팡·네이버 API를 부르던 `/api/dashboard/orders-summary`(로컬 실측 65~77초)는 지운다.

- 근거: ERP 재구성 설계(2026-09-25) v3 피드백 5 「첫 화면이 숫자 대시보드였다 → A11 오늘 할 일」 · 메뉴 `[A] 홈 — A11 오늘 할 일 · A12 매출 추이` · 목업 `2026-09-25-erp-restructure-mockup.html`의 `today()`.
- 선행: 1-C2c까지 병합(4f54413d), 판매 차감 켜짐(2026-10-05).
- 사용자 결정(2026-10-09): ① 목업 8카드 중 **데이터가 있는 5개만**(로지아이 송장 미반영·클레임·문의는 그 기능을 만들 때 카드도 함께) ② **`/dashboard` 자리를 바꾼다**(새 화면을 따로 만들지 않는다).

## 1. 「오늘 할 일」 카드 5개

| 카드 | 세는 것 | 경고 | 누르면 |
|---|---|---|---|
| 출고 대기 주문 | 직접발송 채널(`coupang_wing`·`naver`·`toss`) 중 **`paid` 줄이 1개 이상이고 모든 줄이 `paid`·`canceled`·`returned`·`unpaid` 중 하나**인 주문 수(`order_id` 기준, 부분 취소 주문 포함·배송중 줄이 섞이면 제외). 「결제됐고 아직 출고 안 됨」이라는 뜻이라 Wing 상품준비중(INSTRUCT)·네이버 발주확인 뒤도 포함한다 | 그중 `paid` 줄의 `paid_at`이 24시간보다 오래된 주문이 있으면 빨강(「출고 지연 의심 N건」) | `/orders` |
| 매핑 필요 | `attribution = 'unattributed'`이고 상태가 `canceled`·`returned`·`unpaid`가 아닌 주문 줄 수(`/orders` 미귀속 큐와 같은 상수 `UNMAPPED_EXCLUDED_STATUSES`) | 1 이상 빨강 | `/erp/stock`(미연결 주문 연결 영역) |
| 전송 실패 | 최근 24시간 `erp.job_runs`에서 `status = 'failed'`인 작업 — 작업별 실패 횟수·마지막 실패 시각 | 1 이상 빨강 | 이동 없음 — 카드 안에 작업 이름·횟수·마지막 시각(F13 작업 로그 화면은 아직 없다) |
| 재고 부족 보류 | `deduction_state = 'skipped_short'`이고 `SOLD` 상태인 줄 수 · 묶음 줄은 `alloc`의 SKU별로 센 SKU 수. 실사 대기열은 숫자로 세지 않고 「오늘 실사 목록 보기」 링크만 둔다(`count-queue`는 밀린 일이 아니라 오늘 셀 목록 8개 고정이다) | 보류 1줄 이상 노랑 | `/erp/stock` |
| RG 대조 경고 | 가장 최근 `run_id`의 `erp.rg_recon_snapshots`에서 `alert is not null`인 줄 수(`alerts`) · 그 실행 시각 | 1 이상 빨강 | `/erp/stock`(RG 실재고 대조) |

- 0건이면 회색 「없음」 — 카드를 숨기지 않는다(확인했다는 것이 보이게).
- 쿠팡·네이버 API는 부르지 않는다.

## 2. 오늘 흐름

- **직접발송 채널(`coupang_wing`·`naver`·`toss`)만** 센다 — RG 어댑터는 상태를 `paid`로 고정하고 당근 입력도 `paid`로 들어가 둘 다 진행하지 않으므로 섞으면 결제완료가 부풀려진다. 최근 7일 결제분의 주문 수를 표준 상태별로: **결제완료(`paid`) → 배송중(`shipping`) → 배송완료(`delivered`) → 구매확정(`confirmed`)** · 별도로 취소요청·취소·반품요청·반품.
- ⚠️ ERP의 `confirmed`는 **구매확정**이다(발주확인이 아니다). 발주확인·로지아이 전달 단계는 ERP가 아직 갖고 있지 않다.
- 기존 `OrderPipeline` 위젯을 이것으로 바꾼다.

## 3. 매출 추이 (A12)

- 출처 `erp.order_lines`. **`SOLD` 상태만**(`types.ts` — 취소·반품 완료 제외).
- 매출 = `amount − coalesce(discount_amount, 0)`. 건수 = 주문 수(`order_id`).
- 기간: 오늘 · 7일 · 30일 · 이번 달(기존 토글 유지). 날짜는 KST, 기준 시각은 `coalesce(paid_at, ordered_at)`.
- 그래프: 날짜별 막대를 채널별로 쌓는다(쿠팡 Wing · RG · 네이버 · 토스 · 당근). 옆에 합계(매출·건수)와 채널 비중.
- ⚠️ **RG 매출은 취소·반품만큼 크게 잡힌다(1~2%)** — RG API로 취소를 알 수 없다(2026-10-05 실측). 화면에 작은 글씨로 적는다. 정확한 보정은 별도 과제 「월 1회 Wing 순판매 보정」.
- 기존 화면(쿠팡·네이버 정산 API 기준)과 숫자가 다를 수 있다 — 기준이 「정산」에서 「주문」으로 바뀐다.

## 4. 화면 배치·구조

```
/dashboard
 ├ 오늘 할 일 (카드 5)          GET /api/erp/home/today
 ├ 오늘 흐름                    (같은 응답)
 ├ 매출 추이 [오늘|7일|30일|이번 달]  GET /api/erp/home/revenue?period=
 └ 플랜 진행률 · 상품 수         (기존 그대로)
```

| 단위 | 책임 |
|---|---|
| `src/lib/erp/home/today.ts` | 카드 5개·오늘 흐름 쿼리(순수 집계 함수 + SQL) |
| `src/lib/erp/home/revenue.ts` | 기간 범위(KST) · 매출 집계 쿼리 |
| `src/app/api/erp/home/today/route.ts` · `revenue/route.ts` | `requireAuth` + 위 함수 |
| `src/components/dashboard/TodayCards.tsx` · `TodayFlow.tsx` | 카드·흐름 렌더 |
| `RevenueTrend.tsx` | 매출 추이(채널 스택) — 새로 만든다. 옛 `RevenueChart.tsx`(12주 누적 목표선)는 지운다 |
| `DashboardClient.tsx` | 배치 교체 · orders-summary 호출 제거 |

- 삭제: `src/app/api/dashboard/orders-summary/route.ts`와 그 타입(`OrdersSummaryData`), `OrderPipeline.tsx`·`PipelineStageCard.tsx`·`RevenueChart.tsx`와 테스트 `order-pipeline`·`revenue-chart`(다른 사용처 없음을 `grep`으로 확인했다).
- 실사 대기열(`count-queue`)은 오늘 셀 목록(기본 8개 고정)이라 숫자로 세지 않고 「오늘 실사 목록 보기」 링크만 둔다(2026-10-09 계획 작성 중 발견).

## 5. 오류 처리

- 카드 API가 실패하면 카드 자리에 「불러오지 못했다 · 다시 시도」 — 매출 추이·플랜은 그대로 뜬다(서로 독립 요청).
- 각 카드 쿼리는 서로 독립이다. 하나가 실패하면 그 카드만 「오류」, 나머지는 보인다(서버에서 카드별 try/catch, 응답에 카드별 `error`).

## 6. 테스트

| 대상 | 경우 |
|---|---|
| today 쿼리 | 출고 대기: 부분 취소 주문 포함·배송중 섞인 주문 제외·24시간 경계 · 흐름: 직접발송 채널만 · 매핑 필요: 취소·반품·미결제 제외(큐와 공유 상수) · 전송 실패: 24시간 경계·작업별 묶음 · 재고 부족 보류: 줄·alloc SKU 수·SOLD만 · RG 대조 경고: 최근 run만 · 카드 하나 실패 시 나머지 유지 |
| revenue | KST 날짜 경계 · `SOLD`만 · 할인 차감 · 채널별 · 4개 기간 범위 |
| 화면 | 0건 회색「없음」 · 경고 색 · 링크 · 카드 오류 표시 · RG 한계 문구 |
| 운영 대조(읽기 전용) | 운영 DB에서 카드 숫자를 뽑아 Wing 「결제완료＋상품준비중」, 네이버·토스 발송 전 건수와 한 번 대조 |

## 범위 밖

- 로지아이 송장 미반영 · 클레임·반품 판정 · 문의 미답변 카드(기능과 함께).
- 안전재고 설정 · 작업 로그 화면(F13) · 메뉴 재구성(`erp-menu.ts`).
- RG 매출 보정.
