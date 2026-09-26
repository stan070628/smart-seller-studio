# ERP 1-C1 — 재고 수정·기초재고·입고/RG 기록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사람이 PC(`/erp/stock`)·휴대폰(`/m/stock`)에서 원장 재고를 고치고(빈 위치의 첫 「지금 개수」 = 기초재고), 품목이 많아도 실사가 돌도록 상품 단위로 묶어 보고 「오늘 셀 목록」(센 기록 기반 순환 실사)을 따라 세며, 실사표 CSV로 기초재고를 한 번에 불러오며, 코스트코 영수증 확정과 RG 보내기가 같은 트랜잭션에서 원장에 기록되게 한다. 관문: **원장 RG = 쿠팡 RG 실재고**.

**Architecture:** 조정은 1-B 원장 위에 얹는 얇은 층이다. 무엇을 기록할지는 순수 함수(`adjust.ts` — 지금 개수→차이 · 단가 출처 · 화면 재고 불일치 409 · 기초/조정 구분 · 커서 규칙)가 정하고, 기록은 `adjust-store.ts`가 1-B `store.ts`(SKU 잠금·멱등·FIFO)를 불러 한다. 화면은 `/api/erp/stock/*` 한 벌을 PC·휴대폰이 같이 쓴다. 영수증 확정·RG 보내기는 기존 라우트의 트랜잭션 **안에서** 원장 함수(`receipt.ts`·`rg-ship.ts`)를 부른다.

**Tech Stack:** Next.js 16 App Router · React 19(inline style + `E` 토큰 + `erp-ui.tsx`) · Postgres 17(Supabase, `pg` 직접) · TypeScript · vitest + testing-library + msw · tsx 스크립트

- 설계: `docs/superpowers/specs/2026-09-26-erp-phase1c1-stock-adjust-design.md`(사용자 승인) · 결정 기록: `…-decisions.md`
- 선행: 1-B(`docs/superpowers/plans/2026-09-26-erp-phase1b-stock-ledger.md`) — 원장 비어 있음, `purchase_units` 0행

---

## 사전 정보 (실행자는 반드시 읽는다)

- 작업 폴더: `~/dev/smart_seller_studio/.worktrees/erp-restructure` (브랜치 `feature/erp-restructure`, main `5b5d995f`까지 fast-forward). 모든 명령은 여기서.
- **합격 기준** = 새 테스트 전부 통과 + 전체 실패 수 ≤ 기준선(Task 0 Step 1에서 잰다 — 1-B 때 13건, 전부 ERP 무관) + `npx tsc --noEmit` 0 오류.
- **DB는 운영 Supabase 하나다.** 스크립트·마이그레이션은 `SUPABASE_DB_URL`, 앱 서버 코드(`getSourcingPool()` — `src/lib/sourcing/db.ts`)는 `SOURCING_DATABASE_URL`로 붙는다. 둘이 같은 DB인지 Task 1 Step 0에서 확인한다(값은 출력하지 않는다). 비밀값 출력 금지.
- 마이그레이션: `node scripts/apply-migration.mjs 115`(트랜잭션으로 감싼다 — 파일 안에 BEGIN/COMMIT 금지). **운영 적용 허용** — 원장 0행·`purchase_units` 0행이다. Task 4c의 `116`(센 기록 `erp.stock_counts`, 새 테이블)도 같은 방식·같은 허용이다.
- 스크립트 실행: `npx --no-install tsx scripts/erp/<파일>.ts`. 첫 줄에서 `loadEnvLocal()`(`scripts/erp/_env.ts`). 스크립트는 `new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })`로 접속한다.
- **erp 스키마 접근(1-B P4):** 서버 코드는 `pg` 직접(`getSourcingPool()`), supabase-js로 `erp`를 읽지 않는다. `pg.Pool`·`PoolClient`·`pg.Client`는 모두 1-B `Db` 인터페이스(`src/lib/erp/ledger/store.ts`)를 만족한다.
- **인증:** 새 `/api/erp/*`는 전부 첫 줄에서 `requireAuth`(`src/lib/supabase/auth.ts` — 미인증이면 401 `Response`)를 부른다. `src/proxy.ts`는 `/api/`를 통과시키므로 **핸들러가 막아야 한다.** 테스트는 `vi.mock('@/lib/auth', () => ({ getCurrentUser: … }))`로 로그인 상태를 만든다(`src/__tests__/api/rg-shipments.test.ts` 방식).
- **멱등키(1-B `assertIdemKey`):** `#` 금지 · `rev:` 접두 금지. 이 계획의 키는 조정 `adj:<uuid>` · 기초 `opening:<skuId>:<location>` · 영수증 `receipt:<receipt_line_id>:<skuId>` · RG 보내기 `rgship:<event_id>:<skuId>` 넷뿐이다.
- **1-B 인계 중 1-C1에 걸리는 것:** ① 여러 SKU를 한 트랜잭션에 쓰면 **`sku_id` 오름차순으로 먼저 `lockSku`** 한다(교착 방지). ② `occurredAt`은 **오프셋 있는 ISO**만 쓴다(서버 `new Date().toISOString()` 또는 `YYYY-MM-DDT00:00:00+09:00`). ③ (I2) 역전표 뒤 같은 멱등키 재기록은 무시된다 — 조정은 요청마다 새 uuid라 걸리지 않고, 기초 키는 되돌린 뒤 그 위치가 더는 비어 있지 않아 다시 쓰이지 않는다.
- 🔴 **구매자 개인정보를 파일·로그에 쓰지 않는다.**
- 🔴 **화면 확인은 컨트롤러가 직접 브라우저로 한다(서브에이전트에게 맡기지 않는다).** `npm run dev`(백그라운드) → 사용자가 `http://localhost:3000/login`에서 **직접 로그인**(비밀번호를 대신 입력하지 않는다) → PC 폭(1440px)과 휴대폰 폭(390px)에서 본다. 로컬 개발 서버도 **운영 DB**에 붙는다 — 화면 확인 중 저장 버튼은 사용자가 허락한 것만 누른다.
- 🔴 **사용자 게이트:** Task 7 Step 7(의심 품번 2건) · Task 8 전체 · Task 9 Step 5(병합).
- UI 규칙: 인라인 스타일 + `E` 토큰(`src/lib/design-tokens.ts`) + `src/components/orders/erp-ui.tsx` 조각, `fetch` + `useState`. 새 UI 라이브러리 금지(TanStack은 2단계). 휴대폰 화면은 영수증 화면 틀(480px · 상단 52px · 하단 고정 버튼)을 따른다. 화면 문구는 기존 화면처럼 「~습니다」체.

## 설계 해석 — 스펙이 열어 둔 것을 이 계획이 정한 것

| # | 스펙 문구 | 이 계획의 선택 | 이유 |
|---|---|---|---|
| 1 | §5 「`/api/orders/{coupang,naver,toss}`에 `requireAuth`」 | **`coupang-rg`·`naver/debug`까지 5개** | 같은 폴더의 나머지 둘도 인증이 없다. `naver/debug`는 네이버 원본 응답(구매자 정보 포함)을 그대로 돌려준다 |
| 2 | §1 「원장이 빈 SKU의 첫 `count`는 opening」 | 화면 조정(PC·휴대폰·RG 반영)은 **(SKU·위치)에 전표가 하나도 없을 때** 첫 `count`를 opening으로. CSV 불러오기는 스펙대로 **SKU 단위**(전표가 하나라도 있으면 제외) | SKU 단위로 보면 집을 센 뒤 같은 SKU의 입고중·RG 첫 입력이 「실사차이 조정」이 된다 — 기초재고가 아닌데 조정으로 남는다 |
| 3 | §1 「조정 한 건 = 멱등키 하나(`adj:<uuid>`)」 | 화면이 요청마다 uuid(`requestId`)를 만든다. 전표 `ref_type='adjust'`·`ref_id=<uuid>`. 같은 uuid 재전송은 `duplicate`(기록 없음). opening이 되는 조정의 키는 `opening:<sku>:<위치>` | 두 번 눌러도 한 번만 기록된다. 기초 키를 1-B 적재 스크립트와 같게 둬 CSV·화면 어느 쪽으로 들어가도 한 위치에 기초가 둘 생기지 않는다 |
| 4 | §1 「단가: 최근 lot → 옛 입고 → 입력 필수, 화면은 보여주고 고칠 수 있다」 | 화면이 기본값(최근 lot → 옛 입고)을 미리 채워 **보낸 값을 `input`으로** 쓴다. 서버는 값이 없을 때만 lot → legacy를 찾고, 모두 없으면 422 `cost_required` | 사람이 본 값이 곧 기록값이다. 휴대폰처럼 값을 안 보낸 경우에도 같은 순서가 적용된다 |
| 5 | §1 「입출 이력의 되돌리기」 | **`adj:`·`opening:` 키만** 되돌린다 | 영수증·RG 보내기 전표는 옛 원가 기록(`cost_entries`)과 짝이라 원장만 되돌리면 둘이 어긋난다 |
| 6 | §2 「확인 후 반영」 | 화면이 본 `actual`을 그대로 반영한다(서버가 다시 읽지 않는다). `expected`(화면의 원장 RG)가 다르면 409. 웹의 RG 매핑 이슈는 **경고**만 — `docs/erp/opening-overrides.json`의 `ignoreRgVids`는 스크립트 전용 | 사람이 확인한 숫자와 기록되는 숫자가 같아야 한다. 운영(Vercel)에는 docs 파일이 없다 |
| 7 | §3 「실사표 불러오기 — 1-B `opening.ts` 재사용」 | `opening-overrides.json` 대신 **화면에서 단가 입력·실사 시각 입력**. `self_count` 빈칸 행과 실사표에 없는 SKU는 **건너뛴다(경고)** — 1-B 스크립트는 오류였다 | 빈 위치의 첫 입력이 곧 기초재고이므로 나머지는 나중에 화면에서 적으면 된다 |
| 8 | §4 「분배 합 = 판매단위 수량」 | 수량 단위 = `cost_entries.quantity`(소분 후 팩 수). 소분은 이월 때문에 화면이 **추정값**만 안다 → 분배 합이 서버 계산과 다르면 **그 줄만 실패**하고 실제 팩 수를 알려준다. 연결 SKU가 없는 품목은 SKU를 고르기 전까지 확정 실패 | 원장 누락보다 확정 실패가 낫다 — 실패 사유가 화면에 그대로 뜬다 |
| 9 | §4 「RG 보내기 SKU 수량 입력」 | SKU 수량은 **선택**(안 보내면 옛 흐름만). 원장 전표가 **하나도 없는** SKU는 건너뛰고(응답 `ledger.skipped`) 화면에 알린다. 전표가 있는데 집 재고가 모자라면 409로 **전부 되돌린다**. 이동 시각 = 기록 시각, 보낸 날짜·Wing 입고 ID는 메모 | 기초재고 전에도 옛 원가 배분 흐름이 막히지 않아야 한다 |
| 10 | §4 영수증 입고 시각 | `구매일T00:00:00+09:00` | 영수증에는 구매일만 확실하다 |
| 11 | §3 사이드바 「재고·매입 > 재고현황」 | 최상위 「재고·매입」(`/erp` → `/erp/stock` 리다이렉트) 아래 「재고현황」 | 사이드바는 부모도 링크다 |
| 12 | §3 휴대폰 「최근 수정 5건」 | 서버 기준(`ref_type='adjust'` 묶음) — PC에서 고친 것도 보인다 | 기기 간 공유 |
| 13 | (없음) 휴대폰 진입점 | 주소 직접(`/m/stock`, 홈 화면 추가). 링크는 만들지 않는다 | `/m`에는 목록 화면이 없다 |
| 14 | (Task 2 리뷰) 빈 위치의 ±수량 · 옛 단가 · 기준 시각 · 요청 id | ① 빈 (SKU·위치)의 **+수량 = expected 0인 「지금 개수」**(기초 전표·`opening:` 키·커서), −수량은 400 「비어 있는 위치에서는 뺄 수 없다」 ② **`base_unit_label`이 정해진 SKU는 옛 `cost_entries` 단가를 쓰지 않는다** — 조정 서버·재고 목록 미리 채움 모두 null, 목록에 `costNeedsInput` → 사람이 단가를 적는다(없으면 422) ③ `ledger_cutover` = **가장 이른 기초 시각**(`least()` upsert — 화면 조정·실사표 불러오기·`opening-apply` 공통, 스크립트의 「다른 값이면 중단」 제거) ④ 요청 id는 소문자로 맞추고, 한 요청 안 중복·다른 SKU·위치에 쓰인 id는 400, 멱등키 unique 위반(23505)은 409 ⑤ `rg` 위치 ⇔ `rg_reconcile` 사유 | ① 입력 방식에 따라 같은 첫 입력이 기초/조정으로 갈리지 않게 ② 옛 입고는 묶음·박스 단위일 수 있어 조용히 틀린 원가가 들어간다 ③ 어느 경로가 먼저 들어가도 소급 시작점이 같다 ④ 같은 id의 다른 조정을 `duplicate`로 삼키면 기록이 사라진다 |
| 15 | 결정 5(2026-09-26 추가) 「오늘 셀 목록 · 상품 단위 묶기 · 센 기록」(Task 4b·4c·5) | ① 센 기록(`erp.stock_counts`, 116)은 **`count` 방식 입력마다**(PC 칸·실사 모드·오늘 셀 목록·휴대폰·RG 대조) 조정과 **같은 트랜잭션**에서 한 줄 — 차이 0 포함, ±수량은 남기지 않는다. 실사표 불러오기도 불러온 SKU의 **집 센 개수**를 한 줄씩(0 포함, 시각 = 실사를 마친 시각) ② 같은 요청 판정에 원장과 함께 **`stock_counts.request_id`**(unique)도 본다. unique 위반(23505)은 409 ③ 오늘 셀 목록·「마지막 실사」는 **집(`self`) 센 기록만** 본다. 금액 = **집 평가액**, 제외 = 원장 전표가 없는 SKU(「재고 0이고 전표도 없다」와 같다) · 오늘(KST) 센 SKU, 동점은 SKU id 순. 화면(PC 패널·휴대폰)은 목록을 **열 때 한 번** 받고 **집에서 센** 카드만 뺀다 ④ 화면은 차이 0 「지금 개수」를 막지 않는다(「차이 없음 — 센 기록만 남깁니다」) — Task 4의 `EditCell`·실사 모드가 차이 0을 버리던 것을 고친다 ⑤ 묶음 합계는 **전체 옵션** 합, 조회조건은 옵션에 걸어 맞는 옵션만 보이고, 조회조건이 걸리면 묶음을 모두 펼친다. RG 차이는 합이 아니라 **불일치 옵션 수** | ① 「세어 봤더니 맞다」가 남아야 순환 실사가 돈다. ±수량은 센 개수가 아니다. 불러오기를 빼면 기초재고를 막 센 SKU가 「한 번도 안 센」 것으로 첫 목록을 채운다 ② 차이 0이면 원장에 쓰지 않아 기존 중복 판정(원장 `ref_id`)이 재전송을 못 알아본다 ③ 목록은 집에서 세는 일이다. 다시 받으면 센 만큼 다음 SKU가 채워져 「오늘 N개」가 끝나지 않는다 ④ 막으면 센 기록이 남지 않는다 ⑤ 합계가 필터에 따라 바뀌면 상품 재고를 잘못 읽는다. RG 차이 합은 +1·−1이 상쇄돼 0으로 보인다 |

## 1-C1 탐색 사실 (2026-09-26 읽기 전용)

| 사실 | 계획에 주는 영향 |
|---|---|
| `/api/orders/{coupang,coupang-rg,naver,naver/debug,toss}` 5개 모두 인증 없음. 화면(`OrdersTab`·`CostManagementTab`)은 같은 출처 `fetch`라 쿠키가 따라간다 | Task 0. `src/__tests__/api/toss-orders.test.ts`는 로그인 모의가 없어 인증을 넣으면 깨진다 → 같이 고친다 |
| `rg-shipments` POST는 FIFO를 커밋한 **뒤** `pool.query`로 이벤트를 쓴다(실패해도 무시) | Task 6에서 트랜잭션 안으로. 기존 테스트 「이벤트 INSERT 실패 시에도 FIFO는 COMMIT됨」은 반대 동작이 되므로 바꾼다 |
| 영수증 확정은 줄마다 트랜잭션, `createCostEntry`가 `cost_entries` 행을 돌려준다(`quantity` numeric 문자열 · `unit_cost` int) | Task 7: 그 트랜잭션 안에서 `Number(entry.quantity)`·`Number(entry.unit_cost)`로 원장 입고 |
| `erp.purchase_units`는 `unique (supplier, supplier_code)` · `sku_id` null 허용 · 0행 | 마이그레이션 115에서 1:N으로 |
| `scripts/erp/opening-collect.ts`의 `readDb`·`fetchRgStock`을 스크립트 3개가 쓴다 | Task 3에서 `src/lib/erp/ledger/opening-db.ts`로 옮기고 스크립트는 다시 내보낸다(화면 API가 `scripts/`를 가져오지 않게) |
| `ReceiptDetail`은 msw로 테스트된다(`src/__tests__/components/receipt-screens.test.tsx`) | Task 7에서 새 호출(`sku-options`)의 모의를 더한다 |
| 사이드바에 「재고·매입」이 없다. `labelForHref`는 하위 항목 라벨을 먼저 쓴다 | Task 4에서 추가 |

## File Structure

| 파일 | 책임 |
|---|---|
| `src/app/api/orders/{coupang,coupang-rg,naver,naver/debug,toss}/route.ts` (수정) | 로그인 검사 |
| `supabase/migrations/115_erp_ledger_reason_purchase_units.sql` | 원장 `reason` + 검사 · `purchase_units` 1:N |
| `src/lib/erp/ledger/plan.ts`·`store.ts` (수정) | 전표에 `reason` 칸 |
| `src/lib/erp/ledger/adjust.ts` | 조정 순수 로직: 입력 검사 · 차이 · 기초/조정 · 커서 · 단가 출처 · 오류 타입 · 멱등키 |
| `src/lib/erp/ledger/adjust-store.ts` | 조정 기록(잠금·중복·재고 확인·단가 조회·커서) · 여러 건 · 센 기록(`recordCount`, Task 4c) |
| `src/lib/erp/ledger/opening-db.ts` | (옮김) `readDb`·`readRgLinks`·`fetchRgStock` |
| `src/lib/erp/ledger/opening-import.ts` | 실사표 불러오기 계획(순수) + 적재(DB) · 집 센 기록(Task 4c) |
| `src/lib/erp/ledger/rg-ship.ts` | RG 보내기 → SKU별 `self → rg_inbound` |
| `src/lib/erp/ledger/receipt.ts` | 영수증 줄 → SKU 후보·분배·`receipt` lot·품번 학습 |
| `src/lib/erp/ledger/purchase-units.ts` | `purchase_units` 첫 적재 계획(순수) |
| `supabase/migrations/116_erp_stock_counts.sql` | 센 기록 `erp.stock_counts`(차이 0인 실사도 남긴다 · `request_id` unique) — Task 4c |
| `src/lib/erp/stock/queries.ts` | 재고 화면 조회(목록·이력·최근·RG 원장·활성 SKU) · 목록에 집 평가액·마지막 실사(Task 4c) |
| `src/lib/erp/stock/count-queue.ts` | 「오늘 셀 목록」 규칙(순수) · KST 날짜 — Task 4c |
| `src/lib/erp/stock/http.ts` | `/api/erp/*` 공용: 트랜잭션 · 오류 → HTTP · 요청 본문 변환 |
| `src/app/api/erp/stock/route.ts` | GET 목록 |
| `src/app/api/erp/stock/adjust/route.ts` | POST 조정(1건·실사 모드 여러 건) |
| `src/app/api/erp/stock/[skuId]/history/route.ts` | GET SKU 입출 이력 |
| `src/app/api/erp/stock/reverse/route.ts` | POST 되돌리기 |
| `src/app/api/erp/stock/recent/route.ts` | GET 최근 조정 |
| `src/app/api/erp/stock/rg-reconcile/route.ts` | GET 대조 · POST 반영 |
| `src/app/api/erp/stock/import/route.ts` | POST 실사표 미리보기·적재 |
| `src/app/api/erp/stock/count-queue/route.ts` | GET 오늘 셀 목록 — Task 4c |
| `src/app/api/erp/receipts/[id]/sku-options/route.ts` | GET 영수증 줄별 SKU 후보 |
| `src/app/erp/layout.tsx`·`src/app/erp/page.tsx`·`src/app/erp/stock/page.tsx` | PC 화면 틀 |
| `src/lib/nav-items.tsx` (수정) | 사이드바 「재고·매입 > 재고현황」 |
| `src/components/erp/stock/stock-view.ts` | 화면 순수 계산(필터·KPI·편집 차이·요청 본문·내보내기) · 상품 단위 묶기(Task 4b) |
| `src/components/erp/stock/api.ts` | 화면의 서버 호출 |
| `src/components/erp/stock/StockClient.tsx` | PC 화면 컨테이너(조회조건·KPI·도구줄·실사 모드·RG 반영) |
| `src/components/erp/stock/StockTable.tsx` | 재고 표 — 상품 묶음·펼치기(Task 4b) · 「마지막 실사」 칸(Task 4c) |
| `src/components/erp/stock/CountQueuePanel.tsx` | PC 「오늘 셀 목록」 패널 — Task 4c |
| `src/components/erp/stock/EditCell.tsx` | 칸 편집 팝오버(차이 0 지금 개수 허용 · `countOnly` — Task 4c) |
| `src/components/erp/stock/HistoryPanel.tsx` | 우측 입출 이력 + 되돌리기 |
| `src/components/erp/stock/CsvImportDialog.tsx` | 실사표 불러오기 창 |
| `src/components/erp/stock/MobileStock.tsx` · `src/app/m/stock/{layout,page}.tsx` | 휴대폰 화면 — 오늘 셀 목록으로 시작 → 검색 |
| `src/app/api/cost-management/rg-shipments/route.ts` (수정) · `src/components/orders/RocketGrowthShipmentModal.tsx` (수정) · `src/components/orders/rg-sku-split.ts` | RG 보내기 SKU 수량 |
| `src/app/api/receipts/[id]/confirm/route.ts` (수정) · `src/components/receipt/ReceiptDetail.tsx` (수정) · `src/components/receipt/ReceiptSkuSplit.tsx` · `src/components/receipt/sku-split.ts` | 영수증 확정 → 원장 입고 |
| `scripts/erp/purchase-units-seed.ts` | `purchase_units` 첫 적재 |
| `scripts/erp/ledger-selftest.ts` (수정) | 조정 자가시험 |
| `scripts/erp/opening-collect.ts` (수정) | `readDb`·`fetchRgStock`을 옮긴 곳에서 다시 내보낸다 |
| `src/__tests__/…` | 아래 각 Task |

---
### Task 0: 주문 조회 라우트 인증 (보안 선행)

**Files:**
- Modify: `src/app/api/orders/coupang/route.ts`, `src/app/api/orders/coupang-rg/route.ts`, `src/app/api/orders/naver/route.ts`, `src/app/api/orders/naver/debug/route.ts`, `src/app/api/orders/toss/route.ts`
- Modify: `src/__tests__/api/toss-orders.test.ts`
- Test: `src/__tests__/api/orders-auth.test.ts`

- [ ] **Step 1: 기준선 측정**

Run: `npx vitest run 2>&1 | tail -6` 그리고 `npx tsc --noEmit`
Expected: `Tests  N failed | M passed` 형태. **N을 이 계획서 끝 「실행 기록」의 「기준선」 줄에 적는다**(예: `vitest 실패 13 · tsc 0`). tsc 0 오류가 아니면 멈추고 보고한다.

- [ ] **Step 2: 실패하는 테스트 작성**

`src/__tests__/api/orders-auth.test.ts`:
```ts
// src/__tests__/api/orders-auth.test.ts
// 주문 조회 라우트는 구매자 정보를 돌려준다 — 로그인하지 않으면 채널 API를 부르기 전에 401이어야 한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, clientCalled } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  clientCalled: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/dashboard/orders-cache', () => ({
  getOrdersCache: vi.fn(async () => null),
  setOrdersCache: vi.fn(async () => undefined),
}));
vi.mock('@/lib/listing/coupang-client', () => ({
  getCoupangClient: () => { clientCalled('coupang'); throw new Error('호출되면 안 된다'); },
}));
vi.mock('@/lib/listing/naver-commerce-client', () => ({
  getNaverCommerceClient: () => { clientCalled('naver'); throw new Error('호출되면 안 된다'); },
}));
vi.mock('@/lib/listing/toss-shopping-client', () => ({
  getTossShoppingClient: () => { clientCalled('toss'); throw new Error('호출되면 안 된다'); },
}));
vi.mock('@/lib/proxy-fetch', () => ({ proxyFetch: vi.fn() }));

type Handler = { GET: (req: NextRequest) => Promise<Response> };
const ROUTES: [string, () => Promise<Handler>][] = [
  ['coupang', () => import('@/app/api/orders/coupang/route')],
  ['coupang-rg', () => import('@/app/api/orders/coupang-rg/route')],
  ['naver', () => import('@/app/api/orders/naver/route')],
  ['naver/debug', () => import('@/app/api/orders/naver/debug/route')],
  ['toss', () => import('@/app/api/orders/toss/route')],
];

describe('주문 조회 라우트 인증', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue(null);
  });

  it.each(ROUTES)('%s — 로그인하지 않으면 401이고 채널 API를 부르지 않는다', async (name, load) => {
    const { GET } = await load();
    const res = await GET(new NextRequest(`http://localhost/api/orders/${name}`));
    expect(res.status).toBe(401);
    expect(clientCalled).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/__tests__/api/orders-auth.test.ts`
Expected: 5건 FAIL — `expected 500 to be 401`(또는 200). 채널 모의가 던진 오류를 라우트가 500으로 돌려준다.

- [ ] **Step 4: 다섯 라우트에 로그인 검사를 넣는다**

다섯 파일 모두 같은 두 곳을 고친다(다섯 파일 모두 아래 두 줄이 그대로 있다 — `coupang-rg`는 59~60행, `naver/debug`는 14~15행).

(1) 첫 import 줄
```ts
import { NextRequest } from 'next/server';
```
을 아래로 바꾼다.
```ts
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
```

(2) 핸들러 첫 두 줄
```ts
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
```
을 아래로 바꾼다.
```ts
export async function GET(request: NextRequest) {
  // 2026-09-26 탐색: 로그인 없이 구매자 정보를 돌려주고 있었다(ERP 1-C1 보안 선행)
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const sp = request.nextUrl.searchParams;
```

- [ ] **Step 5: 토스 주문 테스트에 로그인 모의를 넣는다**

`src/__tests__/api/toss-orders.test.ts` 2행
```ts
import { NextRequest } from 'next/server';
```
바로 아래에 넣는다.
```ts

// ─── Mock: 로그인 상태 (라우트가 requireAuth를 부른다) ──────────────
vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ userId: 'user-1', email: 'test@example.com' })),
}));
```

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run src/__tests__/api/orders-auth.test.ts src/__tests__/api/toss-orders.test.ts && npx tsc --noEmit`
Expected: 전부 PASS(5 + 기존 토스 4), tsc 0 오류

- [ ] **Step 7: 커밋**

```bash
git add src/app/api/orders src/__tests__/api/orders-auth.test.ts src/__tests__/api/toss-orders.test.ts
git commit -m "fix(orders): 주문 조회 라우트 5개에 로그인 검사 — 구매자 정보 노출 차단"
```

---

### Task 1: 마이그레이션 115 — 원장 사유 칸 · 매입 단위 1:N

**Files:**
- Create: `supabase/migrations/115_erp_ledger_reason_purchase_units.sql`

- [ ] **Step 0: 앱과 스크립트가 같은 DB를 보는지 확인** (값은 출력하지 않는다)

```bash
node -e "
const fs=require('fs');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
const ref=(s)=>{const u=new URL(s);return (u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co\$/)||[])[1]||u.username.split('.')[1]||u.hostname};
const a=ref(process.env.SUPABASE_DB_URL),b=ref(process.env.SOURCING_DATABASE_URL);
console.log(a===b?'✅ 같은 DB':'❌ 다른 DB — 멈추고 보고한다');"
```
Expected: `✅ 같은 DB`. (`src/lib/jobs/run-log.ts`가 이미 `getSourcingPool()`로 `erp.job_runs`를 쓰므로 같아야 정상이다.) ❌면 멈추고 컨트롤러에게 보고한다.

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- 115_erp_ledger_reason_purchase_units.sql
-- ERP 1-C1. 적용 시점에 erp.stock_ledger·erp.purchase_units는 비어 있다(2026-09-26).
--
-- 1) 원장 사유(reason). 사람이 고친 재고(kind='adjust')는 왜 고쳤는지가 남아야 한다 — 필수.
--    opening = 기초재고(서버가 정한다) · rg_reconcile = RG 실재고 대조 반영 · 나머지는 화면에서 고른다.
--    가드 트리거는 행 삽입만 막으므로 칸 추가는 안전하다.
-- 2) purchase_units를 품번 : SKU = 1 : N으로. 코스트코 품번 하나가 옵션(색·사이즈) 여러 SKU로 나뉜다.

alter table erp.stock_ledger add column if not exists reason text;

alter table erp.stock_ledger drop constraint if exists stock_ledger_reason_chk;
alter table erp.stock_ledger add constraint stock_ledger_reason_chk check (
  reason is null or reason in ('opening', 'count_diff', 'damage', 'loss', 'sample', 'return_in', 'other', 'rg_reconcile')
);
alter table erp.stock_ledger drop constraint if exists stock_ledger_adjust_reason_chk;
alter table erp.stock_ledger add constraint stock_ledger_adjust_reason_chk check (kind <> 'adjust' or reason is not null);
alter table erp.stock_ledger drop constraint if exists stock_ledger_opening_reason_chk;
alter table erp.stock_ledger add constraint stock_ledger_opening_reason_chk check (reason <> 'opening' or kind = 'opening');

do $$
declare
  r record;
begin
  if exists (select 1 from erp.purchase_units where sku_id is null) then
    raise exception 'erp.purchase_units에 sku_id 없는 행이 있다 — 1:N 전환 전에 정리한다';
  end if;
  -- (supplier, supplier_code) 유니크를 이름과 무관하게 지운다(109가 이름 없이 만들었다)
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'erp.purchase_units'::regclass and c.contype = 'u'
       and c.conkey = (select array_agg(a.attnum order by a.attnum) from pg_attribute a
                        where a.attrelid = 'erp.purchase_units'::regclass and a.attname in ('supplier', 'supplier_code'))
  loop
    execute format('alter table erp.purchase_units drop constraint %I', r.conname);
  end loop;
end $$;

alter table erp.purchase_units alter column sku_id set not null;
alter table erp.purchase_units drop constraint if exists purchase_units_supplier_code_sku_key;
alter table erp.purchase_units add constraint purchase_units_supplier_code_sku_key unique (supplier, supplier_code, sku_id);
```

- [ ] **Step 2: 적용**

Run: `node scripts/apply-migration.mjs 115`
Expected: 성공 메시지, exit 0

- [ ] **Step 3: 제약 확인** (읽기 전용)

```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
const r=await c.query(\"select conrelid::regclass::text t, conname from pg_constraint where conrelid in ('erp.stock_ledger'::regclass,'erp.purchase_units'::regclass) and contype in ('c','u') order by 1,2\");
console.log(r.rows.map(x=>x.t+' '+x.conname).join('\n'));
const n=await c.query(\"select attnotnull from pg_attribute where attrelid='erp.purchase_units'::regclass and attname='sku_id'\");
console.log('purchase_units.sku_id not null:',n.rows[0].attnotnull);await c.end()})()"
```
Expected: `erp.purchase_units purchase_units_supplier_code_sku_key`가 있고 `(supplier, supplier_code)`만의 유니크가 **없다**. `erp.stock_ledger stock_ledger_reason_chk`·`stock_ledger_adjust_reason_chk`·`stock_ledger_opening_reason_chk`가 있다. `purchase_units.sku_id not null: true`.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/115_erp_ledger_reason_purchase_units.sql
git commit -m "feat(erp): 마이그레이션 115 — 원장 사유(reason) · purchase_units 품번:SKU 1:N"
```

---
### Task 2: 조정 로직 — 사유 칸 · 순수 규칙 · 기록 · 자가시험

**Files:**
- Modify: `src/lib/erp/ledger/plan.ts`, `src/lib/erp/ledger/store.ts`
- Modify: `src/__tests__/lib/erp/ledger/plan.test.ts`, `src/__tests__/lib/erp/ledger/store.test.ts`
- Create: `src/lib/erp/ledger/adjust.ts`, `src/lib/erp/ledger/adjust-store.ts`
- Test: `src/__tests__/lib/erp/ledger/adjust.test.ts`, `src/__tests__/lib/erp/ledger/adjust-store.test.ts`
- Modify: `scripts/erp/ledger-selftest.ts`

#### 2-A. 전표에 사유(reason)

- [ ] **Step 1: 테스트를 먼저 고친다**

`src/__tests__/lib/erp/ledger/plan.test.ts` 13~14행
```ts
    expect(planLotCreate({ skuId: 1, location: 'self', qty: 4, unitCost: 500, kind: 'opening', occurredAt: AT, idemKey: 'opening:1:self', refType: 'opening', refId: 'x.csv' }))
      .toEqual([{ skuId: 1, location: 'self', qty: 4, kind: 'opening', lotId: null, unitCost: 500, occurredAt: AT, refType: 'opening', refId: 'x.csv', reversesId: null, idemKey: 'opening:1:self', note: null }]);
```
을 아래로 바꾼다(`reason: null`만 더한다).
```ts
    expect(planLotCreate({ skuId: 1, location: 'self', qty: 4, unitCost: 500, kind: 'opening', occurredAt: AT, idemKey: 'opening:1:self', refType: 'opening', refId: 'x.csv' }))
      .toEqual([{ skuId: 1, location: 'self', qty: 4, kind: 'opening', lotId: null, unitCost: 500, occurredAt: AT, refType: 'opening', refId: 'x.csv', reversesId: null, idemKey: 'opening:1:self', note: null, reason: null }]);
```

같은 파일 끝에 더한다.
```ts

describe('사유(reason)', () => {
  it('lot 생성·차감 전표는 사유를 싣고, 이동·역전표는 비운다', () => {
    expect(planLotCreate({ skuId: 1, location: 'self', qty: 1, unitCost: 1, kind: 'adjust', reason: 'return_in', occurredAt: AT, idemKey: 'adj:x' })[0].reason).toBe('return_in');
    expect(planConsume({ skuId: 1, location: 'self', qty: 1, kind: 'adjust', reason: 'damage', occurredAt: AT, idemKey: 'adj:y' }, lots)[0].reason).toBe('damage');
    expect(planTransfer({ skuId: 1, from: 'self', to: 'rg_inbound', qty: 1, occurredAt: AT, idemKey: 't' }, lots)[0].reason).toBeNull();
    const stored: StoredRow = { id: 5, skuId: 1, location: 'self', qty: -1, kind: 'adjust', lotId: 10, unitCost: null, occurredAt: AT, refType: 'adjust', refId: 'r', reversesId: null, idemKey: 'adj:y#0', note: null, reason: 'damage' };
    expect(planReversal(stored, { occurredAt: AT, idemKey: 'rev:adj:y#0' }).reason).toBeNull();
  });
});
```

`src/__tests__/lib/erp/ledger/store.test.ts` 36행
```ts
    expect(f.calls[2].params).toEqual([7, 'self', 3, 'opening', null, 900, AT, null, null, null, 'opening:7:self', null]);
```
을 아래로 바꾼다(13번째 인자 = 사유).
```ts
    expect(f.calls[2].params).toEqual([7, 'self', 3, 'opening', null, 900, AT, null, null, null, 'opening:7:self', null, null]);
```

같은 파일의 `describe('store', () => {` 블록 안 끝(마지막 `});` 바로 앞)에 더한다.
```ts

  it('사유를 13번째 인자(reason 칸)로 기록한다', async () => {
    await postLotCreate(f.db, { skuId: 7, location: 'self', qty: 1, unitCost: 100, kind: 'adjust', reason: 'return_in', occurredAt: AT, idemKey: 'adj:r' });
    const ins = f.calls.find((c) => c.sql.startsWith('insert into erp.stock_ledger'))!;
    expect(ins.sql).toContain('reason');
    expect(ins.params[12]).toBe('return_in');
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger/plan.test.ts src/__tests__/lib/erp/ledger/store.test.ts`
Expected: FAIL — `reason` 칸이 없다(`expected … to deeply equal …`, `undefined to be 'return_in'`)

- [ ] **Step 3: 구현**

`src/lib/erp/ledger/plan.ts`:

(1) 5행
```ts
export type LedgerKind = 'opening' | 'receipt' | 'transfer' | 'sale' | 'return' | 'adjust' | 'reversal';
```
을 아래로 바꾼다.
```ts
export type LedgerKind = 'opening' | 'receipt' | 'transfer' | 'sale' | 'return' | 'adjust' | 'reversal';

/** 원장 사유(마이그레이션 115). opening = 기초재고(서버가 정한다) · rg_reconcile = RG 실재고 대조 반영 · 나머지는 화면에서 고른다 */
export type Reason = 'opening' | 'count_diff' | 'damage' | 'loss' | 'sample' | 'return_in' | 'other' | 'rg_reconcile';
```

(2) `LedgerRow`의 마지막 칸
```ts
  idemKey: string;
  note: string | null;
}

export interface StoredRow extends LedgerRow {
```
을 아래로 바꾼다.
```ts
  idemKey: string;
  note: string | null;
  /** kind='adjust'면 필수(DB 검사). 이동·역전표는 null */
  reason?: Reason | null;
}

export interface StoredRow extends LedgerRow {
```

(3) `LotCreateInput`·`ConsumeInput`에 사유를 더한다.
```ts
export interface LotCreateInput extends RefInput {
  skuId: number;
  location: Location;
  qty: number;
  unitCost: number;
  kind: 'opening' | 'receipt' | 'adjust';
  occurredAt: string;
  idemKey: string;
}

export interface ConsumeInput extends RefInput {
  skuId: number;
  location: Location;
  qty: number;
  kind: 'sale' | 'adjust';
  occurredAt: string;
  idemKey: string;
}
```
을 아래로 바꾼다.
```ts
export interface LotCreateInput extends RefInput {
  skuId: number;
  location: Location;
  qty: number;
  unitCost: number;
  kind: 'opening' | 'receipt' | 'adjust';
  occurredAt: string;
  idemKey: string;
  reason?: Reason;
}

export interface ConsumeInput extends RefInput {
  skuId: number;
  location: Location;
  qty: number;
  kind: 'sale' | 'adjust';
  occurredAt: string;
  idemKey: string;
  reason?: Reason;
}
```

(4) `planLotCreate`의 반환
```ts
  return [{
    skuId: p.skuId, location: p.location, qty: p.qty, kind: p.kind, lotId: null, unitCost: p.unitCost,
    occurredAt: p.occurredAt, ...refOf(p), reversesId: null, idemKey: p.idemKey,
  }];
```
을 아래로 바꾼다.
```ts
  return [{
    skuId: p.skuId, location: p.location, qty: p.qty, kind: p.kind, lotId: null, unitCost: p.unitCost,
    occurredAt: p.occurredAt, ...refOf(p), reversesId: null, idemKey: p.idemKey, reason: p.reason ?? null,
  }];
```

(5) `planConsume`의 반환
```ts
  return allocateFifo(lots, p.qty).map((t, i) => ({
    skuId: p.skuId, location: p.location, qty: -t.qty, kind: p.kind, lotId: t.lotId, unitCost: null,
    occurredAt: p.occurredAt, ...refOf(p), reversesId: null, idemKey: `${p.idemKey}#${i}`,
  }));
```
을 아래로 바꾼다.
```ts
  return allocateFifo(lots, p.qty).map((t, i) => ({
    skuId: p.skuId, location: p.location, qty: -t.qty, kind: p.kind, lotId: t.lotId, unitCost: null,
    occurredAt: p.occurredAt, ...refOf(p), reversesId: null, idemKey: `${p.idemKey}#${i}`, reason: p.reason ?? null,
  }));
```

(6) `planTransfer`의 `common`
```ts
    const common = { skuId: p.skuId, kind: 'transfer' as const, lotId: t.lotId, unitCost: null, occurredAt: p.occurredAt, ...refOf(p), reversesId: null };
```
을 아래로 바꾼다.
```ts
    const common = { skuId: p.skuId, kind: 'transfer' as const, lotId: t.lotId, unitCost: null, occurredAt: p.occurredAt, ...refOf(p), reversesId: null, reason: null };
```

(7) `planReversal`의 반환
```ts
    occurredAt: p.occurredAt, refType: orig.refType, refId: orig.refId, reversesId: orig.id, idemKey: p.idemKey, note: p.note ?? null,
  };
```
을 아래로 바꾼다.
```ts
    occurredAt: p.occurredAt, refType: orig.refType, refId: orig.refId, reversesId: orig.id, idemKey: p.idemKey, note: p.note ?? null,
    reason: null,
  };
```

`src/lib/erp/ledger/store.ts`의 `insertRows` 안
```ts
      `insert into erp.stock_ledger (sku_id, location, qty, kind, lot_id, unit_cost, occurred_at, ref_type, ref_id, reverses_id, idem_key, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [r.skuId, r.location, r.qty, r.kind, r.lotId, r.unitCost, r.occurredAt, r.refType, r.refId, r.reversesId, r.idemKey, r.note],
```
을 아래로 바꾼다.
```ts
      `insert into erp.stock_ledger (sku_id, location, qty, kind, lot_id, unit_cost, occurred_at, ref_type, ref_id, reverses_id, idem_key, note, reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [r.skuId, r.location, r.qty, r.kind, r.lotId, r.unitCost, r.occurredAt, r.refType, r.refId, r.reversesId, r.idemKey, r.note, r.reason ?? null],
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류

- [ ] **Step 5: 커밋**

```bash
git add src/lib/erp/ledger/plan.ts src/lib/erp/ledger/store.ts src/__tests__/lib/erp/ledger/plan.test.ts src/__tests__/lib/erp/ledger/store.test.ts
git commit -m "feat(erp): 원장 전표에 사유(reason) 칸"
```

#### 2-B. 조정 순수 규칙 (`adjust.ts`)

- [ ] **Step 6: 실패하는 테스트 작성**

`src/__tests__/lib/erp/ledger/adjust.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  AdjustInputError, StaleCountError, adjustIdemKey, isReversibleKey, openingIdemKey, pickUnitCost, planAdjustment, validateAdjustInput,
  type AdjustInput,
} from '@/lib/erp/ledger/adjust';
import { assertIdemKey } from '@/lib/erp/ledger/plan';

const REQ = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const base: AdjustInput = {
  skuId: 7, location: 'self', mode: 'count', value: 5, expected: 3, reason: 'count_diff', requestId: REQ, occurredAt: '2026-09-27T10:00:00+09:00',
};

describe('planAdjustment', () => {
  it('지금 개수는 원장과의 차이를 낸다', () => {
    expect(planAdjustment({ mode: 'count', value: 3, expected: 5, onHand: 5, locationEmpty: false }))
      .toEqual({ diff: -2, lotKind: 'adjust', setsCutover: false });
  });

  it('빈 위치의 첫 지금 개수는 기초재고이고 ledger_cutover를 적는다', () => {
    expect(planAdjustment({ mode: 'count', value: 4, expected: 0, onHand: 0, locationEmpty: true }))
      .toEqual({ diff: 4, lotKind: 'opening', setsCutover: true });
  });

  it('빈 위치에 0을 적으면 기록할 것이 없고 커서도 두지 않는다', () => {
    expect(planAdjustment({ mode: 'count', value: 0, expected: 0, onHand: 0, locationEmpty: true }))
      .toEqual({ diff: 0, lotKind: 'opening', setsCutover: false });
  });

  it('±수량은 입력 그대로이고 기초재고가 되지 않는다', () => {
    expect(planAdjustment({ mode: 'delta', value: 2, onHand: 0, locationEmpty: true }))
      .toEqual({ diff: 2, lotKind: 'adjust', setsCutover: false });
  });

  it('화면이 본 재고와 저장 시점 재고가 다르면 StaleCountError', () => {
    try {
      planAdjustment({ mode: 'count', value: 3, expected: 5, onHand: 4, locationEmpty: false });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(StaleCountError);
      expect((e as StaleCountError).expected).toBe(5);
      expect((e as StaleCountError).actual).toBe(4);
    }
  });
});

describe('pickUnitCost', () => {
  it('입력 > 최근 lot > 옛 입고 순이고, 모두 없으면 null', () => {
    expect(pickUnitCost(900, 800, 700)).toEqual({ unitCost: 900, source: 'input' });
    expect(pickUnitCost(undefined, 800, 700)).toEqual({ unitCost: 800, source: 'lot' });
    expect(pickUnitCost(undefined, null, 700)).toEqual({ unitCost: 700, source: 'legacy' });
    expect(pickUnitCost(undefined, null, null)).toBeNull();
  });

  it('입력 0원은 그대로 쓴다(증정품)', () => {
    expect(pickUnitCost(0, 800, null)).toEqual({ unitCost: 0, source: 'input' });
  });
});

describe('validateAdjustInput', () => {
  it('정상 입력은 통과', () => {
    expect(() => validateAdjustInput(base)).not.toThrow();
    expect(() => validateAdjustInput({ ...base, mode: 'delta', value: -2, expected: undefined })).not.toThrow();
  });

  it.each<[string, Partial<AdjustInput>]>([
    ['음수 지금 개수', { value: -1 }],
    ['지금 개수인데 expected 없음', { expected: undefined }],
    ['±수량 0', { mode: 'delta', value: 0 }],
    ['소수', { value: 1.5 }],
    ['opening 사유(서버 전용)', { reason: 'opening' as never }],
    ['uuid 아닌 요청 id', { requestId: 'abc' }],
    ['오프셋 없는 시각', { occurredAt: '2026-09-27T10:00:00' }],
    ['음수 단가', { unitCost: -1 }],
    ['잘못된 위치', { location: 'home' as never }],
    ['201자 메모', { note: 'x'.repeat(201) }],
  ])('%s → AdjustInputError', (_, patch) => {
    expect(() => validateAdjustInput({ ...base, ...patch })).toThrow(AdjustInputError);
  });
});

describe('멱등키', () => {
  it('조정·기초 키는 1-B assertIdemKey를 통과한다', () => {
    expect(() => assertIdemKey(adjustIdemKey(REQ))).not.toThrow();
    expect(() => assertIdemKey(openingIdemKey(7, 'rg_inbound'))).not.toThrow();
  });

  it('되돌리기는 조정·기초 키만', () => {
    expect(isReversibleKey(`adj:${REQ}`)).toBe(true);
    expect(isReversibleKey('opening:7:self')).toBe(true);
    expect(isReversibleKey('receipt:abc:7')).toBe(false);
    expect(isReversibleKey(`rev:adj:${REQ}`)).toBe(false);
    expect(isReversibleKey(`adj:${REQ}#0`)).toBe(false);
  });
});
```

- [ ] **Step 7: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger/adjust.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 8: 구현**

`src/lib/erp/ledger/adjust.ts`:
```ts
// src/lib/erp/ledger/adjust.ts
// 재고 조정(사람이 고치는 재고)의 규칙. 무엇을 기록할지만 정한다 — DB는 adjust-store.ts가 쓴다.
// 기본 입력은 「지금 개수」(원장과의 차이를 계산), 보조 입력은 ±수량. 빈 위치의 첫 「지금 개수」는 기초재고다.
import type { Location } from './fifo';
import type { Reason } from './plan';

export const LOCATIONS: readonly Location[] = ['self', 'rg_inbound', 'rg'];

/** 화면에서 고르는 사유. 'opening'은 서버가 정하고 'rg_reconcile'은 RG 대조 반영만 쓴다 */
export const USER_REASONS = ['count_diff', 'damage', 'loss', 'sample', 'return_in', 'other'] as const;
export type UserReason = (typeof USER_REASONS)[number];

export const REASON_LABEL: Record<Reason, string> = {
  opening: '기초재고',
  count_diff: '실사차이',
  damage: '파손',
  loss: '분실',
  sample: '샘플·증정',
  return_in: '반품입고',
  other: '기타',
  rg_reconcile: 'RG 대조',
};

export type AdjustMode = 'count' | 'delta';

export interface AdjustInput {
  skuId: number;
  location: Location;
  mode: AdjustMode;
  /** count: 지금 개수(0 이상) · delta: ±수량(0 아님) */
  value: number;
  /** count에서 필수 — 화면이 본 원장 재고. 저장 시점 재고와 다르면 StaleCountError */
  expected?: number;
  reason: UserReason | 'rg_reconcile';
  note?: string;
  /** 재고가 늘 때 새 lot 단가. 없으면 최근 lot → 옛 입고 순으로 찾는다 */
  unitCost?: number;
  /** 요청 하나 = uuid 하나. 멱등키 adj:<uuid>와 전표 ref_id가 된다 */
  requestId: string;
  /** 오프셋 있는 ISO */
  occurredAt: string;
}

export class AdjustInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdjustInputError';
  }
}

/** 화면이 본 재고와 저장 시점 재고가 다르다 — 다시 보고 적게 한다(HTTP 409) */
export class StaleCountError extends Error {
  constructor(public readonly expected: number, public readonly actual: number) {
    super(`재고가 바뀌었다 — 화면 ${expected}, 지금 ${actual}. 다시 보고 적는다`);
    this.name = 'StaleCountError';
  }
}

/** 늘어난 재고의 단가를 끝내 못 찾았다(HTTP 422) */
export class CostRequiredError extends Error {
  constructor(public readonly skuId: number) {
    super(`SKU ${skuId}: 늘어난 재고의 단가를 모른다 — 단가를 입력한다`);
    this.name = 'CostRequiredError';
  }
}

/** 여러 건 요청에서 몇 번째 항목이 왜 실패했는지 */
export class AdjustItemError extends Error {
  constructor(
    public readonly index: number,
    public readonly skuId: number,
    public readonly location: Location,
    public readonly inner: unknown,
  ) {
    super(`${index + 1}번째(SKU ${skuId} · ${location}): ${inner instanceof Error ? inner.message : String(inner)}`);
    this.name = 'AdjustItemError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const ALLOWED_REASONS: readonly string[] = [...USER_REASONS, 'rg_reconcile'];

export function validateAdjustInput(p: AdjustInput): void {
  const bad = (m: string): never => {
    throw new AdjustInputError(m);
  };
  if (!Number.isInteger(p.skuId) || p.skuId <= 0) bad(`skuId가 잘못됐다: ${p.skuId}`);
  if (!LOCATIONS.includes(p.location)) bad(`위치가 잘못됐다: ${String(p.location)}`);
  if (p.mode === 'count') {
    if (!Number.isInteger(p.value) || p.value < 0) bad(`지금 개수는 0 이상 정수다: ${p.value}`);
    if (p.expected === undefined || !Number.isInteger(p.expected) || p.expected < 0) bad('지금 개수 방식은 화면이 본 재고(expected)를 함께 보낸다');
  } else if (p.mode === 'delta') {
    if (!Number.isInteger(p.value) || p.value === 0) bad(`±수량은 0이 아닌 정수다: ${p.value}`);
  } else {
    bad(`방식이 잘못됐다: ${String(p.mode)}`);
  }
  if (!ALLOWED_REASONS.includes(p.reason)) bad(`사유가 잘못됐다: ${String(p.reason)}`);
  if (p.unitCost !== undefined && (!Number.isInteger(p.unitCost) || p.unitCost < 0)) bad(`단가는 0 이상 정수다: ${p.unitCost}`);
  if (!UUID.test(p.requestId)) bad(`요청 id는 uuid다: ${p.requestId}`);
  if (!ISO_WITH_OFFSET.test(p.occurredAt)) bad(`발생 시각은 오프셋 있는 ISO다: ${p.occurredAt}`);
  if (p.note !== undefined && p.note.length > 200) bad('메모는 200자까지다');
}

export interface AdjustStep {
  /** 원장 증감(+ 새 lot / − FIFO 차감 / 0 기록 없음) */
  diff: number;
  /** 늘어날 때 lot 전표 종류. 빈 위치의 첫 지금 개수 = opening */
  lotKind: 'opening' | 'adjust';
  /** 기초 전표를 실제로 쓰면 ledger_cutover를 적는다(이미 있으면 두지 않는다 — 1-C2 소급의 시작점) */
  setsCutover: boolean;
}

export function planAdjustment(p: { mode: AdjustMode; value: number; expected?: number; onHand: number; locationEmpty: boolean }): AdjustStep {
  if (p.mode === 'count') {
    if (p.expected !== p.onHand) throw new StaleCountError(p.expected ?? -1, p.onHand);
    const diff = p.value - p.onHand;
    const lotKind = p.locationEmpty ? 'opening' : 'adjust';
    return { diff, lotKind, setsCutover: lotKind === 'opening' && diff > 0 };
  }
  return { diff: p.value, lotKind: 'adjust', setsCutover: false };
}

export type AdjustCostSource = 'input' | 'lot' | 'legacy';

/** 늘어난 재고의 단가: 화면 입력 > 그 SKU의 최근 lot(위치 무관) > 옛 cost_entries 최근 단가 */
export function pickUnitCost(
  input: number | undefined,
  lot: number | null,
  legacy: number | null,
): { unitCost: number; source: AdjustCostSource } | null {
  if (input !== undefined) return { unitCost: input, source: 'input' };
  if (lot !== null) return { unitCost: lot, source: 'lot' };
  if (legacy !== null) return { unitCost: legacy, source: 'legacy' };
  return null;
}

export const adjustIdemKey = (requestId: string): string => `adj:${requestId}`;
export const openingIdemKey = (skuId: number, location: Location): string => `opening:${skuId}:${location}`;

const REVERSIBLE = /^(adj:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|opening:\d+:(self|rg_inbound|rg))$/i;
/** 화면에서 되돌릴 수 있는 원 멱등키(순번 없는 것). 영수증·RG 보내기 전표는 옛 원가 기록과 짝이라 여기서 되돌리지 않는다 */
export const isReversibleKey = (k: string): boolean => REVERSIBLE.test(k);
```

- [ ] **Step 9: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/lib/erp/ledger/adjust.test.ts && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/lib/erp/ledger/adjust.ts src/__tests__/lib/erp/ledger/adjust.test.ts
git commit -m "feat(erp): 조정 규칙 — 지금 개수 차이 · 기초/조정 · 화면 재고 불일치 · 단가 출처"
```

#### 2-C. 조정 기록 (`adjust-store.ts`)

- [ ] **Step 10: 실패하는 테스트 작성**

`src/__tests__/lib/erp/ledger/adjust-store.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { applyAdjustment, applyAdjustments } from '@/lib/erp/ledger/adjust-store';
import { AdjustInputError, AdjustItemError, CostRequiredError, StaleCountError, type AdjustInput } from '@/lib/erp/ledger/adjust';
import type { Db } from '@/lib/erp/ledger/store';

const REQ = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const REQ2 = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const AT = '2026-09-27T10:00:00+09:00';

/** SQL 앞부분으로 분기하는 가짜 DB */
function fakeDb(o: {
  dup?: boolean;
  onHand?: { qty: number; n: number };
  lots?: { lot_id: number; qty: number; unit_cost: number; lot_at: number }[];
  lotCost?: number | null;
  legacyCost?: number | null;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let nextId = 100;
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select 1 from erp.stock_ledger where ref_type')) return { rows: o.dup ? [{}] : [], rowCount: o.dup ? 1 : 0 };
      if (sql.startsWith('select coalesce(sum(qty)')) return { rows: [o.onHand ?? { qty: 0, n: 0 }], rowCount: 1 };
      if (sql.startsWith('select 1 from erp.stock_ledger where idem_key')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('select coalesce(l.lot_id')) return { rows: o.lots ?? [], rowCount: (o.lots ?? []).length };
      if (sql.startsWith('select l.unit_cost')) return { rows: o.lotCost == null ? [] : [{ unit_cost: o.lotCost }], rowCount: 1 };
      if (sql.startsWith('select round(ce.unit_cost)')) return { rows: o.legacyCost == null ? [] : [{ unit_cost: o.legacyCost }], rowCount: 1 };
      if (sql.startsWith('insert into erp.stock_ledger')) return { rows: [{ id: nextId++ }], rowCount: 1 };
      if (sql.startsWith('set constraints')) return { rows: [], rowCount: null };
      if (sql.startsWith('insert into erp.sync_cursors')) return { rows: [], rowCount: 1 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
    },
  };
  return { db, calls };
}

const input = (o: Partial<AdjustInput> = {}): AdjustInput => ({
  skuId: 7, location: 'self', mode: 'count', value: 5, expected: 0, reason: 'count_diff', requestId: REQ, occurredAt: AT, ...o,
});
const inserts = (calls: { sql: string; params: unknown[] }[]) => calls.filter((c) => c.sql.startsWith('insert into erp.stock_ledger'));

describe('applyAdjustment', () => {
  it('빈 위치의 첫 지금 개수 → 기초 전표(opening:<sku>:<위치>, 사유 opening) + ledger_cutover', async () => {
    const f = fakeDb({ onHand: { qty: 0, n: 0 } });
    const r = await applyAdjustment(f.db, input({ unitCost: 700 }));
    expect(r).toMatchObject({ outcome: 'posted', kind: 'opening', qty: 5, idemKey: 'opening:7:self', unitCost: 700, costSource: 'input' });
    const [ins] = inserts(f.calls);
    // [2]=qty [3]=kind [5]=unit_cost [7]=ref_type [8]=ref_id [10]=idem_key [12]=reason
    expect([ins.params[2], ins.params[3], ins.params[5], ins.params[7], ins.params[8], ins.params[10], ins.params[12]])
      .toEqual([5, 'opening', 700, 'adjust', REQ, 'opening:7:self', 'opening']);
    expect(f.calls.find((c) => c.sql.startsWith('insert into erp.sync_cursors'))!.params).toEqual([AT]);
  });

  it('지금 개수가 줄면 FIFO 조정 차감(adj:<uuid>#순번 · 고른 사유), 커서는 건드리지 않는다', async () => {
    const f = fakeDb({ onHand: { qty: 10, n: 2 }, lots: [{ lot_id: 1, qty: 10, unit_cost: 700, lot_at: 1 }] });
    const r = await applyAdjustment(f.db, input({ value: 7, expected: 10, reason: 'damage' }));
    expect(r).toMatchObject({ outcome: 'posted', kind: 'adjust', qty: -3, idemKey: `adj:${REQ}` });
    const [ins] = inserts(f.calls);
    expect([ins.params[2], ins.params[3], ins.params[4], ins.params[10], ins.params[12]]).toEqual([-3, 'adjust', 1, `adj:${REQ}#0`, 'damage']);
    expect(f.calls.some((c) => c.sql.startsWith('insert into erp.sync_cursors'))).toBe(false);
  });

  it('화면 재고와 저장 시점 재고가 다르면 StaleCountError, 아무것도 쓰지 않는다', async () => {
    const f = fakeDb({ onHand: { qty: 4, n: 1 } });
    await expect(applyAdjustment(f.db, input({ value: 3, expected: 5 }))).rejects.toBeInstanceOf(StaleCountError);
    expect(inserts(f.calls)).toHaveLength(0);
  });

  it('같은 요청 id가 이미 있으면 duplicate — 재고를 읽지도 않는다', async () => {
    const f = fakeDb({ dup: true });
    const r = await applyAdjustment(f.db, input());
    expect(r.outcome).toBe('duplicate');
    expect(f.calls.some((c) => c.sql.startsWith('select coalesce(sum(qty)'))).toBe(false);
  });

  it('단가를 안 보내면 최근 lot 단가를 쓰고 옛 입고는 보지 않는다', async () => {
    const f = fakeDb({ onHand: { qty: 2, n: 1 }, lotCost: 800, legacyCost: 650 });
    const r = await applyAdjustment(f.db, input({ mode: 'delta', value: 3, expected: undefined, reason: 'return_in' }));
    expect(r).toMatchObject({ kind: 'adjust', qty: 3, unitCost: 800, costSource: 'lot' });
    expect(f.calls.some((c) => c.sql.startsWith('select round(ce.unit_cost)'))).toBe(false);
  });

  it('최근 lot도 없으면 옛 입고(cost_entries) 단가', async () => {
    const f = fakeDb({ onHand: { qty: 2, n: 1 }, lotCost: null, legacyCost: 650 });
    const r = await applyAdjustment(f.db, input({ mode: 'delta', value: 1, expected: undefined, reason: 'other' }));
    expect(r).toMatchObject({ unitCost: 650, costSource: 'legacy' });
  });

  it('단가를 끝내 모르면 CostRequiredError', async () => {
    const f = fakeDb({ onHand: { qty: 0, n: 0 } });
    await expect(applyAdjustment(f.db, input())).rejects.toBeInstanceOf(CostRequiredError);
    expect(inserts(f.calls)).toHaveLength(0);
  });

  it('차이가 0이면 noop', async () => {
    const f = fakeDb({ onHand: { qty: 5, n: 1 } });
    const r = await applyAdjustment(f.db, input({ value: 5, expected: 5 }));
    expect(r.outcome).toBe('noop');
    expect(inserts(f.calls)).toHaveLength(0);
  });

  it('입력이 틀리면 DB를 건드리기 전에 AdjustInputError', async () => {
    const f = fakeDb();
    await expect(applyAdjustment(f.db, input({ mode: 'delta', value: 0 }))).rejects.toBeInstanceOf(AdjustInputError);
    expect(f.calls).toHaveLength(0);
  });
});

describe('applyAdjustments', () => {
  it('SKU 오름차순으로 먼저 잠근다(1-B 인계 — 교착 방지)', async () => {
    const f = fakeDb({ onHand: { qty: 0, n: 0 } });
    await applyAdjustments(f.db, [input({ skuId: 9, unitCost: 100 }), input({ skuId: 3, unitCost: 100, requestId: REQ2 })]);
    expect(f.calls[0].params).toEqual([7101, 3]);
    expect(f.calls[1].params).toEqual([7101, 9]);
  });

  it('실패한 항목의 순번을 AdjustItemError로 알린다', async () => {
    const f = fakeDb({ onHand: { qty: 0, n: 0 } });
    try {
      await applyAdjustments(f.db, [input({ unitCost: 100 }), input({ skuId: 8, expected: 5, requestId: REQ2 })]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AdjustItemError);
      expect((e as AdjustItemError).index).toBe(1);
      expect((e as AdjustItemError).inner).toBeInstanceOf(StaleCountError);
    }
  });

  it('같은 SKU·위치가 한 요청에 두 번이면 거부', async () => {
    const f = fakeDb();
    await expect(applyAdjustments(f.db, [input(), input({ requestId: REQ2 })])).rejects.toBeInstanceOf(AdjustItemError);
    expect(f.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 11: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger/adjust-store.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 12: 구현**

`src/lib/erp/ledger/adjust-store.ts`:
```ts
// src/lib/erp/ledger/adjust-store.ts
// 조정 전표 기록. 호출자가 트랜잭션을 연다 — 여러 건(실사 모드)은 한 트랜잭션이라 하나라도 실패하면 전부 되돌린다.
// 순서: 입력 검사 → SKU 잠금 → 같은 요청 확인 → 그 위치 재고 → 규칙(adjust.ts) → FIFO 차감 또는 새 lot → (기초면) 커서.
import type { Location } from './fifo';
import { lockSku, postConsume, postLotCreate, type Db } from './store';
import {
  AdjustInputError, AdjustItemError, CostRequiredError, adjustIdemKey, openingIdemKey, pickUnitCost, planAdjustment, validateAdjustInput,
  type AdjustCostSource, type AdjustInput,
} from './adjust';

export interface AdjustResult {
  skuId: number;
  location: Location;
  requestId: string;
  /** posted = 기록 · duplicate = 같은 요청이 이미 기록됨 · noop = 차이 0 */
  outcome: 'posted' | 'duplicate' | 'noop';
  kind: 'opening' | 'adjust' | null;
  /** 원장 증감(+ 늘림 / − 줄임) */
  qty: number;
  idemKey: string | null;
  unitCost: number | null;
  costSource: AdjustCostSource | null;
}

/** 처음 기초재고가 들어간 시각. 이미 있으면 두지 않는다 — 1-C2 판매 소급의 시작점 */
export async function ensureCutover(db: Db, at: string): Promise<void> {
  await db.query(
    `insert into erp.sync_cursors (name, cursor_at) values ('ledger_cutover', $1) on conflict (name) do nothing`,
    [at],
  );
}

/** 그 SKU의 가장 최근 lot 단가(위치 무관, 되돌린 lot 제외) */
export async function latestLotCost(db: Db, skuId: number): Promise<number | null> {
  const { rows } = await db.query(
    `select l.unit_cost from erp.stock_ledger l
      where l.sku_id = $1 and l.lot_id is null
        and not exists (select 1 from erp.stock_ledger r where r.reverses_id = l.id)
      order by l.occurred_at desc, l.id desc limit 1`,
    [skuId],
  );
  return rows.length > 0 ? Number(rows[0].unit_cost) : null;
}

/** 옛 cost_entries(SKU의 legacy_product_cost_ids)의 최근 단가 */
export async function legacyUnitCost(db: Db, skuId: number): Promise<number | null> {
  const { rows } = await db.query(
    `select round(ce.unit_cost)::int as unit_cost from cost_entries ce
       join erp.skus s on ce.product_cost_id = any(s.legacy_product_cost_ids)
      where s.id = $1
      order by ce.received_at desc, ce.created_at desc limit 1`,
    [skuId],
  );
  return rows.length > 0 ? Number(rows[0].unit_cost) : null;
}

export async function applyAdjustment(db: Db, p: AdjustInput): Promise<AdjustResult> {
  validateAdjustInput(p);
  const base = { skuId: p.skuId, location: p.location, requestId: p.requestId };
  const none = { kind: null, qty: 0, idemKey: null, unitCost: null, costSource: null };
  await lockSku(db, p.skuId);

  const dup = await db.query(`select 1 from erp.stock_ledger where ref_type = 'adjust' and ref_id = $1 limit 1`, [p.requestId]);
  if (dup.rows.length > 0) return { ...base, outcome: 'duplicate', ...none };

  const { rows } = await db.query(
    `select coalesce(sum(qty), 0)::int as qty, count(*)::int as n from erp.stock_ledger where sku_id = $1 and location = $2`,
    [p.skuId, p.location],
  );
  const step = planAdjustment({
    mode: p.mode, value: p.value, expected: p.expected, onHand: Number(rows[0].qty), locationEmpty: Number(rows[0].n) === 0,
  });
  if (step.diff === 0) return { ...base, outcome: 'noop', ...none };

  const ref = { refType: 'adjust', refId: p.requestId, note: p.note };
  if (step.diff < 0) {
    const idemKey = adjustIdemKey(p.requestId);
    const r = await postConsume(db, {
      skuId: p.skuId, location: p.location, qty: -step.diff, kind: 'adjust', reason: p.reason, occurredAt: p.occurredAt, idemKey, ...ref,
    });
    if (!r.posted) throw new AdjustInputError(`멱등키 ${idemKey}가 이미 있다`);
    return { ...base, outcome: 'posted', kind: 'adjust', qty: step.diff, idemKey, unitCost: null, costSource: null };
  }

  // 단가는 필요한 만큼만 조회한다: 입력 → 최근 lot → 옛 입고
  let cost = pickUnitCost(p.unitCost, null, null);
  if (!cost) cost = pickUnitCost(undefined, await latestLotCost(db, p.skuId), null);
  if (!cost) cost = pickUnitCost(undefined, null, await legacyUnitCost(db, p.skuId));
  if (!cost) throw new CostRequiredError(p.skuId);

  const opening = step.lotKind === 'opening';
  const idemKey = opening ? openingIdemKey(p.skuId, p.location) : adjustIdemKey(p.requestId);
  const r = await postLotCreate(db, {
    skuId: p.skuId, location: p.location, qty: step.diff, unitCost: cost.unitCost, kind: step.lotKind,
    reason: opening ? 'opening' : p.reason, occurredAt: p.occurredAt, idemKey, ...ref,
  });
  if (!r.posted) throw new AdjustInputError(`멱등키 ${idemKey}가 이미 있다`);
  if (step.setsCutover) await ensureCutover(db, p.occurredAt);
  return { ...base, outcome: 'posted', kind: step.lotKind, qty: step.diff, idemKey, unitCost: cost.unitCost, costSource: cost.source };
}

/** 여러 건(실사 모드·RG 일괄 반영). 호출자 트랜잭션 하나 — 실패하면 몇 번째인지 AdjustItemError로 던진다 */
export async function applyAdjustments(db: Db, items: AdjustInput[]): Promise<AdjustResult[]> {
  const seen = new Set<string>();
  items.forEach((p, i) => {
    try {
      validateAdjustInput(p);
    } catch (e) {
      throw new AdjustItemError(i, p.skuId, p.location, e);
    }
    const k = `${p.skuId}:${p.location}`;
    if (seen.has(k)) throw new AdjustItemError(i, p.skuId, p.location, new AdjustInputError('같은 SKU·위치가 한 요청에 두 번 있다'));
    seen.add(k);
  });
  // 1-B 인계(I4): 여러 SKU를 한 트랜잭션에 기록할 때는 sku_id 오름차순으로 먼저 잠가 교착을 피한다
  for (const id of [...new Set(items.map((p) => p.skuId))].sort((a, b) => a - b)) await lockSku(db, id);
  const out: AdjustResult[] = [];
  for (let i = 0; i < items.length; i++) {
    try {
      out.push(await applyAdjustment(db, items[i]));
    } catch (e) {
      throw new AdjustItemError(i, items[i].skuId, items[i].location, e);
    }
  }
  return out;
}
```

- [ ] **Step 13: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/lib/erp/ledger && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/lib/erp/ledger/adjust-store.ts src/__tests__/lib/erp/ledger/adjust-store.test.ts
git commit -m "feat(erp): 조정 기록 — 잠금·중복 요청·재고 확인·단가 조회·기초재고 커서"
```

#### 2-D. 운영 DB 자가시험 확장 (롤백 트랜잭션)

- [ ] **Step 14: 자가시험에 조정 시험을 더한다**

`scripts/erp/ledger-selftest.ts`:

(1) import 줄
```ts
import { postConsume, postLotCreate, postTransfer, reverse } from '@/lib/erp/ledger/store';
```
을 아래로 바꾼다.
```ts
import { randomUUID } from 'node:crypto';
import { postConsume, postLotCreate, postTransfer, reverse } from '@/lib/erp/ledger/store';
import { applyAdjustment } from '@/lib/erp/ledger/adjust-store';
```

(2) 본 트랜잭션의 마지막 시험과 catch
```ts
    await expectError(c, 'lot 생성 전표는 단가 필수', () => c.query(
      `insert into erp.stock_ledger (sku_id, location, qty, kind, occurred_at, idem_key) values ($1, 'self', 1, 'receipt', now(), $2)`,
      [sku, `st:${sku}:nocost`],
    ), /check constraint/);
  } catch (e) {
    check('예상 못 한 오류', false, (e as Error).message);
```
을 아래로 바꾼다(기존 시험은 그대로 두고 그 뒤에 조정 시험을 더한다 — 전부 같은 롤백 트랜잭션 안이다).
```ts
    await expectError(c, 'lot 생성 전표는 단가 필수', () => c.query(
      `insert into erp.stock_ledger (sku_id, location, qty, kind, occurred_at, idem_key) values ($1, 'self', 1, 'receipt', now(), $2)`,
      [sku, `st:${sku}:nocost`],
    ), /check constraint/);

    // ── 1-C1 조정 전표(마이그레이션 115 · adjust-store) ─────────────────
    const adj = Number((await c.query(
      `insert into erp.skus (key, name, origin, status) values ($1, '자가시험-조정', 'manual', 'archived') returning id`, [`selftest:adj:${Date.now()}`],
    )).rows[0].id);
    const adjSelf = async () =>
      (await c.query('select qty, value from erp.stock_on_hand where sku_id = $1 and location = $2', [adj, 'self'])).rows[0] ?? { qty: 0, value: 0 };
    const cursorOf = async () =>
      (await c.query(`select cursor_at from erp.sync_cursors where name = 'ledger_cutover'`)).rows[0]?.cursor_at ?? null;
    const cursorBefore = await cursorOf();
    const AT1 = '2026-02-01T09:00:00+09:00';

    const o1 = await applyAdjustment(c, { skuId: adj, location: 'self', mode: 'count', value: 5, expected: 0, reason: 'count_diff', unitCost: 700, requestId: randomUUID(), occurredAt: AT1 });
    const r1 = (await c.query('select kind, reason, idem_key from erp.stock_ledger where sku_id = $1', [adj])).rows;
    check('빈 위치의 첫 지금개수 = 기초 전표(kind·사유 opening, opening:<sku>:self)',
      o1.kind === 'opening' && r1.length === 1 && r1[0].kind === 'opening' && r1[0].reason === 'opening' && r1[0].idem_key === `opening:${adj}:self`,
      JSON.stringify(r1));
    const cursorAfter = await cursorOf();
    check('기초 전표가 ledger_cutover를 적는다(이미 있으면 그대로)',
      cursorBefore
        ? new Date(cursorAfter).getTime() === new Date(cursorBefore).getTime()
        : cursorAfter !== null && new Date(cursorAfter).getTime() === new Date(AT1).getTime(),
      `before ${String(cursorBefore)} · after ${String(cursorAfter)}`);

    const req2 = randomUUID();
    const o2 = await applyAdjustment(c, { skuId: adj, location: 'self', mode: 'count', value: 3, expected: 5, reason: 'damage', requestId: req2, occurredAt: '2026-02-02T09:00:00+09:00' });
    let a = await adjSelf();
    check('지금개수 3 → 조정 −2(사유 damage) · 3개 2,100원', o2.kind === 'adjust' && o2.qty === -2 && Number(a.qty) === 3 && Number(a.value) === 2100, JSON.stringify({ o2, a }));

    const again2 = await applyAdjustment(c, { skuId: adj, location: 'self', mode: 'count', value: 3, expected: 5, reason: 'damage', requestId: req2, occurredAt: '2026-02-02T09:00:00+09:00' });
    check('같은 요청 재전송은 duplicate(기록 없음)', again2.outcome === 'duplicate');

    await expectError(c, '화면 재고와 다르면 거부(StaleCountError)', () => applyAdjustment(c, {
      skuId: adj, location: 'self', mode: 'count', value: 1, expected: 5, reason: 'count_diff', requestId: randomUUID(), occurredAt: '2026-02-03T09:00:00+09:00',
    }), /재고가 바뀌었다/);

    const o3 = await applyAdjustment(c, { skuId: adj, location: 'self', mode: 'delta', value: 2, reason: 'return_in', requestId: randomUUID(), occurredAt: '2026-02-04T09:00:00+09:00' });
    a = await adjSelf();
    check('±수량 +2는 최근 lot 단가(700)로 새 lot · 5개 3,500원', o3.kind === 'adjust' && o3.costSource === 'lot' && o3.unitCost === 700 && Number(a.qty) === 5 && Number(a.value) === 3500, JSON.stringify({ o3, a }));

    await reverse(c, `adj:${req2}`, { occurredAt: '2026-02-05T09:00:00+09:00', note: '자가시험 되돌리기' });
    a = await adjSelf();
    check('조정(−2) 되돌리기 후 7개', Number(a.qty) === 7, JSON.stringify(a));

    await expectError(c, 'adjust 전표는 사유 필수', () => c.query(
      `insert into erp.stock_ledger (sku_id, location, qty, kind, unit_cost, occurred_at, idem_key) values ($1, 'self', 1, 'adjust', 100, now(), $2)`,
      [adj, `st:${adj}:noreason`],
    ), /check constraint/);
    await expectError(c, '허용 밖 사유 거부', () => c.query(
      `insert into erp.stock_ledger (sku_id, location, qty, kind, unit_cost, occurred_at, idem_key, reason) values ($1, 'self', 1, 'adjust', 100, now(), $2, 'bogus')`,
      [adj, `st:${adj}:bogus`],
    ), /check constraint/);
  } catch (e) {
    check('예상 못 한 오류', false, (e as Error).message);
```

파일 머리 주석의 첫 줄 설명 아래(`// 운영 DB에서 원장 트리거·제약·뷰가 …` 줄 바로 다음)에 한 줄을 더한다.
```ts
// 1-C1: 조정 전표(지금 개수·±수량·기초재고·중복 요청·화면 재고 불일치·되돌리기·사유 검사)도 같은 롤백 트랜잭션에서 시험한다.
```
🔴 파일 앞부분의 「기초 전표가 있으면 돌지 않는다」 검사는 **그대로 둔다** — Task 8에서 기초재고를 넣은 뒤에는 이 자가시험이 거부해야 정상이다.

- [ ] **Step 15: 자가시험 실행**

Run: `npx tsc --noEmit && npx --no-install tsx scripts/erp/ledger-selftest.ts`
Expected: 표 **26행 전부 ✅**(기존 17 + 새 9), exit 0.

흔적이 없는지 확인한다.
```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
console.log((await c.query(\"select (select count(*) from erp.stock_ledger)::int ledger, (select count(*) from erp.skus where key like 'selftest%')::int skus, (select count(*) from erp.sync_cursors where name='ledger_cutover')::int cursor\")).rows[0]);await c.end()})()"
```
Expected: `{ ledger: 0, skus: 0, cursor: 0 }`

- [ ] **Step 16: 커밋**

```bash
git add scripts/erp/ledger-selftest.ts
git commit -m "test(erp): 운영 DB 자가시험에 조정 전표 9건(롤백 트랜잭션)"
```

---
### Task 3: 재고 API — `/api/erp/stock/*`

**Files:**
- Create: `src/lib/erp/ledger/opening-db.ts` · Modify: `scripts/erp/opening-collect.ts`
- Create: `src/lib/erp/stock/queries.ts`, `src/lib/erp/stock/http.ts`, `src/lib/erp/ledger/opening-import.ts`
- Create: `src/app/api/erp/stock/route.ts`, `src/app/api/erp/stock/adjust/route.ts`, `src/app/api/erp/stock/[skuId]/history/route.ts`, `src/app/api/erp/stock/reverse/route.ts`, `src/app/api/erp/stock/recent/route.ts`, `src/app/api/erp/stock/rg-reconcile/route.ts`, `src/app/api/erp/stock/import/route.ts`
- Test: `src/__tests__/lib/erp/ledger/opening-import.test.ts`, `src/__tests__/api/erp-stock.test.ts`, `src/__tests__/api/erp-stock-rg.test.ts`, `src/__tests__/api/erp-stock-import.test.ts`

#### 3-A. 기초재고 읽기를 `src/lib`로 옮긴다

- [ ] **Step 1: `opening-db.ts` 작성** (코드는 `scripts/erp/opening-collect.ts`의 `fetchRgStock`·`readDb`와 같다 — 인자만 `pg.Client` → `Db`, RG 연결 조회를 `readRgLinks`로 떼어낸다)

`src/lib/erp/ledger/opening-db.ts`:
```ts
// src/lib/erp/ledger/opening-db.ts
// 기초재고 읽기(DB 읽기 전용 · 쿠팡 RG 재고 GET). scripts/erp/opening-collect.ts에서 옮겼다(1-C1) —
// 화면(실사표 불러오기·RG 대조)도 쓰므로 scripts/가 아니라 여기 둔다. 스크립트는 opening-collect에서 다시 내보낸다.
// 구매자 정보는 읽지 않는다 — sale_records에서는 product_cost별 수량 합계만.
import { getCoupangClient } from '@/lib/listing/coupang-client';
import type { Db } from './store';
import type { LegacyFacts, OpeningSku, RgLink, RgStock } from './opening';

export async function fetchRgStock(): Promise<RgStock[]> {
  const client = getCoupangClient();
  const out: RgStock[] = [];
  let token: string | null = null;
  do {
    const page = await client.getRocketGrowthInventories(token ? { nextToken: token } : undefined);
    for (const it of page.items) out.push({ vid: String(it.vendorItemId), qty: it.totalOrderableQuantity });
    token = page.nextToken;
  } while (token);
  return out;
}

/** 활성 RG 리스팅(vendorItemId) ↔ SKU 연결 */
export async function readRgLinks(db: Db): Promise<RgLink[]> {
  const { rows } = await db.query(
    `select l.external_product_id as vid, x.sku_id, x.multiplier
       from erp.channel_listings l join erp.listing_skus x on x.listing_id = l.id
      where l.channel = 'coupang_rg' and l.active`,
  );
  return rows.map((r) => ({ vid: String(r.vid), skuId: Number(r.sku_id), multiplier: Number(r.multiplier) }));
}

export async function readDb(db: Db): Promise<{ skus: OpeningSku[]; links: RgLink[]; legacy: LegacyFacts[]; baseUnitMissing: { key: string; name: string; maxMultiplier: number }[] }> {
  const skus = (await db.query(
    `select id, key, name, option_label, base_unit_label, legacy_product_cost_ids::text[] as legacy from erp.skus where status = 'active' order by id`,
  )).rows.map((r) => ({
    id: Number(r.id), key: r.key, name: r.name, optionLabel: r.option_label, legacyProductCostIds: r.legacy ?? [], baseUnitLabel: r.base_unit_label ?? null,
  }));
  const links = await readRgLinks(db);
  const entries = (await db.query(
    `select product_cost_id, received_at::text as received_at, quantity::int as quantity, unit_cost from cost_entries`,
  )).rows;
  const sales = (await db.query(
    `select product_cost_id,
            coalesce(sum(quantity) filter (where voided_at is null), 0)::int as sold,
            coalesce(sum(quantity) filter (where voided_at is not null), 0)::int as voided
       from sale_records group by product_cost_id`,
  )).rows;
  const byPc = new Map<string, LegacyFacts>();
  const get = (pc: string) => byPc.get(pc) ?? byPc.set(pc, { productCostId: pc, entries: [], soldQty: 0, voidedQty: 0 }).get(pc)!;
  for (const e of entries) get(e.product_cost_id).entries.push({ receivedAt: e.received_at, quantity: Number(e.quantity), unitCost: Number(e.unit_cost) });
  for (const s of sales) Object.assign(get(s.product_cost_id), { soldQty: Number(s.sold), voidedQty: Number(s.voided) });
  const baseUnitMissing = (await db.query(
    `select s.key, s.name, max(x.multiplier)::int as m
       from erp.skus s join erp.listing_skus x on x.sku_id = s.id
      where s.status = 'active' and s.base_unit_label is null
      group by s.key, s.name having max(x.multiplier) > 1 order by s.key`,
  )).rows.map((r) => ({ key: r.key, name: r.name, maxMultiplier: Number(r.m) }));
  return { skus, links, legacy: [...byPc.values()], baseUnitMissing };
}
```

- [ ] **Step 2: `opening-collect.ts`는 옮긴 곳을 쓰고 다시 내보낸다**

`scripts/erp/opening-collect.ts` import 두 덩이
```ts
import { getCoupangClient } from '@/lib/listing/coupang-client';
import {
  buildCountSheet, carryCounts, groupSkus, parseCountCsv, rgQtyBySku, toCsv,
  type LegacyFacts, type OpeningSku, type RgLink, type RgStock,
} from '@/lib/erp/ledger/opening';
```
을 아래로 바꾼다.
```ts
import { fetchRgStock, readDb } from '@/lib/erp/ledger/opening-db';
import {
  buildCountSheet, carryCounts, groupSkus, parseCountCsv, rgQtyBySku, toCsv,
} from '@/lib/erp/ledger/opening';

// 1-C1: 화면도 쓰므로 src/lib/erp/ledger/opening-db.ts로 옮겼다. opening-apply·rg-reconcile은 계속 여기서 가져간다.
export { fetchRgStock, readDb };
```

그리고 `export async function fetchRgStock(): Promise<RgStock[]> {`로 시작해 `readDb`의 마지막 `return { skus, links, legacy: [...byPc.values()], baseUnitMissing };\n}`까지(현재 37~80행) **두 함수 정의를 통째로 지운다.** `readDb(c)` 호출(`main()` 안)과 `Awaited<ReturnType<typeof readDb>>` 타입은 그대로 둔다 — `pg.Client`는 `Db`를 만족한다.

- [ ] **Step 3: 스크립트가 그대로 도는지 확인** (DB 읽기 전용 · 쿠팡 GET만 — 파일을 쓰지 않는 경로로)

Run: `npx tsc --noEmit && npx --no-install tsx scripts/erp/rg-reconcile.ts; echo "exit $?"`
Expected: tsc 0 오류. `기초재고 시각: 없음 · 원장 RG SKU 0 · 실재고 SKU 16 …` 형태 한 줄(원장이 비어 있어 불일치가 나오고 exit 1이 정상이다 — 이 단계는 **가져오기가 깨지지 않았는지만** 본다).

- [ ] **Step 4: 커밋**

```bash
git add src/lib/erp/ledger/opening-db.ts scripts/erp/opening-collect.ts
git commit -m "refactor(erp): 기초재고 읽기(readDb·fetchRgStock)를 src/lib로 — 화면 API가 쓴다"
```

#### 3-B. 실사표 불러오기 계획·적재 (`opening-import.ts`)

- [ ] **Step 5: 실패하는 테스트 작성**

`src/__tests__/lib/erp/ledger/opening-import.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { commitOpeningImport, ImportConflictError, planOpeningImport } from '@/lib/erp/ledger/opening-import';
import type { CountRow, LegacyFacts, OpeningIssue, OpeningSku } from '@/lib/erp/ledger/opening';
import type { Db } from '@/lib/erp/ledger/store';

const skus: OpeningSku[] = [
  { id: 7, key: 'k7', name: '왜건', optionLabel: '블랙', legacyProductCostIds: ['pc-7'] },
  { id: 8, key: 'k8', name: '매트', optionLabel: '', legacyProductCostIds: ['pc-8'] },
  { id: 9, key: 'k9', name: '타월', optionLabel: '', legacyProductCostIds: [] },
];
const legacy: LegacyFacts[] = [
  { productCostId: 'pc-7', entries: [{ receivedAt: '2026-09-01', quantity: 10, unitCost: 1000 }], soldQty: 0, voidedQty: 0 },
  { productCostId: 'pc-8', entries: [{ receivedAt: '2026-09-02', quantity: 5, unitCost: 3000 }], soldQty: 0, voidedQty: 0 },
];
const row = (o: Partial<CountRow>): CountRow => ({
  skuId: 7, skuKey: 'k7', name: '', option: '', group: 'g1', rgActual: 0, selfEstimate: null, selfCount: 0, rgInbound: 0, unitCost: null, note: '', ...o,
});
const base = {
  skus, legacy,
  rgBySku: new Map<number, number>(),
  rgIssues: [] as OpeningIssue[],
  stockedSkuIds: new Set<number>(),
  overrides: {} as Record<string, number>,
  countedAt: '2026-09-27T09:30:00+09:00',
  now: new Date('2026-09-27T01:00:00Z'),
};

describe('planOpeningImport', () => {
  it('집·입고중·지금 RG를 기초 전표로 계획한다(단가 = 옛 입고 이력)', () => {
    const p = planOpeningImport({ ...base, rows: [row({ selfCount: 3, rgInbound: 1 })], rgBySku: new Map([[7, 2]]) });
    expect(p.errors).toEqual([]);
    expect(p.plan).toEqual([
      { skuId: 7, key: 'k7', location: 'self', qty: 3, unitCost: 1000 },
      { skuId: 7, key: 'k7', location: 'rg_inbound', qty: 1, unitCost: 1000 },
      { skuId: 7, key: 'k7', location: 'rg', qty: 2, unitCost: 1000 },
    ]);
    expect(p.totals).toEqual({ self: 3, rgInbound: 1, rg: 2, value: 6000, entries: 3 });
  });

  it('원장에 전표가 있는 SKU는 빼고 조정으로 안내한다', () => {
    const p = planOpeningImport({ ...base, rows: [row({ selfCount: 3 })], stockedSkuIds: new Set([7]) });
    expect(p.plan).toEqual([]);
    expect(p.excluded).toEqual([{ skuKey: 'k7', reason: expect.stringContaining('조정') }]);
  });

  it('self_count 빈칸은 불러오지 않는다(경고 아님 · 제외 목록)', () => {
    const p = planOpeningImport({ ...base, rows: [row({ selfCount: null })] });
    expect(p.plan).toEqual([]);
    expect(p.excluded[0].reason).toContain('빈칸');
    expect(p.errors).toEqual([]);
  });

  it('SKU 키가 다르면 오류', () => {
    const p = planOpeningImport({ ...base, rows: [row({ skuKey: 'k8', selfCount: 1 })] });
    expect(p.errors.join('\n')).toContain('키가 다르다');
  });

  it('단가를 모르면 오류, 화면 입력(overrides)으로 채운다', () => {
    const rows = [row({ skuId: 9, skuKey: 'k9', selfCount: 2 })];
    expect(planOpeningImport({ ...base, rows }).errors.join('\n')).toContain('단가를 모른다: k9');
    const p = planOpeningImport({ ...base, rows, overrides: { k9: 500 } });
    expect(p.errors).toEqual([]);
    expect(p.plan).toEqual([{ skuId: 9, key: 'k9', location: 'self', qty: 2, unitCost: 500 }]);
  });

  it('RG 매핑 이슈와 불러올 행에 없는 RG 재고는 경고로만 남기고 싣지 않는다', () => {
    const p = planOpeningImport({
      ...base,
      rows: [row({ selfCount: 1 })],
      rgBySku: new Map([[8, 4]]),
      rgIssues: [{ kind: 'rg_vid_unmapped', ref: '333', detail: 'RG 재고 2개인 vendorItemId가 어느 RG 리스팅에도 없다' }],
    });
    expect(p.errors).toEqual([]);
    expect(p.warnings).toHaveLength(2);
    expect(p.plan.some((x) => x.skuId === 8)).toBe(false);
  });

  it('실사 시각이 24시간 넘게 지났으면 오류', () => {
    const p = planOpeningImport({ ...base, rows: [row({ selfCount: 1 })], countedAt: '2026-09-25T09:00:00+09:00' });
    expect(p.errors.join('\n')).toContain('24시간');
  });
});

function fakeDb(counts: Record<number, number> = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let nextId = 100;
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select count(*)::int as n from erp.stock_ledger')) return { rows: [{ n: counts[Number(params[0])] ?? 0 }], rowCount: 1 };
      if (sql.startsWith('select 1 from erp.stock_ledger')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('insert into erp.stock_ledger')) return { rows: [{ id: nextId++ }], rowCount: 1 };
      if (sql.startsWith('set constraints')) return { rows: [], rowCount: null };
      if (sql.startsWith('insert into erp.sync_cursors')) return { rows: [], rowCount: 1 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
    },
  };
  return { db, calls };
}

describe('commitOpeningImport', () => {
  const AT = '2026-09-27T01:00:00.000Z';
  const plan = [
    { skuId: 9, key: 'k9', location: 'self' as const, qty: 2, unitCost: 500 },
    { skuId: 7, key: 'k7', location: 'self' as const, qty: 3, unitCost: 1000 },
    { skuId: 7, key: 'k7', location: 'rg' as const, qty: 2, unitCost: 1000 },
  ];

  it('전역 잠금 → SKU 오름차순 잠금·빈 원장 재확인 → 기초 전표 → 커서', async () => {
    const f = fakeDb();
    expect(await commitOpeningImport(f.db, plan, { fileName: 'count.csv', cutoverAt: AT })).toBe(3);
    expect(f.calls[0].params).toEqual([7102]);
    const locks = f.calls.filter((c) => c.sql.startsWith('select pg_advisory_xact_lock($1::int')).map((c) => c.params[1]);
    expect(locks.slice(0, 2)).toEqual([7, 9]);
    const ins = f.calls.filter((c) => c.sql.startsWith('insert into erp.stock_ledger'));
    expect(ins.map((c) => [c.params[10], c.params[3], c.params[12], c.params[7], c.params[8]])).toEqual([
      ['opening:7:self', 'opening', 'opening', 'opening', 'count.csv'],
      ['opening:7:rg', 'opening', 'opening', 'opening', 'count.csv'],
      ['opening:9:self', 'opening', 'opening', 'opening', 'count.csv'],
    ]);
    expect(f.calls.find((c) => c.sql.startsWith('insert into erp.sync_cursors'))!.params).toEqual([AT]);
  });

  it('미리보기 뒤 그 사이 전표가 생긴 SKU가 있으면 ImportConflictError(아무것도 쓰지 않는다)', async () => {
    const f = fakeDb({ 9: 1 });
    await expect(commitOpeningImport(f.db, plan, { fileName: 'count.csv', cutoverAt: AT })).rejects.toBeInstanceOf(ImportConflictError);
    expect(f.calls.some((c) => c.sql.startsWith('insert'))).toBe(false);
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger/opening-import.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 7: 구현**

`src/lib/erp/ledger/opening-import.ts`:
```ts
// src/lib/erp/ledger/opening-import.ts
// 화면의 「실사표 불러오기」 = 기초재고 한꺼번에. 1-B opening.ts(실사표 CSV·단가 결정·RG 환산)를 그대로 쓴다.
// 1-B 스크립트(opening-apply)와 다른 점: 단가 덮어쓰기와 실사 시각은 화면 입력이다(docs 파일 없음) ·
// self_count 빈칸 행과 실사표에 없는 SKU는 건너뛴다(빈 위치의 첫 입력이 곧 기초재고라 나중에 적으면 된다) ·
// RG 매핑 이슈는 경고다 · 원장에 전표가 이미 있는 SKU는 빼고 「조정으로 고친다」로 안내한다.
import type { Location } from './fifo';
import {
  checkCountedAt, groupSkus, resolveOpeningCosts, rgOutsideActive,
  type CountRow, type LegacyFacts, type OpeningIssue, type OpeningSku, type ResolvedCost,
} from './opening';
import { lockSku, postLotCreate, type Db } from './store';
import { ensureCutover } from './adjust-store';
import { openingIdemKey } from './adjust';

/** 기초재고 적재 전역 잠금 — 1-B scripts/erp/opening-apply.ts와 같은 값(겹친 실행이 서로를 기다린다) */
export const OPENING_LOCK = 7102;

export interface ImportPlanRow {
  skuId: number;
  key: string;
  location: Location;
  qty: number;
  unitCost: number;
}

export interface ImportTotals {
  self: number;
  rgInbound: number;
  rg: number;
  value: number;
  entries: number;
}

export interface ImportPreview {
  plan: ImportPlanRow[];
  errors: string[];
  warnings: string[];
  excluded: { skuKey: string; reason: string }[];
  /** 보유 수량이 있는 SKU의 적재 단가와 출처(화면이 단가 입력 칸을 그린다) */
  costs: ResolvedCost[];
  totals: ImportTotals;
}

/** /api/erp/stock/import 응답 */
export interface ImportSummary extends Omit<ImportPreview, 'plan'> {
  committed: number;
  cutoverAt: string;
}

export class ImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportConflictError';
  }
}

export function planOpeningImport(input: {
  rows: CountRow[];
  skus: OpeningSku[];
  legacy: LegacyFacts[];
  rgBySku: Map<number, number>;
  rgIssues: OpeningIssue[];
  stockedSkuIds: Set<number>;
  overrides: Record<string, number>;
  countedAt: string;
  now: Date;
}): ImportPreview {
  const errors: string[] = [];
  const warnings: string[] = [];
  const excluded: { skuKey: string; reason: string }[] = [];
  const active = new Map(input.skus.map((s) => [s.id, s]));
  const activeKeys = new Set(input.skus.map((s) => s.key));

  const bad = checkCountedAt(input.countedAt, input.now);
  if (bad) errors.push(bad.replace('opening-overrides.json에 ', ''));
  for (const i of input.rgIssues) warnings.push(`${i.kind} ${i.ref} — ${i.detail} (불러오지 않는다)`);
  for (const o of rgOutsideActive(input.rgBySku, new Set(active.keys()))) {
    warnings.push(`활성이 아닌 SKU ${o.skuId}에 RG 재고 ${o.qty}개 — 불러오지 않는다`);
  }

  const included: CountRow[] = [];
  for (const r of input.rows) {
    const s = active.get(r.skuId);
    if (!s) { errors.push(`실사표의 SKU ${r.skuId}(${r.skuKey})가 활성 SKU가 아니다`); continue; }
    if (s.key !== r.skuKey) { errors.push(`SKU ${r.skuId} 키가 다르다: 실사표 ${r.skuKey} / DB ${s.key}`); continue; }
    if (input.stockedSkuIds.has(r.skuId)) { excluded.push({ skuKey: r.skuKey, reason: '원장에 이미 전표가 있다 — 재고현황에서 조정으로 고친다' }); continue; }
    if (r.selfCount === null) { excluded.push({ skuKey: r.skuKey, reason: 'self_count 빈칸 — 불러오지 않는다(나중에 화면에서 적으면 기초재고가 된다)' }); continue; }
    if (r.selfCount < 0) { errors.push(`self_count 음수: ${r.skuKey}`); continue; }
    if (r.rgInbound < 0) { errors.push(`rg_inbound 음수: ${r.skuKey}`); continue; }
    included.push(r);
  }
  const includedIds = new Set(included.map((r) => r.skuId));
  for (const [id, q] of input.rgBySku) {
    const s = active.get(id);
    if (q > 0 && s && !includedIds.has(id) && !input.stockedSkuIds.has(id)) {
      warnings.push(`RG 재고 ${q}개인 SKU ${s.key}가 불러올 행에 없다 — RG도 불러오지 않는다`);
    }
  }
  for (const [k, v] of Object.entries(input.overrides)) {
    if (!activeKeys.has(k)) errors.push(`단가 입력의 SKU 키 ${k}가 활성 SKU가 아니다`);
    else if (!Number.isInteger(v) || v < 0) errors.push(`단가 입력 ${k} = ${v} — 0 이상 정수여야 한다`);
  }

  const rgIncluded = new Map([...input.rgBySku].filter(([id]) => includedIds.has(id)));
  const cost = resolveOpeningCosts(input.skus, groupSkus(input.skus), input.legacy, included, rgIncluded, input.overrides);
  const costById = new Map(cost.costs.map((c) => [c.skuId, c]));
  for (const m of cost.missing) errors.push(`재고 ${m.onHand}개인데 단가를 모른다: ${m.skuKey} — 단가를 입력한다`);

  const plan: ImportPlanRow[] = [];
  for (const r of included) {
    const unitCost = costById.get(r.skuId)?.unitCost;
    if (unitCost === null || unitCost === undefined) continue;
    const rgNow = rgIncluded.get(r.skuId) ?? 0;
    for (const [location, qty] of [['self', r.selfCount ?? 0], ['rg_inbound', r.rgInbound], ['rg', rgNow]] as const) {
      if (qty > 0) plan.push({ skuId: r.skuId, key: r.skuKey, location, qty, unitCost });
    }
  }
  const sum = (loc: Location) => plan.filter((p) => p.location === loc).reduce((s, p) => s + p.qty, 0);
  return {
    plan, errors, warnings, excluded,
    costs: cost.costs.filter((c) => c.onHand > 0),
    totals: { self: sum('self'), rgInbound: sum('rg_inbound'), rg: sum('rg'), value: plan.reduce((s, p) => s + p.qty * p.unitCost, 0), entries: plan.length },
  };
}

/** 호출자 트랜잭션 안에서 기초 전표를 쓴다. 전역 잠금 → SKU 오름차순 잠금·빈 원장 재확인 → 전표 → 커서 */
export async function commitOpeningImport(db: Db, plan: ImportPlanRow[], p: { fileName: string; cutoverAt: string }): Promise<number> {
  await db.query('select pg_advisory_xact_lock($1::bigint)', [OPENING_LOCK]);
  const ids = [...new Set(plan.map((r) => r.skuId))].sort((a, b) => a - b);
  for (const id of ids) {
    await lockSku(db, id);
    const { rows } = await db.query('select count(*)::int as n from erp.stock_ledger where sku_id = $1', [id]);
    if (Number(rows[0].n) > 0) throw new ImportConflictError(`SKU ${id}에 미리보기 뒤 전표가 생겼다 — 다시 미리보기한다`);
  }
  let n = 0;
  for (const r of [...plan].sort((a, b) => a.skuId - b.skuId)) {
    const res = await postLotCreate(db, {
      skuId: r.skuId, location: r.location, qty: r.qty, unitCost: r.unitCost, kind: 'opening', reason: 'opening',
      occurredAt: p.cutoverAt, idemKey: openingIdemKey(r.skuId, r.location), refType: 'opening', refId: p.fileName,
    });
    if (res.posted) n++;
  }
  if (n > 0) await ensureCutover(db, p.cutoverAt);
  return n;
}
```

- [ ] **Step 8: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/lib/erp/ledger && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/lib/erp/ledger/opening-import.ts src/__tests__/lib/erp/ledger/opening-import.test.ts
git commit -m "feat(erp): 실사표 불러오기 계획·적재 — 원장 있는 SKU 제외 · 단가 입력 · RG는 경고"
```

#### 3-C. 조회와 HTTP 공용 (`queries.ts`·`http.ts`)

- [ ] **Step 9: `queries.ts` 작성** (라우트 테스트가 검증한다 — Step 12)

`src/lib/erp/stock/queries.ts`:
```ts
// src/lib/erp/stock/queries.ts
// 재고 화면 조회(읽기 전용). 쓰기는 ledger/adjust-store.ts · ledger/opening-import.ts.
import type { Db } from '@/lib/erp/ledger/store';
import type { Location } from '@/lib/erp/ledger/fifo';
import type { LedgerKind, Reason } from '@/lib/erp/ledger/plan';
import type { OpeningIssue } from '@/lib/erp/ledger/opening';
import { isReversibleKey } from '@/lib/erp/ledger/adjust';

export interface StockListRow {
  skuId: number;
  key: string;
  name: string;
  option: string;
  legacyProductCostIds: string[];
  self: number;
  rgInbound: number;
  rg: number;
  /** 원장 평가액(lot 단가 × 수량 합) */
  value: number;
  /** 원장 전표가 하나라도 있다 */
  hasLedger: boolean;
  /** 최근 lot 단가(위치 무관, 되돌린 lot 제외) */
  lotCost: number | null;
  /** 옛 cost_entries 최근 단가 */
  legacyCost: number | null;
}

export interface HistoryRow {
  id: number;
  location: Location;
  qty: number;
  kind: LedgerKind;
  reason: Reason | null;
  note: string | null;
  occurredAt: string;
  idemKey: string;
  /** 순번(#…)을 뗀 원 멱등키 — 되돌리기 단위 */
  baseKey: string;
  refType: string | null;
  refId: string | null;
  /** lot 단가(차감·이동 전표는 그 lot의 단가) */
  unitCost: number | null;
  reversed: boolean;
  reversible: boolean;
}

export interface RecentAdjust {
  requestId: string;
  skuId: number;
  name: string;
  option: string;
  location: Location;
  /** 그 요청의 순증감(되돌렸으면 0) */
  qty: number;
  reason: Reason | null;
  occurredAt: string;
}

export interface RgReconResponse {
  fetchedAt: string;
  rows: { skuId: number; ledger: number; actual: number }[];
  issues: OpeningIssue[];
  inactive: { skuId: number; qty: number }[];
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

export async function listStock(db: Db): Promise<StockListRow[]> {
  const { rows } = await db.query(
    `select s.id, s.key, s.name, s.option_label, s.legacy_product_cost_ids::text[] as legacy,
            coalesce(sum(h.qty) filter (where h.location = 'self'), 0)::int as self,
            coalesce(sum(h.qty) filter (where h.location = 'rg_inbound'), 0)::int as rg_inbound,
            coalesce(sum(h.qty) filter (where h.location = 'rg'), 0)::int as rg,
            coalesce(sum(h.value), 0)::bigint as value,
            exists (select 1 from erp.stock_ledger x where x.sku_id = s.id) as has_ledger,
            (select l.unit_cost from erp.stock_ledger l
              where l.sku_id = s.id and l.lot_id is null
                and not exists (select 1 from erp.stock_ledger r where r.reverses_id = l.id)
              order by l.occurred_at desc, l.id desc limit 1) as lot_cost,
            (select round(ce.unit_cost)::int from cost_entries ce
              where ce.product_cost_id = any(s.legacy_product_cost_ids)
              order by ce.received_at desc, ce.created_at desc limit 1) as legacy_cost
       from erp.skus s
       left join erp.stock_on_hand h on h.sku_id = s.id
      where s.status = 'active'
      group by s.id
      order by s.name, s.option_label, s.id`,
  );
  return rows.map((r) => ({
    skuId: Number(r.id), key: r.key, name: r.name, option: r.option_label ?? '', legacyProductCostIds: r.legacy ?? [],
    self: Number(r.self), rgInbound: Number(r.rg_inbound), rg: Number(r.rg), value: Number(r.value),
    hasLedger: r.has_ledger === true, lotCost: num(r.lot_cost), legacyCost: num(r.legacy_cost),
  }));
}

export async function skuHistory(db: Db, skuId: number, limit = 300): Promise<HistoryRow[]> {
  const { rows } = await db.query(
    `select l.id, l.location, l.qty, l.kind, l.reason, l.note, l.occurred_at, l.idem_key, l.ref_type, l.ref_id,
            h.unit_cost,
            exists (select 1 from erp.stock_ledger r where r.reverses_id = l.id) as reversed
       from erp.stock_ledger l join erp.stock_ledger h on h.id = coalesce(l.lot_id, l.id)
      where l.sku_id = $1
      order by l.occurred_at desc, l.id desc
      limit $2`,
    [skuId, limit],
  );
  const mapped = rows.map((r) => ({
    id: Number(r.id), location: r.location as Location, qty: Number(r.qty), kind: r.kind as LedgerKind,
    reason: (r.reason ?? null) as Reason | null, note: r.note ?? null, occurredAt: iso(r.occurred_at),
    idemKey: String(r.idem_key), baseKey: String(r.idem_key).split('#')[0], refType: r.ref_type ?? null, refId: r.ref_id ?? null,
    unitCost: num(r.unit_cost), reversed: r.reversed === true, reversible: false,
  }));
  const reversedKeys = new Set(mapped.filter((m) => m.reversed).map((m) => m.baseKey));
  return mapped.map((m) => ({ ...m, reversible: m.kind !== 'reversal' && isReversibleKey(m.baseKey) && !reversedKeys.has(m.baseKey) }));
}

export async function recentAdjustments(db: Db, limit: number): Promise<RecentAdjust[]> {
  const { rows } = await db.query(
    `select l.ref_id, l.sku_id, s.name, s.option_label, l.location, sum(l.qty)::int as qty,
            max(l.reason) as reason, max(l.occurred_at) as occurred_at
       from erp.stock_ledger l join erp.skus s on s.id = l.sku_id
      where l.ref_type = 'adjust'
      group by l.ref_id, l.sku_id, s.name, s.option_label, l.location
      order by max(l.id) desc
      limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    requestId: String(r.ref_id), skuId: Number(r.sku_id), name: r.name, option: r.option_label ?? '', location: r.location as Location,
    qty: Number(r.qty), reason: (r.reason ?? null) as Reason | null, occurredAt: iso(r.occurred_at),
  }));
}

export async function rgLedgerBySku(db: Db): Promise<Map<number, number>> {
  const { rows } = await db.query(`select sku_id, qty from erp.stock_on_hand where location = 'rg'`);
  return new Map(rows.map((r) => [Number(r.sku_id), Number(r.qty)]));
}

export async function activeSkuIds(db: Db): Promise<Set<number>> {
  const { rows } = await db.query(`select id from erp.skus where status = 'active'`);
  return new Set(rows.map((r) => Number(r.id)));
}

export async function stockedSkuIds(db: Db): Promise<Set<number>> {
  const { rows } = await db.query('select distinct sku_id from erp.stock_ledger');
  return new Set(rows.map((r) => Number(r.sku_id)));
}
```

- [ ] **Step 10: `http.ts` 작성**

`src/lib/erp/stock/http.ts`:
```ts
// src/lib/erp/stock/http.ts
// /api/erp/* 공용: 트랜잭션 · 오류 → HTTP 응답 · 조정 요청 본문 변환.
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { getSourcingPool } from '@/lib/sourcing/db';
import { InsufficientStockError, type Location } from '@/lib/erp/ledger/fifo';
import {
  AdjustInputError, AdjustItemError, CostRequiredError, StaleCountError,
  type AdjustInput, type AdjustMode, type UserReason,
} from '@/lib/erp/ledger/adjust';
import { ImportConflictError } from '@/lib/erp/ledger/opening-import';

/** 한 트랜잭션. 던지면 ROLLBACK — 여러 건 조정은 전부 되거나 전부 안 된다 */
export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getSourcingPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ success: false, code, error, ...extra }, { status });

/** 원장 오류를 화면이 다룰 수 있는 코드로. stale = 다시 보고 적는다 · insufficient/negative = 재고 부족 · cost_required = 단가 입력 */
export function erpError(e: unknown): NextResponse {
  const item = e instanceof AdjustItemError ? e : null;
  const inner = item ? item.inner : e;
  const extra = item ? { index: item.index, skuId: item.skuId, location: item.location } : {};
  const msg = item ? item.message : inner instanceof Error ? inner.message : String(inner);
  if (inner instanceof StaleCountError) return fail(409, 'stale', msg, extra);
  if (inner instanceof InsufficientStockError) return fail(409, 'insufficient', msg, extra);
  if (inner instanceof CostRequiredError) return fail(422, 'cost_required', msg, extra);
  if (inner instanceof ImportConflictError) return fail(409, 'conflict', msg, extra);
  if (inner instanceof AdjustInputError || inner instanceof RangeError) return fail(400, 'invalid', msg, extra);
  if (inner instanceof Error && /음수가 된다/.test(inner.message)) return fail(409, 'negative', msg, extra);
  console.error('[erp]', e);
  return fail(500, 'server', '서버 오류');
}

export const badRequest = (error: string) => fail(400, 'invalid', error);

const optNum = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number(v));

/** 화면이 보낸 조정 한 건 → AdjustInput. 검사는 validateAdjustInput이 한다. fixed는 라우트가 정하는 칸(RG 반영의 위치·사유 등) */
export function parseAdjustItem(b: Record<string, unknown>, at: string, fixed: Partial<AdjustInput> = {}): AdjustInput {
  return {
    skuId: Number(b.skuId),
    location: b.location as Location,
    mode: b.mode as AdjustMode,
    value: Number(b.value),
    expected: optNum(b.expected),
    reason: b.reason as UserReason,
    note: typeof b.note === 'string' && b.note.trim() !== '' ? b.note.trim() : undefined,
    unitCost: optNum(b.unitCost),
    requestId: typeof b.requestId === 'string' ? b.requestId : '',
    occurredAt: at,
    ...fixed,
  };
}
```

- [ ] **Step 11: 커밋**

Run: `npx tsc --noEmit` → 0 오류
```bash
git add src/lib/erp/stock/queries.ts src/lib/erp/stock/http.ts
git commit -m "feat(erp): 재고 화면 조회와 /api/erp 공용(트랜잭션·오류 코드·조정 본문)"
```

#### 3-D. 목록·조정·이력·되돌리기·최근 라우트

- [ ] **Step 12: 실패하는 테스트 작성**

`src/__tests__/api/erp-stock.test.ts`:
```ts
// src/__tests__/api/erp-stock.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockGetPool, mockApply, mockReverse } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetPool: vi.fn(),
  mockApply: vi.fn(),
  mockReverse: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));
vi.mock('@/lib/erp/ledger/adjust-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/erp/ledger/adjust-store')>()),
  applyAdjustments: mockApply,
}));
vi.mock('@/lib/erp/ledger/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/erp/ledger/store')>()),
  reverse: mockReverse,
}));

import { AdjustItemError, StaleCountError } from '@/lib/erp/ledger/adjust';

const REQ = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
type Rows = { rows: Record<string, unknown>[]; rowCount: number };

let poolRows: (sql: string) => Rows;
let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

const get = (url: string) => new NextRequest(`http://localhost${url}`);
const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const clientSql = () => client.query.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  poolRows = (sql) => {
    if (sql.startsWith("select id from erp.skus where status = 'active'")) return { rows: [{ id: 7 }, { id: 9 }], rowCount: 2 };
    throw new Error(`예상 못 한 SQL: ${sql.slice(0, 50)}`);
  };
  client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), release: vi.fn() };
  mockGetPool.mockReturnValue({ query: vi.fn(async (sql: string) => poolRows(sql)), connect: vi.fn(async () => client) });
});

describe('GET /api/erp/stock', () => {
  it('로그인하지 않으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/erp/stock/route');
    expect((await GET(get('/api/erp/stock'))).status).toBe(401);
  });

  it('SKU별 위치 재고·평가액·단가를 돌려준다', async () => {
    poolRows = () => ({
      rows: [{ id: '7', key: 'cp:1:블랙', name: '왜건', option_label: '블랙', legacy: ['pc-1'], self: 3, rg_inbound: 0, rg: 2, value: '5000', has_ledger: true, lot_cost: 1000, legacy_cost: null }],
      rowCount: 1,
    });
    const { GET } = await import('@/app/api/erp/stock/route');
    const json = await (await GET(get('/api/erp/stock'))).json();
    expect(json.data).toEqual([{
      skuId: 7, key: 'cp:1:블랙', name: '왜건', option: '블랙', legacyProductCostIds: ['pc-1'],
      self: 3, rgInbound: 0, rg: 2, value: 5000, hasLedger: true, lotCost: 1000, legacyCost: null,
    }]);
  });
});

describe('POST /api/erp/stock/adjust', () => {
  const item = { skuId: 7, location: 'self', mode: 'count', value: 5, expected: 3, reason: 'count_diff', unitCost: 900, requestId: REQ };

  it('로그인하지 않으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { POST } = await import('@/app/api/erp/stock/adjust/route');
    expect((await POST(post('/api/erp/stock/adjust', { items: [item] }))).status).toBe(401);
  });

  it.each([
    ['빈 items', { items: [] }],
    ['RG 위치(대조로만 고친다)', { items: [{ ...item, location: 'rg' }] }],
    ['서버 전용 사유', { items: [{ ...item, reason: 'opening' }] }],
    ['활성이 아닌 SKU', { items: [{ ...item, skuId: 11 }] }],
  ])('%s → 400, 원장을 건드리지 않는다', async (_, body) => {
    const { POST } = await import('@/app/api/erp/stock/adjust/route');
    const res = await POST(post('/api/erp/stock/adjust', body));
    expect(res.status).toBe(400);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('한 트랜잭션에서 applyAdjustments를 부르고 서버 시각을 쓴다', async () => {
    mockApply.mockResolvedValue([{ skuId: 7, location: 'self', requestId: REQ, outcome: 'posted', kind: 'adjust', qty: 2, idemKey: `adj:${REQ}`, unitCost: 900, costSource: 'input' }]);
    const { POST } = await import('@/app/api/erp/stock/adjust/route');
    const res = await POST(post('/api/erp/stock/adjust', { items: [item] }));
    expect(res.status).toBe(200);
    const [db, inputs] = mockApply.mock.calls[0];
    expect(db).toBe(client);
    expect(inputs).toEqual([{
      skuId: 7, location: 'self', mode: 'count', value: 5, expected: 3, reason: 'count_diff', unitCost: 900, requestId: REQ, occurredAt: expect.stringMatching(ISO),
    }]);
    expect(clientSql()).toEqual(['BEGIN', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('화면 재고가 낡았으면 409 stale + 몇 번째인지, 트랜잭션은 되돌린다', async () => {
    mockApply.mockRejectedValue(new AdjustItemError(0, 7, 'self', new StaleCountError(3, 4)));
    const { POST } = await import('@/app/api/erp/stock/adjust/route');
    const res = await POST(post('/api/erp/stock/adjust', { items: [item] }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toMatchObject({ success: false, code: 'stale', index: 0, skuId: 7 });
    expect(clientSql()).toEqual(['BEGIN', 'ROLLBACK']);
  });
});

describe('GET /api/erp/stock/[skuId]/history', () => {
  const ctx = (skuId: string) => ({ params: Promise.resolve({ skuId }) });

  it('숫자가 아닌 SKU는 400', async () => {
    const { GET } = await import('@/app/api/erp/stock/[skuId]/history/route');
    expect((await GET(get('/api/erp/stock/abc/history'), ctx('abc'))).status).toBe(400);
  });

  it('되돌리기는 되돌리지 않은 조정·기초 묶음에만 연다', async () => {
    poolRows = () => ({
      rows: [
        { id: 3, location: 'self', qty: -2, kind: 'adjust', reason: 'damage', note: null, occurred_at: new Date('2026-09-27T02:00:00Z'), idem_key: `adj:${REQ}#0`, ref_type: 'adjust', ref_id: REQ, unit_cost: 700, reversed: false },
        { id: 2, location: 'self', qty: -5, kind: 'reversal', reason: null, note: null, occurred_at: new Date('2026-09-27T01:30:00Z'), idem_key: 'rev:opening:7:self', ref_type: 'adjust', ref_id: 'r0', unit_cost: 700, reversed: false },
        { id: 1, location: 'self', qty: 5, kind: 'opening', reason: 'opening', note: null, occurred_at: new Date('2026-09-27T01:00:00Z'), idem_key: 'opening:7:self', ref_type: 'adjust', ref_id: 'r0', unit_cost: 700, reversed: true },
      ],
      rowCount: 3,
    });
    const { GET } = await import('@/app/api/erp/stock/[skuId]/history/route');
    const json = await (await GET(get('/api/erp/stock/7/history'), ctx('7'))).json();
    expect(json.data.map((h: { baseKey: string; reversible: boolean }) => [h.baseKey, h.reversible])).toEqual([
      [`adj:${REQ}`, true],
      ['rev:opening:7:self', false],
      ['opening:7:self', false],
    ]);
    expect(json.data[0].occurredAt).toBe('2026-09-27T02:00:00.000Z');
  });
});

describe('POST /api/erp/stock/reverse', () => {
  it('조정·기초 키가 아니면 400', async () => {
    const { POST } = await import('@/app/api/erp/stock/reverse/route');
    expect((await POST(post('/api/erp/stock/reverse', { idemKey: 'receipt:x:7' }))).status).toBe(400);
    expect(mockReverse).not.toHaveBeenCalled();
  });

  it('트랜잭션 안에서 reverse를 부른다', async () => {
    mockReverse.mockResolvedValue({ posted: true, ids: [10] });
    const { POST } = await import('@/app/api/erp/stock/reverse/route');
    const res = await POST(post('/api/erp/stock/reverse', { idemKey: `adj:${REQ}` }));
    expect(res.status).toBe(200);
    expect(mockReverse).toHaveBeenCalledWith(client, `adj:${REQ}`, { occurredAt: expect.stringMatching(ISO), note: '화면에서 되돌림' });
    expect(clientSql()).toEqual(['BEGIN', 'COMMIT']);
  });

  it('이미 되돌렸으면 409', async () => {
    mockReverse.mockResolvedValue({ posted: false, ids: [] });
    const { POST } = await import('@/app/api/erp/stock/reverse/route');
    const res = await POST(post('/api/erp/stock/reverse', { idemKey: 'opening:7:self' }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('already');
  });

  it('되돌릴 전표가 없으면 404', async () => {
    mockReverse.mockRejectedValue(new Error('되돌릴 전표가 없다: opening:7:self'));
    const { POST } = await import('@/app/api/erp/stock/reverse/route');
    expect((await POST(post('/api/erp/stock/reverse', { idemKey: 'opening:7:self' }))).status).toBe(404);
  });

  it('되돌리면 재고가 음수가 되면 409', async () => {
    mockReverse.mockRejectedValue(new Error('SKU 7 · self · lot 1의 재고가 음수가 된다 (-1)'));
    const { POST } = await import('@/app/api/erp/stock/reverse/route');
    const res = await POST(post('/api/erp/stock/reverse', { idemKey: 'opening:7:self' }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('negative');
  });
});

describe('GET /api/erp/stock/recent', () => {
  it('최근 조정을 요청 단위로 돌려준다(limit 1~20)', async () => {
    let limit: unknown = null;
    mockGetPool.mockReturnValue({
      query: vi.fn(async (_sql: string, params: unknown[]) => {
        limit = params[0];
        return { rows: [{ ref_id: REQ, sku_id: '7', name: '왜건', option_label: '블랙', location: 'self', qty: -2, reason: 'damage', occurred_at: new Date('2026-09-27T02:00:00Z') }], rowCount: 1 };
      }),
    });
    const { GET } = await import('@/app/api/erp/stock/recent/route');
    const json = await (await GET(get('/api/erp/stock/recent?limit=99'))).json();
    expect(limit).toBe(20);
    expect(json.data).toEqual([{ requestId: REQ, skuId: 7, name: '왜건', option: '블랙', location: 'self', qty: -2, reason: 'damage', occurredAt: '2026-09-27T02:00:00.000Z' }]);
  });
});
```

- [ ] **Step 13: 실패 확인**

Run: `npx vitest run src/__tests__/api/erp-stock.test.ts`
Expected: FAIL — 라우트 모듈 없음

- [ ] **Step 14: 라우트 다섯 개 작성**

`src/app/api/erp/stock/route.ts`:
```ts
// GET /api/erp/stock — 활성 SKU별 원장 재고(집·RG입고중·RG) · 평가액 · 최근 lot 단가 · 옛 입고 단가
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { listStock } from '@/lib/erp/stock/queries';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ success: true, data: await listStock(getSourcingPool()) });
  } catch (e) {
    return erpError(e);
  }
}
```

`src/app/api/erp/stock/adjust/route.ts`:
```ts
// POST /api/erp/stock/adjust — 재고 조정(집·RG입고중). body { items: [{ skuId, location, mode, value, expected?, reason, note?, unitCost?, requestId }] }
// 여러 건(실사 모드)은 한 트랜잭션 — 하나라도 실패하면 전부 되돌리고 몇 번째인지(index) 알려준다.
// RG 위치는 여기서 고치지 않는다 — 「RG 실재고 대조」(/api/erp/stock/rg-reconcile)로만.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { applyAdjustments } from '@/lib/erp/ledger/adjust-store';
import { AdjustInputError, AdjustItemError, USER_REASONS, validateAdjustInput } from '@/lib/erp/ledger/adjust';
import { activeSkuIds } from '@/lib/erp/stock/queries';
import { badRequest, erpError, parseAdjustItem, withTx } from '@/lib/erp/stock/http';

const MAX_ITEMS = 300;
const EDITABLE: readonly string[] = ['self', 'rg_inbound'];
const REASONS: readonly string[] = USER_REASONS;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  const raw: unknown = body?.items;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) return badRequest(`items는 1~${MAX_ITEMS}건 배열이다`);
  const at = new Date().toISOString();
  try {
    const inputs = raw.map((b, i) => {
      const p = parseAdjustItem((b ?? {}) as Record<string, unknown>, at);
      try {
        if (!EDITABLE.includes(p.location)) throw new AdjustInputError('RG 위치는 「RG 실재고 대조」로만 고친다');
        if (!REASONS.includes(p.reason)) throw new AdjustInputError(`사유가 잘못됐다: ${String(p.reason)}`);
        validateAdjustInput(p);
      } catch (e) {
        throw new AdjustItemError(i, p.skuId, p.location, e);
      }
      return p;
    });
    const active = await activeSkuIds(getSourcingPool());
    inputs.forEach((p, i) => {
      if (!active.has(p.skuId)) throw new AdjustItemError(i, p.skuId, p.location, new AdjustInputError(`활성 SKU가 아니다: ${p.skuId}`));
    });
    const results = await withTx((c) => applyAdjustments(c, inputs));
    return NextResponse.json({ success: true, data: results });
  } catch (e) {
    return erpError(e);
  }
}
```

`src/app/api/erp/stock/[skuId]/history/route.ts`:
```ts
// GET /api/erp/stock/[skuId]/history — SKU 입출 이력(최근 300건) · 되돌릴 수 있는 묶음 표시
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { skuHistory } from '@/lib/erp/stock/queries';
import { badRequest, erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ skuId: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const { skuId } = await params;
  const id = Number(skuId);
  if (!Number.isInteger(id) || id <= 0) return badRequest(`SKU id가 잘못됐다: ${skuId}`);
  try {
    return NextResponse.json({ success: true, data: await skuHistory(getSourcingPool(), id) });
  } catch (e) {
    return erpError(e);
  }
}
```

`src/app/api/erp/stock/reverse/route.ts`:
```ts
// POST /api/erp/stock/reverse — 조정·기초 전표 되돌리기(역전표). body { idemKey, note? }
// 영수증·RG 보내기 전표는 옛 원가 기록과 짝이라 여기서 되돌리지 않는다.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { reverse } from '@/lib/erp/ledger/store';
import { isReversibleKey } from '@/lib/erp/ledger/adjust';
import { badRequest, erpError, withTx } from '@/lib/erp/stock/http';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  const idemKey = body?.idemKey;
  if (typeof idemKey !== 'string' || !isReversibleKey(idemKey)) return badRequest('되돌릴 수 있는 것은 조정(adj:)·기초(opening:) 전표뿐이다');
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : '화면에서 되돌림';
  try {
    const r = await withTx((c) => reverse(c, idemKey, { occurredAt: new Date().toISOString(), note }));
    if (!r.posted) return NextResponse.json({ success: false, code: 'already', error: '이미 되돌린 전표다' }, { status: 409 });
    return NextResponse.json({ success: true, data: { ids: r.ids } });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('되돌릴 전표가 없다')) {
      return NextResponse.json({ success: false, code: 'not_found', error: e.message }, { status: 404 });
    }
    return erpError(e);
  }
}
```

`src/app/api/erp/stock/recent/route.ts`:
```ts
// GET /api/erp/stock/recent?limit=5 — 최근 조정(요청 단위, 되돌렸으면 증감 0). 휴대폰 「최근 수정」
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { recentAdjustments } from '@/lib/erp/stock/queries';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const n = Number(request.nextUrl.searchParams.get('limit') ?? '5');
  const limit = Number.isInteger(n) ? Math.min(Math.max(n, 1), 20) : 5;
  try {
    return NextResponse.json({ success: true, data: await recentAdjustments(getSourcingPool(), limit) });
  } catch (e) {
    return erpError(e);
  }
}
```

- [ ] **Step 15: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/api/erp-stock.test.ts && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/app/api/erp/stock/route.ts src/app/api/erp/stock/adjust src/app/api/erp/stock/\[skuId\] src/app/api/erp/stock/reverse src/app/api/erp/stock/recent src/__tests__/api/erp-stock.test.ts
git commit -m "feat(erp): 재고 API — 목록·조정(여러 건 한 트랜잭션)·이력·되돌리기·최근"
```

#### 3-E. RG 대조 라우트

- [ ] **Step 16: 실패하는 테스트 작성**

`src/__tests__/api/erp-stock-rg.test.ts`:
```ts
// src/__tests__/api/erp-stock-rg.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockGetPool, mockApply, mockFetchRg, mockLinks } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetPool: vi.fn(),
  mockApply: vi.fn(),
  mockFetchRg: vi.fn(),
  mockLinks: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));
vi.mock('@/lib/erp/ledger/opening-db', () => ({ fetchRgStock: mockFetchRg, readRgLinks: mockLinks, readDb: vi.fn() }));
vi.mock('@/lib/erp/ledger/adjust-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/erp/ledger/adjust-store')>()),
  applyAdjustments: mockApply,
}));

const REQ = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), release: vi.fn() };
  mockGetPool.mockReturnValue({
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith('select sku_id, qty from erp.stock_on_hand')) return { rows: [{ sku_id: '7', qty: 5 }], rowCount: 1 };
      if (sql.startsWith("select id from erp.skus where status = 'active'")) return { rows: [{ id: 7 }, { id: 9 }], rowCount: 2 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 50)}`);
    }),
    connect: vi.fn(async () => client),
  });
  mockLinks.mockResolvedValue([{ vid: '111', skuId: 7, multiplier: 1 }, { vid: '222', skuId: 9, multiplier: 2 }]);
  mockFetchRg.mockResolvedValue([{ vid: '111', qty: 4 }, { vid: '222', qty: 1 }, { vid: '333', qty: 2 }]);
});

describe('GET /api/erp/stock/rg-reconcile', () => {
  it('로그인하지 않으면 401이고 쿠팡을 부르지 않는다', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/erp/stock/rg-reconcile/route');
    expect((await GET(new NextRequest('http://localhost/api/erp/stock/rg-reconcile'))).status).toBe(401);
    expect(mockFetchRg).not.toHaveBeenCalled();
  });

  it('SKU별 원장 RG와 실재고(배수 환산)를 돌려주고 미매핑 vid는 이슈로', async () => {
    const { GET } = await import('@/app/api/erp/stock/rg-reconcile/route');
    const json = await (await GET(new NextRequest('http://localhost/api/erp/stock/rg-reconcile'))).json();
    expect(json.data.rows).toEqual([{ skuId: 7, ledger: 5, actual: 4 }, { skuId: 9, ledger: 0, actual: 2 }]);
    expect(json.data.issues).toEqual([expect.objectContaining({ kind: 'rg_vid_unmapped', ref: '333' })]);
    expect(json.data.inactive).toEqual([]);
  });
});

describe('POST /api/erp/stock/rg-reconcile', () => {
  it('확인한 행을 RG 위치 지금개수 조정(사유 rg_reconcile)으로 한 트랜잭션에 반영한다', async () => {
    mockApply.mockResolvedValue([]);
    const { POST } = await import('@/app/api/erp/stock/rg-reconcile/route');
    const res = await POST(new NextRequest('http://localhost/api/erp/stock/rg-reconcile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ skuId: 7, expected: 5, actual: 4, requestId: REQ, unitCost: null }] }),
    }));
    expect(res.status).toBe(200);
    expect(mockApply.mock.calls[0][1]).toEqual([{
      skuId: 7, location: 'rg', mode: 'count', value: 4, expected: 5, reason: 'rg_reconcile', note: 'RG 실재고 대조',
      unitCost: undefined, requestId: REQ, occurredAt: expect.any(String),
    }]);
  });

  it('활성이 아닌 SKU는 400', async () => {
    const { POST } = await import('@/app/api/erp/stock/rg-reconcile/route');
    const res = await POST(new NextRequest('http://localhost/api/erp/stock/rg-reconcile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ skuId: 11, expected: 0, actual: 1, requestId: REQ }] }),
    }));
    expect(res.status).toBe(400);
    expect(mockApply).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 17: 실패 확인**

Run: `npx vitest run src/__tests__/api/erp-stock-rg.test.ts`
Expected: FAIL — 라우트 모듈 없음

- [ ] **Step 18: 구현**

`src/app/api/erp/stock/rg-reconcile/route.ts`:
```ts
// GET  /api/erp/stock/rg-reconcile — 쿠팡 RG 판매 가능 재고 ↔ 원장 RG(SKU별). 원장은 쓰지 않는다.
// POST /api/erp/stock/rg-reconcile — 사람이 확인한 행만 원장 RG를 실재고로 맞춘다(지금 개수 조정 · 사유 rg_reconcile).
//      body { items: [{ skuId, expected(화면의 원장 RG), actual(화면의 실재고), requestId, unitCost? }] }
// 1-C1에서는 자동 반영하지 않는다 — 판매 차감이 없어 RG 판매가 차이로 보인다(자동 입고 완료·7일 경보는 1-C2).
// 웹에서는 RG 매핑 이슈를 경고로만 보인다(docs/erp/opening-overrides.json의 ignoreRgVids는 스크립트 전용).
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { rgOutsideActive, rgQtyBySku } from '@/lib/erp/ledger/opening';
import { fetchRgStock, readRgLinks } from '@/lib/erp/ledger/opening-db';
import { applyAdjustments } from '@/lib/erp/ledger/adjust-store';
import { AdjustInputError, AdjustItemError, validateAdjustInput } from '@/lib/erp/ledger/adjust';
import { activeSkuIds, rgLedgerBySku, type RgReconResponse } from '@/lib/erp/stock/queries';
import { badRequest, erpError, parseAdjustItem, withTx } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const MAX_ITEMS = 300;

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    const pool = getSourcingPool();
    const [ledger, links, active] = await Promise.all([rgLedgerBySku(pool), readRgLinks(pool), activeSkuIds(pool)]);
    const rg = rgQtyBySku(links, await fetchRgStock(), new Set());
    const ids = [...new Set([...ledger.keys(), ...rg.bySku.keys()])].filter((id) => active.has(id)).sort((a, b) => a - b);
    const data: RgReconResponse = {
      fetchedAt: new Date().toISOString(),
      rows: ids.map((skuId) => ({ skuId, ledger: ledger.get(skuId) ?? 0, actual: rg.bySku.get(skuId) ?? 0 })),
      issues: rg.issues,
      inactive: rgOutsideActive(rg.bySku, active),
    };
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return erpError(e);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  const raw: unknown = body?.items;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) return badRequest(`items는 1~${MAX_ITEMS}건 배열이다`);
  const at = new Date().toISOString();
  try {
    const inputs = raw.map((b, i) => {
      const o = (b ?? {}) as Record<string, unknown>;
      const p = parseAdjustItem({ ...o, value: o.actual }, at, { location: 'rg', mode: 'count', reason: 'rg_reconcile', note: 'RG 실재고 대조' });
      try {
        validateAdjustInput(p);
      } catch (e) {
        throw new AdjustItemError(i, p.skuId, p.location, e);
      }
      return p;
    });
    const active = await activeSkuIds(getSourcingPool());
    inputs.forEach((p, i) => {
      if (!active.has(p.skuId)) throw new AdjustItemError(i, p.skuId, p.location, new AdjustInputError(`활성 SKU가 아니다: ${p.skuId}`));
    });
    const results = await withTx((c) => applyAdjustments(c, inputs));
    return NextResponse.json({ success: true, data: results });
  } catch (e) {
    return erpError(e);
  }
}
```

- [ ] **Step 19: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/api/erp-stock-rg.test.ts && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/app/api/erp/stock/rg-reconcile src/__tests__/api/erp-stock-rg.test.ts
git commit -m "feat(erp): RG 실재고 대조 API — 읽기 · 확인한 행만 반영(rg_reconcile)"
```

#### 3-F. 실사표 불러오기 라우트

- [ ] **Step 20: 실패하는 테스트 작성**

`src/__tests__/api/erp-stock-import.test.ts`:
```ts
// src/__tests__/api/erp-stock-import.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { toCsv, type CountRow } from '@/lib/erp/ledger/opening';

const { mockGetCurrentUser, mockGetPool, mockReadDb, mockFetchRg, mockCommit } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetPool: vi.fn(),
  mockReadDb: vi.fn(),
  mockFetchRg: vi.fn(),
  mockCommit: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));
vi.mock('@/lib/erp/ledger/opening-db', () => ({ readDb: mockReadDb, fetchRgStock: mockFetchRg, readRgLinks: vi.fn() }));
vi.mock('@/lib/erp/ledger/opening-import', async (orig) => ({
  ...(await orig<typeof import('@/lib/erp/ledger/opening-import')>()),
  commitOpeningImport: mockCommit,
}));

const row = (o: Partial<CountRow>): CountRow => ({
  skuId: 7, skuKey: 'k7', name: '왜건', option: '블랙', group: 'g1', rgActual: 0, selfEstimate: null, selfCount: 0, rgInbound: 0, unitCost: null, note: '', ...o,
});
const CSV = toCsv([row({ selfCount: 3 }), row({ skuId: 9, skuKey: 'k9', name: '타월', option: '', group: 'g2', selfCount: 1 })]);
let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

const post = (body: unknown) =>
  new NextRequest('http://localhost/api/erp/stock/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), release: vi.fn() };
  mockGetPool.mockReturnValue({
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith('select distinct sku_id from erp.stock_ledger')) return { rows: [], rowCount: 0 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 50)}`);
    }),
    connect: vi.fn(async () => client),
  });
  mockReadDb.mockResolvedValue({
    skus: [
      { id: 7, key: 'k7', name: '왜건', optionLabel: '블랙', legacyProductCostIds: ['pc-7'], baseUnitLabel: null },
      { id: 9, key: 'k9', name: '타월', optionLabel: '', legacyProductCostIds: [], baseUnitLabel: null },
    ],
    links: [{ vid: '111', skuId: 7, multiplier: 1 }],
    legacy: [{ productCostId: 'pc-7', entries: [{ receivedAt: '2026-09-01', quantity: 10, unitCost: 1000 }], soldQty: 0, voidedQty: 0 }],
    baseUnitMissing: [],
  });
  mockFetchRg.mockResolvedValue([{ vid: '111', qty: 2 }]);
  mockCommit.mockResolvedValue(3);
});

describe('POST /api/erp/stock/import', () => {
  it('로그인하지 않으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { POST } = await import('@/app/api/erp/stock/import/route');
    expect((await POST(post({ csv: CSV, countedAt: new Date().toISOString(), commit: false }))).status).toBe(401);
  });

  it('머리글이 다른 CSV는 400', async () => {
    const { POST } = await import('@/app/api/erp/stock/import/route');
    expect((await POST(post({ csv: 'a,b\n1,2', countedAt: new Date().toISOString(), commit: false }))).status).toBe(400);
  });

  it('미리보기: 단가를 모르는 SKU는 오류로, 합계는 지금 RG 포함', async () => {
    const { POST } = await import('@/app/api/erp/stock/import/route');
    const json = await (await POST(post({ csv: CSV, fileName: 'count.csv', countedAt: new Date().toISOString(), commit: false }))).json();
    expect(json.data.committed).toBe(0);
    expect(json.data.errors.join('\n')).toContain('단가를 모른다: k9');
    expect(json.data.totals).toMatchObject({ self: 3, rg: 2, value: 5000 });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('오류가 있으면 commit=true여도 적재하지 않는다', async () => {
    const { POST } = await import('@/app/api/erp/stock/import/route');
    const json = await (await POST(post({ csv: CSV, countedAt: new Date().toISOString(), commit: true }))).json();
    expect(json.data.committed).toBe(0);
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('단가를 입력하면 한 트랜잭션으로 적재한다', async () => {
    const { POST } = await import('@/app/api/erp/stock/import/route');
    const json = await (await POST(post({ csv: CSV, fileName: 'count.csv', countedAt: new Date().toISOString(), unitCostOverrides: { k9: 800 }, commit: true }))).json();
    expect(json.data.errors).toEqual([]);
    expect(json.data.committed).toBe(3);
    const [db, plan, opts] = mockCommit.mock.calls[0];
    expect(db).toBe(client);
    expect(plan).toEqual([
      { skuId: 7, key: 'k7', location: 'self', qty: 3, unitCost: 1000 },
      { skuId: 7, key: 'k7', location: 'rg', qty: 2, unitCost: 1000 },
      { skuId: 9, key: 'k9', location: 'self', qty: 1, unitCost: 800 },
    ]);
    expect(opts).toEqual({ fileName: 'count.csv', cutoverAt: json.data.cutoverAt });
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'COMMIT']);
  });

  it('실사 시각이 24시간 넘게 지났으면 오류', async () => {
    const { POST } = await import('@/app/api/erp/stock/import/route');
    const old = new Date(Date.now() - 48 * 3600_000).toISOString();
    const json = await (await POST(post({ csv: CSV, countedAt: old, unitCostOverrides: { k9: 800 }, commit: true }))).json();
    expect(json.data.errors.join('\n')).toContain('24시간');
    expect(mockCommit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 21: 실패 확인**

Run: `npx vitest run src/__tests__/api/erp-stock-import.test.ts`
Expected: FAIL — 라우트 모듈 없음

- [ ] **Step 22: 구현**

`src/app/api/erp/stock/import/route.ts`:
```ts
// POST /api/erp/stock/import — 실사표(CSV) 불러오기 = 기초재고.
// body { csv, fileName, countedAt(오프셋 있는 ISO), unitCostOverrides?: { [skuKey]: 원 }, commit }
// commit=false: 미리보기(합계·오류·경고·제외·단가). commit=true: 오류가 없을 때만 한 트랜잭션으로 kind='opening' 적재.
// 요청마다 CSV·DB·쿠팡 RG 재고를 새로 읽는다(서버에 상태를 두지 않는다) — RG 칸은 이 요청 시점의 API 값이다.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { parseCountCsv, rgQtyBySku, type CountRow } from '@/lib/erp/ledger/opening';
import { fetchRgStock, readDb } from '@/lib/erp/ledger/opening-db';
import { commitOpeningImport, planOpeningImport, type ImportSummary } from '@/lib/erp/ledger/opening-import';
import { stockedSkuIds } from '@/lib/erp/stock/queries';
import { badRequest, erpError, withTx } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  const csv: unknown = body?.csv;
  if (typeof csv !== 'string' || csv.trim() === '' || csv.length > 2_000_000) return badRequest('csv(실사표 내용)가 없다');
  if (typeof body?.countedAt !== 'string') return badRequest('countedAt(실사를 마친 시각)이 없다');
  const countedAt: string = body.countedAt;
  const fileName = (typeof body?.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : 'opening.csv').slice(0, 120);
  const overrides: Record<string, number> = {};
  if (body?.unitCostOverrides && typeof body.unitCostOverrides === 'object') {
    for (const [k, v] of Object.entries(body.unitCostOverrides as Record<string, unknown>)) overrides[k] = Number(v);
  }
  let rows: CountRow[];
  try {
    rows = parseCountCsv(csv);
  } catch (e) {
    return badRequest((e as Error).message);
  }

  try {
    const pool = getSourcingPool();
    const db = await readDb(pool);
    const stocked = await stockedSkuIds(pool);
    // 기준 시각 = RG 재고를 읽기 직전(1-B opening-apply와 같다) — 1-C2 판매 소급의 시작점
    const cutoverAt = new Date().toISOString();
    const rg = rgQtyBySku(db.links, await fetchRgStock(), new Set());
    const p = planOpeningImport({
      rows, skus: db.skus, legacy: db.legacy, rgBySku: rg.bySku, rgIssues: rg.issues,
      stockedSkuIds: stocked, overrides, countedAt, now: new Date(cutoverAt),
    });
    const summary: ImportSummary = {
      committed: 0, cutoverAt, totals: p.totals, errors: p.errors, warnings: p.warnings, excluded: p.excluded, costs: p.costs,
    };
    if (body.commit !== true || p.errors.length > 0) return NextResponse.json({ success: true, data: summary });
    const committed = await withTx((c) => commitOpeningImport(c, p.plan, { fileName, cutoverAt }));
    return NextResponse.json({ success: true, data: { ...summary, committed } });
  } catch (e) {
    return erpError(e);
  }
}
```

- [ ] **Step 23: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/api/erp-stock-import.test.ts src/__tests__/lib/erp && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/app/api/erp/stock/import src/__tests__/api/erp-stock-import.test.ts
git commit -m "feat(erp): 실사표 불러오기 API — 미리보기·단가 입력·오류 없을 때만 한 트랜잭션 적재"
```

---
### Task 4: PC 재고현황 `/erp/stock`

**Files:**
- Create: `src/app/erp/layout.tsx`, `src/app/erp/page.tsx`, `src/app/erp/stock/page.tsx`
- Modify: `src/lib/nav-items.tsx`, `src/__tests__/lib/nav-items.test.ts`
- Create: `src/components/erp/stock/stock-view.ts`, `src/components/erp/stock/api.ts`, `src/components/erp/stock/StockClient.tsx`, `src/components/erp/stock/StockTable.tsx`, `src/components/erp/stock/EditCell.tsx`, `src/components/erp/stock/HistoryPanel.tsx`, `src/components/erp/stock/CsvImportDialog.tsx`
- Test: `src/__tests__/components/erp-stock-view.test.ts`, `src/__tests__/components/erp-stock-edit-cell.test.tsx`

#### 4-A. 화면 순수 계산과 서버 호출

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/components/erp-stock-view.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  computeKpis, defaultCost, editDiff, filterRows, localInputToIso, summarizeStaged, toAdjustItems, toExportCsv,
  type RgRecon, type StagedEdit, type StockRow,
} from '@/components/erp/stock/stock-view';

const row = (o: Partial<StockRow> = {}): StockRow => ({
  skuId: 1, key: 'cp:1:블랙', name: '왜건', option: '블랙', legacyProductCostIds: [], self: 3, rgInbound: 0, rg: 2, value: 5000,
  hasLedger: true, lotCost: 1000, legacyCost: null, ...o,
});
const recon: RgRecon = { fetchedAt: '2026-09-27T01:00:00Z', actual: new Map([[1, 4]]), issues: [], inactive: [] };
const edit = (o: Partial<StagedEdit> = {}): StagedEdit => ({
  skuId: 1, location: 'self', mode: 'count', value: 5, expected: 3, reason: 'count_diff', note: '', unitCost: null, ...o,
});

describe('filterRows', () => {
  const rows = [row(), row({ skuId: 2, key: 'cp:2:레드', name: '매트', option: '레드', self: 0, rg: 0, value: 0 })];
  it('상품·옵션·키로 찾는다(대소문자 무시)', () => {
    expect(filterRows(rows, { q: '레드', onlyStocked: false, onlyRgMismatch: false }, null).map((r) => r.skuId)).toEqual([2]);
    expect(filterRows(rows, { q: 'CP:1', onlyStocked: false, onlyRgMismatch: false }, null).map((r) => r.skuId)).toEqual([1]);
  });
  it('재고 있는 것만 · RG 불일치만', () => {
    expect(filterRows(rows, { q: '', onlyStocked: true, onlyRgMismatch: false }, null).map((r) => r.skuId)).toEqual([1]);
    expect(filterRows(rows, { q: '', onlyStocked: false, onlyRgMismatch: true }, recon).map((r) => r.skuId)).toEqual([1]);
  });
});

describe('computeKpis', () => {
  it('위치별 합계·평가액, 대조 전에는 불일치 null', () => {
    expect(computeKpis([row(), row({ skuId: 2, self: 1, rgInbound: 2, rg: 0, value: 700 })], null))
      .toEqual({ total: 8, self: 4, rgInbound: 2, rg: 2, value: 5700, rgMismatch: null });
    expect(computeKpis([row()], recon).rgMismatch).toBe(1);
  });
});

describe('편집', () => {
  it('지금 개수는 화면 재고와의 차이, ±수량은 그대로', () => {
    expect(editDiff(edit())).toBe(2);
    expect(editDiff(edit({ mode: 'delta', value: -2 }))).toBe(-2);
  });
  it('단가 기본값은 최근 lot → 옛 입고', () => {
    expect(defaultCost(row())).toBe(1000);
    expect(defaultCost(row({ lotCost: null, legacyCost: 800 }))).toBe(800);
  });
  it('요청 본문: count만 expected를 싣고 요청마다 새 id', () => {
    let n = 0;
    const ids = () => `id-${n++}`;
    expect(toAdjustItems([edit({ note: '박스 파손', unitCost: 900 }), edit({ skuId: 2, mode: 'delta', value: -1, reason: 'damage' })], ids)).toEqual([
      { skuId: 1, location: 'self', mode: 'count', value: 5, expected: 3, reason: 'count_diff', note: '박스 파손', unitCost: 900, requestId: 'id-0' },
      { skuId: 2, location: 'self', mode: 'delta', value: -1, reason: 'damage', unitCost: null, requestId: 'id-1' },
    ]);
  });
  it('실사 모드 요약: 늘림·줄임·평가액 영향(추정)', () => {
    const byId = new Map([[1, row()], [2, row({ skuId: 2, lotCost: 500 })]]);
    expect(summarizeStaged([edit({ unitCost: 1200 }), edit({ skuId: 2, value: 1, expected: 3 })], byId))
      .toEqual({ count: 2, plus: 2, minus: 2, valueDelta: 2 * 1200 - 2 * 500 });
  });
});

describe('내보내기', () => {
  it('BOM + 머리글 + 대조값', () => {
    const csv = toExportCsv([row()], recon);
    expect(csv.startsWith('﻿sku_key,상품,옵션,집,RG입고중,RG(원장),RG실재고,차이,단가,평가액\n')).toBe(true);
    expect(csv).toContain('cp:1:블랙,왜건,블랙,3,0,2,4,2,1000,5000');
  });
  it('datetime-local 값은 KST 오프셋 ISO로', () => {
    expect(localInputToIso('2026-09-27T09:30')).toBe('2026-09-27T09:30:00+09:00');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/components/erp-stock-view.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/components/erp/stock/api.ts`:
```ts
// src/components/erp/stock/api.ts
// 재고 화면의 서버 호출. 실패는 던지지 않고 { ok: false }로 돌려준다 — 화면이 메시지를 그대로 보인다.
import type { AdjustResult } from '@/lib/erp/ledger/adjust-store';
import type { HistoryRow, RecentAdjust, RgReconResponse, StockListRow } from '@/lib/erp/stock/queries';
import type { ImportSummary } from '@/lib/erp/ledger/opening-import';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; code?: string; index?: number };

export interface AdjustItemBody {
  skuId: number;
  location: 'self' | 'rg_inbound';
  mode: 'count' | 'delta';
  value: number;
  expected?: number;
  reason: string;
  note?: string;
  unitCost: number | null;
  requestId: string;
}

export interface RgApplyItem {
  skuId: number;
  expected: number;
  actual: number;
  requestId: string;
  unitCost: number | null;
}

export interface ImportBody {
  csv: string;
  fileName: string;
  countedAt: string;
  unitCostOverrides: Record<string, number>;
  commit: boolean;
}

async function call<T>(url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(
      url,
      body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      return { ok: false, status: res.status, error: json?.error ?? `요청 실패 (${res.status})`, code: json?.code, index: json?.index };
    }
    return { ok: true, data: json.data as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : '네트워크 오류' };
  }
}

export const fetchStock = () => call<StockListRow[]>('/api/erp/stock');
export const postAdjust = (items: AdjustItemBody[]) => call<AdjustResult[]>('/api/erp/stock/adjust', { items });
export const fetchHistory = (skuId: number) => call<HistoryRow[]>(`/api/erp/stock/${skuId}/history`);
export const postReverse = (idemKey: string) => call<{ ids: number[] }>('/api/erp/stock/reverse', { idemKey });
export const fetchRecent = (limit: number) => call<RecentAdjust[]>(`/api/erp/stock/recent?limit=${limit}`);
export const fetchRecon = () => call<RgReconResponse>('/api/erp/stock/rg-reconcile');
export const postRgApply = (items: RgApplyItem[]) => call<AdjustResult[]>('/api/erp/stock/rg-reconcile', { items });
export const postImport = (body: ImportBody) => call<ImportSummary>('/api/erp/stock/import', body);
```

`src/components/erp/stock/stock-view.ts`:
```ts
// src/components/erp/stock/stock-view.ts
// 재고현황 화면의 순수 계산 — 필터·KPI·편집 차이·요청 본문·내보내기. 컴포넌트는 그리기만 한다(PC·휴대폰 공용).
import type { StockListRow, RgReconResponse } from '@/lib/erp/stock/queries';
import type { OpeningIssue } from '@/lib/erp/ledger/opening';
import type { UserReason } from '@/lib/erp/ledger/adjust';
import type { AdjustItemBody } from './api';

export type StockRow = StockListRow;
/** 사람이 고치는 위치. RG는 「RG 실재고 대조」로만 고친다 */
export type EditLocation = 'self' | 'rg_inbound';

export interface RgRecon {
  fetchedAt: string;
  actual: Map<number, number>;
  issues: OpeningIssue[];
  inactive: { skuId: number; qty: number }[];
}

export interface Filters {
  q: string;
  onlyStocked: boolean;
  onlyRgMismatch: boolean;
}

export interface StagedEdit {
  skuId: number;
  location: EditLocation;
  mode: 'count' | 'delta';
  value: number;
  /** 편집을 시작할 때 화면이 본 원장 재고 — 서버가 다르면 409 */
  expected: number;
  reason: UserReason;
  note: string;
  /** 늘어날 때만 */
  unitCost: number | null;
}

export const won = (n: number) => n.toLocaleString('ko-KR');
export const stageKey = (skuId: number, loc: EditLocation) => `${skuId}:${loc}`;
export const defaultCost = (r: StockRow): number | null => r.lotCost ?? r.legacyCost;
export const onHandAt = (r: StockRow, loc: EditLocation): number => (loc === 'self' ? r.self : r.rgInbound);
export const totalOf = (r: StockRow): number => r.self + r.rgInbound + r.rg;
export const LOC_LABEL: Record<'self' | 'rg_inbound' | 'rg', string> = { self: '집', rg_inbound: 'RG입고중', rg: 'RG' };

export function rgActual(r: StockRow, recon: RgRecon | null): number | null {
  return recon ? (recon.actual.get(r.skuId) ?? 0) : null;
}

export function rgDiff(r: StockRow, recon: RgRecon | null): number | null {
  const a = rgActual(r, recon);
  return a === null ? null : a - r.rg;
}

export function editDiff(e: Pick<StagedEdit, 'mode' | 'value' | 'expected'>): number {
  return e.mode === 'count' ? e.value - e.expected : e.value;
}

export function filterRows(rows: StockRow[], f: Filters, recon: RgRecon | null): StockRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !`${r.name} ${r.option} ${r.key}`.toLowerCase().includes(q)) return false;
    if (f.onlyStocked && totalOf(r) === 0) return false;
    if (f.onlyRgMismatch && !rgDiff(r, recon)) return false;
    return true;
  });
}

export interface Kpis {
  total: number;
  self: number;
  rgInbound: number;
  rg: number;
  value: number;
  /** 대조 전이면 null */
  rgMismatch: number | null;
}

export function computeKpis(rows: StockRow[], recon: RgRecon | null): Kpis {
  const sum = (f: (r: StockRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  return {
    total: sum(totalOf),
    self: sum((r) => r.self),
    rgInbound: sum((r) => r.rgInbound),
    rg: sum((r) => r.rg),
    value: sum((r) => r.value),
    rgMismatch: recon ? rows.filter((r) => rgDiff(r, recon) !== 0).length : null,
  };
}

/** 편집 → /api/erp/stock/adjust 본문. 요청마다 새 id(멱등 — 두 번 눌러도 한 번만 기록된다) */
export function toAdjustItems(list: StagedEdit[], newId: () => string): AdjustItemBody[] {
  return list.map((e) => ({
    skuId: e.skuId,
    location: e.location,
    mode: e.mode,
    value: e.value,
    ...(e.mode === 'count' ? { expected: e.expected } : {}),
    reason: e.reason,
    ...(e.note ? { note: e.note } : {}),
    unitCost: e.unitCost,
    requestId: newId(),
  }));
}

/** 실사 모드 저장 전 확인 창의 숫자. 평가액 영향은 추정(줄 때는 최근 단가, 늘 때는 입력 단가) */
export function summarizeStaged(list: StagedEdit[], rowById: Map<number, StockRow>): { count: number; plus: number; minus: number; valueDelta: number } {
  let plus = 0;
  let minus = 0;
  let valueDelta = 0;
  for (const e of list) {
    const d = editDiff(e);
    const row = rowById.get(e.skuId);
    const base = row ? defaultCost(row) : null;
    const cost = d > 0 ? (e.unitCost ?? base ?? 0) : (base ?? 0);
    if (d > 0) plus += d;
    else minus += -d;
    valueDelta += d * cost;
  }
  return { count: list.length, plus, minus, valueDelta };
}

export function parseRecon(d: RgReconResponse): RgRecon {
  return { fetchedAt: d.fetchedAt, actual: new Map(d.rows.map((r) => [r.skuId, r.actual])), issues: d.issues, inactive: d.inactive };
}

const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 엑셀↓ — 지금 보이는 행 그대로. BOM을 붙여 엑셀이 한글을 깨지 않게 한다 */
export function toExportCsv(rows: StockRow[], recon: RgRecon | null): string {
  const head = ['sku_key', '상품', '옵션', '집', 'RG입고중', 'RG(원장)', 'RG실재고', '차이', '단가', '평가액'];
  const lines = rows.map((r) =>
    [r.key, r.name, r.option, r.self, r.rgInbound, r.rg, rgActual(r, recon), rgDiff(r, recon), defaultCost(r), r.value].map(csvCell).join(','),
  );
  return `﻿${[head.join(','), ...lines].join('\n')}\n`;
}

/** <input type="datetime-local">의 기본값(지금, KST) */
export function toKstLocalInput(d: Date): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 16);
}

/** 'YYYY-MM-DDTHH:mm'(KST) → 오프셋 있는 ISO */
export function localInputToIso(v: string): string {
  return `${v}:00+09:00`;
}

/** 이력·최근 수정의 시각 표시(KST, MM.DD HH:mm) */
export function fmtKst(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
```

- [ ] **Step 4: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/components/erp-stock-view.test.ts && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/components/erp/stock/stock-view.ts src/components/erp/stock/api.ts src/__tests__/components/erp-stock-view.test.ts
git commit -m "feat(erp): 재고 화면 순수 계산과 서버 호출"
```

#### 4-B. 칸 편집(EditCell)

- [ ] **Step 5: 실패하는 테스트 작성**

`src/__tests__/components/erp-stock-edit-cell.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EditCell from '@/components/erp/stock/EditCell';
import type { StockRow } from '@/components/erp/stock/stock-view';

const row: StockRow = {
  skuId: 1, key: 'cp:1:블랙', name: '왜건', option: '블랙', legacyProductCostIds: [], self: 10, rgInbound: 0, rg: 0, value: 7000,
  hasLedger: true, lotCost: 700, legacyCost: null,
};

describe('EditCell', () => {
  it('지금 개수를 적으면 차이를 보이고, 저장하면 count 편집을 넘긴다', () => {
    const onSubmit = vi.fn();
    render(<EditCell row={row} location="self" countMode={false} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('지금 개수'), { target: { value: '7' } });
    expect(screen.getByText('10 → 7 (-3)')).toBeInTheDocument();
    fireEvent.click(screen.getByText('저장'));
    expect(onSubmit).toHaveBeenCalledWith({ skuId: 1, location: 'self', mode: 'count', value: 7, expected: 10, reason: 'count_diff', note: '', unitCost: null });
  });

  it('±수량으로 늘리면 최근 lot 단가를 미리 채워 함께 넘긴다', () => {
    const onSubmit = vi.fn();
    render(<EditCell row={row} location="self" countMode={false} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('±수량'));
    fireEvent.change(screen.getByLabelText('±수량'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('사유'), { target: { value: 'return_in' } });
    expect(screen.getByLabelText('단가')).toHaveValue('700');
    fireEvent.click(screen.getByText('저장'));
    expect(onSubmit).toHaveBeenCalledWith({ skuId: 1, location: 'self', mode: 'delta', value: 2, expected: 10, reason: 'return_in', note: '', unitCost: 700 });
  });

  it('단가를 모르면 늘리는 저장이 막힌다', () => {
    render(<EditCell row={{ ...row, lotCost: null }} location="self" countMode={false} onSubmit={vi.fn()} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('지금 개수'), { target: { value: '12' } });
    expect(screen.getByText('저장')).toBeDisabled();
  });

  it('실사 모드에서는 「담기」', () => {
    render(<EditCell row={row} location="rg_inbound" countMode onSubmit={vi.fn()} onCancel={() => {}} />);
    expect(screen.getByText('담기')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/__tests__/components/erp-stock-edit-cell.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 7: 구현**

`src/components/erp/stock/EditCell.tsx`:
```tsx
'use client';

/**
 * 재고 칸 편집 팝오버. 기본은 「지금 개수」(원장과의 차이를 계산), 보조는 ±수량.
 * 늘어나면 새 lot 단가를 받는다 — 최근 lot → 옛 입고 단가를 미리 채우고 고칠 수 있다.
 * 실사 모드에서는 저장하지 않고 담는다(StockClient가 한 번에 저장한다).
 */
import React, { useState } from 'react';
import { E } from '@/lib/design-tokens';
import { btnStyle, inputStyle, primaryBtnStyle, segBtnStyle, segStyle } from '@/components/orders/erp-ui';
import { REASON_LABEL, USER_REASONS, type UserReason } from '@/lib/erp/ledger/adjust';
import { LOC_LABEL, defaultCost, editDiff, onHandAt, won, type EditLocation, type StagedEdit, type StockRow } from './stock-view';

interface Props {
  row: StockRow;
  location: EditLocation;
  staged?: StagedEdit;
  countMode: boolean;
  onSubmit: (e: StagedEdit) => void;
  onCancel: () => void;
}

export default function EditCell({ row, location, staged, countMode, onSubmit, onCancel }: Props) {
  const onHand = onHandAt(row, location);
  const initialCost = staged?.unitCost ?? defaultCost(row);
  const [mode, setMode] = useState<'count' | 'delta'>(staged?.mode ?? 'count');
  const [raw, setRaw] = useState(staged ? String(staged.value) : String(onHand));
  const [reason, setReason] = useState<UserReason>(staged?.reason ?? 'count_diff');
  const [note, setNote] = useState(staged?.note ?? '');
  const [costRaw, setCostRaw] = useState(initialCost === null ? '' : String(initialCost));

  const t = raw.trim();
  const value = /^-?\d+$/.test(t) ? Number(t) : null;
  const valid = value !== null && (mode === 'count' ? value >= 0 : value !== 0);
  const diff = valid ? editDiff({ mode, value: value as number, expected: onHand }) : 0;
  const cost = /^\d+$/.test(costRaw.trim()) ? Number(costRaw.trim()) : null;
  const needsCost = diff > 0 && cost === null;
  const canSubmit = valid && diff !== 0 && !needsCost;

  function switchMode(m: 'count' | 'delta') {
    setMode(m);
    setRaw(m === 'count' ? String(onHand) : '');
  }

  function submit() {
    if (!canSubmit || value === null) return;
    onSubmit({ skuId: row.skuId, location, mode, value, expected: onHand, reason, note: note.trim(), unitCost: diff > 0 ? cost : null });
  }

  return (
    <div
      role="dialog"
      aria-label={`${row.name} ${LOC_LABEL[location]} 재고 고치기`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter') submit();
      }}
      style={{
        position: 'absolute', top: '100%', right: 0, zIndex: 20, width: 260, padding: 10,
        background: E.surface, border: `1px solid ${E.line}`, boxShadow: '0 6px 18px rgba(0,0,0,.18)',
        textAlign: 'left', whiteSpace: 'normal', fontFamily: 'inherit', cursor: 'default', color: E.ink,
      }}
    >
      <div style={{ fontSize: 11, color: E.inkSub, marginBottom: 6 }}>
        {LOC_LABEL[location]} · 원장 {won(onHand)}개
      </div>
      <div style={{ ...segStyle, marginBottom: 6 }}>
        {(['count', 'delta'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            style={{ ...segBtnStyle, flex: 1, background: mode === m ? E.ink : E.surface, color: mode === m ? '#fff' : E.ink }}
          >
            {m === 'count' ? '지금 개수' : '±수량'}
          </button>
        ))}
      </div>
      <input
        autoFocus
        aria-label={mode === 'count' ? '지금 개수' : '±수량'}
        inputMode="numeric"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        style={{ ...inputStyle, width: '100%', fontFamily: E.mono }}
      />
      <div style={{ fontSize: 11, margin: '4px 0 6px', color: diff > 0 ? E.profit : diff < 0 ? E.loss : E.inkMute }}>
        {valid
          ? diff === 0 ? '차이 없음' : `${won(onHand)} → ${won(onHand + diff)} (${diff > 0 ? '+' : ''}${won(diff)})`
          : mode === 'count' ? '0 이상 정수' : '0이 아닌 정수(예: -2)'}
      </div>
      <select
        aria-label="사유"
        value={reason}
        onChange={(e) => setReason(e.target.value as UserReason)}
        style={{ ...inputStyle, width: '100%', marginBottom: 6 }}
      >
        {USER_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
      </select>
      {diff > 0 && (
        <label style={{ display: 'block', fontSize: 11, color: E.inkSub, marginBottom: 6 }}>
          늘어난 재고 단가(원)
          <input
            aria-label="단가"
            inputMode="numeric"
            value={costRaw}
            onChange={(e) => setCostRaw(e.target.value)}
            style={{ ...inputStyle, width: '100%', fontFamily: E.mono, borderColor: needsCost ? E.loss : E.line }}
          />
        </label>
      )}
      <input
        aria-label="메모"
        placeholder="메모(선택)"
        maxLength={200}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{ ...inputStyle, width: '100%', marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={btnStyle}>취소</button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          style={canSubmit ? primaryBtnStyle : { ...btnStyle, opacity: 0.5, cursor: 'not-allowed' }}
        >
          {countMode ? '담기' : '저장'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/components/erp-stock-edit-cell.test.tsx && npx tsc --noEmit`
Expected: 4건 PASS, 0 오류
```bash
git add src/components/erp/stock/EditCell.tsx src/__tests__/components/erp-stock-edit-cell.test.tsx
git commit -m "feat(erp): 재고 칸 편집 — 지금 개수/±수량 · 사유 · 늘 때 단가"
```

#### 4-C. 표·이력·불러오기·컨테이너

- [ ] **Step 9: `StockTable.tsx`**

```tsx
'use client';

/** 재고 표. 집·RG입고중 칸을 누르면 편집, 행을 누르면 우측 이력. RG 차이가 있으면 행마다 「반영」 */
import React from 'react';
import { E } from '@/lib/design-tokens';
import { Tag, bandStyle, btnStyle, numTdStyle, thStyle } from '@/components/orders/erp-ui';
import EditCell from './EditCell';
import {
  defaultCost, editDiff, rgActual, rgDiff, stageKey, won,
  type EditLocation, type RgRecon, type StagedEdit, type StockRow,
} from './stock-view';

interface Props {
  rows: StockRow[];
  recon: RgRecon | null;
  staged: Map<string, StagedEdit>;
  countMode: boolean;
  editing: { skuId: number; location: EditLocation } | null;
  selected: number | null;
  busy: boolean;
  onEdit: (skuId: number, location: EditLocation) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (e: StagedEdit) => void;
  onSelect: (skuId: number) => void;
  onRgApply: (row: StockRow) => void;
}

const HEADERS = ['상품', '옵션', '집', 'RG입고중', 'RG(원장)', 'RG실재고', '차이', '단가', '평가액'];

const textTd: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`, borderRight: `1px solid ${E.lineSoft}`, padding: '4px 8px',
  fontSize: 12, color: E.ink, whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis',
};

export default function StockTable({
  rows, recon, staged, countMode, editing, selected, busy, onEdit, onCancelEdit, onSubmitEdit, onSelect, onRgApply,
}: Props) {
  return (
    <div style={{ background: E.surface, border: `1px solid ${E.line}`, overflow: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
      <div style={bandStyle}>SKU별 재고 — 원장 기준 · 집·RG입고중 칸을 누르면 고칩니다 · 행을 누르면 입출 이력</div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>{HEADERS.map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const diff = rgDiff(r, recon);
            const actual = rgActual(r, recon);
            const cost = defaultCost(r);
            const cell = (loc: EditLocation) => {
              const s = staged.get(stageKey(r.skuId, loc));
              const value = loc === 'self' ? r.self : r.rgInbound;
              const isEditing = editing?.skuId === r.skuId && editing.location === loc;
              return (
                <td
                  title="눌러서 고칩니다"
                  onClick={(e) => { e.stopPropagation(); if (!isEditing) onEdit(r.skuId, loc); }}
                  style={{ ...numTdStyle, position: 'relative', cursor: 'pointer', background: s ? E.warnSoft : undefined }}
                >
                  {s ? (
                    <>
                      <span style={{ textDecoration: 'line-through', color: E.inkMute }}>{won(value)}</span>
                      {' → '}
                      <b>{won(value + editDiff(s))}</b>
                    </>
                  ) : won(value)}
                  {isEditing && (
                    <EditCell row={r} location={loc} staged={s} countMode={countMode} onSubmit={onSubmitEdit} onCancel={onCancelEdit} />
                  )}
                </td>
              );
            };
            return (
              <tr
                key={r.skuId}
                onClick={() => onSelect(r.skuId)}
                style={{ height: E.rowH, cursor: 'pointer', background: selected === r.skuId ? E.infoSoft : i % 2 ? E.chrome2 : E.surface }}
              >
                <td style={textTd} title={r.key}>
                  {r.name} {!r.hasLedger && <Tag tone={E.inkMute} title="원장 전표가 아직 없습니다 — 첫 「지금 개수」가 기초재고가 됩니다">원장 없음</Tag>}
                </td>
                <td style={textTd}>{r.option || '—'}</td>
                {cell('self')}
                {cell('rg_inbound')}
                <td style={numTdStyle}>{won(r.rg)}</td>
                <td style={numTdStyle}>{actual === null ? '—' : won(actual)}</td>
                <td style={{ ...numTdStyle, color: diff ? E.loss : E.inkMute }}>
                  {diff === null ? '—' : diff === 0 ? '0' : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {diff > 0 ? '+' : ''}{won(diff)}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => { e.stopPropagation(); onRgApply(r); }}
                        style={{ ...btnStyle, height: 20, padding: '0 6px', fontSize: 10.5 }}
                      >
                        반영
                      </button>
                    </span>
                  )}
                </td>
                <td style={numTdStyle}>{cost === null ? '—' : won(cost)}</td>
                <td style={numTdStyle}>{won(r.value)}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={HEADERS.length} style={{ padding: 24, textAlign: 'center', color: E.inkMute, fontSize: 12 }}>표시할 SKU가 없습니다</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 10: `HistoryPanel.tsx`**

```tsx
'use client';

/** 우측 입출 이력. 조정·기초 묶음(같은 원 멱등키)마다 「되돌리기」 하나 — 역전표를 남긴다 */
import React, { useCallback, useEffect, useState } from 'react';
import { Undo2, X } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { bandStyle, btnStyle, numTdStyle, thStyle } from '@/components/orders/erp-ui';
import { REASON_LABEL } from '@/lib/erp/ledger/adjust';
import type { HistoryRow } from '@/lib/erp/stock/queries';
import { fetchHistory, postReverse } from './api';
import { LOC_LABEL, fmtKst, won, type StockRow } from './stock-view';

const KIND_LABEL: Record<string, string> = {
  opening: '기초', receipt: '입고', transfer: '이동', sale: '판매', return: '반품', adjust: '조정', reversal: '되돌림',
};

const td: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`, borderRight: `1px solid ${E.lineSoft}`, padding: '4px 6px', fontSize: 11.5, whiteSpace: 'nowrap',
};

interface Props {
  row: StockRow;
  refreshKey: number;
  onClose: () => void;
  onChanged: () => void;
}

export default function HistoryPanel({ row, refreshKey, onClose, onChanged }: Props) {
  const [items, setItems] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchHistory(row.skuId);
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setItems(r.data);
  }, [row.skuId]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load, refreshKey]);

  async function undo(h: HistoryRow) {
    const group = (items ?? []).filter((x) => x.baseKey === h.baseKey);
    const qty = group.reduce((s, x) => s + x.qty, 0);
    const ok = await confirmDialog({
      message: `이 ${KIND_LABEL[h.kind] ?? h.kind} 전표를 되돌립니다(지우지 않고 역전표를 남깁니다).\n\n${LOC_LABEL[h.location]} ${qty > 0 ? '+' : ''}${won(qty)}개${h.reason ? ` · ${REASON_LABEL[h.reason]}` : ''}`,
      confirmLabel: '되돌리기',
      danger: true,
    });
    if (!ok) return;
    setBusyKey(h.baseKey);
    const r = await postReverse(h.baseKey);
    setBusyKey(null);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('되돌렸습니다');
    onChanged();
  }

  const shown = new Set<string>();
  return (
    <aside style={{ width: 420, flexShrink: 0, background: E.surface, border: `1px solid ${E.line}`, maxHeight: 'calc(100vh - 300px)', overflow: 'auto' }}>
      <div style={{ ...bandStyle, justifyContent: 'space-between' }}>
        <span>입출 이력 — {row.name}{row.option ? ` · ${row.option}` : ''}</span>
        <button type="button" aria-label="이력 닫기" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex' }}>
          <X size={13} color={E.inkSub} />
        </button>
      </div>
      {error && <div role="alert" style={{ padding: 10, color: E.loss, fontSize: 12 }}>{error}</div>}
      {!items && !error && <div style={{ padding: 10, color: E.inkMute, fontSize: 12 }}>불러오는 중…</div>}
      {items && items.length === 0 && <div style={{ padding: 10, color: E.inkMute, fontSize: 12 }}>원장 전표가 없습니다</div>}
      {items && items.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>{['시각', '위치', '종류', '수량', '단가', '사유 · 메모', ''].map((h, i) => <th key={i} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {items.map((h) => {
              const first = !shown.has(h.baseKey);
              shown.add(h.baseKey);
              return (
                <tr key={h.id} style={{ color: h.kind === 'reversal' || h.reversed ? E.inkMute : E.ink }}>
                  <td style={td}>{fmtKst(h.occurredAt)}</td>
                  <td style={td}>{LOC_LABEL[h.location]}</td>
                  <td style={td}>{KIND_LABEL[h.kind] ?? h.kind}{h.reversed ? ' (되돌림)' : ''}</td>
                  <td style={{ ...numTdStyle, fontSize: 11.5, color: h.qty < 0 ? E.loss : E.profit }}>{h.qty > 0 ? '+' : ''}{won(h.qty)}</td>
                  <td style={{ ...numTdStyle, fontSize: 11.5 }}>{h.unitCost === null ? '—' : won(h.unitCost)}</td>
                  <td style={{ ...td, whiteSpace: 'normal', maxWidth: 140 }}>
                    {h.reason ? REASON_LABEL[h.reason] : ''}{h.reason && h.note ? ' · ' : ''}{h.note ?? ''}
                  </td>
                  <td style={td}>
                    {h.reversible && first && (
                      <button
                        type="button"
                        disabled={busyKey === h.baseKey}
                        onClick={() => void undo(h)}
                        style={{ ...btnStyle, height: 20, padding: '0 6px', fontSize: 10.5 }}
                      >
                        <Undo2 size={11} /> 되돌리기
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </aside>
  );
}
```

- [ ] **Step 11: `CsvImportDialog.tsx`**

```tsx
'use client';

/**
 * 실사표 불러오기(기초재고). 파일 → 실사 시각 → 미리보기(합계·오류·경고·단가) → 단가 채우기 → 다시 미리보기 → 불러오기.
 * 입력을 고치면 미리보기가 낡은 것으로 보고 불러오기를 막는다 — 본 숫자와 적재되는 숫자가 같아야 한다.
 */
import React, { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { bandStyle, btnStyle, disabledBtnStyle, inputStyle, numTdStyle, primaryBtnStyle, thStyle } from '@/components/orders/erp-ui';
import type { ImportSummary } from '@/lib/erp/ledger/opening-import';
import { postImport } from './api';
import { localInputToIso, toKstLocalInput, won } from './stock-view';

const SOURCE_LABEL: Record<string, string> = { override: '입력', history: '옛 입고', csv: '실사표', none: '없음' };

interface Props {
  onClose: () => void;
  onCommitted: () => void;
}

export default function CsvImportDialog({ onClose, onCommitted }: Props) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [countedAt, setCountedAt] = useState(toKstLocalInput(new Date()));
  const [costInput, setCostInput] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function touch() {
    if (preview) setStale(true);
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    setCsv(await f.text());
    setPreview(null);
    setStale(false);
  }

  function overrides(): Record<string, number> {
    const o: Record<string, number> = {};
    for (const [k, v] of Object.entries(costInput)) if (/^\d+$/.test(v.trim())) o[k] = Number(v.trim());
    return o;
  }

  async function run(commit: boolean) {
    if (!csv) return;
    if (commit && preview) {
      const t = preview.totals;
      const ok = await confirmDialog({
        message: `기초재고를 불러옵니다 — 전표 ${t.entries}건\n\n집 ${won(t.self)} · RG입고중 ${won(t.rgInbound)} · RG ${won(t.rg)}개\n평가액 ${won(t.value)}원\n\nRG는 지금 쿠팡 API 값으로 다시 읽어 적재합니다. 원장에 전표가 있는 SKU는 빠집니다.`,
        confirmLabel: '불러오기',
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    const r = await postImport({ csv, fileName, countedAt: localInputToIso(countedAt), unitCostOverrides: overrides(), commit });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setPreview(r.data);
    setStale(false);
    if (commit && r.data.committed > 0) {
      toast.success(`기초재고 ${r.data.committed}건을 불러왔습니다`);
      onCommitted();
    } else if (commit) {
      setError(r.data.errors.length > 0 ? '오류가 있어 불러오지 않았습니다' : '불러올 전표가 없습니다');
    }
  }

  const canCommit = !!preview && !stale && preview.errors.length === 0 && preview.totals.entries > 0 && !busy;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)' }} />
      <div
        role="dialog"
        aria-label="실사표 불러오기"
        style={{ position: 'relative', width: 760, maxWidth: 'calc(100vw - 32px)', maxHeight: '88vh', overflow: 'auto', background: E.surface, border: `1px solid ${E.line}`, color: E.ink, fontSize: 12 }}
      >
        <div style={{ ...bandStyle, justifyContent: 'space-between' }}>
          <span>실사표 불러오기 — 기초재고</span>
          <button type="button" aria-label="닫기" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex' }}><X size={13} /></button>
        </div>
        <div style={{ padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ ...btnStyle, position: 'relative' }}>
            <Upload size={12} /> {fileName || 'CSV 고르기'}
            <input type="file" accept=".csv,text/csv" aria-label="실사표 CSV" onChange={(e) => void onFile(e.target.files?.[0])} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            실사를 마친 시각
            <input type="datetime-local" aria-label="실사를 마친 시각" value={countedAt} onChange={(e) => { setCountedAt(e.target.value); touch(); }} style={inputStyle} />
          </label>
          <button type="button" disabled={!csv || busy} onClick={() => void run(false)} style={!csv || busy ? disabledBtnStyle : btnStyle}>
            {busy ? '읽는 중…' : '미리보기'}
          </button>
        </div>
        <div style={{ padding: '0 12px 8px', color: E.inkSub, fontSize: 11 }}>
          형식은 1-B 실사표(`docs/erp/opening-count-*.csv`)와 같습니다. self_count가 빈 행은 건너뛰고, 원장에 전표가 있는 SKU는 「조정」으로 고칩니다.
        </div>
        {error && <div role="alert" style={{ margin: '0 12px 8px', padding: 8, border: `1px solid ${E.loss}`, color: E.loss }}>{error}</div>}

        {preview && (
          <div style={{ padding: '0 12px 12px' }}>
            <div style={{ display: 'flex', gap: 14, padding: '6px 0', fontFamily: E.mono }}>
              <span>전표 {preview.totals.entries}건</span>
              <span>집 {won(preview.totals.self)}</span>
              <span>RG입고중 {won(preview.totals.rgInbound)}</span>
              <span>RG {won(preview.totals.rg)}</span>
              <span>평가액 {won(preview.totals.value)}원</span>
              {stale && <span style={{ color: E.warn }}>입력이 바뀌었습니다 — 다시 미리보기</span>}
            </div>
            {preview.errors.length > 0 && (
              <div style={{ border: `1px solid ${E.loss}`, color: E.loss, padding: 8, marginBottom: 8 }}>
                <b>오류 {preview.errors.length}건 — 고쳐야 불러옵니다</b>
                {preview.errors.map((m) => <div key={m}>· {m}</div>)}
              </div>
            )}
            {preview.warnings.length > 0 && (
              <div style={{ border: `1px solid ${E.warn}`, background: E.warnSoft, color: E.warn, padding: 8, marginBottom: 8 }}>
                <b>경고 {preview.warnings.length}건</b>
                {preview.warnings.map((m) => <div key={m}>· {m}</div>)}
              </div>
            )}
            {preview.excluded.length > 0 && (
              <details style={{ marginBottom: 8 }}>
                <summary>불러오지 않는 행 {preview.excluded.length}건</summary>
                {preview.excluded.map((x) => <div key={x.skuKey} style={{ color: E.inkSub }}>· {x.skuKey} — {x.reason}</div>)}
              </details>
            )}
            {preview.costs.length > 0 && (
              <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 8 }}>
                <thead>
                  <tr>{['SKU', '보유', '적재 단가', '출처', '단가 입력'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.costs.map((c) => (
                    <tr key={c.skuId} style={{ background: c.unitCost === null ? E.accentSoft : undefined }}>
                      <td style={{ ...numTdStyle, textAlign: 'left', fontFamily: 'inherit' }}>{c.skuKey}</td>
                      <td style={numTdStyle}>{won(c.onHand)}</td>
                      <td style={numTdStyle}>{c.unitCost === null ? '—' : won(c.unitCost)}</td>
                      <td style={{ ...numTdStyle, fontFamily: 'inherit' }}>{SOURCE_LABEL[c.source] ?? c.source}</td>
                      <td style={numTdStyle}>
                        <input
                          aria-label={`${c.skuKey} 단가`}
                          inputMode="numeric"
                          value={costInput[c.skuKey] ?? ''}
                          placeholder={c.unitCost === null ? '필수' : '바꿀 때만'}
                          onChange={(e) => { setCostInput((m) => ({ ...m, [c.skuKey]: e.target.value })); touch(); }}
                          style={{ ...inputStyle, width: 90, textAlign: 'right', fontFamily: E.mono }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button type="button" onClick={onClose} style={btnStyle}>닫기</button>
              <button type="button" disabled={!canCommit} onClick={() => void run(true)} style={canCommit ? primaryBtnStyle : disabledBtnStyle}>
                불러오기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 12: `StockClient.tsx`**

```tsx
'use client';

/**
 * 재고현황(PC). 원장 재고를 보고 고친다 — 칸 편집(바로 저장) · 실사 모드(여러 칸 담아 한 번에) ·
 * RG 실재고 대조(보기 → 행 반영/일괄 반영) · 실사표 불러오기(기초재고) · 엑셀↓ · 우측 입출 이력.
 * C11 축소판이다. ERP 틀·TanStack은 2단계.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ClipboardCheck, Download, RefreshCw, Search, Upload } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import {
  Kpi, btnStyle, disabledBtnStyle, dividerStyle, inputStyle, primaryBtnStyle,
  qFieldStyle, qLabelStyle, qTitleStyle, qValStyle, queryPanelStyle, statNumStyle, statusBarStyle,
} from '@/components/orders/erp-ui';
import StockTable from './StockTable';
import HistoryPanel from './HistoryPanel';
import CsvImportDialog from './CsvImportDialog';
import { fetchRecon, fetchStock, postAdjust, postRgApply } from './api';
import {
  computeKpis, defaultCost, editDiff, filterRows, parseRecon, rgDiff, stageKey, summarizeStaged, toAdjustItems, toExportCsv, won,
  type EditLocation, type Filters, type RgRecon, type StagedEdit, type StockRow,
} from './stock-view';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${won(Math.abs(n))}`;

export default function StockClient() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ q: '', onlyStocked: false, onlyRgMismatch: false });
  const [recon, setRecon] = useState<RgRecon | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ skuId: number; location: EditLocation } | null>(null);
  const [countMode, setCountMode] = useState(false);
  const [staged, setStaged] = useState<Map<string, StagedEdit>>(new Map());
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchStock();
    setLoading(false);
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setRows(r.data);
    setHistoryKey((k) => k + 1);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => filterRows(rows, filters, recon), [rows, filters, recon]);
  const kpi = useMemo(() => computeKpis(rows, recon), [rows, recon]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.skuId, r])), [rows]);
  const mismatches = useMemo(() => (recon ? rows.filter((r) => (rgDiff(r, recon) ?? 0) !== 0) : []), [rows, recon]);
  const selectedRow = selected === null ? null : rowById.get(selected) ?? null;

  async function saveOne(edit: StagedEdit) {
    setSaving(true);
    const r = await postAdjust(toAdjustItems([edit], uuidv4));
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      if (r.code === 'stale') await load();
      return;
    }
    const res = r.data[0];
    toast.success(res.outcome === 'noop' ? '차이가 없어 기록하지 않았습니다' : `${res.kind === 'opening' ? '기초재고' : '조정'} ${res.qty > 0 ? '+' : ''}${res.qty} 기록했습니다`);
    setEditing(null);
    await load();
  }

  function stage(edit: StagedEdit) {
    setStaged((m) => {
      const n = new Map(m);
      const k = stageKey(edit.skuId, edit.location);
      if (editDiff(edit) === 0) n.delete(k);
      else n.set(k, edit);
      return n;
    });
    setEditing(null);
  }

  async function saveStaged() {
    const list = [...staged.values()];
    if (list.length === 0) return;
    const s = summarizeStaged(list, rowById);
    const ok = await confirmDialog({
      message: `실사 변경 ${s.count}건을 저장합니다.\n\n늘림 +${won(s.plus)}개 · 줄임 −${won(s.minus)}개\n평가액 영향(추정) ${signed(s.valueDelta)}원\n\n하나라도 실패하면 전부 저장되지 않습니다.`,
      confirmLabel: '저장',
    });
    if (!ok) return;
    setSaving(true);
    const r = await postAdjust(toAdjustItems(list, uuidv4));
    setSaving(false);
    if (!r.ok) {
      const bad = r.index !== undefined ? list[r.index] : undefined;
      toast.error(bad ? `${rowById.get(bad.skuId)?.name ?? bad.skuId}: ${r.error}` : r.error);
      if (r.code === 'stale' && bad) {
        setStaged((m) => { const n = new Map(m); n.delete(stageKey(bad.skuId, bad.location)); return n; });
      }
      await load();
      return;
    }
    toast.success(`${r.data.filter((x) => x.outcome === 'posted').length}건 저장했습니다`);
    setStaged(new Map());
    setCountMode(false);
    await load();
  }

  async function toggleCountMode() {
    if (countMode && staged.size > 0) {
      const ok = await confirmDialog({ message: `담아 둔 ${staged.size}건을 버리고 실사 모드를 끕니다.`, confirmLabel: '버리기', danger: true });
      if (!ok) return;
      setStaged(new Map());
    }
    setEditing(null);
    setCountMode((v) => !v);
  }

  async function loadRecon() {
    setReconLoading(true);
    const r = await fetchRecon();
    setReconLoading(false);
    if (!r.ok) { toast.error(r.error); return; }
    setRecon(parseRecon(r.data));
    const warn = r.data.issues.length + r.data.inactive.length;
    if (warn > 0) toast.error(`RG 매핑 경고 ${warn}건 — 표 위 안내를 확인하세요`);
  }

  async function applyRg(targets: StockRow[]) {
    if (!recon) return;
    const items = targets
      .map((row) => ({ row, actual: recon.actual.get(row.skuId) ?? 0 }))
      .filter((x) => x.actual !== x.row.rg);
    if (items.length === 0) return;
    const plus = items.reduce((s, x) => s + Math.max(x.actual - x.row.rg, 0), 0);
    const minus = items.reduce((s, x) => s + Math.max(x.row.rg - x.actual, 0), 0);
    const valueDelta = items.reduce((s, x) => s + (x.actual - x.row.rg) * (defaultCost(x.row) ?? 0), 0);
    const ok = await confirmDialog({
      message: `RG 실재고를 원장에 반영합니다 — SKU ${items.length}개\n\n늘림 +${won(plus)}개 · 줄임 −${won(minus)}개\n평가액 영향(추정) ${signed(valueDelta)}원\n\n판매 차감(1-C2) 전이라 RG 판매도 차이로 보입니다. 확인한 것만 반영하세요.`,
      confirmLabel: '반영',
    });
    if (!ok) return;
    setSaving(true);
    const r = await postRgApply(items.map((x) => ({
      skuId: x.row.skuId, expected: x.row.rg, actual: x.actual, requestId: uuidv4(), unitCost: defaultCost(x.row),
    })));
    setSaving(false);
    if (!r.ok) { toast.error(r.error); await load(); return; }
    toast.success(`RG ${r.data.filter((x) => x.outcome === 'posted').length}건 반영했습니다`);
    await load();
  }

  function exportCsv() {
    const blob = new Blob([toExportCsv(visible, recon)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `재고현황-${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const reconTime = recon ? new Date(recon.fetchedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }) : null;

  return (
    <div style={{ background: E.ground, minHeight: '100%', padding: 12, color: E.ink, fontSize: 12 }}>
      <div style={queryPanelStyle}>
        <div style={qTitleStyle}>재고현황 — 조회조건</div>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          <div style={qFieldStyle}>
            <div style={qLabelStyle}>검색</div>
            <div style={qValStyle}>
              <Search size={12} color={E.inkMute} />
              <input
                aria-label="상품·옵션·키 검색"
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                placeholder="상품·옵션·키"
                style={{ ...inputStyle, width: 220 }}
              />
            </div>
          </div>
          <div style={qFieldStyle}>
            <div style={qLabelStyle}>보기</div>
            <div style={qValStyle}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={filters.onlyStocked} onChange={(e) => setFilters({ ...filters, onlyStocked: e.target.checked })} />
                재고 있는 것만
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: recon ? 1 : 0.5 }} title={recon ? undefined : 'RG 실재고 대조 후 쓸 수 있습니다'}>
                <input type="checkbox" disabled={!recon} checked={filters.onlyRgMismatch} onChange={(e) => setFilters({ ...filters, onlyRgMismatch: e.target.checked })} />
                RG 불일치만
              </label>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', background: E.surface, border: `1px solid ${E.line}`, marginBottom: 10 }}>
        <Kpi label="총재고" value={won(kpi.total)} unit="개" />
        <Kpi label="집" value={won(kpi.self)} unit="개" />
        <Kpi label="RG입고중" value={won(kpi.rgInbound)} unit="개" />
        <Kpi label="RG(원장)" value={won(kpi.rg)} unit="개" />
        <Kpi label="평가액" value={won(kpi.value)} unit="원" />
        <Kpi
          label="RG 불일치"
          value={kpi.rgMismatch === null ? '—' : String(kpi.rgMismatch)}
          unit={kpi.rgMismatch === null ? undefined : 'SKU'}
          tone={kpi.rgMismatch ? E.loss : undefined}
          sub={reconTime ? `대조 ${reconTime}` : '대조 전'}
          last
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={reconLoading} onClick={() => void loadRecon()} style={reconLoading ? disabledBtnStyle : btnStyle}>
          <RefreshCw size={12} /> {reconLoading ? '대조 중…' : 'RG 실재고 대조'}
        </button>
        {recon && mismatches.length > 0 && (
          <button type="button" disabled={saving} onClick={() => void applyRg(mismatches)} style={saving ? disabledBtnStyle : btnStyle}>
            불일치 {mismatches.length}건 일괄 반영
          </button>
        )}
        <div style={dividerStyle} />
        <button type="button" onClick={() => setShowImport(true)} style={btnStyle}><Upload size={12} /> 실사표 불러오기(CSV)</button>
        <button type="button" onClick={exportCsv} style={btnStyle}><Download size={12} /> 엑셀↓</button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          aria-pressed={countMode}
          onClick={() => void toggleCountMode()}
          style={countMode ? { ...btnStyle, borderColor: E.accent, color: E.accent, fontWeight: 600 } : btnStyle}
        >
          <ClipboardCheck size={12} /> 실사 모드{countMode ? ' 켜짐' : ''}
        </button>
        {countMode && (
          <button type="button" disabled={staged.size === 0 || saving} onClick={() => void saveStaged()} style={staged.size === 0 || saving ? disabledBtnStyle : primaryBtnStyle}>
            변경 {staged.size}건 저장
          </button>
        )}
      </div>

      {recon && (recon.issues.length > 0 || recon.inactive.length > 0) && (
        <div style={{ border: `1px solid ${E.warn}`, background: E.warnSoft, color: E.warn, padding: '6px 10px', marginBottom: 8, fontSize: 11.5 }}>
          {recon.issues.map((i) => <div key={`${i.kind}:${i.ref}`}>⚠ {i.kind} {i.ref} — {i.detail}</div>)}
          {recon.inactive.map((o) => <div key={`inactive:${o.skuId}`}>⚠ 보관된 SKU {o.skuId}에 RG 재고 {o.qty}개</div>)}
        </div>
      )}
      {error && <div role="alert" style={{ border: `1px solid ${E.loss}`, color: E.loss, background: E.surface, padding: '6px 10px', marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <StockTable
            rows={visible}
            recon={recon}
            staged={staged}
            countMode={countMode}
            editing={editing}
            selected={selected}
            busy={saving}
            onEdit={(skuId, location) => setEditing({ skuId, location })}
            onCancelEdit={() => setEditing(null)}
            onSubmitEdit={(e) => { if (countMode) stage(e); else void saveOne(e); }}
            onSelect={setSelected}
            onRgApply={(row) => void applyRg([row])}
          />
          <div style={statusBarStyle}>
            <span>표시 <span style={statNumStyle}>{visible.length}</span> / {rows.length} SKU</span>
            {loading && <span>불러오는 중…</span>}
            {countMode && <span style={{ color: E.accent }}>실사 모드 — 칸을 고치면 담기고, 「변경 저장」에서 한 번에 기록합니다</span>}
          </div>
        </div>
        {selectedRow && (
          <HistoryPanel row={selectedRow} refreshKey={historyKey} onClose={() => setSelected(null)} onChanged={() => void load()} />
        )}
      </div>

      {showImport && (
        <CsvImportDialog onClose={() => setShowImport(false)} onCommitted={() => { setShowImport(false); void load(); }} />
      )}
    </div>
  );
}
```

- [ ] **Step 13: 커밋**

Run: `npx tsc --noEmit` → 0 오류
```bash
git add src/components/erp/stock/StockTable.tsx src/components/erp/stock/HistoryPanel.tsx src/components/erp/stock/CsvImportDialog.tsx src/components/erp/stock/StockClient.tsx
git commit -m "feat(erp): 재고현황 화면 — 표·실사 모드·RG 대조 반영·입출 이력·실사표 불러오기"
```

#### 4-D. 페이지·사이드바

- [ ] **Step 14: 사이드바 테스트를 먼저 더한다**

`src/__tests__/lib/nav-items.test.ts`의 `describe('labelForHref', () => {` 블록 안 끝(`it('루트는 대시보드 라벨을 쓴다', …)` 다음)에 더한다.
```ts

  it('재고현황은 재고·매입의 하위 항목 라벨을 쓴다', () => {
    expect(labelForHref('/erp/stock')).toBe('재고현황');
    expect(labelForHref('/erp')).toBe('재고·매입');
  });
```

Run: `npx vitest run src/__tests__/lib/nav-items.test.ts`
Expected: 새 테스트 FAIL(`'erp/stock'`이 나온다)

- [ ] **Step 15: 사이드바 항목과 페이지**

`src/lib/nav-items.tsx`의 `/orders` 항목 끝과 `/plan` 항목 시작
```tsx
        <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: '/plan',
```
을 아래로 바꾼다(사이에 「재고·매입」을 넣는다).
```tsx
        <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: '/erp',
    label: '재고·매입',
    icon: (
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M21 8l-9-5-9 5 9 5 9-5z" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M3 8v8l9 5 9-5V8" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M12 13v8" strokeWidth="1.5" />
      </svg>
    ),
    children: [
      {
        href: '/erp/stock',
        label: '재고현황',
        icon: (
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M4 6h16M4 12h16M4 18h10" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
  },
  {
    href: '/plan',
```

`src/app/erp/layout.tsx`:
```tsx
import AppShell from '@/components/AppShell';

export default function ErpLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
```

`src/app/erp/page.tsx`:
```tsx
import { redirect } from 'next/navigation';

/** 사이드바 「재고·매입」(부모 링크) → 재고현황 */
export default function ErpIndexPage() {
  redirect('/erp/stock');
}
```

`src/app/erp/stock/page.tsx`:
```tsx
import StockClient from '@/components/erp/stock/StockClient';

export const metadata = {
  title: '재고현황 — SmartSellerStudio',
  description: 'SKU별 원장 재고 · 재고 수정 · RG 실재고 대조 · 기초재고',
};

export default function ErpStockPage() {
  return <StockClient />;
}
```

- [ ] **Step 16: 테스트·타입·커밋**

Run: `npx vitest run src/__tests__/lib/nav-items.test.ts src/__tests__/components/erp-stock-view.test.ts src/__tests__/components/erp-stock-edit-cell.test.tsx && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/app/erp src/lib/nav-items.tsx src/__tests__/lib/nav-items.test.ts
git commit -m "feat(erp): /erp/stock 페이지와 사이드바 「재고·매입 > 재고현황」"
```

- [ ] **Step 17: 🔴 화면 확인 — 컨트롤러가 직접(서브에이전트 아님)**

1. `npm run dev`를 백그라운드로 띄운다. 사용자에게 `http://localhost:3000/login`에서 **직접 로그인**해 달라고 요청한다(비밀번호를 대신 입력하지 않는다).
2. 브라우저 1440px 폭으로 `http://localhost:3000/erp/stock`을 연다. 확인: 사이드바 「재고·매입 > 재고현황」 강조 · 조회조건 · KPI 6칸 · 표(215행 전후, 원장이 비어 있어 전부 0과 「원장 없음」) · 콘솔 오류 없음.
3. **쓰지 않는 동작만** 해 본다: 검색 · 「재고 있는 것만」 · 「RG 실재고 대조」(쿠팡 GET만 — RG실재고·차이 칸이 채워지고 KPI 「RG 불일치」가 숫자로 바뀐다) · 「RG 불일치만」 · 행 클릭 → 이력 패널(「원장 전표가 없습니다」) · 칸 클릭 → 편집 팝오버가 뜨고 차이·단가 칸이 반응하는지(「취소」로 닫는다) · 실사 모드 켜기/끄기 · 「실사표 불러오기」 창에서 `docs/erp/opening-count-2026-09-26.csv`를 골라 **미리보기만**(오류·경고·단가 표가 뜬다 — 「불러오기」는 누르지 않는다) · 엑셀↓ 파일이 한글 깨짐 없이 열리는지.
4. 🔴 **저장·반영·불러오기 버튼은 누르지 않는다** — 로컬 서버도 운영 DB다. 실제 입력은 Task 8에서 사용자가 한다.
5. 깨진 곳이 있으면 고치고 `fix(erp): …`로 커밋한 뒤 다시 본다. 스크린샷 한 장을 사용자에게 보여준다.

---
### Task 4b: 상품 단위로 묶어 보기

> 결정 5(2026-09-26 추가): 품목이 많아지면 SKU 한 줄씩 보는 표로는 실사가 힘들다 → `erp.skus.name`(쿠팡 상품명)으로 묶어 **한 줄 = 상품**(옵션 수 · 합계 집/입고중/RG/평가액), 펼치면 옵션 행. 옵션 1개 상품은 그대로 한 줄. Task 4에서 만든 표·컨테이너 위에 얹는다(API 변경 없음).

**Files:**
- Modify: `src/components/erp/stock/stock-view.ts`, `src/components/erp/stock/StockTable.tsx`, `src/components/erp/stock/StockClient.tsx`
- Modify: `src/__tests__/components/erp-stock-view.test.ts`
- Test: `src/__tests__/components/erp-stock-table.test.tsx`

#### 4b-A. 묶기 순수 함수

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/components/erp-stock-view.test.ts` 맨 위 import
```ts
import {
  computeKpis, defaultCost, editDiff, filterRows, localInputToIso, summarizeStaged, toAdjustItems, toExportCsv,
  type RgRecon, type StagedEdit, type StockRow,
} from '@/components/erp/stock/stock-view';
```
을 아래로 바꾼다.
```ts
import {
  computeKpis, defaultCost, editDiff, filterGroups, filterRows, filtersActive, groupRows, localInputToIso, summarizeStaged, toAdjustItems, toExportCsv,
  type RgRecon, type StagedEdit, type StockRow,
} from '@/components/erp/stock/stock-view';
```

같은 파일 끝에 더한다.
```ts

describe('상품 단위 묶기', () => {
  const rows = [
    row({ skuId: 1, key: 'k1', name: '왜건', option: '블랙', self: 3, rgInbound: 1, rg: 2, value: 6000 }),
    row({ skuId: 2, key: 'k2', name: '왜건', option: '베이지', self: 0, rgInbound: 0, rg: 0, value: 0 }),
    row({ skuId: 3, key: 'k3', name: '매트', option: '', self: 4, rgInbound: 0, rg: 1, value: 2500 }),
  ];

  it('상품명으로 묶어 집·입고중·RG(원장)·평가액을 더하고 옵션 수를 센다(나온 순서 유지)', () => {
    const g = groupRows(rows, null);
    expect(g.map((x) => [x.name, x.options.length, x.self, x.rgInbound, x.rg, x.value, x.rgActual, x.rgMismatch])).toEqual([
      ['왜건', 2, 3, 1, 2, 6000, null, null],
      ['매트', 1, 4, 0, 1, 2500, null, null],
    ]);
  });

  it('대조 뒤에는 RG 실재고를 더하고 불일치를 옵션 단위로 센다(합이 상쇄돼도 가려지지 않는다)', () => {
    // 블랙 2→1(−1) · 베이지 0→1(+1) — 상품 합은 2 = 2지만 옵션 둘 다 틀렸다
    const r2: RgRecon = { ...recon, actual: new Map([[1, 1], [2, 1]]) };
    const [wagon] = groupRows(rows, r2);
    expect([wagon.rgActual, wagon.rgMismatch]).toEqual([2, 2]);
  });

  it('조회조건은 옵션에 건다 — 맞는 옵션이 있는 묶음만 남기고 그 옵션만 보인다(합계는 전체 옵션)', () => {
    const g = groupRows(rows, null);
    expect(filterGroups(g, { q: '', onlyStocked: true, onlyRgMismatch: false }, null).map((v) => [v.group.name, v.shown.map((r) => r.skuId), v.group.self]))
      .toEqual([['왜건', [1], 3], ['매트', [3], 4]]);
    expect(filterGroups(g, { q: '베이지', onlyStocked: false, onlyRgMismatch: false }, null).map((v) => v.shown.map((r) => r.skuId))).toEqual([[2]]);
    // 상품명으로 찾으면 그 상품의 옵션이 모두 보인다
    expect(filterGroups(g, { q: '왜건', onlyStocked: false, onlyRgMismatch: false }, null).map((v) => v.shown.length)).toEqual([2]);
  });

  it('조회조건이 하나라도 걸리면 filtersActive(공백만 있는 검색어는 아니다)', () => {
    expect(filtersActive({ q: ' ', onlyStocked: false, onlyRgMismatch: false })).toBe(false);
    expect(filtersActive({ q: '왜건', onlyStocked: false, onlyRgMismatch: false })).toBe(true);
    expect(filtersActive({ q: '', onlyStocked: true, onlyRgMismatch: false })).toBe(true);
    expect(filtersActive({ q: '', onlyStocked: false, onlyRgMismatch: true })).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/components/erp-stock-view.test.ts`
Expected: 새 4건 FAIL — `groupRows is not a function`(기존 테스트는 PASS)

- [ ] **Step 3: 구현**

`src/components/erp/stock/stock-view.ts`의 `filterRows` 함수 바로 뒤(`export interface Kpis {` 앞)에 넣는다.
```ts

/** 조회조건이 하나라도 걸려 있다 — 표가 묶음을 모두 펼친다 */
export const filtersActive = (f: Filters): boolean => f.q.trim() !== '' || f.onlyStocked || f.onlyRgMismatch;

/** 상품 단위 묶음 — erp.skus.name(쿠팡 상품명)이 같은 옵션들. 합계는 전체 옵션 기준 */
export interface StockGroup {
  name: string;
  options: StockRow[];
  self: number;
  rgInbound: number;
  /** 원장 RG 합 */
  rg: number;
  value: number;
  /** RG 실재고 합. 대조 전이면 null */
  rgActual: number | null;
  /** RG 차이가 있는 옵션 수(합이 상쇄돼도 옵션 단위로 센다). 대조 전이면 null */
  rgMismatch: number | null;
}

/** 표에 그릴 묶음 하나 — shown은 조회조건에 맞는 옵션만 */
export interface GroupView {
  group: StockGroup;
  shown: StockRow[];
}

/** 상품명으로 묶는다. 순서는 처음 나온 순서(목록 API가 상품명·옵션 순으로 준다). 옵션 1개 상품도 묶음 하나다(표가 한 줄로 그린다) */
export function groupRows(rows: StockRow[], recon: RgRecon | null): StockGroup[] {
  const byName = new Map<string, StockRow[]>();
  for (const r of rows) {
    const list = byName.get(r.name);
    if (list) list.push(r);
    else byName.set(r.name, [r]);
  }
  return [...byName].map(([name, options]) => {
    const sum = (f: (r: StockRow) => number) => options.reduce((s, r) => s + f(r), 0);
    return {
      name,
      options,
      self: sum((r) => r.self),
      rgInbound: sum((r) => r.rgInbound),
      rg: sum((r) => r.rg),
      value: sum((r) => r.value),
      rgActual: recon ? sum((r) => rgActual(r, recon) ?? 0) : null,
      rgMismatch: recon ? options.filter((r) => (rgDiff(r, recon) ?? 0) !== 0).length : null,
    };
  });
}

/** 조회조건은 옵션에 건다 — 맞는 옵션이 하나라도 있으면 묶음을 남기고 그 옵션만 보인다(묶음 합계는 전체 옵션 그대로) */
export function filterGroups(groups: StockGroup[], f: Filters, recon: RgRecon | null): GroupView[] {
  return groups.map((group) => ({ group, shown: filterRows(group.options, f, recon) })).filter((v) => v.shown.length > 0);
}
```

- [ ] **Step 4: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/components/erp-stock-view.test.ts && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/components/erp/stock/stock-view.ts src/__tests__/components/erp-stock-view.test.ts
git commit -m "feat(erp): 재고 행을 상품 단위로 묶는 순수 함수 — 합계·옵션 수·옵션에 거는 조회조건"
```

#### 4b-B. 표가 묶음을 그린다

- [ ] **Step 5: 실패하는 테스트 작성**

`src/__tests__/components/erp-stock-table.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import StockTable from '@/components/erp/stock/StockTable';
import { filterGroups, groupRows, type StockRow } from '@/components/erp/stock/stock-view';

const row = (o: Partial<StockRow>): StockRow => ({
  skuId: 1, key: 'k1', name: '왜건', option: '블랙', legacyProductCostIds: [], self: 3, rgInbound: 1, rg: 2, value: 6000,
  hasLedger: true, lotCost: 1000, legacyCost: null, costNeedsInput: false, ...o,
});
const ROWS = [
  row({}),
  row({ skuId: 2, key: 'k2', option: '베이지', self: 5, rgInbound: 0, rg: 0, value: 5000 }),
  row({ skuId: 3, key: 'k3', name: '매트', option: '', self: 4, rgInbound: 0, rg: 0, value: 2000 }),
];
const NO_FILTER = { q: '', onlyStocked: false, onlyRgMismatch: false };

function renderTable(forceOpen = false) {
  const onEdit = vi.fn();
  const onSelect = vi.fn();
  render(
    <StockTable
      views={filterGroups(groupRows(ROWS, null), NO_FILTER, null)}
      forceOpen={forceOpen}
      recon={null}
      staged={new Map()}
      countMode={false}
      editing={null}
      selected={null}
      busy={false}
      onEdit={onEdit}
      onCancelEdit={() => {}}
      onSubmitEdit={() => {}}
      onSelect={onSelect}
      onRgApply={() => {}}
    />,
  );
  return { onEdit, onSelect };
}
const trOf = (text: string) => screen.getByText(text).closest('tr')!;

describe('StockTable — 상품 묶음', () => {
  it('옵션 여러 개인 상품은 합계 한 줄로 접혀 있고, 누르면 옵션 행이 펼쳐진다', () => {
    const { onSelect } = renderTable();
    const group = trOf('왜건');
    expect(within(group).getByText('옵션 2')).toBeInTheDocument();
    expect(within(group).getByText('8')).toBeInTheDocument(); // 집 3 + 5
    expect(within(group).queryByTitle('눌러서 고칩니다')).toBeNull(); // 묶음 줄은 고치지 않는다
    expect(screen.queryByText('베이지')).not.toBeInTheDocument();
    fireEvent.click(group);
    expect(screen.getByText('베이지')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled(); // 묶음 줄은 이력을 열지 않는다
    fireEvent.click(trOf('왜건'));
    expect(screen.queryByText('베이지')).not.toBeInTheDocument();
  });

  it('옵션 1개 상품은 묶지 않고 한 줄 — 그 줄에서 바로 고치고, 누르면 이력', () => {
    const { onEdit, onSelect } = renderTable();
    const mat = trOf('매트');
    expect(within(mat).queryByText(/^옵션 /)).toBeNull();
    fireEvent.click(within(mat).getAllByTitle('눌러서 고칩니다')[0]);
    expect(onEdit).toHaveBeenCalledWith(3, 'self');
    fireEvent.click(mat);
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('전체 펼치기·전체 접기', () => {
    renderTable();
    fireEvent.click(screen.getByText('전체 펼치기'));
    expect(screen.getByText('블랙')).toBeInTheDocument();
    expect(screen.getByText('베이지')).toBeInTheDocument();
    fireEvent.click(screen.getByText('전체 접기'));
    expect(screen.queryByText('블랙')).not.toBeInTheDocument();
  });

  it('조회조건이 걸리면(forceOpen) 묶음이 펼쳐져 있고 펼치기 버튼은 잠긴다', () => {
    renderTable(true);
    expect(screen.getByText('베이지')).toBeInTheDocument();
    expect(screen.getByText('전체 접기')).toBeDisabled();
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/__tests__/components/erp-stock-table.test.tsx`
Expected: FAIL — `views`를 받지 않는 옛 표(`rows` 없음으로 렌더 오류)

- [ ] **Step 7: `StockTable.tsx`를 묶음 표로 바꾼다**

`src/components/erp/stock/StockTable.tsx` 전체를 아래로 바꾼다.
```tsx
'use client';

/**
 * 재고 표 — 상품 단위로 묶는다(결정 5). 옵션이 여러 개인 상품은 합계 한 줄(누르면 펼침), 옵션 1개 상품은 그대로 한 줄.
 * 고치는 칸(집·RG입고중)은 옵션 행에만 있다. 옵션 행을 누르면 우측 이력. RG 차이가 있으면 옵션 행마다 「반영」.
 * 조회조건이 걸리면(forceOpen) 묶음을 모두 펼쳐 맞는 옵션을 바로 보인다.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { Tag, bandStyle, btnStyle, numTdStyle, thStyle } from '@/components/orders/erp-ui';
import EditCell from './EditCell';
import {
  defaultCost, editDiff, rgActual, rgDiff, stageKey, won,
  type EditLocation, type GroupView, type RgRecon, type StagedEdit, type StockRow,
} from './stock-view';

interface Props {
  views: GroupView[];
  /** 조회조건이 걸려 있다 — 묶음을 모두 펼친다 */
  forceOpen: boolean;
  recon: RgRecon | null;
  staged: Map<string, StagedEdit>;
  countMode: boolean;
  editing: { skuId: number; location: EditLocation } | null;
  selected: number | null;
  busy: boolean;
  onEdit: (skuId: number, location: EditLocation) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (e: StagedEdit) => void;
  onSelect: (skuId: number) => void;
  onRgApply: (row: StockRow) => void;
}

const HEADERS = ['상품', '옵션', '집', 'RG입고중', 'RG(원장)', 'RG실재고', '차이', '단가', '평가액'];

const textTd: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`, borderRight: `1px solid ${E.lineSoft}`, padding: '4px 8px',
  fontSize: 12, color: E.ink, whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis',
};
const smallBtn: React.CSSProperties = { ...btnStyle, height: 20, padding: '0 6px', fontSize: 10.5 };

export default function StockTable({
  views, forceOpen, recon, staged, countMode, editing, selected, busy, onEdit, onCancelEdit, onSubmitEdit, onSelect, onRgApply,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const multi = views.filter((v) => v.group.options.length > 1);
  const toggle = (name: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  // 줄무늬는 화면에 보이는 줄 순서로 센다(묶음·옵션 줄 공통)
  let stripe = 0;

  const optionRow = (r: StockRow, child: boolean) => {
    const i = stripe++;
    const diff = rgDiff(r, recon);
    const actual = rgActual(r, recon);
    const cost = defaultCost(r);
    const cell = (loc: EditLocation) => {
      const s = staged.get(stageKey(r.skuId, loc));
      const value = loc === 'self' ? r.self : r.rgInbound;
      const isEditing = editing?.skuId === r.skuId && editing.location === loc;
      return (
        <td
          title="눌러서 고칩니다"
          onClick={(e) => { e.stopPropagation(); if (!isEditing) onEdit(r.skuId, loc); }}
          style={{ ...numTdStyle, position: 'relative', cursor: 'pointer', background: s ? E.warnSoft : undefined }}
        >
          {s ? (
            <>
              <span style={{ textDecoration: 'line-through', color: E.inkMute }}>{won(value)}</span>
              {' → '}
              <b>{won(value + editDiff(s))}</b>
            </>
          ) : won(value)}
          {isEditing && (
            <EditCell row={r} location={loc} staged={s} countMode={countMode} onSubmit={onSubmitEdit} onCancel={onCancelEdit} />
          )}
        </td>
      );
    };
    return (
      <tr
        key={r.skuId}
        onClick={() => onSelect(r.skuId)}
        style={{ height: E.rowH, cursor: 'pointer', background: selected === r.skuId ? E.infoSoft : i % 2 ? E.chrome2 : E.surface }}
      >
        <td style={textTd} title={r.key}>
          {child ? <span style={{ color: E.inkMute, paddingLeft: 14 }}>└</span> : <span>{r.name}</span>}{' '}
          {!r.hasLedger && <Tag tone={E.inkMute} title="원장 전표가 아직 없습니다 — 첫 「지금 개수」가 기초재고가 됩니다">원장 없음</Tag>}
        </td>
        <td style={textTd}>{r.option || '—'}</td>
        {cell('self')}
        {cell('rg_inbound')}
        <td style={numTdStyle}>{won(r.rg)}</td>
        <td style={numTdStyle}>{actual === null ? '—' : won(actual)}</td>
        <td style={{ ...numTdStyle, color: diff ? E.loss : E.inkMute }}>
          {diff === null ? '—' : diff === 0 ? '0' : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {diff > 0 ? '+' : ''}{won(diff)}
              <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onRgApply(r); }} style={smallBtn}>
                반영
              </button>
            </span>
          )}
        </td>
        <td style={numTdStyle}>{cost === null ? '—' : won(cost)}</td>
        <td style={numTdStyle}>{won(r.value)}</td>
      </tr>
    );
  };

  const groupRow = (v: GroupView, open: boolean) => {
    const g = v.group;
    const i = stripe++;
    const stagedN = g.options.filter((r) => staged.has(stageKey(r.skuId, 'self')) || staged.has(stageKey(r.skuId, 'rg_inbound'))).length;
    return (
      <tr
        key={`g:${g.name}`}
        aria-expanded={open}
        onClick={() => { if (!forceOpen) toggle(g.name); }}
        style={{ height: E.rowH, cursor: forceOpen ? 'default' : 'pointer', background: i % 2 ? E.chrome2 : E.surface, fontWeight: 600 }}
      >
        <td style={textTd}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>{g.name}</span>
            <Tag tone={E.inkSub}>{v.shown.length < g.options.length ? `옵션 ${v.shown.length}/${g.options.length}` : `옵션 ${g.options.length}`}</Tag>
            {stagedN > 0 && <Tag tone={E.warn}>담김 {stagedN}</Tag>}
          </span>
        </td>
        <td style={{ ...textTd, color: E.inkMute }}>합계</td>
        <td style={numTdStyle}>{won(g.self)}</td>
        <td style={numTdStyle}>{won(g.rgInbound)}</td>
        <td style={numTdStyle}>{won(g.rg)}</td>
        <td style={numTdStyle}>{g.rgActual === null ? '—' : won(g.rgActual)}</td>
        <td style={{ ...numTdStyle, color: g.rgMismatch ? E.loss : E.inkMute }}>
          {g.rgMismatch === null ? '—' : g.rgMismatch === 0 ? '0' : `불일치 ${g.rgMismatch}옵션`}
        </td>
        <td style={numTdStyle}>—</td>
        <td style={numTdStyle}>{won(g.value)}</td>
      </tr>
    );
  };

  return (
    <div style={{ background: E.surface, border: `1px solid ${E.line}`, overflow: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
      <div style={bandStyle}>
        <span style={{ flex: 1 }}>
          상품별 재고 — 원장 기준 · 상품 줄을 누르면 옵션이 펼쳐집니다 · 집·RG입고중 칸을 누르면 고칩니다 · 옵션 줄을 누르면 입출 이력
        </span>
        <button type="button" disabled={forceOpen} onClick={() => setExpanded(new Set(multi.map((v) => v.group.name)))} style={smallBtn}>
          전체 펼치기
        </button>
        <button type="button" disabled={forceOpen} onClick={() => setExpanded(new Set())} style={smallBtn}>
          전체 접기
        </button>
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr>{HEADERS.map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {views.map((v) => {
            if (v.group.options.length === 1) return optionRow(v.shown[0], false);
            const open = forceOpen || expanded.has(v.group.name);
            return (
              <React.Fragment key={`g:${v.group.name}`}>
                {groupRow(v, open)}
                {open && v.shown.map((r) => optionRow(r, true))}
              </React.Fragment>
            );
          })}
          {views.length === 0 && (
            <tr><td colSpan={HEADERS.length} style={{ padding: 24, textAlign: 'center', color: E.inkMute, fontSize: 12 }}>표시할 SKU가 없습니다</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 8: 컨테이너가 묶음을 넘긴다**

`src/components/erp/stock/StockClient.tsx`에서 네 곳을 고친다.

(1) import
```tsx
import {
  computeKpis, defaultCost, editDiff, filterRows, parseRecon, rgDiff, stageKey, summarizeStaged, toAdjustItems, toExportCsv, won,
  type EditLocation, type Filters, type RgRecon, type StagedEdit, type StockRow,
} from './stock-view';
```
을 아래로.
```tsx
import {
  computeKpis, defaultCost, editDiff, filterGroups, filterRows, filtersActive, groupRows, parseRecon, rgDiff, stageKey, summarizeStaged,
  toAdjustItems, toExportCsv, won,
  type EditLocation, type Filters, type RgRecon, type StagedEdit, type StockRow,
} from './stock-view';
```

(2)
```tsx
  const visible = useMemo(() => filterRows(rows, filters, recon), [rows, filters, recon]);
```
을 아래로(내보내기·상태바는 SKU 단위 그대로 `visible`을 쓴다).
```tsx
  const visible = useMemo(() => filterRows(rows, filters, recon), [rows, filters, recon]);
  const groups = useMemo(() => groupRows(rows, recon), [rows, recon]);
  const views = useMemo(() => filterGroups(groups, filters, recon), [groups, filters, recon]);
```

(3)
```tsx
          <StockTable
            rows={visible}
```
을 아래로.
```tsx
          <StockTable
            views={views}
            forceOpen={filtersActive(filters)}
```

(4)
```tsx
            <span>표시 <span style={statNumStyle}>{visible.length}</span> / {rows.length} SKU</span>
```
을 아래로.
```tsx
            <span>
              표시 상품 <span style={statNumStyle}>{views.length}</span> · SKU <span style={statNumStyle}>{visible.length}</span> / {rows.length} SKU
            </span>
```

- [ ] **Step 9: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/components/erp-stock-table.test.tsx src/__tests__/components/erp-stock-view.test.ts src/__tests__/components/erp-stock-edit-cell.test.tsx && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/components/erp/stock/StockTable.tsx src/components/erp/stock/StockClient.tsx src/__tests__/components/erp-stock-table.test.tsx
git commit -m "feat(erp): 재고현황 상품 단위 묶어 보기 — 합계 줄·펼치기/접기·옵션에 거는 조회조건"
```

- [ ] **Step 10: 🔴 화면 확인 — 컨트롤러가 직접(서브에이전트 아님)**

개발 서버·로그인은 Task 4 Step 17 그대로. 1440px로 `http://localhost:3000/erp/stock`을 연다. 확인: 옵션 여러 개인 상품이 「▸ 상품명 [옵션 N]」 합계 한 줄로 접혀 있음 · 누르면 옵션 행(└ 들여쓰기)이 펼쳐지고 다시 누르면 접힘 · 「전체 펼치기/접기」 · 옵션 1개 상품은 한 줄이고 집·RG입고중 칸 편집 팝오버가 뜸(「취소」로 닫는다) · 묶음 줄 칸은 편집이 뜨지 않음 · 검색어를 넣으면 맞는 옵션만 펼쳐져 보이고 묶음 태그가 「옵션 k/N」 · 「재고 있는 것만」·「RG 불일치만」(대조 후)도 같은 방식 · 실사 모드에서 옵션 칸을 담으면 접힌 묶음 줄에 「담김 n」 · 상태바 「표시 상품 · SKU」 · 콘솔 오류 없음. 🔴 **저장·반영 버튼은 누르지 않는다.** 깨진 곳은 고쳐 `fix(erp): …`로 커밋하고 스크린샷 한 장을 사용자에게 보여준다.

---
### Task 4c: 센 기록과 오늘 셀 목록

> 결정 5(2026-09-26 추가) · 「추가 설계」: **센 기록 `erp.stock_counts`** — `count` 방식 입력은 차이가 0이어도 한 줄 남긴다(원장 전표는 여전히 차이가 있을 때만). **오늘 셀 목록** — 집(`self`)에서 매일 N개(기본 8), ① 한 번도 안 센 SKU 중 재고 금액 큰 순 ② 마지막 실사가 오래된 순(같으면 금액 큰 순). 오늘 이미 센 것은 빠지고, 재고 0이고 원장 전표도 없는 SKU는 제외. 날마다 저장하지 않고 요청 때 계산. 해석은 「설계 해석」 15번.

**Files:**
- Create: `supabase/migrations/116_erp_stock_counts.sql`
- Modify: `src/lib/erp/ledger/adjust-store.ts`, `src/lib/erp/ledger/opening-import.ts`, `src/app/api/erp/stock/import/route.ts`, `src/lib/erp/stock/http.ts`, `src/lib/erp/stock/queries.ts`, `scripts/erp/ledger-selftest.ts`
- Create: `src/lib/erp/stock/count-queue.ts`, `src/app/api/erp/stock/count-queue/route.ts`, `src/components/erp/stock/CountQueuePanel.tsx`
- Modify: `src/components/erp/stock/stock-view.ts`, `src/components/erp/stock/api.ts`, `src/components/erp/stock/EditCell.tsx`, `src/components/erp/stock/StockTable.tsx`, `src/components/erp/stock/StockClient.tsx`
- Modify(테스트): `src/__tests__/lib/erp/ledger/adjust-store.test.ts`, `src/__tests__/lib/erp/ledger/opening-import.test.ts`, `src/__tests__/api/erp-stock-import.test.ts`, `src/__tests__/api/erp-stock.test.ts`, `src/__tests__/components/erp-stock-view.test.ts`, `src/__tests__/components/erp-stock-edit-cell.test.tsx`, `src/__tests__/components/erp-stock-table.test.tsx`
- Test: `src/__tests__/lib/erp/stock/count-queue.test.ts`, `src/__tests__/api/erp-stock-count-queue.test.ts`, `src/__tests__/components/erp-count-queue-panel.test.tsx`

#### 4c-A. 마이그레이션 116 — 센 기록

- [ ] **Step 1: 마이그레이션 작성**

`supabase/migrations/116_erp_stock_counts.sql`:
```sql
-- 116_erp_stock_counts.sql
-- ERP 1-C1 추가(2026-09-26 결정 5). 「센 기록」 — 사람이 실제로 센 개수를 차이가 없어도 남긴다.
-- 원장(stock_ledger)은 재고가 바뀔 때만 전표를 쓰므로 「세어 봤더니 맞았다」가 남지 않는다 → 오늘 셀 목록(순환 실사)이
-- 마지막 실사 시각을 알 수 없다. 원장 전표는 여전히 차이가 있을 때만 쓴다.
--   ledger_qty          = 센 시점(SKU 잠금 안)의 그 위치 원장 재고
--   adjustment_idem_key = 그때 쓴 조정·기초 전표의 원 멱등키(adj:<uuid> · opening:<sku>:<위치>). 차이 0이면 null.
--                         차감 전표의 행 키는 뒤에 #순번이 붙어 이 값과 같지 않으므로 FK를 걸지 않는다
--   request_id          = 화면 요청 id(조정의 requestId). unique — 같은 요청의 재전송이 두 줄을 만들지 않는다.
--                         실사표 불러오기는 서버가 줄마다 새로 만든다
--   counted_at          = 센 시각(화면 조정 = 기록 시각, 실사표 = 실사를 마친 시각)
-- 고치거나 지우는 경로는 없다(앱은 insert만 한다). 조정을 되돌려도 「그때 그렇게 셌다」는 남는다.

create table if not exists erp.stock_counts (
  id                   bigserial   primary key,
  sku_id               bigint      not null references erp.skus(id),
  location             text        not null check (location in ('self', 'rg_inbound', 'rg')),
  counted_qty          integer     not null check (counted_qty >= 0),
  ledger_qty           integer     not null check (ledger_qty >= 0),
  adjustment_idem_key  text,
  counted_at           timestamptz not null default now(),
  request_id           uuid        not null,
  created_at           timestamptz not null default now(),
  constraint stock_counts_request_id_key unique (request_id)
);

-- 「SKU별 집 마지막 실사」(재고 목록·오늘 셀 목록)를 읽는 순서
create index if not exists stock_counts_last_idx on erp.stock_counts (sku_id, location, counted_at desc);

alter table erp.stock_counts enable row level security;
```

- [ ] **Step 2: 적용**

Run: `node scripts/apply-migration.mjs 116`
Expected: `✅ 116_erp_stock_counts.sql`, exit 0. (**운영 적용 허용** — 새 테이블이고 기존 행을 건드리지 않는다.)

- [ ] **Step 3: 확인** (읽기 전용)

```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
const cols=await c.query(\"select column_name, data_type, is_nullable from information_schema.columns where table_schema='erp' and table_name='stock_counts' order by ordinal_position\");
console.log(cols.rows.map(x=>x.column_name+' '+x.data_type+' '+x.is_nullable).join('\n'));
const u=await c.query(\"select conname from pg_constraint where conrelid='erp.stock_counts'::regclass and contype='u'\");
const r=await c.query(\"select relrowsecurity from pg_class where oid='erp.stock_counts'::regclass\");
const n=await c.query('select count(*)::int n from erp.stock_counts');
console.log('unique:',u.rows.map(x=>x.conname).join(','),'· rls:',r.rows[0].relrowsecurity,'· 행:',n.rows[0].n);await c.end()})()"
```
Expected: 9칸(`id` … `request_id uuid NO` · `created_at`), `unique: stock_counts_request_id_key · rls: true · 행: 0`.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/116_erp_stock_counts.sql
git commit -m "feat(erp): 마이그레이션 116 — 센 기록 erp.stock_counts(차이 0인 실사도 남긴다)"
```

#### 4c-B. 조정이 센 기록을 남긴다

- [ ] **Step 5: 실패하는 테스트 작성**

`src/__tests__/lib/erp/ledger/adjust-store.test.ts`에서 세 곳을 고친다.

(1) 가짜 DB 옵션 — 
```ts
  /** 같은 요청 id로 이미 기록된 전표의 SKU·위치 */
  dup?: { sku_id: number; location: string };
```
을 아래로.
```ts
  /** 같은 요청 id로 이미 기록된 전표의 SKU·위치 */
  dup?: { sku_id: number; location: string };
  /** 같은 요청 id로 이미 남은 센 기록의 SKU·위치(차이 0 실사는 전표 없이 이것만 남는다) */
  countDup?: { sku_id: number; location: string };
```

(2) 가짜 DB 분기 —
```ts
      if (sql.startsWith('select sku_id, location from erp.stock_ledger where ref_type')) return { rows: o.dup ? [o.dup] : [], rowCount: o.dup ? 1 : 0 };
```
을 아래로.
```ts
      if (sql.startsWith('select sku_id, location from erp.stock_ledger where ref_type')) return { rows: o.dup ? [o.dup] : [], rowCount: o.dup ? 1 : 0 };
      if (sql.startsWith('select sku_id, location from erp.stock_counts')) return { rows: o.countDup ? [o.countDup] : [], rowCount: o.countDup ? 1 : 0 };
      if (sql.startsWith('insert into erp.stock_counts')) return { rows: [], rowCount: 1 };
```

(3) `const inserts = …` 줄 바로 아래에 넣는다.
```ts
const countInserts = (calls: { sql: string; params: unknown[] }[]) => calls.filter((c) => c.sql.startsWith('insert into erp.stock_counts'));
```

그리고 파일 끝(`describe('ensureCutover', …)` 뒤)에 더한다.
```ts

describe('센 기록(stock_counts)', () => {
  // 넣는 칸 순서: sku_id, location, counted_qty, ledger_qty, adjustment_idem_key, request_id, counted_at
  it('지금 개수는 차이가 0이어도 센 기록 한 줄(조정 키 null) — 원장에는 쓰지 않는다', async () => {
    const f = fakeDb({ onHand: { qty: 5, n: 1 } });
    const r = await applyAdjustment(f.db, input({ value: 5, expected: 5 }));
    expect(r.outcome).toBe('noop');
    expect(inserts(f.calls)).toHaveLength(0);
    expect(countInserts(f.calls).map((c) => c.params)).toEqual([[7, 'self', 5, 5, null, REQ, AT]]);
  });

  it('차이가 있으면 센 기록에 그 조정의 원 멱등키(adj:<uuid>, #순번 없음)', async () => {
    const f = fakeDb({ onHand: { qty: 10, n: 2 }, lots: [{ lot_id: 1, qty: 10, unit_cost: 700, lot_at: 1 }] });
    await applyAdjustment(f.db, input({ value: 7, expected: 10, reason: 'damage' }));
    expect(countInserts(f.calls).map((c) => c.params)).toEqual([[7, 'self', 7, 10, `adj:${REQ}`, REQ, AT]]);
  });

  it('빈 위치의 첫 지금 개수는 기초 키(opening:<sku>:<위치>)', async () => {
    const f = fakeDb({ onHand: { qty: 0, n: 0 } });
    await applyAdjustment(f.db, input({ unitCost: 700 }));
    expect(countInserts(f.calls).map((c) => c.params)).toEqual([[7, 'self', 5, 0, 'opening:7:self', REQ, AT]]);
  });

  it('RG 대조도 지금 개수라 센 기록(위치 rg)', async () => {
    const f = fakeDb({ onHand: { qty: 4, n: 1 } });
    await applyAdjustment(f.db, input({ location: 'rg', reason: 'rg_reconcile', value: 4, expected: 4 }));
    expect(countInserts(f.calls).map((c) => c.params[1])).toEqual(['rg']);
  });

  it('±수량은 센 개수가 아니다 — 센 기록을 남기지 않는다', async () => {
    const f = fakeDb({ onHand: { qty: 2, n: 1 }, lotCost: 800 });
    await applyAdjustment(f.db, input({ mode: 'delta', value: 3, expected: undefined, reason: 'return_in' }));
    expect(countInserts(f.calls)).toHaveLength(0);
  });

  it('차이 0 실사의 재전송은 센 기록으로 알아본다 — duplicate, 재고를 읽지도 더 쓰지도 않는다', async () => {
    const f = fakeDb({ countDup: { sku_id: 7, location: 'self' }, onHand: { qty: 5, n: 1 } });
    const r = await applyAdjustment(f.db, input({ value: 5, expected: 5 }));
    expect(r.outcome).toBe('duplicate');
    expect(f.calls.some((c) => c.sql.startsWith('select coalesce(sum(qty)'))).toBe(false);
    expect(countInserts(f.calls)).toHaveLength(0);
  });

  it('센 기록에 쓰인 요청 id가 다른 SKU·위치면 AdjustInputError(duplicate로 삼키지 않는다)', async () => {
    const f = fakeDb({ countDup: { sku_id: 8, location: 'self' }, onHand: { qty: 5, n: 1 } });
    await expect(applyAdjustment(f.db, input({ value: 5, expected: 5 }))).rejects.toBeInstanceOf(AdjustInputError);
    expect(countInserts(f.calls)).toHaveLength(0);
  });

  it('화면 재고가 낡았으면(StaleCountError) 센 기록도 남기지 않는다', async () => {
    const f = fakeDb({ onHand: { qty: 4, n: 1 } });
    await expect(applyAdjustment(f.db, input({ value: 3, expected: 5 }))).rejects.toBeInstanceOf(StaleCountError);
    expect(countInserts(f.calls)).toHaveLength(0);
  });
});
```

`src/__tests__/api/erp-stock.test.ts`의 `describe('erpError', () => {` 블록 안 첫 테스트 바로 뒤에 더한다.
```ts

  it('센 기록 요청 id unique 위반(23505)도 409 — 겹친 요청이 먼저 셌다', async () => {
    const e = Object.assign(new Error('duplicate key value violates unique constraint "stock_counts_request_id_key"'), {
      code: '23505', constraint: 'stock_counts_request_id_key',
    });
    const res = erpError(e);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('conflict');
  });
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger/adjust-store.test.ts src/__tests__/api/erp-stock.test.ts`
Expected: 새 테스트 FAIL — 센 기록 insert가 없다(0건) · duplicate 판정이 센 기록을 보지 않는다 · 센 기록 unique 위반이 500. 기존 테스트는 PASS.

- [ ] **Step 7: 구현 — `adjust-store.ts`**

`src/lib/erp/ledger/adjust-store.ts`의 머리 주석 3행
```ts
// 순서: 입력 검사 → SKU 잠금 → 같은 요청 확인 → 그 위치 재고 → 규칙(adjust.ts) → FIFO 차감 또는 새 lot → (기초면) 커서.
```
을 아래로.
```ts
// 순서: 입력 검사 → SKU 잠금 → 같은 요청 확인(전표·센 기록) → 그 위치 재고 → 규칙(adjust.ts) → FIFO 차감 또는 새 lot → (기초면) 커서
//       → (지금 개수면) 센 기록(erp.stock_counts — 차이가 0이어도 한 줄. 오늘 셀 목록이 마지막 실사를 여기서 읽는다).
```

`export async function applyAdjustment(` 부터 그 함수 끝(`/** 여러 건(실사 모드·RG 일괄 반영).` 주석 바로 앞)까지를 아래로 바꾼다.
```ts
const NONE = { kind: null, qty: 0, idemKey: null, unitCost: null, costSource: null } as const;

/** 센 기록 한 줄(erp.stock_counts). 지금 개수 방식만 부른다 — ±수량은 센 개수가 아니다. 호출자가 SKU를 잠갔다 */
export async function recordCount(
  db: Db,
  c: { skuId: number; location: Location; countedQty: number; ledgerQty: number; idemKey: string | null; requestId: string; countedAt: string },
): Promise<void> {
  await db.query(
    `insert into erp.stock_counts (sku_id, location, counted_qty, ledger_qty, adjustment_idem_key, request_id, counted_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [c.skuId, c.location, c.countedQty, c.ledgerQty, c.idemKey, c.requestId, c.countedAt],
  );
}

export async function applyAdjustment(db: Db, p: AdjustInput): Promise<AdjustResult> {
  validateAdjustInput(p);
  const base = { skuId: p.skuId, location: p.location, requestId: p.requestId };
  await lockSku(db, p.skuId);

  // 같은 요청 id의 재전송만 duplicate다. 다른 SKU·위치에 쓰인 id면 조용히 삼키지 않고 거부한다.
  // 차이 0인 지금 개수는 원장에 아무것도 쓰지 않으므로 센 기록도 함께 본다 — 재전송이 센 기록을 두 줄 만들지 않게
  for (const sql of [
    `select sku_id, location from erp.stock_ledger where ref_type = 'adjust' and ref_id = $1 limit 1`,
    `select sku_id, location from erp.stock_counts where request_id = $1 limit 1`,
  ]) {
    const dup = await db.query(sql, [p.requestId]);
    if (dup.rows.length === 0) continue;
    const d = dup.rows[0];
    if (Number(d.sku_id) === p.skuId && d.location === p.location) return { ...base, outcome: 'duplicate', ...NONE };
    throw new AdjustInputError('요청 id가 다른 조정에 이미 쓰였다');
  }

  const { rows } = await db.query(
    `select coalesce(sum(qty), 0)::int as qty, count(*)::int as n from erp.stock_ledger where sku_id = $1 and location = $2`,
    [p.skuId, p.location],
  );
  const onHand = Number(rows[0].qty);
  const step = planAdjustment({ mode: p.mode, value: p.value, expected: p.expected, onHand, locationEmpty: Number(rows[0].n) === 0 });
  const out = await postStep(db, p, step);
  if (p.mode === 'count') {
    await recordCount(db, {
      skuId: p.skuId, location: p.location, countedQty: p.value, ledgerQty: onHand, idemKey: out.idemKey, requestId: p.requestId, countedAt: p.occurredAt,
    });
  }
  return out;
}

/** 규칙이 정한 한 걸음을 원장에 쓴다: 차이 0 → 기록 없음 · 음수 → FIFO 차감 · 양수 → 새 lot(단가: 입력 → 최근 lot → 옛 입고) */
async function postStep(db: Db, p: AdjustInput, step: ReturnType<typeof planAdjustment>): Promise<AdjustResult> {
  const base = { skuId: p.skuId, location: p.location, requestId: p.requestId };
  if (step.diff === 0) return { ...base, outcome: 'noop', ...NONE };

  const ref = { refType: 'adjust', refId: p.requestId, note: p.note };
  if (step.diff < 0) {
    const idemKey = adjustIdemKey(p.requestId);
    const r = await postConsume(db, {
      skuId: p.skuId, location: p.location, qty: -step.diff, kind: 'adjust', reason: p.reason, occurredAt: p.occurredAt, idemKey, ...ref,
    });
    // 잠금 안에서 요청 id를 확인했으니 여기 오면 불변식 위반이다(입력 오류가 아니라 500)
    if (!r.posted) throw new Error(`멱등키 ${idemKey}가 이미 있다`);
    return { ...base, outcome: 'posted', kind: 'adjust', qty: step.diff, idemKey, unitCost: null, costSource: null };
  }

  // 단가는 필요한 만큼만 조회한다: 입력 → 최근 lot → 옛 입고
  let cost = pickUnitCost(p.unitCost, null, null);
  if (!cost) cost = pickUnitCost(undefined, await latestLotCost(db, p.skuId), null);
  if (!cost) cost = pickUnitCost(undefined, null, await legacyUnitCost(db, p.skuId));
  if (!cost) throw new CostRequiredError(p.skuId);

  const opening = step.lotKind === 'opening';
  const idemKey = opening ? openingIdemKey(p.skuId, p.location) : adjustIdemKey(p.requestId);
  const r = await postLotCreate(db, {
    skuId: p.skuId, location: p.location, qty: step.diff, unitCost: cost.unitCost, kind: step.lotKind,
    reason: opening ? 'opening' : p.reason, occurredAt: p.occurredAt, idemKey, ...ref,
  });
  // 기초 키는 빈 위치에서만 쓰고 조정 키는 요청 id가 새것일 때만 쓰므로 여기 오면 불변식 위반이다(500)
  if (!r.posted) throw new Error(`멱등키 ${idemKey}가 이미 있다`);
  if (step.setsCutover) await ensureCutover(db, p.occurredAt);
  return { ...base, outcome: 'posted', kind: step.lotKind, qty: step.diff, idemKey, unitCost: cost.unitCost, costSource: cost.source };
}

```

같은 파일 `AdjustResult`의 `outcome` 주석
```ts
  /** posted = 기록 · duplicate = 같은 요청이 이미 기록됨 · noop = 차이 0 */
```
을 아래로.
```ts
  /** posted = 기록 · duplicate = 같은 요청이 이미 기록됨 · noop = 차이 0(지금 개수면 센 기록만 남는다) */
```

- [ ] **Step 8: 구현 — 센 기록 unique 위반도 409**

`src/lib/erp/stock/http.ts`의
```ts
/** Postgres unique 위반(23505) 중 erp.stock_ledger.idem_key */
function isIdemKeyConflict(e: unknown): boolean {
  const pg = e as { code?: unknown; constraint?: unknown } | null;
  return !!pg && pg.code === '23505' && typeof pg.constraint === 'string' && pg.constraint.includes('idem_key');
}
```
을 아래로.
```ts
/** Postgres unique 위반(23505) 중 erp.stock_ledger.idem_key · erp.stock_counts.request_id(겹친 같은 요청이 먼저 셌다) */
function isIdemKeyConflict(e: unknown): boolean {
  const pg = e as { code?: unknown; constraint?: unknown } | null;
  return !!pg && pg.code === '23505' && typeof pg.constraint === 'string'
    && (pg.constraint.includes('idem_key') || pg.constraint === 'stock_counts_request_id_key');
}
```

- [ ] **Step 9: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/lib/erp/ledger/adjust-store.test.ts src/__tests__/api/erp-stock.test.ts src/__tests__/api/erp-stock-rg.test.ts && npx tsc --noEmit`
Expected: 전부 PASS(기존 + 새 9), 0 오류
```bash
git add src/lib/erp/ledger/adjust-store.ts src/lib/erp/stock/http.ts src/__tests__/lib/erp/ledger/adjust-store.test.ts src/__tests__/api/erp-stock.test.ts
git commit -m "feat(erp): 지금 개수마다 센 기록 — 차이 0도 남기고 재전송은 센 기록으로 중복 판정"
```

#### 4c-C. 실사표 불러오기도 집 센 개수를 남긴다

> 불러오기가 센 기록을 남기지 않으면 기초재고를 막 센 SKU들이 「한 번도 안 센 SKU」로 오늘 셀 목록 맨 앞을 채운다.

- [ ] **Step 10: 실패하는 테스트 작성**

`src/__tests__/lib/erp/ledger/opening-import.test.ts`에서 네 곳을 고친다.

(1) `describe('planOpeningImport', () => {`의 첫 테스트 끝
```ts
    expect(p.totals).toEqual({ self: 3, rgInbound: 1, rg: 2, value: 6000, entries: 3 });
  });
```
을 아래로.
```ts
    expect(p.totals).toEqual({ self: 3, rgInbound: 1, rg: 2, value: 6000, entries: 3 });
    expect(p.selfCounts).toEqual([{ skuId: 7, qty: 3 }]);
  });

  it('집 0개로 센 행도 센 개수로 남긴다(전표는 없다) · 빈칸·전표 있는 SKU는 남기지 않는다', () => {
    expect(planOpeningImport({ ...base, rows: [row({ selfCount: 0 })] }).selfCounts).toEqual([{ skuId: 7, qty: 0 }]);
    expect(planOpeningImport({ ...base, rows: [row({ selfCount: null })] }).selfCounts).toEqual([]);
    expect(planOpeningImport({ ...base, rows: [row({ selfCount: 3 })], stockedSkuIds: new Set([7]) }).selfCounts).toEqual([]);
  });
```

(2) 가짜 DB 분기 —
```ts
      if (sql.startsWith('insert into erp.sync_cursors')) return { rows: [], rowCount: 1 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
```
을 아래로(이 파일의 가짜 DB는 하나뿐이다).
```ts
      if (sql.startsWith('insert into erp.sync_cursors')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('insert into erp.stock_counts')) return { rows: [], rowCount: 1 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
```

(3) `describe('commitOpeningImport', () => {` 안의
```ts
  const AT = '2026-09-27T01:00:00.000Z';
```
을 아래로.
```ts
  const AT = '2026-09-27T01:00:00.000Z';
  const COUNTED = '2026-09-27T09:30:00+09:00';
  const opts = { fileName: 'count.csv', cutoverAt: AT, countedAt: COUNTED, selfCounts: [] as { skuId: number; qty: number }[] };
```
그리고 이 블록의 `commitOpeningImport(f.db, plan, { fileName: 'count.csv', cutoverAt: AT })` 두 곳을 모두 `commitOpeningImport(f.db, plan, opts)`로 바꾼다.

(4) `describe('commitOpeningImport', () => {` 블록 끝(마지막 `it` 뒤)에 더한다.
```ts

  it('집 센 개수마다 센 기록 — 0개도(조정 키 null), 전표를 쓴 집은 기초 키 · 0개로 센 SKU도 잠그고 빈 원장을 확인한다', async () => {
    const f = fakeDb();
    await commitOpeningImport(f.db, plan, { ...opts, selfCounts: [{ skuId: 9, qty: 2 }, { skuId: 7, qty: 3 }, { skuId: 5, qty: 0 }] });
    const locks = f.calls.filter((c) => c.sql.startsWith('select pg_advisory_xact_lock($1::int')).map((c) => c.params[1]);
    expect(locks.slice(0, 3)).toEqual([5, 7, 9]);
    const counts = f.calls.filter((c) => c.sql.startsWith('insert into erp.stock_counts'));
    // [sku_id, location, counted_qty, ledger_qty, adjustment_idem_key, counted_at]
    expect(counts.map((c) => [c.params[0], c.params[1], c.params[2], c.params[3], c.params[4], c.params[6]])).toEqual([
      [5, 'self', 0, 0, null, COUNTED],
      [7, 'self', 3, 0, 'opening:7:self', COUNTED],
      [9, 'self', 2, 0, 'opening:9:self', COUNTED],
    ]);
    // 요청 id는 줄마다 새 uuid
    expect(new Set(counts.map((c) => c.params[5])).size).toBe(3);
    expect(String(counts[0].params[5])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('0개로 센 SKU에 미리보기 뒤 전표가 생겼어도 ImportConflictError', async () => {
    const f = fakeDb({ 5: 1 });
    await expect(commitOpeningImport(f.db, plan, { ...opts, selfCounts: [{ skuId: 5, qty: 0 }] })).rejects.toBeInstanceOf(ImportConflictError);
    expect(f.calls.some((c) => c.sql.startsWith('insert'))).toBe(false);
  });
```

`src/__tests__/api/erp-stock-import.test.ts`의 `it('단가를 입력하면 한 트랜잭션으로 적재한다', …)`에서
```ts
    const json = await (await POST(post({ csv: CSV, fileName: 'count.csv', countedAt: new Date().toISOString(), unitCostOverrides: { k9: 800 }, commit: true }))).json();
```
을 아래로.
```ts
    const countedAt = new Date().toISOString();
    const json = await (await POST(post({ csv: CSV, fileName: 'count.csv', countedAt, unitCostOverrides: { k9: 800 }, commit: true }))).json();
```
그리고 같은 테스트의
```ts
    expect(opts).toEqual({ fileName: 'count.csv', cutoverAt: json.data.cutoverAt });
```
를 아래로.
```ts
    expect(opts).toEqual({ fileName: 'count.csv', cutoverAt: json.data.cutoverAt, countedAt, selfCounts: [{ skuId: 7, qty: 3 }, { skuId: 9, qty: 1 }] });
    expect(json.data.selfCounts).toBeUndefined(); // 적재용 내부 값 — 응답에 싣지 않는다
```

- [ ] **Step 11: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger/opening-import.test.ts src/__tests__/api/erp-stock-import.test.ts`
Expected: 새 테스트와 바뀐 `opts` 비교 FAIL(`selfCounts` 없음 · 센 기록 insert 0건)

- [ ] **Step 12: 구현**

`src/lib/erp/ledger/opening-import.ts`에서 다섯 곳을 고친다.

(1) import
```ts
import { lockSku, postLotCreate, type Db } from './store';
import { ensureCutover } from './adjust-store';
import { openingIdemKey } from './adjust';
```
을 아래로.
```ts
import { randomUUID } from 'node:crypto';
import { lockSku, postLotCreate, type Db } from './store';
import { ensureCutover, recordCount } from './adjust-store';
import { openingIdemKey } from './adjust';
```

(2) `ImportPreview`의
```ts
  totals: ImportTotals;
}

/** /api/erp/stock/import 응답 */
export interface ImportSummary extends Omit<ImportPreview, 'plan'> {
```
를 아래로.
```ts
  totals: ImportTotals;
  /** 불러올 SKU의 집 센 개수(0 포함) — 적재 때 센 기록(erp.stock_counts)으로 남긴다. 응답에는 싣지 않는다 */
  selfCounts: { skuId: number; qty: number }[];
}

/** /api/erp/stock/import 응답 */
export interface ImportSummary extends Omit<ImportPreview, 'plan' | 'selfCounts'> {
```

(3) `planOpeningImport`의 반환
```ts
  return {
    plan, errors, warnings, excluded,
```
를 아래로.
```ts
  return {
    plan, errors, warnings, excluded,
    selfCounts: included.map((r) => ({ skuId: r.skuId, qty: r.selfCount ?? 0 })),
```

(4) `commitOpeningImport` 전체를 아래로 바꾼다.
```ts
/** 호출자 트랜잭션 안에서 기초 전표를 쓴다. 전역 잠금 → SKU 오름차순 잠금·빈 원장 재확인 → 전표 → 집 센 기록 → 커서.
 *  집 0개로 센 SKU는 전표가 없지만 센 기록은 남긴다 — 그 SKU도 잠그고 빈 원장을 다시 확인한다 */
export async function commitOpeningImport(
  db: Db,
  plan: ImportPlanRow[],
  p: { fileName: string; cutoverAt: string; countedAt: string; selfCounts: { skuId: number; qty: number }[] },
): Promise<number> {
  await db.query('select pg_advisory_xact_lock($1::bigint)', [OPENING_LOCK]);
  const ids = [...new Set([...plan.map((r) => r.skuId), ...p.selfCounts.map((c) => c.skuId)])].sort((a, b) => a - b);
  for (const id of ids) {
    await lockSku(db, id);
    const { rows } = await db.query('select count(*)::int as n from erp.stock_ledger where sku_id = $1', [id]);
    if (Number(rows[0].n) > 0) throw new ImportConflictError(`SKU ${id}에 미리보기 뒤 전표가 생겼다 — 다시 미리보기한다`);
  }
  let n = 0;
  for (const r of [...plan].sort((a, b) => a.skuId - b.skuId)) {
    const res = await postLotCreate(db, {
      skuId: r.skuId, location: r.location, qty: r.qty, unitCost: r.unitCost, kind: 'opening', reason: 'opening',
      occurredAt: p.cutoverAt, idemKey: openingIdemKey(r.skuId, r.location), refType: 'opening', refId: p.fileName,
    });
    if (res.posted) n++;
  }
  // 센 시각 = 실사를 마친 시각(기초 전표 시각 cutoverAt과 다르다). 빈 원장을 확인했으니 원장 재고는 0
  const selfPosted = new Set(plan.filter((r) => r.location === 'self').map((r) => r.skuId));
  for (const c of [...p.selfCounts].sort((a, b) => a.skuId - b.skuId)) {
    await recordCount(db, {
      skuId: c.skuId, location: 'self', countedQty: c.qty, ledgerQty: 0,
      idemKey: selfPosted.has(c.skuId) ? openingIdemKey(c.skuId, 'self') : null,
      requestId: randomUUID(), countedAt: p.countedAt,
    });
  }
  if (n > 0) await ensureCutover(db, p.cutoverAt);
  return n;
}
```

(5) `src/app/api/erp/stock/import/route.ts`의
```ts
    const committed = await withTx((c) => commitOpeningImport(c, p.plan, { fileName, cutoverAt }));
```
를 아래로(`countedAt`은 `planOpeningImport`가 검사했다 — 오류가 있으면 여기 오지 않는다).
```ts
    const committed = await withTx((c) => commitOpeningImport(c, p.plan, { fileName, cutoverAt, countedAt, selfCounts: p.selfCounts }));
```

- [ ] **Step 13: 자가시험에 센 기록 두 줄을 더한다**

`scripts/erp/ledger-selftest.ts`의
```ts
    check('같은 요청 재전송은 duplicate(기록 없음)', again2.outcome === 'duplicate');
```
바로 아래에 넣는다.
```ts

    // 센 기록(116): 지금 개수는 차이가 0이어도 한 줄 · 그 재전송은 센 기록으로 duplicate
    const reqSame = randomUUID();
    const same = { skuId: adj, location: 'self' as const, mode: 'count' as const, value: 3, expected: 3, reason: 'count_diff' as const, requestId: reqSame, occurredAt: '2026-02-02T10:00:00+09:00' };
    const oSame = await applyAdjustment(c, { ...same });
    const againSame = await applyAdjustment(c, { ...same });
    const counts = (await c.query(
      'select counted_qty, ledger_qty, adjustment_idem_key from erp.stock_counts where sku_id = $1 order by id', [adj],
    )).rows;
    check('지금 개수마다 센 기록 한 줄 — 기초·조정 키, 차이 0은 null',
      oSame.outcome === 'noop' && counts.length === 3
        && counts[0].adjustment_idem_key === `opening:${adj}:self` && counts[1].adjustment_idem_key === `adj:${req2}`
        && counts[2].adjustment_idem_key === null && counts[2].counted_qty === 3 && counts[2].ledger_qty === 3,
      JSON.stringify(counts));
    check('차이 0 실사의 재전송은 duplicate — 센 기록을 더 쓰지 않는다', againSame.outcome === 'duplicate' && counts.length === 3, againSame.outcome);
```
그리고 머리 주석의 흔적 지우기 SQL
```ts
//   delete from erp.stock_ledger where sku_id in (select id from erp.skus where key like 'selftest%');
```
을 아래로.
```ts
//   delete from erp.stock_ledger where sku_id in (select id from erp.skus where key like 'selftest%');
//   delete from erp.stock_counts where sku_id in (select id from erp.skus where key like 'selftest%');
```

Run: `npx --no-install tsx scripts/erp/ledger-selftest.ts`
Expected: 표 **28행 전부 ✅**(26 + 새 2), exit 0. (롤백 트랜잭션이라 `erp.stock_counts`에 흔적이 남지 않는다 — Step 3의 확인 명령을 다시 돌려 `행: 0`.) 🔴 기초 전표가 이미 있어 자가시험이 거부하면 이 실행은 건너뛰고 「실행 기록」에 적는다.

- [ ] **Step 14: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/lib/erp/ledger src/__tests__/api/erp-stock-import.test.ts && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/lib/erp/ledger/opening-import.ts src/app/api/erp/stock/import/route.ts scripts/erp/ledger-selftest.ts src/__tests__/lib/erp/ledger/opening-import.test.ts src/__tests__/api/erp-stock-import.test.ts
git commit -m "feat(erp): 실사표 불러오기도 집 센 개수를 센 기록으로 · 자가시험 센 기록 2행"
```

#### 4c-D. 오늘 셀 목록 규칙(순수) · 목록 칸 · API

- [ ] **Step 15: 실패하는 테스트 작성**

`src/__tests__/lib/erp/stock/count-queue.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_QUEUE_N, kstDate, pickCountQueue } from '@/lib/erp/stock/count-queue';

const TODAY = '2026-09-27';
const r = (skuId: number, selfValue: number, hasLedger = true) => ({ skuId, selfValue, hasLedger });
const ids = (xs: { skuId: number }[]) => xs.map((x) => x.skuId);

describe('kstDate', () => {
  it('ISO를 KST 날짜로', () => {
    expect(kstDate('2026-09-26T15:00:00Z')).toBe('2026-09-27');
    expect(kstDate('2026-09-26T14:59:59Z')).toBe('2026-09-26');
    expect(kstDate(new Date('2026-09-27T00:00:00+09:00'))).toBe('2026-09-27');
  });
});

describe('pickCountQueue', () => {
  it('한 번도 안 센 SKU — 집 재고 금액 큰 순', () => {
    expect(ids(pickCountQueue([r(1, 100), r(2, 900), r(3, 500)], new Map(), { today: TODAY }))).toEqual([2, 3, 1]);
  });

  it('센 적이 있으면 마지막 실사가 오래된 순, 같으면 금액 큰 순', () => {
    const counts = new Map([[1, '2026-09-20T01:00:00Z'], [2, '2026-09-25T01:00:00Z'], [3, '2026-09-20T01:00:00Z']]);
    expect(ids(pickCountQueue([r(1, 100), r(2, 900), r(3, 500)], counts, { today: TODAY }))).toEqual([3, 1, 2]);
  });

  it('안 센 SKU가 센 SKU보다 앞선다(금액과 무관)', () => {
    expect(ids(pickCountQueue([r(1, 5000), r(2, 10)], new Map([[1, '2026-09-01T00:00:00Z']]), { today: TODAY }))).toEqual([2, 1]);
  });

  it('오늘(KST) 센 SKU는 빠진다 — 날짜 경계는 KST', () => {
    const counts = new Map([
      [1, '2026-09-26T15:00:00Z'], // 27일 00:00 KST — 오늘
      [2, '2026-09-26T14:59:59Z'], // 26일 23:59 KST — 어제
    ]);
    expect(ids(pickCountQueue([r(1, 100), r(2, 100)], counts, { today: TODAY }))).toEqual([2]);
  });

  it('원장 전표가 하나도 없는 SKU는 빠진다(재고 0이고 전표도 없다 = 판매하지 않는 옵션)', () => {
    expect(ids(pickCountQueue([r(1, 0, false), r(2, 0, true)], new Map(), { today: TODAY }))).toEqual([2]);
  });

  it('N개까지(기본 8) · 금액이 같으면 SKU id 순(순서가 흔들리지 않게)', () => {
    const rows = Array.from({ length: 10 }, (_, i) => r(10 - i, 100));
    expect(DEFAULT_QUEUE_N).toBe(8);
    expect(ids(pickCountQueue(rows, new Map(), { today: TODAY }))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(pickCountQueue(rows, new Map(), { n: 3, today: TODAY })).toHaveLength(3);
  });
});
```

`src/__tests__/api/erp-stock-count-queue.test.ts`:
```ts
// src/__tests__/api/erp-stock-count-queue.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockGetPool } = vi.hoisted(() => ({ mockGetCurrentUser: vi.fn(), mockGetPool: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));

const dbRow = (id: number, o: Record<string, unknown> = {}) => ({
  id: String(id), key: `k${id}`, name: `상품${id}`, option_label: '', legacy: [], base_unit_label: null,
  self: 1, rg_inbound: 0, rg: 0, value: '1000', self_value: '1000', has_ledger: true, lot_cost: 1000, legacy_cost: null, last_counted_at: null, ...o,
});
const get = (url: string) => new NextRequest(`http://localhost${url}`);
let sql = '';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-27T03:00:00Z')); // KST 2026-09-27 12:00
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  mockGetPool.mockReturnValue({
    query: vi.fn(async (q: string) => {
      sql = q;
      return {
        rows: [
          dbRow(1, { self_value: '500' }),
          dbRow(2, { self_value: '9000', last_counted_at: new Date('2026-09-20T01:00:00Z') }),
          dbRow(3, { self_value: '100' }),
          dbRow(4, { self_value: '8000', last_counted_at: new Date('2026-09-27T00:30:00Z') }), // 오늘(KST 09:30) 셌다
          dbRow(5, { self: 0, value: '0', self_value: '0', has_ledger: false }), // 전표 없음
        ],
        rowCount: 5,
      };
    }),
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/erp/stock/count-queue', () => {
  it('로그인하지 않으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/erp/stock/count-queue/route');
    expect((await GET(get('/api/erp/stock/count-queue'))).status).toBe(401);
  });

  it('우선순위대로 — 안 센 것(집 금액 순) → 오래된 것. 오늘 센 것·전표 없는 것은 빠진다', async () => {
    const { GET } = await import('@/app/api/erp/stock/count-queue/route');
    const json = await (await GET(get('/api/erp/stock/count-queue'))).json();
    expect(json.data.today).toBe('2026-09-27');
    expect(json.data.n).toBe(8);
    expect(json.data.items.map((x: { skuId: number }) => x.skuId)).toEqual([1, 3, 2]);
    expect(json.data.items[2]).toMatchObject({ name: '상품2', selfValue: 9000, lastCountedAt: '2026-09-20T01:00:00.000Z' });
    expect(sql).toMatch(/from erp\.stock_counts c where c\.sku_id = s\.id and c\.location = 'self'/);
  });

  it('n은 1~30으로 자르고, 숫자가 아니면 기본 8', async () => {
    const { GET } = await import('@/app/api/erp/stock/count-queue/route');
    expect((await (await GET(get('/api/erp/stock/count-queue?n=1'))).json()).data.items.map((x: { skuId: number }) => x.skuId)).toEqual([1]);
    expect((await (await GET(get('/api/erp/stock/count-queue?n=99'))).json()).data.n).toBe(30);
    expect((await (await GET(get('/api/erp/stock/count-queue?n=abc'))).json()).data.n).toBe(8);
  });
});
```

`src/__tests__/api/erp-stock.test.ts`의 `it('SKU별 위치 재고·평가액·단가를 돌려준다', …)`에서
```ts
      rows: [{ id: '7', key: 'cp:1:블랙', name: '왜건', option_label: '블랙', legacy: ['pc-1'], self: 3, rg_inbound: 0, rg: 2, value: '5000', has_ledger: true, lot_cost: 1000, legacy_cost: null, base_unit_label: null }],
```
을 아래로.
```ts
      rows: [{
        id: '7', key: 'cp:1:블랙', name: '왜건', option_label: '블랙', legacy: ['pc-1'], self: 3, rg_inbound: 0, rg: 2, value: '5000', self_value: '3000',
        has_ledger: true, lot_cost: 1000, legacy_cost: null, base_unit_label: null, last_counted_at: new Date('2026-09-20T01:00:00Z'),
      }],
```
그리고 같은 테스트의 기대값
```ts
      self: 3, rgInbound: 0, rg: 2, value: 5000, hasLedger: true, lotCost: 1000, legacyCost: null, costNeedsInput: false,
    }]);
```
을 아래로.
```ts
      self: 3, rgInbound: 0, rg: 2, value: 5000, hasLedger: true, lotCost: 1000, legacyCost: null, costNeedsInput: false,
      selfValue: 3000, lastCountedAt: '2026-09-20T01:00:00.000Z',
    }]);
```

- [ ] **Step 16: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/stock/count-queue.test.ts src/__tests__/api/erp-stock-count-queue.test.ts src/__tests__/api/erp-stock.test.ts`
Expected: FAIL — `count-queue` 모듈·라우트 없음, 목록에 `selfValue`·`lastCountedAt` 없음

- [ ] **Step 17: 구현 — 목록 칸**

`src/lib/erp/stock/queries.ts`의 `StockListRow` 끝
```ts
  /** 미리 채울 단가가 없다(최근 lot도, 쓸 수 있는 옛 입고도 없다) — 재고를 늘리려면 사람이 단가를 적는다 */
  costNeedsInput: boolean;
}
```
을 아래로.
```ts
  /** 미리 채울 단가가 없다(최근 lot도, 쓸 수 있는 옛 입고도 없다) — 재고를 늘리려면 사람이 단가를 적는다 */
  costNeedsInput: boolean;
  /** 집 위치 원장 평가액 — 오늘 셀 목록의 금액 순서 */
  selfValue: number;
  /** 집 마지막 실사(센 기록, erp.stock_counts) 시각. 한 번도 안 셌으면 null */
  lastCountedAt: string | null;
}
```

`listStock`의 SQL에서
```ts
            coalesce(sum(h.value), 0)::bigint as value,
```
를 아래로.
```ts
            coalesce(sum(h.value), 0)::bigint as value,
            coalesce(sum(h.value) filter (where h.location = 'self'), 0)::bigint as self_value,
            (select max(c.counted_at) from erp.stock_counts c where c.sku_id = s.id and c.location = 'self') as last_counted_at,
```
같은 함수의 반환 객체
```ts
      hasLedger: r.has_ledger === true, lotCost, legacyCost, costNeedsInput: lotCost === null && legacyCost === null,
    };
```
를 아래로.
```ts
      hasLedger: r.has_ledger === true, lotCost, legacyCost, costNeedsInput: lotCost === null && legacyCost === null,
      selfValue: Number(r.self_value), lastCountedAt: r.last_counted_at ? iso(r.last_counted_at) : null,
    };
```

- [ ] **Step 18: 구현 — 규칙과 API**

`src/lib/erp/stock/count-queue.ts`:
```ts
// src/lib/erp/stock/count-queue.ts
// 「오늘 셀 목록」(순환 실사, 2026-09-26 결정 5) — 집(self)에서 오늘 셀 SKU N개를 고른다. 날마다 저장하지 않고 요청 때 계산한다.
// 우선순위: ① 한 번도 안 센 SKU — 집 재고 금액 큰 순 ② 마지막 실사가 오래된 순(같으면 금액 큰 순). 그래도 같으면 SKU id 순.
// 빠지는 것: 오늘(KST) 이미 센 SKU · 원장 전표가 하나도 없는 SKU(재고 0이고 전표도 없다 = 판매하지 않는 옵션).
// 순수 함수 — 서버(라우트)와 화면(마지막 실사 날짜 표시)이 같이 쓴다.
import type { StockListRow } from './queries';

export const DEFAULT_QUEUE_N = 8;
export const MAX_QUEUE_N = 30;

export type QueueCandidate = Pick<StockListRow, 'skuId' | 'selfValue' | 'hasLedger'>;

/** GET /api/erp/stock/count-queue 응답 */
export interface CountQueueResponse {
  /** 오늘(KST, YYYY-MM-DD) */
  today: string;
  n: number;
  items: StockListRow[];
}

/** ISO(또는 Date) → KST 날짜 YYYY-MM-DD */
export function kstDate(v: string | Date): string {
  const t = typeof v === 'string' ? Date.parse(v) : v.getTime();
  return new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * @param counts SKU → 집 마지막 실사 시각(ISO). 없으면 한 번도 안 셌다
 * @param opts.today 오늘(KST YYYY-MM-DD) — 이날 센 SKU는 빠진다
 */
export function pickCountQueue<T extends QueueCandidate>(
  rows: T[],
  counts: ReadonlyMap<number, string>,
  opts: { n?: number; today: string },
): T[] {
  const n = opts.n ?? DEFAULT_QUEUE_N;
  const last = (r: T): number | null => {
    const v = counts.get(r.skuId);
    return v === undefined ? null : Date.parse(v);
  };
  return rows
    .filter((r) => {
      if (!r.hasLedger) return false;
      const v = counts.get(r.skuId);
      return v === undefined || kstDate(v) < opts.today;
    })
    .sort((a, b) => {
      const la = last(a);
      const lb = last(b);
      if ((la === null) !== (lb === null)) return la === null ? -1 : 1;
      if (la !== null && lb !== null && la !== lb) return la - lb;
      if (a.selfValue !== b.selfValue) return b.selfValue - a.selfValue;
      return a.skuId - b.skuId;
    })
    .slice(0, Math.max(0, n));
}
```

`src/app/api/erp/stock/count-queue/route.ts`:
```ts
// GET /api/erp/stock/count-queue?n=8 — 오늘 셀 목록(집). 저장하지 않고 요청 때 계산한다(규칙: lib/erp/stock/count-queue.ts).
// 화면(PC 패널·휴대폰)은 열 때 한 번 받고, 센 줄은 화면에서 뺀다 — 다시 받으면 센 만큼 다음 SKU가 채워진다.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { listStock } from '@/lib/erp/stock/queries';
import { DEFAULT_QUEUE_N, MAX_QUEUE_N, kstDate, pickCountQueue, type CountQueueResponse } from '@/lib/erp/stock/count-queue';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const raw = Number(request.nextUrl.searchParams.get('n') ?? String(DEFAULT_QUEUE_N));
  const n = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), MAX_QUEUE_N) : DEFAULT_QUEUE_N;
  try {
    const rows = await listStock(getSourcingPool());
    // 집 마지막 실사는 목록 행에 이미 실려 있다(listStock이 erp.stock_counts에서 읽는다)
    const counts = new Map<number, string>();
    for (const r of rows) if (r.lastCountedAt) counts.set(r.skuId, r.lastCountedAt);
    const today = kstDate(new Date());
    const data: CountQueueResponse = { today, n, items: pickCountQueue(rows, counts, { n, today }) };
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return erpError(e);
  }
}
```

- [ ] **Step 19: 화면 테스트 고정값에 새 칸을 넣는다**

`StockRow`(= `StockListRow`)에 필수 칸 둘이 생겨 화면 테스트의 행 고정값이 타입 오류가 된다. 세 파일에서 `costNeedsInput: false,`를 `costNeedsInput: false, selfValue: 0, lastCountedAt: null,`로 바꾼다(각 파일 한 곳).
- `src/__tests__/components/erp-stock-view.test.ts` — `row()` 고정값
- `src/__tests__/components/erp-stock-edit-cell.test.tsx` — `row` 고정값
- `src/__tests__/components/erp-stock-table.test.tsx` — `row()` 고정값(Task 4b)

- [ ] **Step 20: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/lib/erp/stock src/__tests__/api/erp-stock-count-queue.test.ts src/__tests__/api/erp-stock.test.ts src/__tests__/components/erp-stock-view.test.ts src/__tests__/components/erp-stock-edit-cell.test.tsx src/__tests__/components/erp-stock-table.test.tsx && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/lib/erp/stock/count-queue.ts src/lib/erp/stock/queries.ts src/app/api/erp/stock/count-queue src/__tests__/lib/erp/stock/count-queue.test.ts src/__tests__/api/erp-stock-count-queue.test.ts src/__tests__/api/erp-stock.test.ts src/__tests__/components/erp-stock-view.test.ts src/__tests__/components/erp-stock-edit-cell.test.tsx src/__tests__/components/erp-stock-table.test.tsx
git commit -m "feat(erp): 오늘 셀 목록 규칙과 GET /api/erp/stock/count-queue · 목록에 집 평가액·마지막 실사"
```

#### 4c-E. 화면 — 차이 0 지금 개수 · 「마지막 실사」 칸 · 「오늘 셀 목록」 패널

> 🔵 화면이 차이 0 「지금 개수」를 막으면 센 기록이 남지 않는다(Task 4의 `EditCell`은 차이 0이면 저장을 막고, 실사 모드는 차이 0 편집을 버렸다). 이제 **지금 개수는 차이가 없어도 저장·담기가 된다**(「차이 없음 — 센 기록만 남깁니다」).

- [ ] **Step 21: 실패하는 테스트 작성**

`src/__tests__/components/erp-stock-edit-cell.test.tsx`의 `describe('EditCell', () => {` 블록 끝(`it('실사 모드에서는 「담기」', …)` 뒤)에 더한다.
```tsx

  it('지금 개수가 원장과 같아도 저장된다 — 센 기록만 남는다', () => {
    const onSubmit = vi.fn();
    render(<EditCell row={row} location="self" countMode={false} onSubmit={onSubmit} onCancel={() => {}} />);
    expect(screen.getByText('차이 없음 — 센 기록만 남깁니다')).toBeInTheDocument();
    fireEvent.click(screen.getByText('저장'));
    expect(onSubmit).toHaveBeenCalledWith({ skuId: 1, location: 'self', mode: 'count', value: 10, expected: 10, reason: 'count_diff', note: '', unitCost: null });
  });

  it('countOnly면 ±수량 전환이 없다(오늘 셀 목록)', () => {
    render(<EditCell row={row} location="self" countMode={false} countOnly onSubmit={vi.fn()} onCancel={() => {}} />);
    expect(screen.queryByText('±수량')).not.toBeInTheDocument();
    expect(screen.getByLabelText('지금 개수')).toHaveValue('10');
  });
```

`src/__tests__/components/erp-stock-view.test.ts`의
```ts
  it('실사 모드 요약: 늘림·줄임·평가액 영향(추정)', () => {
    const byId = new Map([[1, row()], [2, row({ skuId: 2, lotCost: 500 })]]);
    expect(summarizeStaged([edit({ unitCost: 1200 }), edit({ skuId: 2, value: 1, expected: 3 })], byId))
      .toEqual({ count: 2, plus: 2, minus: 2, valueDelta: 2 * 1200 - 2 * 500 });
  });
```
를 아래로.
```ts
  it('실사 모드 요약: 늘림·줄임·차이 없음(센 기록만)·평가액 영향(추정)', () => {
    const byId = new Map([[1, row()], [2, row({ skuId: 2, lotCost: 500 })], [3, row({ skuId: 3 })]]);
    expect(summarizeStaged([edit({ unitCost: 1200 }), edit({ skuId: 2, value: 1, expected: 3 }), edit({ skuId: 3, value: 3, expected: 3 })], byId))
      .toEqual({ count: 3, plus: 2, minus: 2, same: 1, valueDelta: 2 * 1200 - 2 * 500 });
  });
```

`src/__tests__/components/erp-stock-table.test.tsx`의 `describe('StockTable — 상품 묶음', () => {` 블록 끝에 더한다.
```tsx

  it('「마지막 실사」 — 옵션은 날짜(KST) 또는 「안 셈」, 묶음은 안 센 옵션 수', () => {
    render(
      <StockTable
        views={filterGroups(groupRows([
          row({ lastCountedAt: '2026-09-26T15:30:00Z' }),
          row({ skuId: 2, key: 'k2', option: '베이지' }),
        ], null), NO_FILTER, null)}
        forceOpen
        recon={null} staged={new Map()} countMode={false} editing={null} selected={null} busy={false}
        onEdit={() => {}} onCancelEdit={() => {}} onSubmitEdit={() => {}} onSelect={() => {}} onRgApply={() => {}}
      />,
    );
    expect(screen.getByText('마지막 실사')).toBeInTheDocument();
    expect(screen.getByText('2026-09-27')).toBeInTheDocument();
    expect(within(trOf('베이지')).getByText('안 셈')).toBeInTheDocument();
    expect(within(trOf('왜건')).getByText('안 셈 1')).toBeInTheDocument();
  });
```

`src/__tests__/components/erp-count-queue-panel.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import CountQueuePanel from '@/components/erp/stock/CountQueuePanel';
import type { StockRow } from '@/components/erp/stock/stock-view';
import { server } from '../mocks/server';

const row = (o: Partial<StockRow>): StockRow => ({
  skuId: 1, key: 'k1', name: '왜건', option: '블랙', legacyProductCostIds: [], self: 5, rgInbound: 0, rg: 0, value: 3500,
  hasLedger: true, lotCost: 700, legacyCost: null, costNeedsInput: false, selfValue: 3500, lastCountedAt: null, ...o,
});
const A = row({});
const B = row({ skuId: 2, key: 'k2', name: '매트', option: '', self: 2, selfValue: 1400, lastCountedAt: '2026-09-20T01:00:00Z' });
const serveQueue = () =>
  server.use(http.get('/api/erp/stock/count-queue', () => HttpResponse.json({ success: true, data: { today: '2026-09-27', n: 8, items: [A, B] } })));

describe('CountQueuePanel', () => {
  it('오늘 셀 목록을 보이고, 센 개수를 저장하면(차이가 없어도) 그 줄이 빠진다', async () => {
    serveQueue();
    const onSave = vi.fn(async () => true);
    render(<CountQueuePanel rowById={new Map([[1, A], [2, B]])} busy={false} onSave={onSave} />);
    expect(await screen.findByText('왜건')).toBeInTheDocument();
    expect(screen.getByText(/남은 2 \/ 2개/)).toBeInTheDocument();
    expect(screen.getByText('안 셈')).toBeInTheDocument();
    expect(screen.getByText('2026-09-20')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '세기' })[0]);
    expect(screen.queryByText('±수량')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('저장'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ skuId: 1, location: 'self', mode: 'count', value: 5, expected: 5, reason: 'count_diff' })));
    await waitFor(() => expect(screen.queryByText('왜건')).not.toBeInTheDocument());
    expect(screen.getByText(/남은 1 \/ 2개/)).toBeInTheDocument();
  });

  it('저장이 실패하면 줄을 남긴다', async () => {
    serveQueue();
    const onSave = vi.fn(async () => false);
    render(<CountQueuePanel rowById={new Map([[1, A], [2, B]])} busy={false} onSave={onSave} />);
    fireEvent.click((await screen.findAllByRole('button', { name: '세기' }))[0]);
    fireEvent.click(screen.getByText('저장'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(screen.getByText('왜건')).toBeInTheDocument();
  });
});
```

- [ ] **Step 22: 실패 확인**

Run: `npx vitest run src/__tests__/components/erp-stock-edit-cell.test.tsx src/__tests__/components/erp-stock-view.test.ts src/__tests__/components/erp-stock-table.test.tsx src/__tests__/components/erp-count-queue-panel.test.tsx`
Expected: 새 테스트 FAIL — 차이 0이면 「저장」이 잠겨 있다 · `countOnly` 없음 · `same` 없음 · 「마지막 실사」 칸 없음 · 패널 모듈 없음

- [ ] **Step 23: 구현 — `EditCell.tsx`**

`src/components/erp/stock/EditCell.tsx`에서 여섯 곳을 고친다.

(1) 머리 주석
```tsx
 * 실사 모드에서는 저장하지 않고 담는다(StockClient가 한 번에 저장한다).
 */
```
를 아래로.
```tsx
 * 실사 모드에서는 저장하지 않고 담는다(StockClient가 한 번에 저장한다).
 * 지금 개수는 원장과 같아도 저장·담기가 된다 — 원장 전표 없이 센 기록(erp.stock_counts)만 남는다(결정 5).
 * `countOnly`면 ±수량 전환을 숨긴다(오늘 셀 목록 — 센 개수만 받는다).
 */
```

(2) Props
```tsx
  countMode: boolean;
  onSubmit: (e: StagedEdit) => void;
```
를 아래로.
```tsx
  countMode: boolean;
  /** 지금 개수만(±수량 전환 없음) */
  countOnly?: boolean;
  onSubmit: (e: StagedEdit) => void;
```

(3)
```tsx
export default function EditCell({ row, location, staged, countMode, onSubmit, onCancel }: Props) {
```
를 아래로.
```tsx
export default function EditCell({ row, location, staged, countMode, countOnly = false, onSubmit, onCancel }: Props) {
```

(4)
```tsx
  const canSubmit = valid && diff !== 0 && !needsCost;
```
를 아래로(±수량은 0이 이미 무효라 차이 0은 지금 개수뿐이다).
```tsx
  const canSubmit = valid && !needsCost;
```

(5) 방식 전환 버튼 묶음 — `countOnly`면 그리지 않는다(숨기기만 하면 버튼이 DOM에 남는다).
```tsx
      <div style={{ ...segStyle, marginBottom: 6 }}>
        {(['count', 'delta'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            style={{ ...segBtnStyle, flex: 1, background: mode === m ? E.ink : E.surface, color: mode === m ? '#fff' : E.ink }}
          >
            {m === 'count' ? '지금 개수' : '±수량'}
          </button>
        ))}
      </div>
```
을 아래로.
```tsx
      {!countOnly && (
        <div style={{ ...segStyle, marginBottom: 6 }}>
          {(['count', 'delta'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              style={{ ...segBtnStyle, flex: 1, background: mode === m ? E.ink : E.surface, color: mode === m ? '#fff' : E.ink }}
            >
              {m === 'count' ? '지금 개수' : '±수량'}
            </button>
          ))}
        </div>
      )}
```

(6) 차이 표시
```tsx
          ? diff === 0 ? '차이 없음' : `${won(onHand)} → ${won(onHand + diff)} (${diff > 0 ? '+' : ''}${won(diff)})`
```
를 아래로.
```tsx
          ? diff === 0 ? '차이 없음 — 센 기록만 남깁니다' : `${won(onHand)} → ${won(onHand + diff)} (${diff > 0 ? '+' : ''}${won(diff)})`
```

- [ ] **Step 24: 구현 — `stock-view.ts`·`api.ts`**

`src/components/erp/stock/stock-view.ts`의 `summarizeStaged` 전체를 아래로 바꾼다.
```ts
/** 실사 모드 저장 전 확인 창의 숫자. same = 차이 없는 지금 개수(센 기록만 남는다). 평가액 영향은 추정(줄 때는 최근 단가, 늘 때는 입력 단가) */
export function summarizeStaged(
  list: StagedEdit[],
  rowById: Map<number, StockRow>,
): { count: number; plus: number; minus: number; same: number; valueDelta: number } {
  let plus = 0;
  let minus = 0;
  let same = 0;
  let valueDelta = 0;
  for (const e of list) {
    const d = editDiff(e);
    if (d === 0) {
      same++;
      continue;
    }
    const row = rowById.get(e.skuId);
    const base = row ? defaultCost(row) : null;
    const cost = d > 0 ? (e.unitCost ?? base ?? 0) : (base ?? 0);
    if (d > 0) plus += d;
    else minus += -d;
    valueDelta += d * cost;
  }
  return { count: list.length, plus, minus, same, valueDelta };
}
```

`src/components/erp/stock/api.ts`에서
```ts
import type { ImportSummary } from '@/lib/erp/ledger/opening-import';
```
를 아래로.
```ts
import type { ImportSummary } from '@/lib/erp/ledger/opening-import';
import type { CountQueueResponse } from '@/lib/erp/stock/count-queue';
```
그리고
```ts
export const postRgApply = (items: RgApplyItem[]) => call<AdjustResult[]>('/api/erp/stock/rg-reconcile', { items });
```
바로 아래에 넣는다.
```ts
export const fetchCountQueue = (n: number) => call<CountQueueResponse>(`/api/erp/stock/count-queue?n=${n}`);
```

- [ ] **Step 25: 구현 — `StockTable.tsx`에 「마지막 실사」 칸**

`src/components/erp/stock/StockTable.tsx`(Task 4b 판)에서 여섯 곳을 고친다.

(1) import 끝에 한 줄 더한다 —
```tsx
} from './stock-view';
```
를 아래로.
```tsx
} from './stock-view';
import { kstDate } from '@/lib/erp/stock/count-queue';
```

(2)
```tsx
const HEADERS = ['상품', '옵션', '집', 'RG입고중', 'RG(원장)', 'RG실재고', '차이', '단가', '평가액'];
```
를 아래로.
```tsx
const HEADERS = ['상품', '옵션', '집', 'RG입고중', 'RG(원장)', 'RG실재고', '차이', '단가', '평가액', '마지막 실사'];
```

(3) 담긴 칸 표시 — 차이 없는 지금 개수도 담기므로 「→ 같은 값」 대신 확인 표시를 한다.
```tsx
          {s ? (
            <>
              <span style={{ textDecoration: 'line-through', color: E.inkMute }}>{won(value)}</span>
              {' → '}
              <b>{won(value + editDiff(s))}</b>
            </>
          ) : won(value)}
```
를 아래로.
```tsx
          {s ? (
            editDiff(s) === 0 ? (
              <b title="차이 없음 — 센 기록만 남깁니다">{won(value)} ✓</b>
            ) : (
              <>
                <span style={{ textDecoration: 'line-through', color: E.inkMute }}>{won(value)}</span>
                {' → '}
                <b>{won(value + editDiff(s))}</b>
              </>
            )
          ) : won(value)}
```

(4) 옵션 행 끝
```tsx
        <td style={numTdStyle}>{cost === null ? '—' : won(cost)}</td>
        <td style={numTdStyle}>{won(r.value)}</td>
      </tr>
    );
  };
```
를 아래로.
```tsx
        <td style={numTdStyle}>{cost === null ? '—' : won(cost)}</td>
        <td style={numTdStyle}>{won(r.value)}</td>
        <td style={{ ...numTdStyle, color: r.lastCountedAt ? E.ink : E.inkMute }}>{r.lastCountedAt ? kstDate(r.lastCountedAt) : '안 셈'}</td>
      </tr>
    );
  };
```

(5) 묶음 행 — 안 센 옵션 수, 모두 셌으면 가장 오래된 날짜.
```tsx
    const stagedN = g.options.filter((r) => staged.has(stageKey(r.skuId, 'self')) || staged.has(stageKey(r.skuId, 'rg_inbound'))).length;
```
를 아래로.
```tsx
    const stagedN = g.options.filter((r) => staged.has(stageKey(r.skuId, 'self')) || staged.has(stageKey(r.skuId, 'rg_inbound'))).length;
    const neverCounted = g.options.filter((r) => !r.lastCountedAt).length;
    const oldest = g.options.map((r) => r.lastCountedAt).filter((x): x is string => x !== null).sort()[0] ?? null;
```
그리고 묶음 행 끝
```tsx
        <td style={numTdStyle}>—</td>
        <td style={numTdStyle}>{won(g.value)}</td>
      </tr>
```
를 아래로.
```tsx
        <td style={numTdStyle}>—</td>
        <td style={numTdStyle}>{won(g.value)}</td>
        <td style={{ ...numTdStyle, color: neverCounted ? E.inkMute : E.ink }} title={neverCounted ? undefined : '가장 오래된 옵션의 실사 날짜'}>
          {neverCounted ? `안 셈 ${neverCounted}` : oldest ? kstDate(oldest) : '—'}
        </td>
      </tr>
```

(6) 표 설명 띠
```tsx
          상품별 재고 — 원장 기준 · 상품 줄을 누르면 옵션이 펼쳐집니다 · 집·RG입고중 칸을 누르면 고칩니다 · 옵션 줄을 누르면 입출 이력
```
을 아래로.
```tsx
          상품별 재고 — 원장 기준 · 상품 줄을 누르면 옵션이 펼쳐집니다 · 집·RG입고중 칸을 누르면 고칩니다(개수가 같아도 저장하면 실사로 남습니다) · 옵션 줄을 누르면 입출 이력
```

- [ ] **Step 26: 구현 — `CountQueuePanel.tsx`**

`src/components/erp/stock/CountQueuePanel.tsx`:
```tsx
'use client';

/**
 * 「오늘 셀 목록」(PC) — 집에서 오늘 셀 SKU N개(결정 5). 「세기」를 누르면 칸 편집(EditCell)이 지금 개수로만 열리고,
 * 저장하면(차이가 없어도 센 기록이 남는다) 그 줄이 목록에서 빠진다.
 * 목록은 화면을 열 때 한 번 받는다 — 다시 받으면 센 만큼 다음 SKU가 채워져 「오늘 N개」가 끝나지 않는다.
 */
import React, { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { bandStyle, btnStyle, numTdStyle, thStyle } from '@/components/orders/erp-ui';
import { DEFAULT_QUEUE_N, kstDate } from '@/lib/erp/stock/count-queue';
import EditCell from './EditCell';
import { fetchCountQueue } from './api';
import { won, type StagedEdit, type StockRow } from './stock-view';

interface Props {
  /** 최신 목록 행 — 세는 사이 원장이 바뀌었으면(저장 뒤 다시 불러온 값) 이 값으로 편집을 연다 */
  rowById: Map<number, StockRow>;
  busy: boolean;
  /** 저장. 성공하면 true — 그 줄을 목록에서 뺀다 */
  onSave: (e: StagedEdit) => Promise<boolean>;
}

const HEADERS = ['상품', '옵션', '집(원장)', '집 평가액', '마지막 실사', ''];
const textTd: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`, borderRight: `1px solid ${E.lineSoft}`, padding: '4px 8px',
  fontSize: 12, color: E.ink, whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis',
};
const smallBtn: React.CSSProperties = { ...btnStyle, height: 20, padding: '0 8px', fontSize: 10.5 };

export default function CountQueuePanel({ rowById, busy, onSave }: Props) {
  const [items, setItems] = useState<StockRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchCountQueue(DEFAULT_QUEUE_N).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setItems(r.data.items);
      setTotal(r.data.items.length);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function submit(e: StagedEdit) {
    if (!(await onSave(e))) return;
    setItems((list) => (list ?? []).filter((r) => r.skuId !== e.skuId));
    setEditing(null);
  }

  const left = items?.length ?? 0;
  const status =
    items === null ? (error ? '불러오지 못했습니다' : '불러오는 중…')
      : total === 0 ? '셀 SKU가 없습니다(원장 전표가 있는 SKU만 고릅니다)'
        : left === 0 ? `오늘 ${total}개를 다 셌습니다`
          : `남은 ${left} / ${total}개`;

  return (
    <div style={{ background: E.surface, border: `1px solid ${E.line}`, marginBottom: 10 }}>
      <div style={bandStyle}>
        <ClipboardList size={12} />
        <span style={{ flex: 1 }}>오늘 셀 목록 — 집 · {status}</span>
        <button type="button" onClick={() => setOpen((v) => !v)} style={smallBtn}>{open ? '접기' : '펼치기'}</button>
      </div>
      {error && <div role="alert" style={{ padding: '6px 10px', color: E.loss, fontSize: 11.5 }}>{error}</div>}
      {open && items && items.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>{HEADERS.map((h, i) => <th key={i} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const r = rowById.get(item.skuId) ?? item;
              return (
                <tr key={r.skuId} style={{ height: E.rowH }}>
                  <td style={textTd} title={r.key}>{r.name}</td>
                  <td style={textTd}>{r.option || '—'}</td>
                  <td style={numTdStyle}>{won(r.self)}</td>
                  <td style={numTdStyle}>{won(r.selfValue)}</td>
                  <td style={{ ...numTdStyle, color: r.lastCountedAt ? E.ink : E.inkMute }}>{r.lastCountedAt ? kstDate(r.lastCountedAt) : '안 셈'}</td>
                  <td style={{ ...numTdStyle, position: 'relative', textAlign: 'center' }}>
                    <button type="button" disabled={busy} onClick={() => setEditing(r.skuId)} style={smallBtn}>세기</button>
                    {editing === r.skuId && (
                      <EditCell row={r} location="self" countMode={false} countOnly onSubmit={(e) => void submit(e)} onCancel={() => setEditing(null)} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 27: 구현 — `StockClient.tsx`**

`src/components/erp/stock/StockClient.tsx`에서 여섯 곳을 고친다.

(1) import
```tsx
import CsvImportDialog from './CsvImportDialog';
```
를 아래로.
```tsx
import CsvImportDialog from './CsvImportDialog';
import CountQueuePanel from './CountQueuePanel';
```

(2) `saveOne` 전체를 아래로 바꾼다(오늘 셀 목록이 성공 여부를 알아야 줄을 뺀다).
```tsx
  /** 한 칸 바로 저장. 성공하면 true */
  async function saveOne(edit: StagedEdit): Promise<boolean> {
    setSaving(true);
    const r = await postAdjust(toAdjustItems([edit], uuidv4));
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      if (r.code === 'stale') await load();
      return false;
    }
    const res = r.data[0];
    toast.success(
      res.outcome === 'noop' ? '차이 없음 — 센 기록만 남겼습니다'
        : res.outcome === 'duplicate' ? '이미 저장된 요청입니다'
          : `${res.kind === 'opening' ? '기초재고' : '조정'} ${res.qty > 0 ? '+' : ''}${res.qty} 기록했습니다`,
    );
    setEditing(null);
    await load();
    return true;
  }
```

(3) `stage` 안의
```tsx
      if (editDiff(edit) === 0) n.delete(k);
      else n.set(k, edit);
```
를 아래로.
```tsx
      // 차이 없는 지금 개수도 담는다 — 저장하면 센 기록이 남는다
      n.set(k, edit);
```
`editDiff`를 더 쓰지 않으므로 import(Task 4b 판)의
```tsx
  computeKpis, defaultCost, editDiff, filterGroups, filterRows, filtersActive, groupRows, parseRecon, rgDiff, stageKey, summarizeStaged,
```
를 아래로.
```tsx
  computeKpis, defaultCost, filterGroups, filterRows, filtersActive, groupRows, parseRecon, rgDiff, stageKey, summarizeStaged,
```

(4) `saveStaged`의 확인 문구
```tsx
      message: `실사 변경 ${s.count}건을 저장합니다.\n\n늘림 +${won(s.plus)}개 · 줄임 −${won(s.minus)}개\n평가액 영향(추정) ${signed(s.valueDelta)}원\n\n하나라도 실패하면 전부 저장되지 않습니다.`,
```
를 아래로.
```tsx
      message: `실사 ${s.count}건을 저장합니다.\n\n늘림 +${won(s.plus)}개 · 줄임 −${won(s.minus)}개 · 차이 없음 ${s.same}건(센 기록만)\n평가액 영향(추정) ${signed(s.valueDelta)}원\n\n하나라도 실패하면 전부 저장되지 않습니다.`,
```
그리고 성공 토스트
```tsx
    toast.success(`${r.data.filter((x) => x.outcome === 'posted').length}건 저장했습니다`);
```
를 아래로.
```tsx
    toast.success(`${r.data.filter((x) => x.outcome === 'posted').length}건 기록 · ${r.data.filter((x) => x.outcome === 'noop').length}건 차이 없음(센 기록)`);
```

(5) 실사 모드 저장 버튼 문구
```tsx
            변경 {staged.size}건 저장
```
을 아래로.
```tsx
            실사 {staged.size}건 저장
```

(6) KPI 묶음 바로 뒤(도구줄 `<div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>` 바로 앞)에 넣는다.
```tsx
      <CountQueuePanel rowById={rowById} busy={saving} onSave={saveOne} />

```
그리고 `onSubmitEdit={(e) => { if (countMode) stage(e); else void saveOne(e); }}`는 그대로 둔다(반환값을 쓰지 않는다).

- [ ] **Step 28: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/components/erp-stock-edit-cell.test.tsx src/__tests__/components/erp-stock-view.test.ts src/__tests__/components/erp-stock-table.test.tsx src/__tests__/components/erp-count-queue-panel.test.tsx && npx tsc --noEmit && npx eslint src/components/erp/stock`
Expected: 전부 PASS, tsc 0 오류, eslint 오류 0
```bash
git add src/components/erp/stock src/__tests__/components/erp-stock-edit-cell.test.tsx src/__tests__/components/erp-stock-view.test.ts src/__tests__/components/erp-stock-table.test.tsx src/__tests__/components/erp-count-queue-panel.test.tsx
git commit -m "feat(erp): 재고현황 「오늘 셀 목록」 패널 · 「마지막 실사」 칸 · 차이 없는 지금 개수도 센 기록으로"
```

- [ ] **Step 29: 🔴 화면 확인 — 컨트롤러가 직접(서브에이전트 아님)**

개발 서버·로그인은 Task 4 Step 17 그대로. 1440px로 `http://localhost:3000/erp/stock`을 연다. 확인: KPI 아래 「오늘 셀 목록 — 집 · …」 띠 · 기초재고 전(원장 0행)이면 「셀 SKU가 없습니다(원장 전표가 있는 SKU만 고릅니다)」 · 접기/펼치기 · 표 끝 「마지막 실사」 칸(전부 「안 셈」, 묶음은 「안 셈 N」) · 칸 편집에서 개수를 그대로 두면 「차이 없음 — 센 기록만 남깁니다」와 함께 「저장」이 켜짐(「취소」로 닫는다) · 실사 모드에서 같은 값을 담으면 칸이 「n ✓」 · 콘솔 오류 없음. `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/erp/stock/count-queue` → `401`(로그인 쿠키 없음). 🔴 **저장·「세기」 저장 버튼은 누르지 않는다** — 로컬 서버도 운영 DB다. 목록이 채워진 모습은 Task 9 기초재고 뒤에 확인한다. 깨진 곳은 고쳐 `fix(erp): …`로 커밋하고 스크린샷을 사용자에게 보여준다.

---
### Task 5: 휴대폰 재고 수정 `/m/stock` — 「오늘 셀 목록」으로 시작

> 결정 5(2026-09-26 추가): 휴대폰은 **「오늘 셀 목록」(Task 4c)으로 연다** — N개 카드를 차례로 세고, 목록 밖 SKU는 검색으로 찾는다. 저장한 카드는 목록에서 빠진다(목록은 열 때 한 번 받는다). 개수가 같아도 저장하면 센 기록이 남는다. 나머지(위치 탭 · −/+ · 사유 · 메모 · 늘 때 단가 · 최근 수정 5건 · 같은 API)는 그대로다.

**Files:**
- Create: `src/app/m/stock/layout.tsx`, `src/app/m/stock/page.tsx`, `src/components/erp/stock/MobileStock.tsx`
- Test: `src/__tests__/components/erp-mobile-stock.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/components/erp-mobile-stock.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import MobileStock from '@/components/erp/stock/MobileStock';
import { server } from '../mocks/server';

const ROW = {
  skuId: 1, key: 'cp:1:블랙', name: '왜건', option: '블랙', legacyProductCostIds: [], self: 5, rgInbound: 1, rg: 2, value: 5600,
  hasLedger: true, lotCost: 700, legacyCost: null, costNeedsInput: false, selfValue: 3500, lastCountedAt: null,
};
const OTHER = { ...ROW, skuId: 2, key: 'cp:2:레드', name: '매트', option: '레드', self: 3, rgInbound: 0, rg: 0, value: 2100, selfValue: 2100 };

// 콜백 안에서만 채워진다 — 선언 타입을 넓혀 둬야 TS가 null로 좁히지 않는다
type Body = { items: Record<string, unknown>[] };
function serve(onAdjust?: (b: Body) => void) {
  server.use(
    http.get('/api/erp/stock', () => HttpResponse.json({ success: true, data: [ROW, OTHER] })),
    http.get('/api/erp/stock/recent', () => HttpResponse.json({ success: true, data: [] })),
    http.get('/api/erp/stock/count-queue', () => HttpResponse.json({ success: true, data: { today: '2026-09-27', n: 8, items: [ROW] } })),
    http.post('/api/erp/stock/adjust', async ({ request }) => {
      const b = (await request.json()) as Body;
      onAdjust?.(b);
      const item = b.items[0];
      const same = item.value === item.expected;
      return HttpResponse.json({ success: true, data: [{ outcome: same ? 'noop' : 'posted', kind: same ? null : 'adjust', qty: Number(item.value) - Number(item.expected) }] });
    }),
  );
}

describe('MobileStock', () => {
  it('오늘 셀 목록 카드로 시작한다 — 검색 전에는 목록 밖 SKU를 보이지 않는다', async () => {
    serve();
    render(<MobileStock />);
    expect(await screen.findByText('왜건')).toBeInTheDocument();
    expect(screen.getByText(/남은 1 \/ 1개/)).toBeInTheDocument();
    expect(screen.getByText(/안 셈/)).toBeInTheDocument();
    expect(screen.queryByText('매트')).not.toBeInTheDocument();
  });

  it('카드를 골라 지금 개수를 줄여 저장하면 count 조정을 보내고, 그 카드가 목록에서 빠진다', async () => {
    let body = null as Body | null;
    serve((b) => { body = b; });
    render(<MobileStock />);
    fireEvent.click(await screen.findByText('왜건'));
    fireEvent.click(screen.getByLabelText('하나 빼기'));
    fireEvent.click(screen.getByLabelText('하나 빼기'));
    expect(screen.getByText('5 → 3 (-2)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.items[0]).toMatchObject({ skuId: 1, location: 'self', mode: 'count', value: 3, expected: 5, reason: 'count_diff' });
    expect(String(body!.items[0].requestId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText(/저장했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/오늘 1개를 다 셌습니다/)).toBeInTheDocument();
    expect(screen.queryByText('왜건')).not.toBeInTheDocument();
  });

  it('개수가 같아도 저장된다 — 센 기록만 남는다', async () => {
    let body = null as Body | null;
    serve((b) => { body = b; });
    render(<MobileStock />);
    fireEvent.click(await screen.findByText('왜건'));
    expect(screen.getByText('차이 없음 — 센 기록만 남깁니다')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '맞습니다 — 센 기록 저장' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.items[0]).toMatchObject({ skuId: 1, location: 'self', mode: 'count', value: 5, expected: 5 });
    expect(await screen.findByText(/센 기록을 저장했습니다/)).toBeInTheDocument();
  });

  it('목록에 없는 SKU는 검색으로 찾는다', async () => {
    serve();
    render(<MobileStock />);
    await screen.findByText('왜건');
    fireEvent.change(screen.getByLabelText('상품 검색'), { target: { value: '매트' } });
    fireEvent.click(await screen.findByText('매트'));
    expect(screen.getByLabelText('지금 개수')).toHaveValue(3);
  });

  it('RG입고중 탭은 그 위치 재고에서 시작하고, 거기서 센 것은 오늘 셀 목록(집)에서 빼지 않는다', async () => {
    serve();
    render(<MobileStock />);
    fireEvent.click(await screen.findByText('왜건'));
    fireEvent.click(screen.getByRole('button', { name: 'RG입고중' }));
    expect(screen.getByLabelText('지금 개수')).toHaveValue(1);
    fireEvent.click(screen.getByRole('button', { name: '맞습니다 — 센 기록 저장' }));
    expect(await screen.findByText(/센 기록을 저장했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/남은 1 \/ 1개/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/components/erp-mobile-stock.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/components/erp/stock/MobileStock.tsx`:
```tsx
'use client';

/**
 * 휴대폰 재고 수정. 「오늘 셀 목록」(집 N개) 카드로 시작한다(결정 5) → 카드 → 위치 탭(집·RG입고중) → 지금 개수(−/+) · 사유 · 메모 → 저장.
 * 목록 밖 SKU는 검색으로 찾는다. 개수가 같아도 저장하면 센 기록(erp.stock_counts)이 남는다.
 * 목록은 열 때 한 번 받고, 집에서 센 카드는 화면에서 뺀다 — 다시 받으면 센 만큼 다음 SKU가 채워져 「오늘 N개」가 끝나지 않는다.
 * PC와 같은 API(/api/erp/stock/adjust)를 쓴다. RG는 여기서 고치지 않는다(PC의 RG 실재고 대조로만).
 * 영수증 화면 틀: 480px · 상단 52px(레이아웃) · 하단 고정 버튼.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { REASON_LABEL, USER_REASONS, type UserReason } from '@/lib/erp/ledger/adjust';
import type { RecentAdjust } from '@/lib/erp/stock/queries';
import { DEFAULT_QUEUE_N, kstDate } from '@/lib/erp/stock/count-queue';
import { fetchCountQueue, fetchRecent, fetchStock, postAdjust } from './api';
import { LOC_LABEL, defaultCost, filterRows, fmtKst, onHandAt, toAdjustItems, won, type EditLocation, type StockRow } from './stock-view';

const TABS: EditLocation[] = ['self', 'rg_inbound'];
const field = { width: '100%', height: '40px', borderRadius: '8px', border: '1px solid #d1d5db', padding: '0 10px', fontSize: '14px', boxSizing: 'border-box', backgroundColor: '#fff' } as const;
const card = { backgroundColor: '#fff', borderRadius: '12px', padding: '12px', border: '1px solid #e5e7eb', marginBottom: '8px' } as const;
const sectionTitle = { fontSize: '13px', fontWeight: 700, color: '#111827', margin: '4px 0 6px' } as const;

export default function MobileStock() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [recent, setRecent] = useState<RecentAdjust[]>([]);
  const [queue, setQueue] = useState<StockRow[] | null>(null);
  const [queueTotal, setQueueTotal] = useState(0);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [loc, setLoc] = useState<EditLocation>('self');
  const [count, setCount] = useState(0);
  const [reason, setReason] = useState<UserReason>('count_diff');
  const [note, setNote] = useState('');
  const [costRaw, setCostRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([fetchStock(), fetchRecent(5)]);
    if (s.ok) setRows(s.data);
    else setMsg({ ok: false, text: s.error });
    if (r.ok) setRecent(r.data);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 오늘 셀 목록은 열 때 한 번만 받는다
  useEffect(() => {
    let alive = true;
    void fetchCountQueue(DEFAULT_QUEUE_N).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        setMsg({ ok: false, text: r.error });
        return;
      }
      setQueue(r.data.items);
      setQueueTotal(r.data.items.length);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 최신 원장 값(rows)을 먼저 쓴다 — 목록 카드는 열 때의 값이다
  const row = sel === null ? null : rows.find((r) => r.skuId === sel) ?? queue?.find((r) => r.skuId === sel) ?? null;
  const onHand = row ? onHandAt(row, loc) : 0;

  function pick(r: StockRow, l: EditLocation) {
    const fresh = rows.find((x) => x.skuId === r.skuId) ?? r;
    setSel(fresh.skuId);
    setLoc(l);
    setCount(onHandAt(fresh, l));
    const c = defaultCost(fresh);
    setCostRaw(c === null ? '' : String(c));
    setMsg(null);
  }

  const results = useMemo(
    () => (q.trim() ? filterRows(rows, { q, onlyStocked: false, onlyRgMismatch: false }, null).slice(0, 40) : []),
    [rows, q],
  );

  const diff = count - onHand;
  const cost = /^\d+$/.test(costRaw.trim()) ? Number(costRaw.trim()) : null;
  const canSave = !!row && !(diff > 0 && cost === null) && !saving;

  async function save() {
    if (!row || !canSave) return;
    setSaving(true);
    setMsg(null);
    const r = await postAdjust(toAdjustItems(
      [{ skuId: row.skuId, location: loc, mode: 'count', value: count, expected: onHand, reason, note: note.trim(), unitCost: diff > 0 ? cost : null }],
      uuidv4,
    ));
    setSaving(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.error });
      if (r.code === 'stale') await load();
      return;
    }
    setMsg({
      ok: true,
      text: diff === 0
        ? `${row.name} ${LOC_LABEL[loc]} ${won(count)}개 맞습니다 — 센 기록을 저장했습니다`
        : `${row.name} ${LOC_LABEL[loc]} ${won(onHand)} → ${won(count)} 저장했습니다`,
    });
    // 오늘 셀 목록은 집 실사다 — 집에서 센 카드만 뺀다
    if (loc === 'self') setQueue((list) => (list ? list.filter((x) => x.skuId !== row.skuId) : list));
    setNote('');
    setSel(null);
    await load();
  }

  const skuCard = (r: StockRow) => (
    <button
      key={r.skuId}
      type="button"
      onClick={() => pick(r, 'self')}
      style={{ ...card, display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }}
    >
      <div style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>{r.name}</div>
      <div style={{ fontSize: '12px', color: '#374151', marginTop: '2px' }}>{r.option || '—'}</div>
      <div style={{ fontSize: '12px', color: '#374151', marginTop: '6px' }}>
        집 {won(r.self)} · 입고중 {won(r.rgInbound)} · RG {won(r.rg)} · 마지막 실사 {r.lastCountedAt ? kstDate(r.lastCountedAt) : '안 셈'}
      </div>
    </button>
  );

  const left = queue?.length ?? 0;

  return (
    <div style={{ padding: '12px 16px', paddingBottom: '96px' }}>
      {msg && (
        <div role={msg.ok ? 'status' : 'alert'} style={{ ...card, backgroundColor: msg.ok ? '#e7f6ec' : '#fdecec', color: msg.ok ? '#1a7f37' : '#b91c1c', fontSize: '13px', fontWeight: 700 }}>
          {msg.text}
        </div>
      )}

      {!row && (
        <>
          <div style={sectionTitle}>
            오늘 셀 목록 · 집{' '}
            <span style={{ fontWeight: 500, color: '#6b7280' }}>
              {queue === null ? '불러오는 중…' : queueTotal === 0 ? '셀 SKU가 없습니다' : left === 0 ? `오늘 ${queueTotal}개를 다 셌습니다` : `남은 ${left} / ${queueTotal}개`}
            </span>
          </div>
          {(queue ?? []).map((r) => skuCard(rows.find((x) => x.skuId === r.skuId) ?? r))}

          <div style={{ ...sectionTitle, marginTop: '16px' }}>다른 상품</div>
          <input aria-label="상품 검색" value={q} onChange={(e) => setQ(e.target.value)} placeholder="상품·옵션 검색" style={{ ...field, marginBottom: '10px' }} />
          {results.map(skuCard)}
          {q.trim() !== '' && results.length === 0 && <div style={{ padding: '16px', color: '#6b7280', fontSize: '13px' }}>검색 결과가 없습니다</div>}

          {recent.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <div style={sectionTitle}>최근 수정</div>
              {recent.map((a) => (
                <div key={`${a.requestId}:${a.location}`} style={{ ...card, fontSize: '12px', color: '#374151' }}>
                  <b>{a.name}</b>{a.option ? ` · ${a.option}` : ''} · {LOC_LABEL[a.location]}{' '}
                  <span style={{ color: a.qty < 0 ? '#b91c1c' : '#1a7f37', fontWeight: 700 }}>{a.qty > 0 ? '+' : ''}{won(a.qty)}</span>
                  {a.qty === 0 ? ' (되돌림)' : ''} · {a.reason ? REASON_LABEL[a.reason] : ''} · {fmtKst(a.occurredAt)}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {row && (
        <>
          <button type="button" onClick={() => setSel(null)} style={{ background: 'none', border: 'none', color: '#374151', fontSize: '13px', fontWeight: 600, padding: 0, marginBottom: '10px' }}>
            ← 목록
          </button>
          <div style={card}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>{row.name}</div>
            <div style={{ fontSize: '13px', color: '#374151' }}>{row.option || '—'}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>RG {won(row.rg)}개 — RG는 PC의 「RG 실재고 대조」로 고칩니다</div>
          </div>

          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
            {TABS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => pick(row, l)}
                style={{
                  flex: 1, height: '38px', borderRadius: '8px', fontSize: '14px', fontWeight: 700,
                  border: loc === l ? 'none' : '1px solid #d1d5db', backgroundColor: loc === l ? '#374151' : '#fff', color: loc === l ? '#fff' : '#374151',
                }}
              >
                {LOC_LABEL[l]}
              </button>
            ))}
          </div>

          <div style={{ ...card, textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>지금 개수 (원장 {won(onHand)})</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '8px' }}>
              <button type="button" aria-label="하나 빼기" onClick={() => setCount((c) => Math.max(0, c - 1))} style={{ width: '52px', height: '52px', borderRadius: '26px', border: '1px solid #d1d5db', backgroundColor: '#fff', fontSize: '24px' }}>−</button>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                aria-label="지금 개수"
                value={count}
                onChange={(e) => setCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                style={{ width: '96px', height: '52px', textAlign: 'center', fontSize: '24px', fontWeight: 700, borderRadius: '10px', border: '1px solid #d1d5db' }}
              />
              <button type="button" aria-label="하나 더하기" onClick={() => setCount((c) => c + 1)} style={{ width: '52px', height: '52px', borderRadius: '26px', border: '1px solid #d1d5db', backgroundColor: '#fff', fontSize: '24px' }}>+</button>
            </div>
            <div style={{ marginTop: '8px', fontSize: '13px', fontWeight: 700, color: diff > 0 ? '#1a7f37' : diff < 0 ? '#b91c1c' : '#6b7280' }}>
              {diff === 0 ? '차이 없음 — 센 기록만 남깁니다' : `${won(onHand)} → ${won(count)} (${diff > 0 ? '+' : ''}${won(diff)})`}
            </div>
          </div>

          <select aria-label="사유" value={reason} onChange={(e) => setReason(e.target.value as UserReason)} style={{ ...field, marginBottom: '8px' }}>
            {USER_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
          </select>
          {diff > 0 && (
            <input aria-label="단가" inputMode="numeric" value={costRaw} onChange={(e) => setCostRaw(e.target.value)} placeholder="늘어난 재고 단가(원)" style={{ ...field, marginBottom: '8px', borderColor: cost === null ? '#f87171' : '#d1d5db' }} />
          )}
          <input aria-label="메모" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="메모(선택)" style={field} />

          <div style={{
            position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '480px',
            padding: '12px 16px', backgroundColor: '#fff', borderTop: '1px solid #e5e7eb', boxSizing: 'border-box',
          }}>
            <button
              type="button"
              disabled={!canSave}
              onClick={() => void save()}
              style={{ width: '100%', height: '50px', borderRadius: '12px', border: 'none', backgroundColor: canSave ? '#1a7f37' : '#9ca3af', color: '#fff', fontSize: '16px', fontWeight: 700 }}
            >
              {saving ? '저장 중…' : diff === 0 ? '맞습니다 — 센 기록 저장' : '저장'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

`src/app/m/stock/layout.tsx`:
```tsx
/**
 * 재고 수정 모바일 레이아웃 — 상단 고정 헤더 52px (src/app/m/receipt/layout.tsx와 같은 구조)
 */
import React from 'react';

export const metadata = { title: '재고 수정' };

export default function StockMobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', backgroundColor: '#f4f4f4' }}>
      <header
        style={{
          position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: '480px', height: '52px',
          backgroundColor: '#ffffff', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', padding: '0 16px',
          zIndex: 100, boxSizing: 'border-box',
        }}
      >
        <span style={{ fontSize: '16px', fontWeight: 700, color: '#1a1c1c', letterSpacing: '-0.3px' }}>재고 수정</span>
      </header>
      <main style={{ paddingTop: '52px' }}>{children}</main>
    </div>
  );
}
```

`src/app/m/stock/page.tsx`:
```tsx
/**
 * 휴대폰 재고 수정 — 오늘 셀 목록 → 지금 개수 → 저장 (목록 밖은 검색)
 */
import MobileStock from '@/components/erp/stock/MobileStock';

export default function MobileStockPage() {
  return <MobileStock />;
}
```

- [ ] **Step 4: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/components/erp-mobile-stock.test.tsx && npx tsc --noEmit && npx eslint src/components/erp/stock/MobileStock.tsx src/app/m/stock`
Expected: 5건 PASS, tsc 0 오류, eslint 오류 0(`load`의 setState는 await 뒤라 `react-hooks/set-state-in-effect`에 걸리지 않는다 — 걸리면 StockClient처럼 이유를 적은 한 줄 예외를 단다)
```bash
git add src/app/m/stock src/components/erp/stock/MobileStock.tsx src/__tests__/components/erp-mobile-stock.test.tsx
git commit -m "feat(erp): 휴대폰 재고 수정 /m/stock — 오늘 셀 목록으로 시작·검색·지금 개수·사유·최근 수정"
```

- [ ] **Step 5: 🔴 화면 확인 — 컨트롤러가 직접**

개발 서버·로그인은 Task 4 Step 17 그대로. 브라우저 창을 **390px 폭**으로 줄여 `http://localhost:3000/m/stock`을 연다. 확인: 헤더 52px · 가로 스크롤 없음 · 맨 위 「오늘 셀 목록 · 집」(기초재고 전이면 「셀 SKU가 없습니다」) · 「다른 상품」 검색 → 카드 → 탭 전환 시 지금 개수가 그 위치 원장 값으로 바뀜 · −/+ · 차이 표시(같으면 「차이 없음 — 센 기록만 남깁니다」·버튼 「맞습니다 — 센 기록 저장」) · 늘리면 단가 칸이 뜸 · 하단 버튼이 가려지지 않음(키보드 없는 상태). 🔴 **저장 버튼은 누르지 않는다.** 스크린샷을 사용자에게 보여준다. 깨진 곳은 고쳐 `fix(erp): …`로 커밋한다. 카드가 채워진 목록은 Task 9 Step 6에서 확인한다.

---
### Task 6: RG 보내기 → SKU `self → rg_inbound` (트랜잭션 안으로)

**Files:**
- Create: `src/lib/erp/ledger/rg-ship.ts`
- Test: `src/__tests__/lib/erp/ledger/rg-ship.test.ts`
- Modify: `src/app/api/cost-management/rg-shipments/route.ts`, `src/__tests__/api/rg-shipments.test.ts`
- Create: `src/components/orders/rg-sku-split.ts` · Test: `src/__tests__/components/rg-sku-split.test.ts`
- Modify: `src/components/orders/RocketGrowthShipmentModal.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/erp/ledger/rg-ship.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { RgShipInputError, RgShipStockError, postRgShipTransfers, validateRgShipItems } from '@/lib/erp/ledger/rg-ship';
import type { Db } from '@/lib/erp/ledger/store';

const EVENT = 'a1b2c3d4-0000-4000-8000-000000000001';
const AT = '2026-09-27T01:00:00.000Z';

function fakeDb(skus: { id: number; status: string; has_ledger: boolean }[], lots: { lot_id: number; qty: number; unit_cost: number; lot_at: number }[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let nextId = 100;
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('select s.id, s.status')) return { rows: skus, rowCount: skus.length };
      if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select 1 from erp.stock_ledger')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('select coalesce(l.lot_id')) return { rows: lots, rowCount: lots.length };
      if (sql.startsWith('insert into erp.stock_ledger')) return { rows: [{ id: nextId++ }], rowCount: 1 };
      if (sql.startsWith('set constraints')) return { rows: [], rowCount: null };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
    },
  };
  return { db, calls };
}

describe('validateRgShipItems', () => {
  it('없으면 빈 배열(옛 화면 호환)', () => {
    expect(validateRgShipItems(undefined)).toEqual([]);
    expect(validateRgShipItems(null)).toEqual([]);
  });
  it('sku_id·quantity를 읽는다', () => {
    expect(validateRgShipItems([{ sku_id: 7, quantity: 3 }])).toEqual([{ skuId: 7, qty: 3 }]);
  });
  it.each([
    ['배열 아님', { sku_id: 7 }],
    ['수량 0', [{ sku_id: 7, quantity: 0 }]],
    ['소수', [{ sku_id: 7, quantity: 1.5 }]],
    ['같은 SKU 두 번', [{ sku_id: 7, quantity: 1 }, { sku_id: 7, quantity: 2 }]],
  ])('%s → RgShipInputError', (_, raw) => {
    expect(() => validateRgShipItems(raw)).toThrow(RgShipInputError);
  });
});

describe('postRgShipTransfers', () => {
  it('SKU 오름차순으로 self → rg_inbound 이동(rgship:<이벤트>:<SKU>), 원장 전표 없는 SKU는 건너뛴다', async () => {
    const f = fakeDb(
      [{ id: 9, status: 'active', has_ledger: true }, { id: 3, status: 'active', has_ledger: false }, { id: 5, status: 'active', has_ledger: true }],
      [{ lot_id: 1, qty: 50, unit_cost: 1000, lot_at: 1 }],
    );
    const r = await postRgShipTransfers(f.db, { eventId: EVENT, occurredAt: AT, note: 'RG 보내기 2026-09-27', items: [{ skuId: 9, qty: 2 }, { skuId: 3, qty: 1 }, { skuId: 5, qty: 4 }] });
    expect(r.posted).toEqual([{ skuId: 5, qty: 4 }, { skuId: 9, qty: 2 }]);
    expect(r.skipped).toEqual([{ skuId: 3, qty: 1, reason: 'no_ledger' }]);
    const ins = f.calls.filter((c) => c.sql.startsWith('insert into erp.stock_ledger'));
    expect(ins.map((c) => [c.params[0], c.params[1], c.params[2], c.params[3], c.params[10], c.params[7], c.params[8]])).toEqual([
      [5, 'self', -4, 'transfer', `rgship:${EVENT}:5#0:out`, 'rg_shipment', EVENT],
      [5, 'rg_inbound', 4, 'transfer', `rgship:${EVENT}:5#0:in`, 'rg_shipment', EVENT],
      [9, 'self', -2, 'transfer', `rgship:${EVENT}:9#0:out`, 'rg_shipment', EVENT],
      [9, 'rg_inbound', 2, 'transfer', `rgship:${EVENT}:9#0:in`, 'rg_shipment', EVENT],
    ]);
  });

  it('활성이 아니거나 없는 SKU는 RgShipInputError', async () => {
    const f = fakeDb([{ id: 5, status: 'archived', has_ledger: true }]);
    await expect(postRgShipTransfers(f.db, { eventId: EVENT, occurredAt: AT, note: null, items: [{ skuId: 5, qty: 1 }, { skuId: 6, qty: 1 }] }))
      .rejects.toBeInstanceOf(RgShipInputError);
  });

  it('집 원장 재고가 모자라면 SKU를 밝힌 RgShipStockError', async () => {
    const f = fakeDb([{ id: 5, status: 'active', has_ledger: true }], [{ lot_id: 1, qty: 1, unit_cost: 1000, lot_at: 1 }]);
    await expect(postRgShipTransfers(f.db, { eventId: EVENT, occurredAt: AT, note: null, items: [{ skuId: 5, qty: 3 }] }))
      .rejects.toThrow(/SKU 5: 집 원장 재고 1개 < 보낼 3개/);
  });

  it('보낼 SKU가 없으면 DB를 부르지 않는다', async () => {
    const f = fakeDb([]);
    expect(await postRgShipTransfers(f.db, { eventId: EVENT, occurredAt: AT, note: null, items: [] })).toEqual({ posted: [], skipped: [] });
    expect(f.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger/rg-ship.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/lib/erp/ledger/rg-ship.ts`:
```ts
// src/lib/erp/ledger/rg-ship.ts
// RG 보내기 → 원장 self → rg_inbound 이동(SKU별). 옛 rg-shipments 라우트의 트랜잭션 안에서 부른다.
// 원장 전표가 하나도 없는 SKU는 건너뛴다(기초재고 전에도 옛 원가 배분 흐름이 막히지 않게) — 호출자가 사용자에게 알린다.
// 전표가 있는데 집 재고가 모자라면 던진다 — 호출자가 전부 되돌린다. 입고 완료(rg_inbound → rg)는 1-C2.
import { InsufficientStockError } from './fifo';
import { lockSku, postTransfer, type Db } from './store';

export interface RgShipSkuItem {
  skuId: number;
  qty: number;
}

export class RgShipInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RgShipInputError';
  }
}

export class RgShipStockError extends Error {
  constructor(public readonly skuId: number, public readonly need: number, public readonly have: number) {
    super(`SKU ${skuId}: 집 원장 재고 ${have}개 < 보낼 ${need}개`);
    this.name = 'RgShipStockError';
  }
}

/** 요청 본문 sku_items: [{ sku_id, quantity }]. 없으면 [](옛 화면) */
export function validateRgShipItems(raw: unknown): RgShipSkuItem[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new RgShipInputError('sku_items는 [{ sku_id, quantity }] 배열이다');
  const seen = new Set<number>();
  return raw.map((x) => {
    const o = (x ?? {}) as { sku_id?: unknown; quantity?: unknown };
    const skuId = Number(o.sku_id);
    const qty = Number(o.quantity);
    if (!Number.isInteger(skuId) || skuId <= 0) throw new RgShipInputError(`sku_id가 잘못됐다: ${String(o.sku_id)}`);
    if (!Number.isInteger(qty) || qty <= 0) throw new RgShipInputError(`SKU ${skuId} 수량은 양의 정수다: ${String(o.quantity)}`);
    if (seen.has(skuId)) throw new RgShipInputError(`SKU ${skuId}가 두 번 있다`);
    seen.add(skuId);
    return { skuId, qty };
  });
}

export async function postRgShipTransfers(
  db: Db,
  p: { eventId: string; occurredAt: string; note: string | null; items: RgShipSkuItem[] },
): Promise<{ posted: RgShipSkuItem[]; skipped: (RgShipSkuItem & { reason: 'no_ledger' })[] }> {
  if (p.items.length === 0) return { posted: [], skipped: [] };
  const items = [...p.items].sort((a, b) => a.skuId - b.skuId);
  const { rows } = await db.query(
    `select s.id, s.status, exists (select 1 from erp.stock_ledger l where l.sku_id = s.id) as has_ledger
       from erp.skus s where s.id = any($1::bigint[])`,
    [items.map((i) => i.skuId)],
  );
  const byId = new Map(rows.map((r) => [Number(r.id), r as { status: string; has_ledger: boolean }]));
  for (const i of items) {
    const s = byId.get(i.skuId);
    if (!s || s.status !== 'active') throw new RgShipInputError(`SKU ${i.skuId}가 활성 SKU가 아니다`);
  }
  // 1-B 인계(I4): 여러 SKU는 오름차순으로 먼저 잠근다
  for (const i of items) await lockSku(db, i.skuId);
  const posted: RgShipSkuItem[] = [];
  const skipped: (RgShipSkuItem & { reason: 'no_ledger' })[] = [];
  for (const i of items) {
    if (!byId.get(i.skuId)!.has_ledger) {
      skipped.push({ ...i, reason: 'no_ledger' });
      continue;
    }
    try {
      await postTransfer(db, {
        skuId: i.skuId, from: 'self', to: 'rg_inbound', qty: i.qty, occurredAt: p.occurredAt,
        idemKey: `rgship:${p.eventId}:${i.skuId}`, refType: 'rg_shipment', refId: p.eventId, note: p.note ?? undefined,
      });
    } catch (e) {
      if (e instanceof InsufficientStockError) throw new RgShipStockError(i.skuId, e.need, e.have);
      throw e;
    }
    posted.push(i);
  }
  return { posted, skipped };
}
```

- [ ] **Step 4: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/lib/erp/ledger/rg-ship.test.ts && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/lib/erp/ledger/rg-ship.ts src/__tests__/lib/erp/ledger/rg-ship.test.ts
git commit -m "feat(erp): RG 보내기 원장 이동(self → rg_inbound) — 원장 없는 SKU 건너뜀 · 부족하면 SKU 밝혀 거부"
```

- [ ] **Step 5: 라우트 테스트를 새 동작으로 바꾼다**

`src/__tests__/api/rg-shipments.test.ts`:

(1) 6행
```ts
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));
```
바로 아래에 넣는다.
```ts
const { mockPostRg } = vi.hoisted(() => ({ mockPostRg: vi.fn() }));
vi.mock('@/lib/erp/ledger/rg-ship', async (orig) => ({
  ...(await orig<typeof import('@/lib/erp/ledger/rg-ship')>()),
  postRgShipTransfers: mockPostRg,
}));
```

(2) 89행 `function makePostRequest(body: unknown): NextRequest {`부터 파일 끝(172행)까지를 통째로 아래로 바꾼다(GET 테스트 1~87행은 그대로).
```ts
function makePostRequest(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/cost-management/rg-shipments',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

import { RgShipStockError } from '@/lib/erp/ledger/rg-ship';

describe('POST /api/cost-management/rg-shipments — FIFO·이벤트·원장 이동이 한 트랜잭션', () => {
  let order: string[];
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  let mockPoolQuery: ReturnType<typeof vi.fn>;
  let failEvent: boolean;

  const body = {
    shipped_at: '2026-05-28',
    total_shipping_fee: 15200,
    items: [{ product_cost_id: 'prod-uuid', quantity: 100, unit_rg_fee: 152 }],
    sku_items: [{ sku_id: 7, quantity: 100 }],
    wing_inbound_id: '12345',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    order = [];
    failEvent = false;
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-uuid-123', email: 'test@example.com' });
    mockClient = {
      query: vi.fn(async (sql: string) => {
        if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) { order.push(sql); return {}; }
        if (sql.includes('FROM product_costs WHERE id')) return { rows: [{ id: 'prod-uuid', product_name: '상품A' }] };
        if (sql.includes('AS total_stock')) return { rows: [{ total_stock: 100 }] };
        if (sql.includes('SELECT id, quantity FROM cost_entries')) return { rows: [{ id: 'entry-uuid-1', quantity: 100 }] };
        if (sql.startsWith('UPDATE cost_entries')) return {};
        if (/INSERT INTO rg_shipment_events/.test(sql)) {
          if (failEvent) throw new Error('DB error');
          order.push('event');
          return { rows: [{ id: 'event-uuid-1' }] };
        }
        if (/INSERT INTO rg_shipment_event_items/.test(sql)) return {};
        throw new Error(`예상 못 한 SQL: ${sql.slice(0, 50)}`);
      }),
      release: vi.fn(),
    };
    mockPoolQuery = vi.fn();
    mockGetPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(mockClient), query: mockPoolQuery });
    mockPostRg.mockImplementation(async () => { order.push('ledger'); return { posted: [{ skuId: 7, qty: 100 }], skipped: [] }; });
  });

  it('이벤트 기록과 원장 이동이 COMMIT 전에 같은 client로 실행된다', async () => {
    const { POST } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await POST(makePostRequest(body));
    expect(res.status).toBe(200);
    expect(order).toEqual(['BEGIN', 'event', 'ledger', 'COMMIT']);
    expect(mockPoolQuery).not.toHaveBeenCalled();

    const itemsCall = mockClient.query.mock.calls.find((args: unknown[]) => /INSERT INTO rg_shipment_event_items/i.test(args[0] as string));
    expect(itemsCall![1][2]).toBe('상품A');

    const [db, arg] = mockPostRg.mock.calls[0];
    expect(db).toBe(mockClient);
    expect(arg).toEqual({
      eventId: 'event-uuid-1',
      occurredAt: expect.stringMatching(/Z$/),
      note: 'RG 보내기 2026-05-28 · Wing 입고 ID 12345',
      items: [{ skuId: 7, qty: 100 }],
    });
    const json = await res.json();
    expect(json.data.ledger).toEqual({ posted: [{ skuId: 7, qty: 100 }], skipped: [] });
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('sku_items 없이 보내면(옛 화면) 원장에는 빈 목록을 넘긴다', async () => {
    mockPostRg.mockResolvedValue({ posted: [], skipped: [] });
    const { POST } = await import('@/app/api/cost-management/rg-shipments/route');
    const { sku_items: _omit, wing_inbound_id: _w, ...legacy } = body;
    const res = await POST(makePostRequest(legacy));
    expect(res.status).toBe(200);
    expect(mockPostRg.mock.calls[0][1]).toMatchObject({ items: [], note: 'RG 보내기 2026-05-28' });
  });

  it('이벤트 기록이 실패하면 FIFO까지 전부 되돌린다(예전과 반대)', async () => {
    failEvent = true;
    const { POST } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await POST(makePostRequest(body));
    expect(res.status).toBe(500);
    expect(order).toEqual(['BEGIN', 'ROLLBACK']);
    expect(mockPostRg).not.toHaveBeenCalled();
  });

  it('집 원장 재고가 모자라면 409 + 재고현황 안내, 전부 되돌린다', async () => {
    mockPostRg.mockRejectedValue(new RgShipStockError(7, 100, 3));
    const { POST } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await POST(makePostRequest(body));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('재고현황');
    expect(order).toEqual(['BEGIN', 'event', 'ROLLBACK']);
  });

  it('sku_items 형태가 틀리면 400이고 DB에 붙지 않는다', async () => {
    const { POST } = await import('@/app/api/cost-management/rg-shipments/route');
    const res = await POST(makePostRequest({ ...body, sku_items: [{ sku_id: 7, quantity: 0 }] }));
    expect(res.status).toBe(400);
    expect(order).toEqual([]);
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/__tests__/api/rg-shipments.test.ts`
Expected: GET 5건 PASS, POST 새 테스트 FAIL(이벤트가 `pool.query`로 가고 `postRgShipTransfers`를 부르지 않는다)

- [ ] **Step 7: 라우트 구현**

`src/app/api/cost-management/rg-shipments/route.ts`:

(1) 5행
```ts
import { computeFifoBatchOps } from '@/lib/cost-management/rg-shipment';
```
을 아래로 바꾼다.
```ts
import { computeFifoBatchOps } from '@/lib/cost-management/rg-shipment';
import {
  RgShipInputError, RgShipStockError, postRgShipTransfers, validateRgShipItems, type RgShipSkuItem,
} from '@/lib/erp/ledger/rg-ship';
```

(2) 105~106행
```ts
  const pool = getSourcingPool();
  const client = await pool.connect();
```
을 아래로 바꾼다.
```ts
  // 1-C1: SKU별 보낸 수량 → 원장 self → rg_inbound. 없으면(옛 화면) 원장 기록 없이 옛 흐름만 돈다
  let skuItems: RgShipSkuItem[];
  try {
    skuItems = validateRgShipItems(body?.sku_items);
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 400 });
  }
  const wingInboundId = typeof body?.wing_inbound_id === 'string' ? body.wing_inbound_id.trim().slice(0, 60) : '';

  const pool = getSourcingPool();
  const client = await pool.connect();
```

(3) 182행부터 함수 끝(215행)까지
```ts
    await client.query('COMMIT');

    // FIFO 완료 후 별도로 이벤트 기록 (트랜잭션 밖 — 실패해도 FIFO에 영향 없음)
    try {
      const { rows: eventRows } = await pool.query(
        `INSERT INTO rg_shipment_events (user_id, shipped_at, total_shipping_fee)
         VALUES ($1, $2, $3) RETURNING id`,
        [user.userId, shipped_at, total_shipping_fee],
      );
      const eventId = eventRows[0].id as string;
      for (const item of items as RgShipmentItem[]) {
        const productName = productNames.get(item.product_cost_id);
        if (productName) {
          await pool.query(
            `INSERT INTO rg_shipment_event_items
               (shipment_event_id, product_cost_id, product_name, quantity, unit_rg_fee)
             VALUES ($1, $2, $3, $4, $5)`,
            [eventId, item.product_cost_id, productName, item.quantity, item.unit_rg_fee],
          );
        }
      }
    } catch (eventErr) {
      console.warn('[rg-shipments] 이벤트 기록 실패', eventErr);
    }

    return NextResponse.json({ success: true, data: { affected_entries: affectedEntries, split_entries: splitEntries } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[rg-shipments]', err);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  } finally {
    client.release();
  }
}
```
를 아래로 바꾼다.
```ts
    // 이벤트 기록 — 1-C1부터 트랜잭션 안에서 한다(원장 이동 전표의 멱등키가 event id를 쓴다).
    // 예전에는 트랜잭션 밖이라 기록이 실패해도 FIFO만 커밋됐다 — 이제는 함께 성공하거나 함께 되돌린다.
    const { rows: eventRows } = await client.query(
      `INSERT INTO rg_shipment_events (user_id, shipped_at, total_shipping_fee)
       VALUES ($1, $2, $3) RETURNING id`,
      [user.userId, shipped_at, total_shipping_fee],
    );
    const eventId = String(eventRows[0].id);
    for (const item of items as RgShipmentItem[]) {
      await client.query(
        `INSERT INTO rg_shipment_event_items
           (shipment_event_id, product_cost_id, product_name, quantity, unit_rg_fee)
         VALUES ($1, $2, $3, $4, $5)`,
        [eventId, item.product_cost_id, productNames.get(item.product_cost_id) as string, item.quantity, item.unit_rg_fee],
      );
    }

    // 원장: SKU별 self → rg_inbound. 원장 전표 없는 SKU는 건너뛰고(ledger.skipped) 화면이 알린다
    const ledger = await postRgShipTransfers(client, {
      eventId,
      occurredAt: new Date().toISOString(),
      note: `RG 보내기 ${shipped_at}${wingInboundId ? ` · Wing 입고 ID ${wingInboundId}` : ''}`,
      items: skuItems,
    });

    await client.query('COMMIT');
    return NextResponse.json({
      success: true,
      data: { affected_entries: affectedEntries, split_entries: splitEntries, event_id: eventId, ledger },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err instanceof RgShipStockError) {
      return NextResponse.json({ success: false, error: `${err.message} — 재고현황에서 집 재고를 먼저 고치세요` }, { status: 409 });
    }
    if (err instanceof RgShipInputError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    console.error('[rg-shipments]', err);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  } finally {
    client.release();
  }
}
```

- [ ] **Step 8: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/api/rg-shipments.test.ts && npx tsc --noEmit`
Expected: GET 5 + POST 5 전부 PASS, 0 오류
```bash
git add src/app/api/cost-management/rg-shipments/route.ts src/__tests__/api/rg-shipments.test.ts
git commit -m "feat(erp): RG 보내기 — 이벤트 기록을 트랜잭션 안으로, SKU별 원장 이동(self → rg_inbound)"
```

- [ ] **Step 9: 모달 SKU 분배 — 실패하는 테스트**

`src/__tests__/components/rg-sku-split.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildSkuItems, skusForProduct, type SkuOption } from '@/components/orders/rg-sku-split';

const skus: SkuOption[] = [
  { skuId: 7, key: 'cp:1:단일', name: '매트', option: '', self: 10, legacyProductCostIds: ['pc-a'] },
  { skuId: 8, key: 'cp:2:블랙', name: '왜건', option: '블랙', self: 5, legacyProductCostIds: ['pc-b'] },
  { skuId: 9, key: 'cp:2:레드', name: '왜건', option: '레드', self: 5, legacyProductCostIds: ['pc-b'] },
];

describe('rg-sku-split', () => {
  it('옛 원가 상품에 연결된 SKU', () => {
    expect(skusForProduct('pc-b', skus).map((s) => s.skuId)).toEqual([8, 9]);
    expect(skusForProduct('pc-z', skus)).toEqual([]);
  });

  it('SKU가 하나면 보낼 수량 전부, 여럿이면 입력값, 연결 없으면 뺀다', () => {
    const r = buildSkuItems([{ id: 'pc-a', qty: 4 }, { id: 'pc-b', qty: 3 }, { id: 'pc-z', qty: 2 }], skus, { 8: '2', 9: '1' });
    expect(r.items).toEqual([{ sku_id: 7, quantity: 4 }, { sku_id: 8, quantity: 2 }, { sku_id: 9, quantity: 1 }]);
    expect(r.mismatched).toEqual([]);
  });

  it('여러 옵션의 합이 보낼 수량과 다르면 알린다', () => {
    const r = buildSkuItems([{ id: 'pc-b', qty: 3 }], skus, { 8: '1' });
    expect(r.items).toEqual([{ sku_id: 8, quantity: 1 }]);
    expect(r.mismatched).toEqual([{ productId: 'pc-b', productQty: 3, skuSum: 1 }]);
  });
});
```

Run: `npx vitest run src/__tests__/components/rg-sku-split.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 10: 구현**

`src/components/orders/rg-sku-split.ts`:
```ts
// src/components/orders/rg-sku-split.ts
// RG 보내기 모달: 옛 원가 상품(product_cost) 보낼 수량 → 원장 SKU 수량(서버가 SKU별 self → rg_inbound 이동을 기록한다).
// 연결은 erp.skus.legacy_product_cost_ids. SKU가 하나면 보낼 수량 전부, 여럿(옵션)이면 사람이 나눈다.
export interface SkuOption {
  skuId: number;
  key: string;
  name: string;
  option: string;
  /** 집 원장 재고 */
  self: number;
  legacyProductCostIds: string[];
}

export function skusForProduct(productId: string, skus: SkuOption[]): SkuOption[] {
  return skus.filter((s) => s.legacyProductCostIds.includes(productId));
}

export function buildSkuItems(
  products: { id: string; qty: number }[],
  skus: SkuOption[],
  skuQty: Record<number, string>,
): { items: { sku_id: number; quantity: number }[]; mismatched: { productId: string; productQty: number; skuSum: number }[] } {
  const bySku = new Map<number, number>();
  const mismatched: { productId: string; productQty: number; skuSum: number }[] = [];
  for (const p of products) {
    if (p.qty <= 0) continue;
    const linked = skusForProduct(p.id, skus);
    if (linked.length === 0) continue;
    if (linked.length === 1) {
      bySku.set(linked[0].skuId, (bySku.get(linked[0].skuId) ?? 0) + p.qty);
      continue;
    }
    let sum = 0;
    for (const s of linked) {
      const q = Math.max(0, parseInt(skuQty[s.skuId] ?? '0', 10) || 0);
      if (q > 0) bySku.set(s.skuId, (bySku.get(s.skuId) ?? 0) + q);
      sum += q;
    }
    if (sum !== p.qty) mismatched.push({ productId: p.id, productQty: p.qty, skuSum: sum });
  }
  return { items: [...bySku].sort((a, b) => a[0] - b[0]).map(([sku_id, quantity]) => ({ sku_id, quantity })), mismatched };
}
```

Run: `npx vitest run src/__tests__/components/rg-sku-split.test.ts` → 3건 PASS

- [ ] **Step 11: 모달에 SKU 수량·Wing 입고 ID를 붙인다**

`src/components/orders/RocketGrowthShipmentModal.tsx`:

(1) 9행
```ts
import { RG_SHIPMENT_DRAFT_KEY } from './draft-keys';
```
을 아래로 바꾼다.
```ts
import { RG_SHIPMENT_DRAFT_KEY } from './draft-keys';
import { buildSkuItems, skusForProduct, type SkuOption } from './rg-sku-split';
```

(2) 35행
```ts
  const [saving, setSaving] = useState(false);
```
을 아래로 바꾼다.
```ts
  const [saving, setSaving] = useState(false);
  // 1-C1: 원장 SKU(집 재고 포함). 불러오지 못해도 옛 흐름(원가 배분)은 그대로 쓸 수 있다
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [skuQty, setSkuQty] = useState<Record<number, string>>({});
  const [wingInboundId, setWingInboundId] = useState('');

  useEffect(() => {
    fetch('/api/erp/stock')
      .then((r) => r.json())
      .then((j) => { if (j.success) setSkus(j.data as SkuOption[]); })
      .catch(() => {});
  }, []);
```

(3) `submit()` 안 83행
```ts
    setSaving(true);
    try {
      const items = activeItems.map((item) => ({
```
을 아래로 바꾼다.
```ts
    const split = buildSkuItems(activeItems.map((i) => ({ id: i.id, qty: i.qty })), skus, skuQty);
    if (split.mismatched.length > 0) {
      const lines = split.mismatched
        .map((m) => `- ${products.find((p) => p.id === m.productId)?.product_name ?? m.productId}: 보낼 ${m.productQty}개 · SKU 합 ${m.skuSum}개`)
        .join('\n');
      const ok = await confirmDialog({ message: `옵션별 수량 합이 보낼 수량과 다릅니다:\n\n${lines}\n\n원장에는 옵션별 수량대로 기록됩니다. 계속할까요?` });
      if (!ok) return;
    }

    setSaving(true);
    try {
      const items = activeItems.map((item) => ({
```

(4) 94행
```ts
        body: JSON.stringify({ shipped_at: shippedAt, total_shipping_fee: feeNum, items }),
```
을 아래로 바꾼다.
```ts
        body: JSON.stringify({
          shipped_at: shippedAt, total_shipping_fee: feeNum, items,
          sku_items: split.items, wing_inbound_id: wingInboundId,
        }),
```

(5) 97~98행
```ts
      if (json.success) {
        clearRgDraftNow();
```
을 아래로 바꾼다.
```ts
      if (json.success) {
        clearRgDraftNow();
        const skipped = (json.data?.ledger?.skipped ?? []) as unknown[];
        if (skipped.length > 0) toast.error(`원장 기초재고가 없는 SKU ${skipped.length}개는 원장 기록을 건너뛰었습니다`);
        else toast.success('로켓그로스 입고를 등록했습니다');
```

(6) 총 배송비 블록 끝과 상품 목록 시작(147~150행)
```tsx
            />
          </div>

          {/* 상품 목록 */}
```
을 아래로 바꾼다(Wing 입고 ID 칸을 넣는다).
```tsx
            />
          </div>

          {/* Wing 입고 ID — 원장 이동 전표의 메모로 남긴다 */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>Wing 입고 ID (선택)</div>
            <input
              value={wingInboundId}
              onChange={(e) => setWingInboundId(e.target.value)}
              placeholder="예: 12345678"
              aria-label="Wing 입고 ID"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px', boxSizing: 'border-box' }}
            />
          </div>

          {/* 상품 목록 */}
```

(7) 상품 행(161~190행)
```tsx
              {products.map((p) => {
                const qtyStr = quantities[p.id] ?? '';
                const qty = parseInt(qtyStr) || 0;
                const unitFee = qty > 0 ? (unitFees.get(p.id) ?? 0) : null;
                const overStock = qty > p.current_stock;
                return (
                  <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 80px 70px', gap: '8px', padding: '8px 12px', alignItems: 'center', borderBottom: '1px solid #f0f0f0', background: qty === 0 ? '#f5f5f7' : '#fff' }}>
```
를 아래로 바꾼다.
```tsx
              {products.map((p) => {
                const qtyStr = quantities[p.id] ?? '';
                const qty = parseInt(qtyStr) || 0;
                const unitFee = qty > 0 ? (unitFees.get(p.id) ?? 0) : null;
                const overStock = qty > p.current_stock;
                const linked = skusForProduct(p.id, skus);
                return (
                  <React.Fragment key={p.id}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 80px 70px', gap: '8px', padding: '8px 12px', alignItems: 'center', borderBottom: '1px solid #f0f0f0', background: qty === 0 ? '#f5f5f7' : '#fff' }}>
```
그리고 같은 행 끝(187~190행)
```tsx
                    </span>
                  </div>
                );
              })}
```
을 아래로 바꾼다(SKU 줄을 붙이고 Fragment를 닫는다).
```tsx
                    </span>
                  </div>
                  {qty > 0 && (
                    <div style={{ padding: '4px 12px 8px 24px', borderBottom: '1px solid #f0f0f0', background: '#fff', fontSize: '10.5px', color: '#555' }}>
                      {linked.length === 0 && <span style={{ color: '#999' }}>연결된 재고 SKU 없음 — 원장 기록 없이 보냅니다</span>}
                      {linked.length === 1 && (
                        <span>재고 SKU {linked[0].option || linked[0].name} · {fmt(qty)}개 자동 (집 원장 {fmt(linked[0].self)}개)</span>
                      )}
                      {linked.length > 1 && linked.map((s) => (
                        <label key={s.skuId} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                          <span style={{ flex: 1 }}>{s.option || s.name} <span style={{ color: '#999' }}>(집 {fmt(s.self)})</span></span>
                          <input
                            type="number"
                            min={0}
                            aria-label={`${s.option || s.name} 보낼 수량`}
                            value={skuQty[s.skuId] ?? ''}
                            onChange={(e) => setSkuQty((prev) => ({ ...prev, [s.skuId]: e.target.value }))}
                            placeholder="0"
                            style={{ width: '56px', padding: '2px 6px', borderRadius: '6px', border: '1px solid #e5e5e5', fontSize: '11px', textAlign: 'right' }}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  </React.Fragment>
                );
              })}
```

- [ ] **Step 12: 타입·테스트·커밋**

Run: `npx tsc --noEmit && npx vitest run src/__tests__/components/rg-sku-split.test.ts src/__tests__/api/rg-shipments.test.ts`
Expected: 0 오류, 전부 PASS
```bash
git add src/components/orders/rg-sku-split.ts src/components/orders/RocketGrowthShipmentModal.tsx src/__tests__/components/rg-sku-split.test.ts
git commit -m "feat(erp): RG 입고 등록 창에 옵션(SKU)별 보낼 수량과 Wing 입고 ID"
```

- [ ] **Step 13: 🔴 화면 확인 — 컨트롤러가 직접**

1440px에서 `http://localhost:3000/orders`의 원가 탭 → 「로켓그로스 입고 등록」 창을 연다. 상품 하나에 수량을 넣으면 그 아래 SKU 줄(자동·옵션별 입력·연결 없음)이 뜨는지, Wing 입고 ID 칸이 보이는지 확인한다. 🔴 **「로켓그로스 입고 등록」은 누르지 않는다**(옛 원가 배분이 실제로 돈다). 입력값은 창을 닫기 전에 지운다(초안 저장이 남는다).

---
### Task 7: 영수증 확정 → 원장 `self` 입고 (옵션 분배 · 품번 학습)

**Files:**
- Create: `src/lib/erp/ledger/receipt.ts`, `src/lib/erp/ledger/purchase-units.ts`, `scripts/erp/purchase-units-seed.ts`
- Test: `src/__tests__/lib/erp/ledger/receipt.test.ts`, `src/__tests__/lib/erp/ledger/purchase-units.test.ts`
- Create: `src/app/api/erp/receipts/[id]/sku-options/route.ts` · Test: `src/__tests__/api/erp-receipt-sku-options.test.ts`
- Modify: `src/app/api/receipts/[id]/confirm/route.ts` · Test: `src/__tests__/api/receipts-confirm-ledger.test.ts`
- Create: `src/components/receipt/sku-split.ts`, `src/components/receipt/ReceiptSkuSplit.tsx` · Test: `src/__tests__/components/receipt-sku-split.test.ts`
- Modify: `src/components/receipt/ReceiptDetail.tsx`, `src/__tests__/components/receipt-screens.test.tsx`

#### 7-A. 영수증 줄 → SKU (`receipt.ts`)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/erp/ledger/receipt.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  ReceiptSplitError, buildLineOptions, expectedPacks, parseSkuSplits, postReceiptLots, resolveReceiptSplit,
} from '@/lib/erp/ledger/receipt';
import type { Db } from '@/lib/erp/ledger/store';

describe('resolveReceiptSplit', () => {
  it('후보가 하나면 입고 수량 전부', () => {
    expect(resolveReceiptSplit(4, [7])).toEqual([{ skuId: 7, qty: 4 }]);
  });
  it('후보가 없거나 여럿인데 분배가 없으면 거부', () => {
    expect(() => resolveReceiptSplit(4, [])).toThrow(/SKU를 고른다/);
    expect(() => resolveReceiptSplit(4, [7, 8])).toThrow(/옵션별 수량/);
  });
  it('분배 합은 입고 수량과 같아야 하고, 결과는 SKU 오름차순', () => {
    expect(resolveReceiptSplit(4, [7, 8], [{ skuId: 8, qty: 1 }, { skuId: 7, qty: 3 }])).toEqual([{ skuId: 7, qty: 3 }, { skuId: 8, qty: 1 }]);
    expect(() => resolveReceiptSplit(4, [7, 8], [{ skuId: 7, qty: 3 }])).toThrow(/합 3개가 입고 수량 4개와 다르다/);
  });
  it('0개로 나눈 옵션은 빼고 기록한다', () => {
    expect(resolveReceiptSplit(2, [7, 8], [{ skuId: 7, qty: 2 }, { skuId: 8, qty: 0 }])).toEqual([{ skuId: 7, qty: 2 }]);
  });
  it('고른 SKU 하나에 수량이 없으면 입고 수량 전부', () => {
    expect(resolveReceiptSplit(5, [], [{ skuId: 9, qty: null }])).toEqual([{ skuId: 9, qty: 5 }]);
  });
  it('소수 입고 수량·같은 SKU 두 번은 거부', () => {
    expect(() => resolveReceiptSplit(1.5, [7])).toThrow(ReceiptSplitError);
    expect(() => resolveReceiptSplit(2, [], [{ skuId: 9, qty: 1 }, { skuId: 9, qty: 1 }])).toThrow(/두 번/);
  });
});

describe('buildLineOptions', () => {
  const learned = [{ supplierCode: '111', skuId: 11, key: 'k11', name: 'A', option: '블랙' }];
  const byProduct = [{ skuId: 21, key: 'k21', name: 'B', option: '', legacy: ['pc-2'] }];
  it('기억한 품번 연결(purchase_units)이 먼저', () => {
    expect(buildLineOptions('111', 'pc-2', learned, byProduct)).toEqual({ source: 'learned', candidates: [{ skuId: 11, key: 'k11', name: 'A', option: '블랙' }] });
  });
  it('없으면 상품(product_cost) 연결', () => {
    expect(buildLineOptions('999', 'pc-2', learned, byProduct)).toEqual({ source: 'product', candidates: [{ skuId: 21, key: 'k21', name: 'B', option: '' }] });
  });
  it('둘 다 없으면 none', () => {
    expect(buildLineOptions(null, null, learned, byProduct)).toEqual({ source: 'none', candidates: [] });
  });
});

describe('expectedPacks', () => {
  it('일반은 수량 그대로, 소분은 추정(이월 모름)', () => {
    expect(expectedPacks({ entry_type: 'normal', quantity: 3, items_per_box: null, subdivision_unit: null })).toEqual({ qty: 3, approx: false });
    expect(expectedPacks({ entry_type: 'subdivision', quantity: 1, items_per_box: 12, subdivision_unit: 6 })).toEqual({ qty: 2, approx: true });
    expect(expectedPacks({ entry_type: 'normal', quantity: 1.5, items_per_box: null, subdivision_unit: null })).toBeNull();
  });
});

describe('parseSkuSplits', () => {
  it('{ 줄번호: [{ sku_id, qty }] }', () => {
    expect(parseSkuSplits(undefined)).toEqual({});
    expect(parseSkuSplits({ 2: [{ sku_id: 7, qty: 3 }, { sku_id: 8, qty: null }] })).toEqual({ 2: [{ skuId: 7, qty: 3 }, { skuId: 8, qty: null }] });
  });
  it('형태가 틀리면 ReceiptSplitError', () => {
    expect(() => parseSkuSplits([1, 2])).toThrow(ReceiptSplitError);
    expect(() => parseSkuSplits({ x: [] })).toThrow(ReceiptSplitError);
  });
});

function fakeDb(o: { productRows?: Record<string, unknown>[]; active?: number[] } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let nextId = 100;
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('select p.supplier_code')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('select s.id, s.key')) return { rows: o.productRows ?? [], rowCount: 0 };
      if (sql.startsWith('select id from erp.skus where id = any')) return { rows: (o.active ?? []).map((id) => ({ id })), rowCount: 0 };
      if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('select 1 from erp.stock_ledger')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('insert into erp.stock_ledger')) return { rows: [{ id: nextId++ }], rowCount: 1 };
      if (sql.startsWith('set constraints')) return { rows: [], rowCount: null };
      if (sql.startsWith('insert into erp.purchase_units')) return { rows: [], rowCount: 1 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
    },
  };
  return { db, calls };
}

describe('postReceiptLots', () => {
  const base = {
    lineId: 'line-1', lineNo: 1, itemCode: '111', itemLabel: '라운드티', productCostId: 'pc-2', packs: 4, unitCost: 2500, receivedAt: '2026-09-20',
  };
  const productRows = [
    { id: '21', key: 'k21', name: '라운드티', option_label: '블랙', legacy: ['pc-2'] },
    { id: '22', key: 'k22', name: '라운드티', option_label: '레드', legacy: ['pc-2'] },
  ];

  it('SKU 오름차순으로 receipt lot(구매일 KST 자정)을 만들고 품번 연결을 기억한다', async () => {
    const f = fakeDb({ productRows, active: [21, 22] });
    const split = await postReceiptLots(f.db, { ...base, requested: [{ skuId: 22, qty: 1 }, { skuId: 21, qty: 3 }] });
    expect(split).toEqual([{ skuId: 21, qty: 3 }, { skuId: 22, qty: 1 }]);
    const ins = f.calls.filter((c) => c.sql.startsWith('insert into erp.stock_ledger'));
    expect(ins.map((c) => [c.params[0], c.params[1], c.params[2], c.params[3], c.params[5], c.params[6], c.params[7], c.params[8], c.params[10]])).toEqual([
      [21, 'self', 3, 'receipt', 2500, '2026-09-20T00:00:00+09:00', 'receipt_line', 'line-1', 'receipt:line-1:21'],
      [22, 'self', 1, 'receipt', 2500, '2026-09-20T00:00:00+09:00', 'receipt_line', 'line-1', 'receipt:line-1:22'],
    ]);
    expect(f.calls.filter((c) => c.sql.startsWith('insert into erp.purchase_units')).map((c) => c.params)).toEqual([
      ['111', '라운드티', 21],
      ['111', '라운드티', 22],
    ]);
  });

  it('고른 SKU가 활성이 아니면 거부(아무것도 쓰지 않는다)', async () => {
    const f = fakeDb({ productRows, active: [] });
    await expect(postReceiptLots(f.db, { ...base, requested: [{ skuId: 21, qty: 4 }] })).rejects.toThrow(/활성 SKU가 아니다/);
    expect(f.calls.some((c) => c.sql.startsWith('insert'))).toBe(false);
  });

  it('품번이 없으면 학습하지 않는다', async () => {
    const f = fakeDb({ productRows: [productRows[0]], active: [21] });
    await postReceiptLots(f.db, { ...base, itemCode: null });
    expect(f.calls.some((c) => c.sql.startsWith('insert into erp.purchase_units'))).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/ledger/receipt.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/lib/erp/ledger/receipt.ts`:
```ts
// src/lib/erp/ledger/receipt.ts
// 코스트코 영수증 확정 → 원장 self 입고(kind='receipt'). 영수증 확정 라우트의 줄 트랜잭션 안에서 부른다.
// 품번 : SKU = 1 : N(erp.purchase_units). 후보: 기억한 품번 연결 → 없으면 옛 상품(product_cost) 연결.
// 수량 단위 = cost_entries.quantity(소분이면 팩 수) · 단가 = 그 입고의 cost_entries.unit_cost(배송비·RG 물류비 제외, 1-B 정의).
import { lockSku, postLotCreate, type Db } from './store';

export interface SkuCandidate {
  skuId: number;
  key: string;
  name: string;
  option: string;
}

export interface LineOptions {
  source: 'learned' | 'product' | 'none';
  candidates: SkuCandidate[];
}

/** 확정 요청의 한 줄 분배. qty null = (고른 SKU가 하나일 때) 입고 수량 전부 */
export interface SplitItem {
  skuId: number;
  qty: number | null;
}

export class ReceiptSplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptSplitError';
  }
}

const strip = (c: SkuCandidate): SkuCandidate => ({ skuId: c.skuId, key: c.key, name: c.name, option: c.option });

export function buildLineOptions(
  itemCode: string | null,
  productCostId: string | null,
  learned: (SkuCandidate & { supplierCode: string })[],
  byProduct: (SkuCandidate & { legacy: string[] })[],
): LineOptions {
  const l = itemCode ? learned.filter((x) => x.supplierCode === itemCode) : [];
  if (l.length > 0) return { source: 'learned', candidates: l.map(strip) };
  const p = productCostId ? byProduct.filter((x) => x.legacy.includes(productCostId)) : [];
  if (p.length > 0) return { source: 'product', candidates: p.map(strip) };
  return { source: 'none', candidates: [] };
}

/** 화면이 보여줄 예상 판매단위 수량. 소분은 이월을 모르므로 추정이다 */
export function expectedPacks(l: { entry_type: string | null; quantity: number; items_per_box: number | null; subdivision_unit: number | null }): { qty: number; approx: boolean } | null {
  if (l.entry_type === 'subdivision') {
    if (!l.items_per_box || !l.subdivision_unit) return null;
    return { qty: Math.floor((l.quantity * l.items_per_box) / l.subdivision_unit), approx: true };
  }
  return Number.isInteger(l.quantity) && l.quantity > 0 ? { qty: l.quantity, approx: false } : null;
}

export function resolveReceiptSplit(packs: number, candidates: number[], requested?: SplitItem[] | null): { skuId: number; qty: number }[] {
  if (!Number.isInteger(packs) || packs <= 0) throw new ReceiptSplitError(`입고 수량 ${packs}이 양의 정수가 아니다 — 원장에 넣을 수 없다`);
  if (requested && requested.length > 0) {
    const seen = new Set<number>();
    for (const r of requested) {
      if (!Number.isInteger(r.skuId) || r.skuId <= 0) throw new ReceiptSplitError(`SKU id가 잘못됐다: ${r.skuId}`);
      if (seen.has(r.skuId)) throw new ReceiptSplitError(`SKU ${r.skuId}가 두 번 있다`);
      seen.add(r.skuId);
    }
    if (requested.length === 1 && requested[0].qty === null) return [{ skuId: requested[0].skuId, qty: packs }];
    for (const r of requested) {
      if (r.qty === null || !Number.isInteger(r.qty) || r.qty < 0) throw new ReceiptSplitError('옵션별 수량은 0 이상 정수다');
    }
    const out = requested.filter((r) => (r.qty as number) > 0).map((r) => ({ skuId: r.skuId, qty: r.qty as number }));
    const sum = out.reduce((s, r) => s + r.qty, 0);
    if (sum !== packs) throw new ReceiptSplitError(`옵션 분배 합 ${sum}개가 입고 수량 ${packs}개와 다르다 — 다시 나눈다`);
    return out.sort((a, b) => a.skuId - b.skuId);
  }
  if (candidates.length === 1) return [{ skuId: candidates[0], qty: packs }];
  if (candidates.length === 0) throw new ReceiptSplitError('이 품목에 연결된 재고 SKU가 없다 — 확정 화면에서 SKU를 고른다');
  throw new ReceiptSplitError(`옵션이 ${candidates.length}개다 — 확정 화면에서 옵션별 수량을 나눈다`);
}

/** 요청 본문 sku_splits: { [line_no]: [{ sku_id, qty }] } */
export function parseSkuSplits(raw: unknown): Record<number, SplitItem[]> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ReceiptSplitError('sku_splits는 { 줄번호: [{ sku_id, qty }] } 형태다');
  const out: Record<number, SplitItem[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const lineNo = Number(k);
    if (!Number.isInteger(lineNo) || !Array.isArray(v)) throw new ReceiptSplitError(`sku_splits[${k}]가 잘못됐다`);
    out[lineNo] = v.map((x) => {
      const o = (x ?? {}) as { sku_id?: unknown; qty?: unknown };
      return { skuId: Number(o.sku_id), qty: o.qty === null || o.qty === undefined ? null : Number(o.qty) };
    });
  }
  return out;
}

export async function loadSkuOptions(
  db: Db,
  lines: { lineNo: number; itemCode: string | null; productCostId: string | null }[],
): Promise<Map<number, LineOptions>> {
  const codes = [...new Set(lines.map((l) => l.itemCode).filter((c): c is string => !!c))];
  const pcs = [...new Set(lines.map((l) => l.productCostId).filter((c): c is string => !!c))];
  const learned = codes.length === 0 ? [] : (await db.query(
    `select p.supplier_code, s.id, s.key, s.name, s.option_label
       from erp.purchase_units p join erp.skus s on s.id = p.sku_id
      where p.supplier = 'costco' and p.supplier_code = any($1::text[]) and s.status = 'active'
      order by s.id`,
    [codes],
  )).rows.map((r) => ({ supplierCode: String(r.supplier_code), skuId: Number(r.id), key: r.key, name: r.name, option: r.option_label ?? '' }));
  const byProduct = pcs.length === 0 ? [] : (await db.query(
    `select s.id, s.key, s.name, s.option_label, s.legacy_product_cost_ids::text[] as legacy
       from erp.skus s
      where s.status = 'active' and s.legacy_product_cost_ids && $1::uuid[]
      order by s.id`,
    [pcs],
  )).rows.map((r) => ({ skuId: Number(r.id), key: r.key, name: r.name, option: r.option_label ?? '', legacy: (r.legacy ?? []) as string[] }));
  return new Map(lines.map((l) => [l.lineNo, buildLineOptions(l.itemCode, l.productCostId, learned, byProduct)]));
}

/**
 * 영수증 한 줄의 원장 입고. 호출자(확정 라우트)의 줄 트랜잭션 안에서 부른다 — 던지면 그 줄의 입고(cost_entries)도 되돌아간다.
 * 멱등키 receipt:<receipt_line_id>:<sku_id>. 품번이 있으면 쓴 SKU를 purchase_units에 기억한다(다음 영수증부터 후보 1순위).
 */
export async function postReceiptLots(
  db: Db,
  p: {
    lineId: string; lineNo: number; itemCode: string | null; itemLabel: string; productCostId: string;
    packs: number; unitCost: number; receivedAt: string; requested?: SplitItem[] | null;
  },
): Promise<{ skuId: number; qty: number }[]> {
  const opts = (await loadSkuOptions(db, [{ lineNo: p.lineNo, itemCode: p.itemCode, productCostId: p.productCostId }])).get(p.lineNo)!;
  const split = resolveReceiptSplit(p.packs, opts.candidates.map((c) => c.skuId), p.requested);
  if (!Number.isInteger(p.unitCost) || p.unitCost < 0) throw new ReceiptSplitError(`입고 단가 ${p.unitCost}가 0 이상 정수가 아니다`);
  const { rows } = await db.query(`select id from erp.skus where id = any($1::bigint[]) and status = 'active'`, [split.map((s) => s.skuId)]);
  const active = new Set(rows.map((r) => Number(r.id)));
  for (const s of split) if (!active.has(s.skuId)) throw new ReceiptSplitError(`SKU ${s.skuId}가 활성 SKU가 아니다`);

  // 1-B 인계(I4): 여러 SKU는 오름차순으로 먼저 잠근다(split은 이미 오름차순)
  for (const s of split) await lockSku(db, s.skuId);
  const occurredAt = `${p.receivedAt}T00:00:00+09:00`;
  for (const s of split) {
    await postLotCreate(db, {
      skuId: s.skuId, location: 'self', qty: s.qty, unitCost: p.unitCost, kind: 'receipt', occurredAt,
      idemKey: `receipt:${p.lineId}:${s.skuId}`, refType: 'receipt_line', refId: p.lineId, note: p.itemLabel.slice(0, 100),
    });
    if (p.itemCode) {
      await db.query(
        `insert into erp.purchase_units (supplier, supplier_code, label, sku_id) values ('costco', $1, $2, $3)
         on conflict (supplier, supplier_code, sku_id) do nothing`,
        [p.itemCode, p.itemLabel, s.skuId],
      );
    }
  }
  return split;
}
```

- [ ] **Step 4: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/lib/erp/ledger/receipt.test.ts && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/lib/erp/ledger/receipt.ts src/__tests__/lib/erp/ledger/receipt.test.ts
git commit -m "feat(erp): 영수증 줄 → SKU 후보·옵션 분배·receipt lot·품번 학습"
```

#### 7-B. `purchase_units` 첫 적재

- [ ] **Step 5: 실패하는 테스트 작성**

`src/__tests__/lib/erp/ledger/purchase-units.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SUSPECT_CODES, planPurchaseUnits, type ItemMapRow, type SkuLink } from '@/lib/erp/ledger/purchase-units';

const maps: ItemMapRow[] = [
  { itemCode: '500', itemLabel: '왜건', productCostId: 'pc-w', defaultDecision: 'ingest' },
  { itemCode: '693742', itemLabel: '프로틴커피쉐이크', productCostId: 'pc-p', defaultDecision: 'ingest' },
  { itemCode: '888450', itemLabel: 'PUMA주니어팬티5P', productCostId: 'pc-t', defaultDecision: 'ask' },
  { itemCode: '700', itemLabel: '개인 간식', productCostId: 'pc-x', defaultDecision: 'skip' },
  { itemCode: '800', itemLabel: '연결 없음', productCostId: 'pc-none', defaultDecision: 'ingest' },
];
const skus: SkuLink[] = [
  { id: 2, key: 'cp:w:레드', legacyProductCostIds: ['pc-w'] },
  { id: 1, key: 'cp:w:블랙', legacyProductCostIds: ['pc-w'] },
  { id: 3, key: 'cp:p', legacyProductCostIds: ['pc-p'] },
  { id: 4, key: 'cp:t', legacyProductCostIds: ['pc-t'] },
];

describe('planPurchaseUnits', () => {
  it('의심 품번 두 건을 기본으로 보류한다', () => {
    expect([...SUSPECT_CODES]).toEqual(['693742', '888450']);
  });

  it('품번 : SKU = 1 : N 행, 의심은 보류, skip은 제외, SKU 없음은 따로', () => {
    const p = planPurchaseUnits(maps, skus, new Set());
    expect(p.rows).toEqual([
      { supplierCode: '500', label: '왜건', skuId: 1, skuKey: 'cp:w:블랙' },
      { supplierCode: '500', label: '왜건', skuId: 2, skuKey: 'cp:w:레드' },
    ]);
    expect(p.held.map((m) => m.itemCode)).toEqual(['693742', '888450']);
    expect(p.skipped.map((m) => m.itemCode)).toEqual(['700']);
    expect(p.unlinked.map((m) => m.itemCode)).toEqual(['800']);
  });

  it('사용자가 확인한 의심 품번만 --include로 넣는다', () => {
    const p = planPurchaseUnits(maps, skus, new Set(['693742']));
    expect(p.rows.map((r) => r.supplierCode)).toEqual(['500', '500', '693742']);
    expect(p.held.map((m) => m.itemCode)).toEqual(['888450']);
  });
});
```

Run: `npx vitest run src/__tests__/lib/erp/ledger/purchase-units.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 6: 구현**

`src/lib/erp/ledger/purchase-units.ts`:
```ts
// src/lib/erp/ledger/purchase-units.ts
// erp.purchase_units 첫 적재 계획(순수). costco_item_map(품번 → product_cost) → SKU(erp.skus.legacy_product_cost_ids).
// 품번 : SKU = 1 : N — 옵션이 여러 SKU로 나뉜 상품은 품번 하나가 SKU 여럿에 걸린다(영수증 확정 때 사람이 나눈다).
/** 1-A 검토에서 오매핑 의심으로 적은 품번(docs/erp/sku-review-2026-09-26.md). 사용자가 확인한 것만 넣는다 */
export const SUSPECT_CODES = ['693742', '888450'] as const;

export interface ItemMapRow {
  itemCode: string;
  itemLabel: string | null;
  productCostId: string;
  defaultDecision: string;
}

export interface SkuLink {
  id: number;
  key: string;
  legacyProductCostIds: string[];
}

export interface PurchaseUnitRow {
  supplierCode: string;
  label: string | null;
  skuId: number;
  skuKey: string;
}

export function planPurchaseUnits(
  maps: ItemMapRow[],
  skus: SkuLink[],
  include: Set<string>,
): { rows: PurchaseUnitRow[]; held: ItemMapRow[]; unlinked: ItemMapRow[]; skipped: ItemMapRow[] } {
  const rows: PurchaseUnitRow[] = [];
  const held: ItemMapRow[] = [];
  const unlinked: ItemMapRow[] = [];
  const skipped: ItemMapRow[] = [];
  const suspect: readonly string[] = SUSPECT_CODES;
  for (const m of maps) {
    if (m.defaultDecision === 'skip') { skipped.push(m); continue; }
    if (suspect.includes(m.itemCode) && !include.has(m.itemCode)) { held.push(m); continue; }
    const linked = skus.filter((s) => s.legacyProductCostIds.includes(m.productCostId));
    if (linked.length === 0) { unlinked.push(m); continue; }
    for (const s of linked) rows.push({ supplierCode: m.itemCode, label: m.itemLabel, skuId: s.id, skuKey: s.key });
  }
  rows.sort((a, b) => (a.supplierCode < b.supplierCode ? -1 : a.supplierCode > b.supplierCode ? 1 : a.skuId - b.skuId));
  return { rows, held, unlinked, skipped };
}
```

`scripts/erp/purchase-units-seed.ts`:
```ts
// scripts/erp/purchase-units-seed.ts
// 사용법: npx --no-install tsx scripts/erp/purchase-units-seed.ts [--apply] [--include=693742,888450]
// erp.purchase_units 첫 적재: costco_item_map(품번 → product_cost) → SKU(legacy_product_cost_ids). 품번 : SKU = 1 : N.
// 기본(점검): 적재할 행과 보류·미연결 품번만 출력한다(DB 읽기 전용).
// --apply : 한 트랜잭션. 이미 있는 (costco, 품번, SKU)는 건너뛴다 — 다시 돌려도 안전하다.
// 🔴 오매핑 의심 품번(693742·888450)은 사용자가 맞다고 확인한 것만 --include로 넣는다.
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { planPurchaseUnits } from '@/lib/erp/ledger/purchase-units';

loadEnvLocal();
const APPLY = process.argv.includes('--apply');
const includeArg = process.argv.find((a) => a.startsWith('--include='));
const include = new Set((includeArg ? includeArg.slice('--include='.length) : '').split(',').map((s) => s.trim()).filter(Boolean));

async function main(): Promise<void> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const maps = (await c.query(
      `select item_code, item_label, product_cost_id::text as pc, default_decision
         from costco_item_map where product_cost_id is not null order by item_code`,
    )).rows.map((r) => ({ itemCode: String(r.item_code), itemLabel: r.item_label ?? null, productCostId: String(r.pc), defaultDecision: String(r.default_decision) }));
    const skus = (await c.query(
      `select id, key, legacy_product_cost_ids::text[] as legacy from erp.skus where status = 'active' order by id`,
    )).rows.map((r) => ({ id: Number(r.id), key: String(r.key), legacyProductCostIds: (r.legacy ?? []) as string[] }));
    const pcNames = new Map((await c.query(`select id::text as id, product_name from product_costs`)).rows.map((r) => [String(r.id), String(r.product_name)]));
    await c.query('COMMIT');

    const plan = planPurchaseUnits(maps, skus, include);
    console.log(`품번 ${maps.length}개 → purchase_units ${plan.rows.length}행 · 보류 ${plan.held.length} · SKU 없음 ${plan.unlinked.length} · 제외(skip) ${plan.skipped.length}`);
    console.table(plan.rows.map((r) => ({ 품번: r.supplierCode, 영수증표기: r.label ?? '', SKU: r.skuKey })));
    for (const h of plan.held) {
      console.log(`  🔴 보류(사용자 확인 필요) ${h.itemCode} 「${h.itemLabel ?? ''}」 → ${pcNames.get(h.productCostId) ?? h.productCostId} (기억된 결정 ${h.defaultDecision})`);
    }
    for (const u of plan.unlinked) {
      console.log(`  ⚠️ SKU 없음 ${u.itemCode} 「${u.itemLabel ?? ''}」 → ${pcNames.get(u.productCostId) ?? u.productCostId}`);
    }
    if (!APPLY) {
      console.log('(점검만 — 적재하려면 --apply)');
      return;
    }

    await c.query('BEGIN');
    try {
      let n = 0;
      for (const r of plan.rows) {
        const res = await c.query(
          `insert into erp.purchase_units (supplier, supplier_code, label, sku_id) values ('costco', $1, $2, $3)
           on conflict (supplier, supplier_code, sku_id) do nothing`,
          [r.supplierCode, r.label, r.skuId],
        );
        n += res.rowCount ?? 0;
      }
      await c.query('COMMIT');
      console.log(`✅ purchase_units ${n}행 적재(이미 있던 ${plan.rows.length - n}행은 건너뜀)`);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exitCode = 1;
});
```

Run: `npx vitest run src/__tests__/lib/erp/ledger/purchase-units.test.ts && npx tsc --noEmit` → 전부 PASS, 0 오류

- [ ] **Step 7: 🔴 점검 → 사용자 확인 → 적재**

Run: `npx --no-install tsx scripts/erp/purchase-units-seed.ts`
Expected: `품번 N개 → purchase_units M행 · 보류 2 · …`, 🔴 보류 두 줄: `693742 「프로틴커피쉐이크」 → 매일유업 퓨어틴 초코 …` · `888450 「PUMA주니어팬티5P」 → 코스트코 커클랜드 다용도 극세사 타월 …`.

🔴 **컨트롤러가 사용자에게 두 줄을 그대로 보여주고 묻는다:** 「이 품번이 이 상품이 맞습니까? 맞는 것만 넣고, 틀린 것은 넣지 않습니다(틀린 품번은 다음 영수증에서 상품을 다시 고르면 그때 새 연결이 기억됩니다).」 **답을 받기 전에는 `--apply`를 돌리지 않는다.** 답은 이 계획서 끝 「실행 기록」에 바로 적는다.

사용자 답에 따라(예: 693742만 맞다):
Run: `npx --no-install tsx scripts/erp/purchase-units-seed.ts --apply --include=693742`
Expected: `✅ purchase_units M행 적재…`. 맞는 것이 없으면 `--include` 없이 `--apply`.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/erp/ledger/purchase-units.ts src/__tests__/lib/erp/ledger/purchase-units.test.ts scripts/erp/purchase-units-seed.ts docs/superpowers/plans/2026-09-26-erp-phase1c1-stock-adjust.md
git commit -m "feat(erp): purchase_units 첫 적재(품번:SKU 1:N) — 의심 품번은 사용자 확인분만"
```

#### 7-C. 영수증 줄별 SKU 후보 API

- [ ] **Step 9: 실패하는 테스트 작성**

`src/__tests__/api/erp-receipt-sku-options.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockGetPool } = vi.hoisted(() => ({ mockGetCurrentUser: vi.fn(), mockGetPool: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));

const line = (o: Record<string, unknown>) => ({
  line_no: 1, item_code: '111', product_cost_id: 'pc-1', decision: 'ingest', entry_type: 'normal', quantity: '2',
  items_per_box: null, subdivision_unit: null, is_discount: false, cost_entry_id: null, ...o,
});
const ctx = { params: Promise.resolve({ id: 'd-1' }) };
const req = () => new NextRequest('http://localhost/api/erp/receipts/d-1/sku-options');

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  mockGetPool.mockReturnValue({
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM receipt_drafts')) return { rows: [{ id: 'd-1' }] };
      if (sql.includes('FROM receipt_draft_lines')) {
        return { rows: [
          line({}),
          line({ line_no: 2, is_discount: true }),
          line({ line_no: 3, item_code: '333', product_cost_id: 'pc-3', entry_type: 'subdivision', quantity: '1', items_per_box: 12, subdivision_unit: 6 }),
          line({ line_no: 4, cost_entry_id: 'ce-1' }),
        ] };
      }
      if (sql.startsWith('select p.supplier_code')) return { rows: [{ supplier_code: '111', id: '11', key: 'k11', name: 'A', option_label: '블랙' }] };
      if (sql.startsWith('select s.id, s.key')) {
        return { rows: [
          { id: '31', key: 'k31', name: 'C', option_label: 'S', legacy: ['pc-3'] },
          { id: '32', key: 'k32', name: 'C', option_label: 'L', legacy: ['pc-3'] },
        ] };
      }
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 50)}`);
    }),
  });
});

describe('GET /api/erp/receipts/[id]/sku-options', () => {
  it('로그인하지 않으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/erp/receipts/[id]/sku-options/route');
    expect((await GET(req(), ctx)).status).toBe(401);
  });

  it('확정 대기 입고 줄만, 후보와 예상 수량을 준다', async () => {
    const { GET } = await import('@/app/api/erp/receipts/[id]/sku-options/route');
    const json = await (await GET(req(), ctx)).json();
    expect(Object.keys(json.data)).toEqual(['1', '3']);
    expect(json.data['1']).toEqual({ source: 'learned', candidates: [{ skuId: 11, key: 'k11', name: 'A', option: '블랙' }], expectedQty: { qty: 2, approx: false } });
    expect(json.data['3'].source).toBe('product');
    expect(json.data['3'].candidates).toHaveLength(2);
    expect(json.data['3'].expectedQty).toEqual({ qty: 2, approx: true });
  });
});
```

Run: `npx vitest run src/__tests__/api/erp-receipt-sku-options.test.ts`
Expected: FAIL — 라우트 없음

- [ ] **Step 10: 구현**

`src/app/api/erp/receipts/[id]/sku-options/route.ts`:
```ts
// GET /api/erp/receipts/[id]/sku-options — 확정 대기 중인 입고 줄마다 재고 SKU 후보와 예상 판매단위 수량.
// 확정 화면이 「자동 / 옵션별 수량 / SKU 고르기」를 정하는 데 쓴다. 확정 때 같은 규칙(receipt.ts)을 서버가 다시 적용한다.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { expectedPacks, loadSkuOptions } from '@/lib/erp/ledger/receipt';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  try {
    const pool = getSourcingPool();
    const { rows: drafts } = await pool.query(`SELECT id FROM receipt_drafts WHERE id = $1 AND user_id = $2`, [id, auth.userId]);
    if (drafts.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const { rows } = await pool.query(
      `SELECT line_no, item_code, product_cost_id, decision, entry_type, quantity, items_per_box, subdivision_unit, is_discount, cost_entry_id
         FROM receipt_draft_lines WHERE draft_id = $1 ORDER BY line_no`,
      [id],
    );
    const target = rows.filter((l) => !l.is_discount && l.decision === 'ingest' && l.cost_entry_id == null);
    const opts = await loadSkuOptions(pool, target.map((l) => ({ lineNo: Number(l.line_no), itemCode: l.item_code ?? null, productCostId: l.product_cost_id ?? null })));
    const data = Object.fromEntries(target.map((l) => [
      Number(l.line_no),
      {
        ...opts.get(Number(l.line_no))!,
        expectedQty: expectedPacks({
          entry_type: l.entry_type, quantity: Number(l.quantity),
          items_per_box: l.items_per_box === null ? null : Number(l.items_per_box),
          subdivision_unit: l.subdivision_unit === null ? null : Number(l.subdivision_unit),
        }),
      },
    ]));
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return erpError(e);
  }
}
```

Run: `npx vitest run src/__tests__/api/erp-receipt-sku-options.test.ts && npx tsc --noEmit` → 전부 PASS, 0 오류
```bash
git add src/app/api/erp/receipts src/__tests__/api/erp-receipt-sku-options.test.ts
git commit -m "feat(erp): 영수증 줄별 재고 SKU 후보·예상 수량 API"
```

#### 7-D. 확정 라우트가 같은 트랜잭션에서 원장에 쓴다

- [ ] **Step 11: 실패하는 테스트 작성**

`src/__tests__/api/receipts-confirm-ledger.test.ts`:
```ts
// src/__tests__/api/receipts-confirm-ledger.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockGetPool, mockCreate, mockSync, mockPostLots, order } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetPool: vi.fn(),
  mockCreate: vi.fn(),
  mockSync: vi.fn(),
  mockPostLots: vi.fn(),
  order: [] as string[],
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));
vi.mock('@/lib/cost-management/create-entry', () => ({ createCostEntry: mockCreate }));
vi.mock('@/lib/receipt/draft-status', () => ({ syncDraftStatus: mockSync }));
vi.mock('@/lib/erp/ledger/receipt', async (orig) => ({
  ...(await orig<typeof import('@/lib/erp/ledger/receipt')>()),
  postReceiptLots: mockPostLots,
}));

import { ReceiptSplitError } from '@/lib/erp/ledger/receipt';

const LINE = {
  id: 'line-uuid-1', line_no: 1, item_code: '713160', item_label: '라운드티', quantity: '4', unit_price: 2500, amount: 10000,
  is_discount: false, applies_to_line_id: null, tax_type: 'taxable', decision: 'ingest', product_cost_id: 'pc-1',
  entry_type: 'normal', items_per_box: null, subdivision_unit: null, cost_entry_id: null,
};
const ctx = { params: Promise.resolve({ id: 'd-1' }) };
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/receipts/d-1/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  client = {
    query: vi.fn(async (sql: string) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) { order.push(sql); return { rows: [], rowCount: 0 }; }
      if (sql.startsWith('UPDATE receipt_draft_lines')) return { rows: [], rowCount: 1 };
      if (sql.includes('INSERT INTO costco_item_map')) return { rows: [], rowCount: 1 };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 40)}`);
    }),
    release: vi.fn(),
  };
  mockGetPool.mockReturnValue({
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM receipt_drafts')) return { rows: [{ id: 'd-1', purchased_at: '2026-09-20' }] };
      if (sql.includes('FROM receipt_draft_lines')) return { rows: [LINE] };
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 40)}`);
    }),
    connect: vi.fn(async () => client),
  });
  mockCreate.mockResolvedValue({ entry: { id: 'ce-1', quantity: '4', unit_cost: 2500 }, carryoverOut: null, isSubdivisionMode: false });
  mockSync.mockResolvedValue('unchanged');
  mockPostLots.mockImplementation(async () => { order.push('ledger'); return [{ skuId: 7, qty: 4 }]; });
});

describe('POST /api/receipts/[id]/confirm — 원장 입고', () => {
  it('입고(cost_entries)와 같은 트랜잭션에서 COMMIT 전에 원장 입고를 기록한다', async () => {
    const { POST } = await import('@/app/api/receipts/[id]/confirm/route');
    const res = await POST(post({ sku_splits: { 1: [{ sku_id: 7, qty: 4 }] } }), ctx);
    const json = await res.json();
    expect(json.data.created).toEqual([{ line_no: 1, cost_entry_id: 'ce-1' }]);
    expect(order).toEqual(['BEGIN', 'ledger', 'COMMIT']);
    expect(mockPostLots).toHaveBeenCalledWith(client, {
      lineId: 'line-uuid-1', lineNo: 1, itemCode: '713160', itemLabel: '라운드티', productCostId: 'pc-1',
      packs: 4, unitCost: 2500, receivedAt: '2026-09-20', requested: [{ skuId: 7, qty: 4 }],
    });
  });

  it('원장 분배가 틀리면 그 줄은 실패로 알리고 입고까지 되돌린다', async () => {
    mockPostLots.mockRejectedValue(new ReceiptSplitError('옵션이 2개다 — 확정 화면에서 옵션별 수량을 나눈다'));
    const { POST } = await import('@/app/api/receipts/[id]/confirm/route');
    const json = await (await POST(post({}), ctx)).json();
    expect(json.data.created).toEqual([]);
    expect(json.data.failed).toEqual([{ line_no: 1, error: '옵션이 2개다 — 확정 화면에서 옵션별 수량을 나눈다' }]);
    expect(order).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('sku_splits 형태가 틀리면 400', async () => {
    const { POST } = await import('@/app/api/receipts/[id]/confirm/route');
    expect((await POST(post({ sku_splits: [1, 2] }), ctx)).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run src/__tests__/api/receipts-confirm-ledger.test.ts`
Expected: FAIL — `postReceiptLots`가 불리지 않는다 / 400이 아니다

- [ ] **Step 12: 구현**

`src/app/api/receipts/[id]/confirm/route.ts`:

(1) 8행
```ts
import type { AttributedLine } from '@/lib/receipt/discount';
```
을 아래로 바꾼다.
```ts
import type { AttributedLine } from '@/lib/receipt/discount';
import { ReceiptSplitError, parseSkuSplits, postReceiptLots, type SplitItem } from '@/lib/erp/ledger/receipt';
```

(2) 머리 주석의 Body 줄
```ts
 * Body: `{ line_nos?: number[] }` — 생략하면 확정 가능한 줄 전부
```
을 아래로 바꾼다.
```ts
 * Body: `{ line_nos?: number[], sku_splits?: { [line_no]: [{ sku_id, qty }] } }` — line_nos를 생략하면 확정 가능한 줄 전부.
 * sku_splits = 원장 입고의 옵션(SKU) 분배(1-C1). 후보가 하나인 줄은 생략해도 서버가 전부 그 SKU로 넣는다.
```

(3) 44~49행
```ts
  const lineNos: number[] | undefined =
    Array.isArray(body?.line_nos) && body.line_nos.every((n: unknown) => typeof n === 'number')
      ? body.line_nos
      : undefined;

  const pool = getSourcingPool();
```
을 아래로 바꾼다.
```ts
  const lineNos: number[] | undefined =
    Array.isArray(body?.line_nos) && body.line_nos.every((n: unknown) => typeof n === 'number')
      ? body.line_nos
      : undefined;
  let skuSplits: Record<number, SplitItem[]>;
  try {
    skuSplits = parseSkuSplits(body?.sku_splits);
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof ReceiptSplitError ? e.message : 'sku_splits 형식 오류' }, { status: 400 });
  }

  const pool = getSourcingPool();
```

(4) 148~152행
```ts
        if (upd.rowCount === 0) {
          throw new Error('이미 확정된 줄입니다.');
        }

        // 매핑 학습 — 다음 장보기에서 같은 품번이 자동으로 채워진다
```
을 아래로 바꾼다.
```ts
        if (upd.rowCount === 0) {
          throw new Error('이미 확정된 줄입니다.');
        }

        // 1-C1: 원장 self 입고. 같은 트랜잭션 — 원장 기록이 실패하면 이 줄의 입고(cost_entries)도 만들지 않는다.
        // 수량 = 이 입고의 판매단위 수량(소분이면 팩 수), 단가 = 그 판매단위 원가
        const e = entry as { quantity: string | number; unit_cost: string | number };
        await postReceiptLots(client, {
          lineId: dbLine.id,
          lineNo: line.line_no,
          itemCode: dbLine.item_code,
          itemLabel: dbLine.item_label,
          productCostId: line.product_cost_id as string,
          packs: Number(e.quantity),
          unitCost: Number(e.unit_cost),
          receivedAt,
          requested: skuSplits[line.line_no] ?? null,
        });

        // 매핑 학습 — 다음 장보기에서 같은 품번이 자동으로 채워진다
```

- [ ] **Step 13: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/api/receipts-confirm-ledger.test.ts && npx tsc --noEmit`
Expected: 3건 PASS, 0 오류
```bash
git add "src/app/api/receipts/[id]/confirm/route.ts" src/__tests__/api/receipts-confirm-ledger.test.ts
git commit -m "feat(erp): 영수증 확정이 같은 트랜잭션에서 원장 self 입고(receipt) — 분배가 틀리면 그 줄만 실패"
```

#### 7-E. 확정 화면의 옵션 분배

- [ ] **Step 14: 실패하는 테스트 작성**

`src/__tests__/components/receipt-sku-split.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { splitSum, toSkuSplits, type LineSkuOptions } from '@/components/receipt/sku-split';

const c = (skuId: number, option: string) => ({ skuId, key: `k${skuId}`, name: '라운드티', option });

describe('toSkuSplits', () => {
  const options: Record<number, LineSkuOptions> = {
    1: { source: 'learned', candidates: [c(11, '블랙')], expectedQty: { qty: 2, approx: false } },
    2: { source: 'product', candidates: [c(21, 'S'), c(22, 'L')], expectedQty: { qty: 3, approx: false } },
    3: { source: 'none', candidates: [], expectedQty: { qty: 1, approx: false } },
    4: { source: 'none', candidates: [], expectedQty: null },
  };

  it('후보 1개는 생략(서버 자동) · 여럿은 옵션별 수량 · 고른 SKU 1개는 전부(null) · 고르지 않았으면 생략', () => {
    expect(toSkuSplits(options, {
      2: { picked: [], qty: { 21: '2', 22: '1' } },
      3: { picked: [c(31, '')], qty: {} },
    })).toEqual({
      2: [{ sku_id: 21, qty: 2 }, { sku_id: 22, qty: 1 }],
      3: [{ sku_id: 31, qty: null }],
    });
  });

  it('고른 SKU가 여럿이면 옵션별 수량', () => {
    expect(toSkuSplits({ 3: options[3] }, { 3: { picked: [c(31, 'S'), c(32, 'L')], qty: { 31: '1' } } }))
      .toEqual({ 3: [{ sku_id: 31, qty: 1 }, { sku_id: 32, qty: 0 }] });
  });

  it('나눈 합', () => {
    expect(splitSum([c(21, 'S'), c(22, 'L')], { picked: [], qty: { 21: '2', 22: 'x' } })).toBe(2);
  });
});
```

Run: `npx vitest run src/__tests__/components/receipt-sku-split.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 15: 구현**

`src/components/receipt/sku-split.ts`:
```ts
// src/components/receipt/sku-split.ts
// 영수증 확정 요청의 sku_splits를 만든다. 서버 규칙(src/lib/erp/ledger/receipt.ts resolveReceiptSplit)과 짝이다:
// 후보 1개 → 보내지 않는다(서버 자동) · 후보 없음 + 고른 SKU 1개 → qty null(입고 수량 전부) · 2개 이상 → 옵션별 수량.
export interface SkuCandidateView {
  skuId: number;
  key: string;
  name: string;
  option: string;
}

export interface LineSkuOptions {
  source: 'learned' | 'product' | 'none';
  candidates: SkuCandidateView[];
  expectedQty: { qty: number; approx: boolean } | null;
}

export interface SplitDraft {
  /** 후보가 없을 때 사람이 검색해 고른 SKU */
  picked: SkuCandidateView[];
  /** skuId → 입력 문자열 */
  qty: Record<number, string>;
}

export type SkuSplitsBody = Record<number, { sku_id: number; qty: number | null }[]>;

export const emptyDraft = (): SplitDraft => ({ picked: [], qty: {} });

export function choicesOf(o: LineSkuOptions, d: SplitDraft | undefined): SkuCandidateView[] {
  return o.candidates.length > 0 ? o.candidates : (d?.picked ?? []);
}

export function splitSum(choices: SkuCandidateView[], d: SplitDraft | undefined): number {
  return choices.reduce((s, c) => s + (parseInt(d?.qty[c.skuId] ?? '0', 10) || 0), 0);
}

export function toSkuSplits(options: Record<number, LineSkuOptions>, drafts: Record<number, SplitDraft>): SkuSplitsBody {
  const out: SkuSplitsBody = {};
  for (const [k, o] of Object.entries(options)) {
    const lineNo = Number(k);
    const d = drafts[lineNo];
    const choices = choicesOf(o, d);
    if (choices.length === 0 || o.candidates.length === 1) continue;
    if (choices.length === 1) {
      out[lineNo] = [{ sku_id: choices[0].skuId, qty: null }];
      continue;
    }
    out[lineNo] = choices.map((c) => ({ sku_id: c.skuId, qty: parseInt(d?.qty[c.skuId] ?? '0', 10) || 0 }));
  }
  return out;
}
```

`src/components/receipt/ReceiptSkuSplit.tsx`:
```tsx
'use client';

/**
 * 영수증 줄 하나의 재고 SKU 분배. 확정 때 원장 「집」 입고로 들어갈 옵션과 수량을 정한다.
 * 후보 1개 = 자동(안내만) · 후보 여럿 = 옵션별 수량 · 후보 없음 = SKU를 검색해 고른다(고른 연결은 확정 때 기억된다).
 * 합이 서버가 계산한 판매단위 수량과 다르면 그 줄만 확정이 실패하고 실제 수량이 화면에 뜬다.
 */
import { useState } from 'react';
import { choicesOf, splitSum, type LineSkuOptions, type SkuCandidateView, type SplitDraft } from './sku-split';

interface Props {
  options: LineSkuOptions;
  draft: SplitDraft;
  allSkus: SkuCandidateView[];
  onChange: (d: SplitDraft) => void;
  /** 검색 칸에 처음 들어갈 때 SKU 목록을 불러온다 */
  onNeedSkus: () => void;
}

const label = (c: SkuCandidateView) => (c.option ? `${c.name} · ${c.option}` : c.name);

const box = {
  marginTop: '-4px', marginBottom: '8px', padding: '8px 12px', borderRadius: '0 0 10px 10px',
  border: '1px solid #e5e7eb', borderTop: 'none', backgroundColor: '#f9fafb', fontSize: '12px', color: '#374151',
} as const;

export default function ReceiptSkuSplit({ options, draft, allSkus, onChange, onNeedSkus }: Props) {
  const [q, setQ] = useState('');
  const exp = options.expectedQty;
  const expText = exp ? `${exp.qty}개${exp.approx ? '(소분 추정 — 이월에 따라 달라질 수 있습니다)' : ''}` : '입고 수량';

  if (options.candidates.length === 1) {
    return <div style={box}>재고: {label(options.candidates[0])} · {expText} 자동</div>;
  }

  const choices = choicesOf(options, draft);
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? allSkus.filter((s) => `${s.name} ${s.option} ${s.key}`.toLowerCase().includes(needle) && !draft.picked.some((p) => p.skuId === s.skuId)).slice(0, 8)
    : [];
  const sum = splitSum(choices, draft);

  return (
    <div style={box}>
      {options.candidates.length === 0 && (
        <>
          <div style={{ fontWeight: 700, color: '#b45309', marginBottom: '6px' }}>연결된 재고 SKU가 없습니다 — 골라 주세요(확정 때 기억합니다)</div>
          <input
            aria-label="재고 SKU 검색"
            value={q}
            onFocus={onNeedSkus}
            onChange={(e) => setQ(e.target.value)}
            placeholder="상품·옵션 검색"
            style={{ width: '100%', height: '34px', borderRadius: '8px', border: '1px solid #d1d5db', padding: '0 8px', fontSize: '13px', boxSizing: 'border-box' }}
          />
          {matches.map((s) => (
            <button
              key={s.skuId}
              type="button"
              onClick={() => { onChange({ ...draft, picked: [...draft.picked, s] }); setQ(''); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: '4px', padding: '6px 8px', borderRadius: '6px', border: '1px solid #e5e7eb', backgroundColor: '#fff', fontSize: '12px' }}
            >
              + {label(s)}
            </button>
          ))}
          {draft.picked.map((p) => (
            <div key={p.skuId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
              <span>{label(p)}</span>
              <button
                type="button"
                aria-label={`${label(p)} 빼기`}
                onClick={() => onChange({ picked: draft.picked.filter((x) => x.skuId !== p.skuId), qty: draft.qty })}
                style={{ border: 'none', background: 'none', color: '#b91c1c', fontWeight: 700, fontSize: '14px' }}
              >
                ×
              </button>
            </div>
          ))}
          {draft.picked.length === 1 && <div style={{ marginTop: '6px' }}>{expText} 전부 이 SKU로 입고합니다</div>}
        </>
      )}
      {choices.length >= 2 && (
        <>
          <div style={{ fontWeight: 700, margin: options.candidates.length === 0 ? '8px 0 6px' : '0 0 6px' }}>옵션별 수량 — 합 {expText}</div>
          {choices.map((c) => (
            <label key={c.skuId} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <span style={{ flex: 1 }}>{label(c)}</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                aria-label={`${label(c)} 수량`}
                value={draft.qty[c.skuId] ?? ''}
                onChange={(e) => onChange({ ...draft, qty: { ...draft.qty, [c.skuId]: e.target.value } })}
                style={{ width: '70px', height: '32px', borderRadius: '8px', border: '1px solid #d1d5db', padding: '0 8px', fontSize: '13px', textAlign: 'right' }}
              />
            </label>
          ))}
          <div style={{ marginTop: '6px', fontWeight: 700, color: exp && sum !== exp.qty ? '#b91c1c' : '#1a7f37' }}>
            나눈 합 {sum}개{exp ? ` / ${exp.qty}개` : ''}
          </div>
        </>
      )}
    </div>
  );
}
```

Run: `npx vitest run src/__tests__/components/receipt-sku-split.test.ts` → 3건 PASS

- [ ] **Step 16: 영수증 상세에 붙인다 — 화면 테스트를 먼저 고친다**

`src/__tests__/components/receipt-screens.test.tsx`:

(1) `mockDetail` 안
```ts
      http.get('/api/cost-management/products/options', () =>
        HttpResponse.json({ success: true, data: [
          { id: 'p-1', product_name: '커클랜드 타월', subdivision_unit: 10 },
        ] })),
    );
  }
```
을 아래로 바꾼다(SKU 후보 모의 — 기본은 후보 없음 표시가 뜨지 않도록 빈 객체).
```ts
      http.get('/api/cost-management/products/options', () =>
        HttpResponse.json({ success: true, data: [
          { id: 'p-1', product_name: '커클랜드 타월', subdivision_unit: 10 },
        ] })),
      http.get(`/api/erp/receipts/${DRAFT_ID}/sku-options`, () => HttpResponse.json({ success: true, data: {} })),
    );
  }
```

(2) `describe('ReceiptDetail', () => {` 블록 안, 첫 번째 `it(` 바로 앞에 더한다.
```ts
  it('🔴 옵션이 여러 개면 옵션별 수량을 받아 확정 요청(sku_splits)에 싣는다', async () => {
    mockDetail(detail());
    let sent = null as { sku_splits?: unknown } | null;
    server.use(
      http.get(`/api/erp/receipts/${DRAFT_ID}/sku-options`, () => HttpResponse.json({ success: true, data: { 1: {
        source: 'product', expectedQty: { qty: 1, approx: false },
        candidates: [
          { skuId: 11, key: 'cp:1:블랙', name: '라운드티', option: '블랙' },
          { skuId: 12, key: 'cp:1:레드', name: '라운드티', option: '레드' },
        ],
      } } })),
      http.post(`/api/receipts/${DRAFT_ID}/confirm`, async ({ request }) => {
        sent = (await request.json()) as { sku_splits?: unknown };
        return HttpResponse.json({ success: true, data: { created: [{ line_no: 1 }], skipped: [], failed: [] } });
      }),
    );
    render(<ReceiptDetail draftId={DRAFT_ID} />);
    fireEvent.change(await screen.findByLabelText('라운드티 · 블랙 수량'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('1건 입고 확정'));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.sku_splits).toEqual({ 1: [{ sku_id: 11, qty: 1 }, { sku_id: 12, qty: 0 }] });
  });

  it('후보가 하나면 자동 안내만 보인다', async () => {
    mockDetail(detail());
    server.use(http.get(`/api/erp/receipts/${DRAFT_ID}/sku-options`, () => HttpResponse.json({ success: true, data: { 1: {
      source: 'learned', expectedQty: { qty: 1, approx: false },
      candidates: [{ skuId: 11, key: 'cp:1:블랙', name: '라운드티', option: '블랙' }],
    } } })));
    render(<ReceiptDetail draftId={DRAFT_ID} />);
    expect(await screen.findByText(/재고: 라운드티 · 블랙 · 1개 자동/)).toBeInTheDocument();
  });

```

Run: `npx vitest run src/__tests__/components/receipt-screens.test.tsx`
Expected: 새 2건 FAIL(분배 칸이 없다), 기존 전부 PASS

- [ ] **Step 17: `ReceiptDetail.tsx` 구현**

(1) 13행
```ts
import ReceiptLineRow, { type LineData, type ProductOption } from './ReceiptLineRow';
```
을 아래로 바꾼다.
```ts
import ReceiptLineRow, { type LineData, type ProductOption } from './ReceiptLineRow';
import ReceiptSkuSplit from './ReceiptSkuSplit';
import { emptyDraft, toSkuSplits, type LineSkuOptions, type SkuCandidateView, type SplitDraft } from './sku-split';
```

(2) 59행
```ts
  const [discardArmed, setDiscardArmed] = useState(false);
```
을 아래로 바꾼다.
```ts
  const [discardArmed, setDiscardArmed] = useState(false);
  // 1-C1: 확정 대기 줄의 재고 SKU 후보(원장 입고 분배) · 사람이 고른 분배 · SKU 검색 목록(처음 검색할 때 읽는다)
  const [skuOptions, setSkuOptions] = useState<Record<number, LineSkuOptions>>({});
  const [splitDrafts, setSplitDrafts] = useState<Record<number, SplitDraft>>({});
  const [allSkus, setAllSkus] = useState<SkuCandidateView[] | null>(null);
```

(3) 89~94행
```ts
  }, []);

  useEffect(() => {
    void load();
    void loadProducts();
  }, [load, loadProducts]);
```
을 아래로 바꾼다.
```ts
  }, []);

  /** 확정 대기 줄의 재고 SKU 후보. 실패해도 조용히 넘긴다 — 후보 하나인 줄은 서버가 알아서 넣는다 */
  const loadSkuOptions = useCallback(async () => {
    try {
      const res = await fetch(`/api/erp/receipts/${draftId}/sku-options`);
      const json = await res.json();
      if (json.success) setSkuOptions(json.data as Record<number, LineSkuOptions>);
    } catch {
      // 무시
    }
  }, [draftId]);

  const loadAllSkus = useCallback(async () => {
    if (allSkus !== null) return;
    try {
      const res = await fetch('/api/erp/stock');
      const json = await res.json();
      if (json.success) {
        setAllSkus((json.data as { skuId: number; key: string; name: string; option: string }[])
          .map((s) => ({ skuId: s.skuId, key: s.key, name: s.name, option: s.option })));
      }
    } catch {
      // 무시 — 검색 결과가 비어 보일 뿐이다
    }
  }, [allSkus]);

  useEffect(() => {
    void load();
    void loadProducts();
    void loadSkuOptions();
  }, [load, loadProducts, loadSkuOptions]);
```

(4) `patchLine` 안 113행
```ts
    await Promise.all([load(), loadProducts()]);
  }, [draftId, load, loadProducts]);
```
을 아래로 바꾼다(줄의 상품·결정이 바뀌면 후보도 바뀐다).
```ts
    await Promise.all([load(), loadProducts(), loadSkuOptions()]);
  }, [draftId, load, loadProducts, loadSkuOptions]);
```

(5) `confirm()` 안 123행
```ts
        body: JSON.stringify({}),
```
을 아래로 바꾼다.
```ts
        body: JSON.stringify({ sku_splits: toSkuSplits(skuOptions, splitDrafts) }),
```
그리고 같은 함수의 134행
```ts
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '확정 실패');
```
을 아래로 바꾼다.
```ts
      await Promise.all([load(), loadSkuOptions()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '확정 실패');
```

(6) 247~249행
```tsx
      {d.lines.map((l) => (
        <ReceiptLineRow key={l.id} line={l} products={products} onPatch={patchLine} />
      ))}
```
을 아래로 바꾼다.
```tsx
      {d.lines.map((l) => (
        <div key={l.id}>
          <ReceiptLineRow line={l} products={products} onPatch={patchLine} />
          {skuOptions[l.line_no] && l.cost_entry_id == null && l.decision === 'ingest' && (
            <ReceiptSkuSplit
              options={skuOptions[l.line_no]}
              draft={splitDrafts[l.line_no] ?? emptyDraft()}
              allSkus={allSkus ?? []}
              onChange={(dr) => setSplitDrafts((m) => ({ ...m, [l.line_no]: dr }))}
              onNeedSkus={() => void loadAllSkus()}
            />
          )}
        </div>
      ))}
```

- [ ] **Step 18: 통과 확인과 커밋**

Run: `npx vitest run src/__tests__/components/receipt-screens.test.tsx src/__tests__/components/receipt-sku-split.test.ts && npx tsc --noEmit`
Expected: 전부 PASS, 0 오류
```bash
git add src/components/receipt src/__tests__/components/receipt-screens.test.tsx src/__tests__/components/receipt-sku-split.test.ts
git commit -m "feat(erp): 영수증 확정 화면에서 옵션(SKU)별 입고 수량 나누기 · 연결 없으면 SKU 고르기"
```

- [ ] **Step 19: 🔴 화면 확인 — 컨트롤러가 직접**

390px 폭으로 `http://localhost:3000/m/receipt`를 연다. 확정 대기 줄이 있는 영수증이 있으면 상세로 들어가 분배 칸(자동 안내 / 옵션별 수량 / SKU 검색)이 줄 아래에 붙어 보이는지, 하단 확정 버튼과 겹치지 않는지 확인한다. 🔴 **「입고 확정」은 누르지 않는다**(실제 입고가 생긴다). 확정 대기 영수증이 없으면 이 확인은 건너뛰고 컴포넌트 테스트로 갈음한다고 기록한다.

---
### Task 8: 1-C1 마무리 — 병합·배포를 게이트보다 먼저

> 🔵 **순서 변경(2026-09-26 컨트롤러 검토):** 원래는 게이트(기초재고 입력) 뒤에 병합했으나, 그러면 게이트~배포 사이 운영 앱의 옛 코드로 한 영수증 확정·RG 입고가 원장에서 빠진다. **코드를 먼저 배포하고 게이트를 마지막에 둔다.** 배포 뒤 게이트 전까지 들어온 입고는 원장에 이미 전표가 생기므로, 그 SKU는 실사표 불러오기에서 제외되고 화면의 「지금 개수」로 입력한다(불러오기 미리보기가 제외 목록을 보여준다).


- [ ] **Step 1:** 전체 테스트와 타입 — `npx vitest run`(실패 수 ≤ 기준선), `npx tsc --noEmit`(0 오류), `npx next build`(성공 — 새 라우트·페이지가 빌드되는지. 실패하면 main에서도 실패하는지 먼저 확인해 원인을 가른다)
- [ ] **Step 2:** 최종 리뷰(superpowers:requesting-code-review) — 설계서 §1~§7과 이 계획서 「설계 해석」 표를 기준으로. 지적은 고치고 `fix(erp): …`로 커밋한다.
- [ ] **Step 3:** 브랜치 푸시 → PR(`gh pr create`). 본문: Task 0~7 요약(4b 상품 묶어 보기 · 4c 센 기록·오늘 셀 목록 포함 — 마이그레이션 116은 이미 운영 적용) · 「설계 해석」 표 · 게이트는 배포 뒤(Task 9) · 「하지 않는 것」 표 · 끝에 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 4:** 🔴 **병합은 사용자 확인 후.** 병합 뒤 Vercel 배포 성공을 확인하고(`gh api repos/stan070628/smart-seller-studio/commits/<병합 SHA>/status`), 곧바로 Task 9 게이트로 간다. 사용자에게 `/m/stock`을 휴대폰 홈 화면에 추가하는 법을 한 줄로 안내한다.

---

### Task 9: 🔴 사용자 게이트(배포 뒤) — 기초재고 입력과 원장 RG = 쿠팡 RG

> 이 Task는 **사용자가 화면에서 입력한다.** 컨트롤러는 준비·안내·검증만 한다. 서브에이전트에게 맡기지 않는다.

- [ ] **Step 1: 전체 테스트·타입·자가시험(기초재고 전 마지막)**

Run: `npx vitest run 2>&1 | tail -6 && npx tsc --noEmit && npx --no-install tsx scripts/erp/ledger-selftest.ts`
Expected: 실패 수 ≤ 기준선(Task 0 Step 1) · tsc 0 · 자가시험 28행 전부 ✅(Task 4c에서 센 기록 2행 추가) · 원장 0행(Task 2 Step 15의 흔적 확인 명령으로 `{ ledger: 0, skus: 0, cursor: 0 }`).

- [ ] **Step 2: 사용자에게 알리고 준비한다**

컨트롤러가 사용자에게 한 번에 전한다.
1. 🔵 **코드는 이미 배포돼 있다(Task 8).** 게이트는 배포 직후 바로 한다 — 그 사이 영수증 확정·RG 입고를 했다면 해당 SKU는 불러오기에서 빠지고 화면에서 「지금 개수」로 입력한다.
2. 실사표: `docs/erp/opening-count-2026-09-26.csv`(1-B에서 사용자가 채운 것)를 쓰거나, 새로 세려면 `npx --no-install tsx scripts/erp/opening-collect.ts --carry=docs/erp/opening-count-2026-09-26.csv --force`로 옛 입력을 옮긴 새 실사표를 뽑는다(오늘 날짜 파일). 고칠 칸은 `self_count`·`rg_inbound`·`unit_cost`. **실사를 마친 시각을 기억해 둔다**(24시간 안에 불러와야 한다).
3. 1-B에서 남긴 입력: 단가 빈칸 6건(쿨매트 핑크 · 쿨매트 블루 구름(베개형) S · 105(L) 블랙 · 화이트+그레이스트라이프 150 · 니트 건조대 2단 · 마크곤잘레스) · **퓨어틴 초코(`cp:16368156484:330ml`) 단가는 팩당 12,995**(옛 이력 재계산은 박스 단위 중복 입고 때문에 틀린다 — 불러오기 창의 「단가 입력」에 적는다) · 퓨어틴 초코 실사 11의 단위(병/팩) · 승인 목록 밖 RG 재고 4건(`95812283106`·`95932746388`·`95833506834`·`95693450298`, 합계 8개) — 웹 불러오기는 이것들을 경고로만 보이고 싣지 않는다. 스크립트 대조(Step 5)에서 빼려면 `docs/erp/opening-overrides.json`의 `ignoreRgVids`에 사유와 함께 적는다(사용자 결정).

- [ ] **Step 3: 사용자가 실사표를 불러온다** (운영 앱 또는 `npm run dev` · 사용자 로그인 · 1440px)

`/erp/stock` → 「실사표 불러오기(CSV)」 → 파일 고르기 → **실사를 마친 시각** → 「미리보기」 → 오류가 0이 될 때까지 「단가 입력」을 채우고 다시 미리보기 → 컨트롤러가 합계(전표 수·집·RG입고중·RG·평가액)와 경고·제외 목록을 사용자에게 읽어 준다 → **사용자 승인** → 「불러오기」.
Expected: `기초재고 N건을 불러왔습니다` 토스트, 표의 「원장 없음」이 불러온 SKU에서 사라진다. 실사표에서 빠진 SKU는 나중에 화면에서 첫 「지금 개수」를 적으면 기초재고가 된다.

- [ ] **Step 4: RG 대조 → 반영** (사용자)

「RG 실재고 대조」 → KPI 「RG 불일치」가 0이 아니면 행을 확인한다. 불러오기와 대조 사이의 RG 판매가 차이로 보인다(판매 차감은 1-C2). 사용자가 확인한 행만 「반영」(또는 「불일치 N건 일괄 반영」 — 확인 창에 SKU 수·증감·평가액이 뜬다).
Expected: 다시 「RG 실재고 대조」를 누르면 **RG 불일치 0**.

- [ ] **Step 5: 스크립트로 관문 확인** (컨트롤러)

Run: `npx --no-install tsx scripts/erp/rg-reconcile.ts`
Expected: `기초재고 시각: <불러온 시각> · … · 불일치 0 · 매핑 이슈 0 · 보관 SKU RG 0` 그리고 `✅ 원장 RG = 쿠팡 RG 실재고`.
- 매핑 이슈가 남으면(승인 목록 밖 vid) Step 2-3의 사용자 결정대로 `ignoreRgVids`를 적고 다시 돌린다.
- 불일치가 남으면 그 SKU가 Step 4 이후 팔렸는지 사용자에게 확인하고 화면에서 다시 반영한 뒤 다시 돌린다.

그리고 자가시험이 이제 거부하는지 본다(기초재고가 들어갔으므로).
Run: `npx --no-install tsx scripts/erp/ledger-selftest.ts; echo "exit $?"`
Expected: `❌ 기초 전표가 N건 있다 — 기초재고 적재 뒤에는 자가시험을 돌리지 않는다…`, exit 1.

- [ ] **Step 6: 휴대폰으로 한 건** (사용자, 선택)

390px에서 `/m/stock` → 「오늘 셀 목록」 카드(기초재고가 들어갔으니 이제 채워진다 — 불러오기가 집 센 기록을 남겼으므로 실사표 시각이 오늘이면 그 SKU들은 빠져 있다) 하나를 실제로 세어 「저장」 → 카드가 목록에서 빠지는지 · PC `/erp/stock`에서 그 행의 「마지막 실사」가 오늘인지 · 차이가 있었다면 이력에 조정 전표가 보이고 「되돌리기」가 되는지 확인한다.

- [ ] **Step 7: 기록과 커밋**

이 계획서 끝 「적재 결과」에 적는다: 불러온 파일 · 실사 시각 · 기준 시각(`ledger_cutover`) · 기초 전표 수와 위치별 합계·평가액 · 입력한 단가 목록 · RG 반영 건수 · `rg-reconcile` 결과 · `ignoreRgVids` 결정.
```bash
git add docs/superpowers/plans/2026-09-26-erp-phase1c1-stock-adjust.md docs/erp/
git commit -m "docs(erp): 1-C1 기초재고 입력 결과 — 원장 RG = 쿠팡 RG"
```

---

## 이 계획에서 하지 않는 것 (1-C2로)

| 항목 | 이유 · 1-C2에서 할 일 |
|---|---|
| 주문 수집 4채널(쿠팡 Wing·RG·네이버·토스) · 주문라인(P3) · 판매 차감(`kind='sale'`) · 할당 | 1-C2 본체. 수집 시작점 = `sync_cursors.ledger_cutover`. 🔴 SKU마다 첫 전표 시각이 다를 수 있다(실사표에서 빠져 나중에 첫 입력한 SKU) — 그 SKU의 첫 전표 이전 판매는 차감하지 않고 기록만 남기는 안을 1-C2 설계에서 정한다(설계서 열린 질문) |
| 당근 수동 판매 | 판매는 주문라인에 묶인다 — 주문 테이블과 함께 |
| RG 자동 입고 완료(`rg_inbound → rg`, RG 판매 가능 수량 증가로 판정) · 입고중 7일 경보 · `rg-reconcile` 매일(pg_cron) | 판매 차감이 없으면 RG 판매가 차이로 보여 증가분을 가려낼 수 없다. 1-C1은 사람이 확인해 반영한다. 7일 기준일(발송일/입고 ID 생성일)은 실측 후 |
| `sale_records` RG 무효 1,062건(≈99%가 `rg-bulk-import` 30일 구간 경계 버그 — 끝 날짜 배타) | 판매 수집을 어댑터로 바꿀 때 함께. 옛 수익 화면 RG 매출 과소 가능성 |
| Wing 판매 키 중복(`wing-…`/`…`) | 같은 이유 |
| 채널 재고 전송 | 1-D |
| 바코드 스캔(휴대폰) | **후순위**(결정 5) — SKU 바코드(`erp.skus.barcode`)를 먼저 채운 뒤 |
| 「이상한 것만 표시」(판매 대비 재고가 이상한 SKU만 걸러 보기) | 판매 차감이 있어야 의미가 있다(결정 5) — 1-C2 |
| 오늘 셀 목록 저장·N 설정 화면 · 센 기록 고치기·지우기 | 목록은 요청 때 계산한다(결정 5). N은 주소 `?n=`(1~30)만. 센 기록은 insert만 — 틀리게 셌으면 다시 세면 마지막 값이 된다 |
| TanStack Table/Query · ERP 화면 틀 | 2단계. 1-C1 화면은 `E` 토큰 + 손 테이블 |
| 영수증 밖 입고 경로(수기 입고 폼 `POST /api/cost-management/products/[id]/entries` 등)의 원장 기록 | 설계서 §4는 영수증 확정만 다룬다. 그 경로로 들어온 입고는 당분간 재고현황에서 조정(±수량·반품입고/기타)으로 맞춘다 — 1-C2에서 경로를 모을지 정한다 |
| 영수증·RG 보내기 전표의 화면 되돌리기 | 옛 `cost_entries`와 짝이라 원장만 되돌리면 둘이 어긋난다. 틀리면 조정으로 맞춘다 |
| `purchase_units.pieces_per_purchase`·`pieces_per_sale_unit`(낱개 환산) 활용 | 1-C1은 `cost_entries`의 판매단위(팩) 수량을 그대로 쓴다. 기준 단위와 옛 입고 단위가 다른 SKU(1-B 「기준 단위 확인 필요」)는 1-C2에서 환산을 붙인다 |
| 옛 `cost_entries` 정리(퓨어틴 초코 박스 단위 중복 입고 등) | 원장은 기초재고부터 새로 시작하므로 옛 표를 고치지 않는다. 옛 수익 화면을 원장으로 옮길 때(2단계) 함께 |

---

## 실행 기록

- 2026-09-26 품번 확인(사용자, Task 7): **693742 「프로틴커피쉐이크」 → 퓨어틴 초코가 아니라 퓨어틴 커피(`cp:16376323038:330ml`)로 고친다** · **888450 「PUMA주니어팬티5P」 → 극세사 타월 36장 연결을 뺀다**(SKU 목록에 없음 — 다음 영수증에서 확정 화면이 고르게 한다). 시드 dry-run: 품번 23개 → 62행 · 보류 2

> 실행 중 사용자 답·결정을 즉시 적는다(세션이 끊겨도 같은 질문을 반복하지 않게).

- 기준선(Task 0 Step 1):
- 의심 품번(Task 7 Step 7):

## 적재 결과

> Task 8 Step 7에서 채운다.
