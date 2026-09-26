# ERP 1-C2a — 주문 수집·판매 차감 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 쿠팡 판매자배송·쿠팡 RG·네이버·토스 주문을 15분마다 수집해 `erp.order_lines`에 쌓고(구매자 개인정보 없이), 같은 라인을 옛 장부 `sale_records`에도 한 키로 기록하며, 스위치를 켜면 기초재고 시각(2026-09-26 11:07:04 UTC) 이후 결제된 라인을 원장에서 뺀다(판매자배송·네이버·토스 = 집, RG = RG). 처음 3일은 기록만 하고 사용자가 채널 관리자 화면과 날짜별 건수를 대조한다(🔴 게이트 ①), 맞으면 소급 합계를 보고 승인해 켠다(🔴 게이트 ②).

**Architecture:** 채널마다 **어댑터**(채널 API → 표준 라인 `OrderLine`, 구매자 칸은 여기서 버린다)가 있고, **순수 로직**(상태 표준화 · 리스팅→SKU 연결 · 멱등키 · 차감 판정 · 옛 장부 행 계획)이 무엇을 기록할지 정하며, **수집기**가 채널별 advisory lock 아래에서 가져오기(트랜잭션 밖) → 한 트랜잭션(라인 upsert · 사라진 라인 취소 · 옛 장부 · 차감 · 커서)으로 쓴다. 차감은 1-B `store.ts`(`postConsume`·`reverse`·SKU 잠금·멱등)를 그대로 부르고 라인마다 savepoint로 재고 부족을 가둔다. 15분 pg_cron → `/api/cron/orders-sync`. 화면은 `/erp/stock` 위 수집 현황 패널과 「차감 켜기…」 확인 창.

**Tech Stack:** Next.js 16 App Router · React 19(inline style + `E` 토큰 + `erp-ui.tsx`) · Postgres 17(Supabase, `pg` 직접) · TypeScript · vitest + testing-library + msw · tsx 스크립트

- 설계: `docs/superpowers/specs/2026-09-26-erp-phase1c2a-orders-design.md`(사용자 승인) · 결정 기록: `docs/superpowers/specs/2026-09-26-erp-phase1c2-orders-decisions.md`
- 선행: 1-C1(`docs/superpowers/plans/2026-09-26-erp-phase1c1-stock-adjust.md`, PR #22 병합) — 기초재고 가동, `ledger_cutover` = **2026-09-26 11:07:04.989 UTC**

---

## 사전 정보 (실행자는 반드시 읽는다)

- 작업 폴더: `~/dev/smart_seller_studio/.worktrees/erp-restructure` (브랜치 `feature/erp-restructure`, PR #22 이후 main과 같다). 모든 명령은 여기서.
- **합격 기준** = 새 테스트 전부 통과 + 전체 실패 수 ≤ 기준선(Task 0에서 잰다) + `npx tsc --noEmit` 0 오류 + `npx next build` 성공.
- **DB는 운영 Supabase 하나다.** 스크립트·마이그레이션은 `SUPABASE_DB_URL`, 앱 서버 코드(`getSourcingPool()` — `src/lib/sourcing/db.ts`)는 `SOURCING_DATABASE_URL`(1-C1 Task 1 Step 0에서 같은 DB임을 확인했다). 비밀값을 출력하지 않는다.
- 마이그레이션: `node scripts/apply-migration.mjs 117`(트랜잭션으로 감싼다 — 파일 안에 BEGIN/COMMIT 금지). **117은 운영 적용 허용**(새 테이블만 만든다). **118(pg_cron)은 파일은 Task 6에서 쓰고, 적용은 Task 9 Step 5(배포·첫 실행 확인 뒤)** — 배포 전에 걸면 운영 앱에 라우트가 없어 15분마다 404가 난다.
- 스크립트 실행: `npx --no-install tsx scripts/erp/<파일>.ts`. 첫 줄에서 `loadEnvLocal()`(`scripts/erp/_env.ts`). 접속은 `new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })`.
- **erp 스키마 접근(1-B P4):** 서버 코드는 `pg` 직접. `pg.Pool`·`PoolClient`·`pg.Client`는 모두 1-B `Db` 인터페이스(`src/lib/erp/ledger/store.ts`)를 만족한다.
- **인증:** 새 `/api/erp/*`는 첫 줄에서 `requireAuth`(`src/lib/supabase/auth.ts`). 크론 라우트는 `Authorization: Bearer ${CRON_SECRET}`(`src/app/api/cron/stock-sync/route.ts`와 같다). 테스트는 `vi.mock('@/lib/auth', () => ({ getCurrentUser: … }))`.
- **1-C1에서 이어받는 규칙(바꾸지 않는다):**
  - 멱등키(`assertIdemKey`, `src/lib/erp/ledger/plan.ts`): `#` 금지 · `rev:` 접두 금지. `:`·`@`는 쓸 수 있다. 이 계획의 새 키는 `sale:<channel>:<lineKey>:s<skuId>`(2번째 차감부터 `@n`) 하나뿐이다.
  - `reverse(db, key, …)`는 `key`와 `key#…`만 상쇄한다 — `@2` 키는 별개다(`alreadyPosted`의 `LIKE 'key#%'`에 `@`가 걸리지 않는다).
  - 여러 SKU를 한 트랜잭션에 쓰면 **`sku_id` 오름차순으로 먼저 `lockSku`**. `occurredAt`은 **오프셋 있는 ISO**.
  - 재고 부족은 `planConsume`이 `InsufficientStockError`(`src/lib/erp/ledger/fifo.ts`)로 **삽입 전에** 던진다. 겹친 실행은 지연 제약이 `…음수가 된다`로 던진다 — 둘 다 「재고 부족」으로 본다.
  - 오류 → HTTP는 `erpError`(`src/lib/erp/stock/http.ts`), 트랜잭션은 `withTx`, 작업 기록은 `withJobRun`(`src/lib/jobs/run-log.ts`), 로그·텔레그램 문구는 `maskPII`(`src/lib/jobs/mask.ts`).
  - 자가시험: **기존 `scripts/erp/ledger-selftest.ts`는 기초 전표가 있으면 거부한다(2026-09-26 이후 항상).** 이 계획은 **ROLLBACK만 하는** 새 `scripts/erp/orders-selftest.ts`를 쓴다.
- 🔴 **구매자 개인정보(이름·전화·주소·이메일·배송메모)를 DB·파일·로그·픽스처에 쓰지 않는다.** 어댑터가 표준 라인으로 옮길 때 버리고, 테스트가 이를 확인한다. 픽스처의 구매자 칸은 누가 봐도 가짜인 값(`테스트구매자`, `010-0000-0000`, `가상시 가상구 1`)만 쓴다.
- 🔴 **테스트는 채널 API를 부르지 않는다.** 어댑터는 녹화한 응답(fixture) + 가짜 클라이언트로 시험한다. 채널을 실제로 부르는 첫 실행은 **컨트롤러가** Task 9에서 한다(읽기 전용 — 발주확인·송장·재고 쓰기 없음).
- 🔴 **화면 확인은 컨트롤러가 직접 브라우저로 한다(서브에이전트에게 맡기지 않는다).** `npm run dev`(백그라운드) → 사용자가 `http://localhost:3000/login`에서 **직접 로그인** → 1440px. 로컬 개발 서버도 **운영 DB**에 붙는다 — 「차감 켜기」는 게이트 ②에서 사용자가 승인한 뒤에만 누른다.
- 🔴 **사용자 게이트:** Task 9 Step 3(병합) · Task 10(3일 대조) · Task 11(차감 켜기).
- UI 규칙: 인라인 스타일 + `E` 토큰(`src/lib/design-tokens.ts`) + `src/components/orders/erp-ui.tsx` 조각, `fetch` + `useState`, 확인은 `confirmDialog`(`src/components/ui/confirm`), 알림은 `toast`(`src/components/ui/toast`). 새 UI 라이브러리 금지. 화면 문구는 「~습니다」체.

## 설계 해석 — 스펙이 열어 둔 것을 이 계획이 정한 것

| # | 스펙 문구 | 이 계획의 선택 | 이유 |
|---|---|---|---|
| 1 | §1 「스위치: `erp.sync_cursors`와 같은 방식의 설정 행 `deduct_enabled`」 | 새 표 **`erp.settings(name pk, value jsonb, updated_at)`**에 한 행 `deduct_enabled = {"enabled": false}`. 켜면 `{"enabled": true, "enabledAt": <ISO>, "by": <userId>}` | `sync_cursors.cursor_at`은 not null 시각이라 켜짐/꺼짐을 담지 못한다. 「이름 하나 = 행 하나」라는 방식은 같다. 언제 누가 켰는지가 남아야 게이트 ② 기록이 된다 |
| 2 | §1 라인의 「SKU id(null 가능) · SKU 기준 수량」 | `alloc jsonb`(`[{skuId, qty}]`, SKU 오름차순)이 원본, `sku_id`는 **SKU가 하나일 때만** 채운다. 실제로 뺀 것은 `posted jsonb`(`[{skuId, qty, idemKey}]`) | 스펙 열린 질문 — `bundle` 리스팅은 구성 SKU마다 뺀다. 한 칸으로는 담지 못한다. 2026-09-26 실측으로 bundle 리스팅은 0건(single 442 · any_of 3)이라 지금 부담은 없다 |
| 3 | §1 차감 상태 `pending|posted|skipped_short|reversed` | **`none`을 더한다**(차감 대상이 아님) + `deduction_note`(`pre_cutover`·`not_paid`·`voided`·`unattributed`·`unknown_status`·재고 부족 문구) | 기초 이전 결제·미귀속·미결제 취소 라인이 `pending`에 섞이면 「차감 켜기」 소급 수가 틀린다 |
| 4 | §2·§3 「표준 상태」 | 11개: `unpaid · paid · shipping · delivered · confirmed · cancel_requested · canceled · return_requested · returned · exchange · unknown`. **팔림**(차감) = paid·shipping·delivered·confirmed·cancel_requested·return_requested·exchange · **무효**(역전표) = unpaid·canceled·returned · **unknown = 지금 상태 유지**(차감도 역전도 하지 않고 `unknown_status`로 센다) | 취소·반품 **요청**은 아직 물건이 안 돌아왔다. 모르는 상태 문자열로 멀쩡한 차감을 되돌리면 재고가 부풀어 오른다 |
| 5 | §3 멱등키 `sale:<channel>:<라인키>`(버전 `@n`) | **`sale:<channel>:<lineKey>:s<skuId>`**, 두 번째 차감부터 `@2`·`@3`… 라인키 문자는 `[0-9A-Za-z_-]`와 `:`만(DB check로도 막는다) | `postConsume`·`reverse`는 SKU 하나 단위다. bundle 라인의 둘째 SKU에 같은 키를 쓰면 `alreadyPosted`가 참이 돼 조용히 빠진다. `assertIdemKey`는 `:`·`@`를 허용한다 |
| 6 | §2 「커서에서 48시간 겹쳐」 | 시작 = `max(기초 시각, min(커서 − 48h, 지금 − 꼬리일수))`. 꼬리일수: 쿠팡 판매자배송·RG·토스 **7일**(주문일·결제일로 거르는 API), 네이버 0(변경 시각으로 거르는 API) | 주문일 기준 API는 5일 뒤 취소를 48시간 겹침으로 다시 읽지 못한다. 네이버는 상태가 바뀐 시각으로 거르므로 48시간이면 된다 |
| 7 | §2 쿠팡 취소 판정 | ① 품목 `canceled` 또는 `shippingCount − cancelCount ≤ 0` → canceled ② **응답에서 사라진 라인 = 취소**(쿠팡 판매자배송·RG): 그 채널을 **끝까지 받은 경우에만**, API가 실제로 거른 구간(`cover`) 안의 라인만 | RG 주문 API는 취소를 플래그로 주지 않고 응답에서 뺀다(옛 `rg-bulk-import` 주석, 2026-07-06 스펙 §4). 발주서 목록도 결제완료 취소는 목록에서 사라진다. 한 페이지라도 실패하면 어댑터가 던져 아무것도 쓰지 않는다 |
| 8 | §2 쿠팡 판매자배송 부분 취소·금액 | 수량 = `shippingCount − cancelCount`, 금액 = `orderPrice × 수량 ÷ shippingCount`(반올림), 단가 = `salesPrice` | 발주서에는 품목 실매출이 없다. 옛 Wing 행(revenue-history 실매출)과 기준이 다를 수 있다 — 게이트 ①에서 수익 화면 금액도 한 번 본다 |
| 9 | §2 RG 「끝 날짜 포함」 | `paidDateTo = 마지막 날 + 1`(API는 배타). 한 번에 **29일**(시작~끝 포함)씩 | 옛 `rg-bulk-import`는 청크 끝을 배타 날짜로 넘겨 청크마다 하루를 잃었다(1-C1 「하지 않는 것」 — 무효 1,062건의 원인) |
| 10 | §2 토스 「상품 ID + 옵션」 | 주문 v2의 `productId`·`optionName`·`stockId`를 살린다(공식 문서 `GetOrderHistoriesCursorResponse`). 연결: (상품 ID, 옵션명) 정확 일치 → **정규화 일치**(`/`로 나눠 칸마다 「이름:」 접두·공백 제거) → 그 상품의 리스팅이 하나뿐이면 그것 → 없으면 `option_unmatched`. `stockId`는 `alt_product_id`에 보관. 결제 시각 칸이 없어 **결제 상태면 주문 시각을 결제 시각으로** 쓴다 | 리스팅 옵션 키는 재고 동기화가 만든 `valueName` ` / ` 결합이고(`src/lib/stock-sync/channels.ts` `tossOptionKey`), 주문 `optionName`의 형식은 아직 실측 전이다. 틀리면 미귀속으로 쌓일 뿐 잘못 빼지는 않는다 — 게이트 ①에서 미귀속 수를 본다 |
| 11 | §2 네이버 「변경 주문 → 상세(`moreSequence`)」 | 새 클라이언트 메서드 `getLastChangedStatuses`(lastChangedType **생략** = 모든 변경 · `limitCount=300` · `more.moreFrom/moreSequence`를 끝까지) + `queryProductOrders`(300건씩, 실패는 던진다). 연결: (`originalProductId`, `optionCode ?? ''`) → 없으면 그 상품의 `''`(단일상품) 리스팅. 기존 `getOrders`는 화면용으로 그대로 두고 정규화 결과에 `originalProductId`·`optionCode`만 더한다 | 기존 `getOrders`는 PAYED·DISPATCHED·PURCHASE_DECIDED만 보고(취소를 못 본다), 실패를 삼키고, `more`를 무시한다. 삼키면 「빠짐없이 받았다」를 믿을 수 없다 |
| 12 | §3 「취소·반품 → reverse()」 | **반품 완료**(네이버 `RETURNED`·토스 `COMPLETED_RETURN`)만 역전표, 반품 **요청 중**은 판매 유지. 쿠팡 판매자배송의 배송 후 반품은 발주서에 나타나지 않는다 → 물건이 돌아오면 사람이 재고현황에서 「반품입고」 | 🔴 역전표가 된 반품을 사람이 또 「반품입고」하면 두 번 들어간다 — 패널 안내 문구로 막는다(Task 7) |
| 13 | §4 옛 장부 한 행·키 통일 | 키 `wing-<orderId>-<vid>`(옛 Wing 키 그대로) · `rg-<orderId>-<vid>` · `naver-<productOrderId>` · `toss-<orderProductId>`. 같은 키의 라인(분리배송 박스)은 **합산**. product_cost: 라인 SKU(미귀속이면 리스팅의 SKU)의 `legacy_product_cost_ids` 중 **리스팅과 맞는 것**(쿠팡 = `product_cost_channels`(채널·vid), 네이버 = `product_costs.naver_channel_product_no`) → 없으면 첫 값 → **SKU가 없으면 옛 불러오기의 직접 매칭**(쿠팡 `product_cost_channels`·RG `product_costs.vendor_item_id`·네이버 채널상품번호) → 그래도 없으면 기록하지 않는다. `user_id`는 그 `product_costs.user_id`. 이미 있는 행은 **수량·단가·금액·판매일·무효만** 갱신(상품·쿠폰·배송비는 덮지 않는다). Wing 키를 쓸 때 상품별 불러오기가 남긴 무접두 `<orderId>-<vid>` 행을 무효화 | 옛 키와 같아야 과거 행과 겹쳐도 두 번 세지 않는다. 옛 불러오기는 ERP 리스팅·SKU가 없는 옛 상품의 판매도 기록했다 — 그 동작을 잃지 않는다. 크론에는 로그인 사용자가 없다(`product_costs` 사용자 1명 실측) |
| 14 | §4 「기존 불러오기 버튼은 새 수집 트리거로」 | 원가관리 「판매 가져오기」·상품별 「판매 가져오기」 → **`POST /api/erp/orders/sync`**(기초 시각 이후, 날짜 입력 없음). 옛 4개 라우트(`rg-bulk-import`·`wing-bulk-import`·`naver-bulk-import`·`products/[id]/coupang-import`)는 **410**을 돌려준다 | 옛 라우트가 살아 있으면 무접두 키·배타 끝 날짜 버그로 다시 이중·누락 기록이 생긴다. 과거(기초 이전) 복구는 1-C2b |
| 15 | §2 「채널별 advisory lock」 | 세션 잠금 `pg_try_advisory_lock(7102, 채널번호)` — 못 잡으면 그 채널은 `busy`로 건너뛴다. **채널 API를 부르는 동안 트랜잭션을 열지 않는다**, 쓰기는 한 트랜잭션. 차감은 대상 라인을 `for update`로 잡고 SKU 오름차순 `lockSku` | 네이버·RG 호출은 수십 초다. 그동안 트랜잭션을 잡으면 원장 잠금이 길어진다. 차감 켜기와 크론이 겹쳐도 라인 행 잠금이 한 쪽을 기다리게 한다 |
| 16 | §3 「재고 부족이면 그 라인만 `skipped_short`」 | 라인마다 savepoint. 되돌릴 차감이 있으면 **역전표 먼저**(자기 savepoint) → 새 차감(자기 savepoint). 새 차감이 부족하면 그 savepoint만 되돌리고 `skipped_short` + 부족 문구 | bundle 라인에서 둘째 SKU가 부족하면 첫째 SKU 차감도 함께 되돌려야 한다. 역전표는 재고를 늘리므로 실패하지 않는다 |
| 17 | §5 「차감 켜기… → 승인해야 켜진다」 | 확인 창이 미리보기의 **소급 라인 수**를 요청에 싣는다(`expectedLines`). 켜는 트랜잭션 안에서 다시 센 수와 다르면 409 `stale` — 창을 다시 연다. 이미 켜져 있으면 409 `already`. 끄는 화면은 없다 | 사람이 본 숫자와 실제로 빼는 숫자가 같아야 한다(1-C1 설계 해석 #6과 같은 원칙) |
| 18 | §5 「입출 이력에 판매 전표(채널·주문번호)」 | 판매 전표 `ref_type='order_line'` · `ref_id=<라인 id>` · `note='<채널> 주문 <주문번호>'`. 역전표 note `'<채널> 주문 <주문번호> 취소·반품'`. `HistoryPanel`은 이미 `sale`=「판매」와 note를 보인다 — 고치지 않는다. 판매 전표는 화면에서 되돌리지 않는다(`isReversibleKey`가 `sale:`을 받지 않는다) | 판매 되돌리기는 채널 상태가 정한다. 사람이 되돌리면 다음 수집이 다시 뺀다 |
| 19 | §3 판매 전표 시각 | `occurredAt` = **결제 시각**(없으면 주문 시각). 역전표 시각 = 수집 시각. 소급·수집 모두 결제 시각 순 | 입출 이력이 실제 판매 순서로 보인다. FIFO는 시각을 보지 않으므로 원가는 같다 |
| 20 | (없음) 토스 클라이언트 | `request()`의 응답 본문 로그(`text.slice(0, 300)` — 구매자 이름·전화가 들어 있다)를 **상태 코드만** 남기게 고친다. `getOrdersPage` 한 페이지 메서드를 더하고 `getOrders`는 그것을 쓴다(20페이지 상한 동작은 그대로). 어댑터는 자기 상한(200페이지)을 넘으면 **던진다** | 크론이 15분마다 구매자 정보를 서버 로그에 남기게 된다. 조용히 자르면 「끝까지 받았다」가 거짓이 된다 |
| 21 | §6 「pg_cron + 수집 API」 | 크론은 채널을 **차례로** 돈다(한 채널 실패가 다른 채널을 막지 않는다). 모든 채널이 실패하면 `withJobRun`이 실패로 남기고 텔레그램(`JOB_ALERT_TELEGRAM_CHAT_ID`), 일부만 실패하면 `ok`로 남기되 같은 채팅에 채널별 실패를 보낸다. `counts` = 채널별 `<ch>_fetched`·`<ch>_new`·`<ch>_error`(0/1) + 합계 | 수집 현황 패널이 `erp.job_runs` 한 줄로 채널별 성패를 보인다 |
| 22 | §5 「채널·날짜를 누르면 그날 라인 목록」 | 날짜 = **주문 시각의 KST 날짜**. 패널 건수 = 라인 수와 주문 수 둘 다(채널 관리자 화면은 주문 수, 네이버는 상품주문 수로 센다) | 게이트 ① 대조표가 채널 화면의 기준과 같아야 한다 |

## 1-C2a 탐색 사실 (2026-09-26 읽기 전용)

| 사실 | 계획에 주는 영향 |
|---|---|
| 네이버·토스 클라이언트는 `src/lib/listing/naver-commerce-client.ts`·`src/lib/listing/toss-shopping-client.ts`(`src/lib/naver`·`src/lib/toss` 폴더는 없다) | 경로를 이것으로 쓴다 |
| 쿠팡 `getOrders`(`coupang-client.ts` 606행)는 한 페이지만 받고 `nextToken`을 돌려준다(인코딩 없이 붙인다). `getRocketGrowthOrders`(773행)는 `paidDateFrom/To`(YYYY-MM-DD → yyyymmdd), `paidAt`은 ms 문자열 | 어댑터가 끝까지 넘긴다. RG 끝 날짜 +1 |
| 네이버 `NaverOrderRawItem`(69행)·`normalizeNaverOrder`(106~138행)는 `originalProductId`·`optionCode`·`claimType`을 버리고, `getOrders`(434행)는 실패를 `console.warn`으로 삼키며 `more`를 모른다 | 설계 해석 #11 |
| 토스 `TossOrder`(12행)에 `productId`·`stockId`가 없고, `request()`가 응답 본문 300자를 `console.log`한다 | 설계 해석 #10·#20 |
| 채널 리스팅(운영, 활성): coupang_wing single 192 · coupang_rg single 102 · naver single 101(옵션 키 68) + any_of 3(SKU 2·9·2) · toss single 47(옵션 키 47, 45개가 ` / ` 결합). bundle 0. 배수 > 1 연결: Wing 7 · RG 5 · 네이버 3 · 토스 1 | 네이버 any_of 3개 상품은 미귀속으로 쌓인다(1-C2b 대기열) |
| 활성 SKU 215 중 `legacy_product_cost_ids` 없음 86 · 둘 이상 5. `product_costs` 사용자 1명·77행. `product_cost_channels`: wing 65 · rg 68 · naver 2 | 설계 해석 #13 |
| `sale_records` 2026-09-01 이후: `coupang`(`wing-`) 41 · `rocket_growth`(`rg-`) 500 · 네이버·토스 0 · 무효 0 | 새 수집이 네이버·토스 행을 처음 채운다 |
| 원장: 기초 전표만(self 20 · rg 15). `sync_cursors`: `ledger_cutover`만. `cron.job`: `stock-sync`(3시간)만. erp 표: `orders`·`order_lines`·`settings` 없음 | 마이그레이션 번호 117·118 |
| `sale_records.coupang_order_item_id`가 유일 키(058) · `sold_at date` · `sale_amount`(087) · `shipping_fee`(088, 판매자 택배 3,500 · RG 0 — `resolveSaleShippingFee`) · `voided_at`(085) | 옛 장부 upsert가 이 키로 `on conflict`. 토스 배송비 소스 `'toss'`를 더한다 |
| 옛 불러오기 버튼 호출부: `CostManagementTab.tsx` `runAllBulkImport`(354행, 3개 라우트) · `SaleEntryPanel.tsx` `runImport`(262행, 상품별). 결과 표시는 `import-summary.ts` `buildImportSummary` | Task 8 |
| `ledger-selftest.ts`는 기초 전표가 있으면 exit 1 | 새 `orders-selftest.ts`(ROLLBACK 전용) |

## File Structure

| 파일 | 책임 |
|---|---|
| `supabase/migrations/117_erp_orders.sql` | `erp.orders` · `erp.order_lines` · `erp.settings`(`deduct_enabled`) · 검사·색인·RLS |
| `src/lib/erp/orders/types.ts` | 채널 · 표준 상태 · 팔림/무효 집합 · 표준 라인 `OrderLine` · 어댑터 인터페이스 · 위치 |
| `src/lib/erp/orders/status.ts` | 채널 상태 문자열 → 표준 상태(4채널) |
| `src/lib/erp/orders/keys.ts` | 외부 id 검사 · 판매 멱등키 · 옛 장부 키 · 옛 장부 채널 |
| `src/lib/erp/orders/resolve.ts` | 리스팅 색인 · 토스 옵션 정규화 · 라인 → 리스팅·SKU·수량(single·bundle·any_of) |
| `src/lib/erp/orders/deduct-plan.ts` | 차감 판정표(순수): 역전표·새 차감(`@n`)·상태·사유 |
| `src/lib/erp/orders/window.ts` | 수집 구간(겹침·꼬리) · KST 날짜·시각 도우미 · 날짜 청크 |
| `src/lib/erp/orders/legacy.ts` | 옛 장부 대상 고르기 · 키별 합산 행 계획(순수) |
| `src/lib/erp/orders/adapters/{coupang-wing,coupang-rg,naver,toss}.ts` | 채널 응답 → `OrderLine`(구매자 칸 버림) · 끝까지 넘기기 |
| `src/lib/erp/orders/adapters/index.ts` | 채널 → 실제 클라이언트로 만든 어댑터(지연 생성) |
| `src/lib/erp/orders/store.ts` | DB: 리스팅·옛 상품 색인 읽기 · 기초 시각·스위치·커서 · 라인 upsert · 사라진 라인 취소 |
| `src/lib/erp/orders/legacy-store.ts` | `sale_records` upsert·무효화 |
| `src/lib/erp/orders/deduct.ts` | 차감 실행(행 잠금·SKU 잠금·savepoint) · 소급 미리보기 · 스위치 켜기 |
| `src/lib/erp/orders/collect.ts` | 채널 수집 한 번(잠금 → 가져오기 → 한 트랜잭션) · 전 채널 |
| `src/lib/erp/orders/queries.ts` | 수집 현황 · 날짜별 라인 · 날짜×채널 건수 |
| `src/lib/listing/naver-commerce-client.ts` (수정) | 원 칸 살리기 · `getLastChangedStatuses` · `queryProductOrders` |
| `src/lib/listing/toss-shopping-client.ts` (수정) | `productId`·`stockId` · `getOrdersPage` · 본문 로그 제거 |
| `src/lib/cost-management/sale-shipping.ts` (수정) | 배송비 소스 `'toss'` |
| `src/app/api/cron/orders-sync/route.ts` | 15분 수집(Bearer · `withJobRun` · 텔레그램 · `?dryRun` · `?channel`) |
| `supabase/migrations/118_pg_cron_orders_sync.sql` | pg_cron 15분(108 방식) — 적용은 Task 9 |
| `src/app/api/erp/orders/status/route.ts` | GET 수집 현황 |
| `src/app/api/erp/orders/lines/route.ts` | GET 채널·날짜 라인 목록 |
| `src/app/api/erp/orders/deduct-preview/route.ts` | GET 소급 미리보기 |
| `src/app/api/erp/orders/deduct-enable/route.ts` | POST 차감 켜기(확인 수 대조 · 소급) |
| `src/app/api/erp/orders/sync/route.ts` | POST 지금 수집(화면 버튼 · 옛 불러오기 대체) |
| `src/components/erp/stock/OrdersSyncPanel.tsx` | 수집 현황 패널 |
| `src/components/erp/stock/OrderLinesDialog.tsx` | 그날 라인 목록 창 |
| `src/components/erp/stock/DeductEnableDialog.tsx` | 「차감 켜기…」 확인 창 |
| `src/components/erp/stock/api.ts` (수정) · `StockClient.tsx` (수정) | 호출 · 패널 배치 |
| `src/components/orders/import-summary.ts` (수정) · `CostManagementTab.tsx` (수정) · `SaleEntryPanel.tsx` (수정) | 옛 버튼 → 새 수집 |
| `src/app/api/cost-management/{rg,wing,naver}-bulk-import/route.ts` · `products/[id]/coupang-import/route.ts` (수정) | 410 |
| `scripts/erp/orders-selftest.ts` | 운영 DB 자가시험(ROLLBACK만) |
| `scripts/erp/orders-daily-counts.ts` | 게이트 ① 날짜×채널 건수표(읽기 전용) |
| `src/__tests__/fixtures/orders/*.json` | 녹화 응답(가짜 구매자) |
| `src/__tests__/lib/erp/orders/*.test.ts` · `src/__tests__/api/{cron-orders-sync,erp-orders}.test.ts` · `src/__tests__/components/erp-orders-sync-panel.test.tsx` | 아래 각 Task |

---
### Task 0: 기준선

- [ ] **Step 1: 기준선 측정**

Run: `npx vitest run 2>&1 | tail -6` 그리고 `npx tsc --noEmit`
Expected: `Tests  N failed | M passed` 형태. **N을 이 계획서 끝 「실행 기록」의 「기준선」 줄에 적는다**(예: `vitest 실패 13 · tsc 0`). tsc가 0 오류가 아니면 멈추고 보고한다.

- [ ] **Step 2: 운영 사실 재확인** (읽기 전용 — 계획 작성 뒤 바뀌었는지)

```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();await c.query('BEGIN READ ONLY');
console.log((await c.query(\"select name, cursor_at from erp.sync_cursors order by 1\")).rows);
console.log((await c.query(\"select to_regclass('erp.orders') o, to_regclass('erp.order_lines') l, to_regclass('erp.settings') s\")).rows[0]);
console.log((await c.query(\"select channel, link_mode, count(*)::int from erp.channel_listings where active group by 1,2 order by 1,2\")).rows);
await c.query('ROLLBACK');await c.end()})()"
```
Expected: `ledger_cutover` 2026-09-26T11:07:04.989Z 한 줄(다른 `orders:*` 커서 없음) · `{ o: null, l: null, s: null }` · 리스팅에 `bundle`이 없다. 🔴 `bundle`이 생겼거나 표가 이미 있으면 멈추고 보고한다.

---

### Task 1: 마이그레이션 117 — 주문·주문라인·설정

**Files:**
- Create: `supabase/migrations/117_erp_orders.sql`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- 117_erp_orders.sql
-- ERP 1-C2a. 채널 주문 수집(쿠팡 판매자배송·쿠팡 RG·네이버·토스)과 판매 차감 상태.
-- 🔴 구매자 개인정보(이름·전화·주소·이메일·배송메모)는 두지 않는다 — 어댑터가 버린다. 송장은 로지아이, 재고·매출에는 필요 없다.
--
-- erp.orders       주문 한 건(채널 · 외부 주문번호). status는 라인 상태가 모두 같으면 그 값, 섞이면 'mixed'
-- erp.order_lines  채널의 주문 품목 한 줄(외부 라인 키로 유일). 수집할 때마다 upsert — 원래 상태 문자열(raw_status)을 남긴다
--   alloc      리스팅 → SKU 연결 결과 [{skuId, qty}](qty = 주문 수량 × 배수, SKU 오름차순). 미귀속이면 []
--   sku_id     alloc이 SKU 하나일 때만(조회 편의). bundle 라인은 null
--   posted     실제로 원장에서 뺀 것 [{skuId, qty, idemKey}]. 역전표를 쓰면 []로 돌아간다
--   ledger_version  지금까지 차감한 횟수. 멱등키 sale:<channel>:<라인키>:s<skuId>, 두 번째부터 @n
--   deduction_state pending(켜지면 뺀다) · posted · skipped_short(재고 부족 — 다음 수집에서 다시) · reversed(취소·반품으로 되돌림) · none(대상 아님)
--   legacy_*   옛 장부(sale_records) 연결: 키(채널별 통일) · 고른 product_cost · 수량 · 행 id
-- erp.settings     이름 하나 = 행 하나. deduct_enabled = {"enabled": bool, "enabledAt"?, "by"?}
-- 채널 수집 커서는 erp.sync_cursors의 'orders:<channel>' 행(수집기가 처음 성공할 때 만든다).

create table if not exists erp.orders (
  id                 bigserial   primary key,
  channel            text        not null check (channel in ('coupang_wing', 'coupang_rg', 'naver', 'toss')),
  external_order_id  text        not null,
  ordered_at         timestamptz not null,
  paid_at            timestamptz,
  status             text        not null check (status in (
                       'unpaid', 'paid', 'shipping', 'delivered', 'confirmed', 'cancel_requested', 'canceled',
                       'return_requested', 'returned', 'exchange', 'unknown', 'mixed')),
  raw_status         text        not null,
  first_seen_at      timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (channel, external_order_id)
);

create table if not exists erp.order_lines (
  id                      bigserial   primary key,
  order_id                bigint      not null references erp.orders(id),
  channel                 text        not null check (channel in ('coupang_wing', 'coupang_rg', 'naver', 'toss')),
  external_line_id        text        not null check (external_line_id ~ '^[0-9A-Za-z_-]+(:[0-9A-Za-z_-]+)*$'),
  listing_id              bigint      references erp.channel_listings(id),
  sku_id                  bigint      references erp.skus(id),
  alloc                   jsonb       not null default '[]'::jsonb,
  attribution             text        not null check (attribution in ('mapped', 'unattributed')),
  unattributed_reason     text        check (unattributed_reason in ('no_listing', 'any_of', 'option_unmatched', 'no_sku_link')),
  order_qty               integer     not null check (order_qty > 0),
  sku_qty                 integer     not null default 0 check (sku_qty >= 0),
  unit_price              integer     not null default 0,
  amount                  integer     not null default 0,
  status                  text        not null check (status in (
                            'unpaid', 'paid', 'shipping', 'delivered', 'confirmed', 'cancel_requested', 'canceled',
                            'return_requested', 'returned', 'exchange', 'unknown')),
  raw_status              text        not null,
  ordered_at              timestamptz not null,
  paid_at                 timestamptz,
  product_id              text        not null default '',
  option_key              text        not null default '',
  alt_product_id          text,
  product_label           text        not null default '',
  deduction_state         text        not null default 'none'
                            check (deduction_state in ('pending', 'posted', 'skipped_short', 'reversed', 'none')),
  deduction_note          text,
  ledger_version          integer     not null default 0 check (ledger_version >= 0),
  posted                  jsonb       not null default '[]'::jsonb,
  deducted_at             timestamptz,
  legacy_key              text,
  legacy_product_cost_id  uuid,
  legacy_qty              integer,
  legacy_sale_id          uuid,
  first_seen_at           timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (channel, external_line_id),
  constraint order_lines_alloc_chk check (jsonb_typeof(alloc) = 'array' and jsonb_typeof(posted) = 'array'),
  constraint order_lines_attribution_chk check ((attribution = 'mapped') = (jsonb_array_length(alloc) > 0)),
  constraint order_lines_reason_chk check ((attribution = 'unattributed') = (unattributed_reason is not null)),
  constraint order_lines_posted_chk check ((deduction_state = 'posted') = (jsonb_array_length(posted) > 0)),
  constraint order_lines_single_sku_chk check (sku_id is null or jsonb_array_length(alloc) = 1)
);

create index if not exists order_lines_order_idx on erp.order_lines (order_id);
create index if not exists order_lines_channel_ordered_idx on erp.order_lines (channel, ordered_at desc);
create index if not exists order_lines_channel_paid_idx on erp.order_lines (channel, paid_at);
create index if not exists order_lines_open_idx on erp.order_lines (deduction_state) where deduction_state in ('pending', 'skipped_short');
create index if not exists order_lines_sku_idx on erp.order_lines (sku_id);
create index if not exists order_lines_legacy_key_idx on erp.order_lines (legacy_key);

create table if not exists erp.settings (
  name        text        primary key,
  value       jsonb       not null,
  updated_at  timestamptz not null default now()
);

insert into erp.settings (name, value) values ('deduct_enabled', '{"enabled": false}'::jsonb)
on conflict (name) do nothing;

alter table erp.orders      enable row level security;
alter table erp.order_lines enable row level security;
alter table erp.settings    enable row level security;

comment on table erp.order_lines is '채널 주문 품목. 구매자 개인정보 없음. 1-C2a';
comment on column erp.order_lines.alloc is '[{skuId, qty}] — 리스팅 연결 결과. qty = 주문 수량 × listing_skus.multiplier';
comment on column erp.order_lines.posted is '[{skuId, qty, idemKey}] — 원장에서 실제로 뺀 것';
```

- [ ] **Step 2: 적용**

Run: `node scripts/apply-migration.mjs 117`
Expected: `✅ 117_erp_orders.sql`, exit 0

- [ ] **Step 3: 확인** (읽기 전용)

```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
console.log((await c.query(\"select conname from pg_constraint where conrelid='erp.order_lines'::regclass and contype in ('c','u') order by 1\")).rows.map(r=>r.conname).join(' '));
console.log((await c.query(\"select name, value from erp.settings\")).rows);
console.log((await c.query(\"select relname, relrowsecurity from pg_class where oid in ('erp.orders'::regclass,'erp.order_lines'::regclass,'erp.settings'::regclass)\")).rows);await c.end()})()"
```
Expected: 제약에 `order_lines_alloc_chk`·`order_lines_attribution_chk`·`order_lines_posted_chk`·`order_lines_reason_chk`·`order_lines_single_sku_chk`·`order_lines_channel_external_line_id_key` · 설정 `[{ name: 'deduct_enabled', value: { enabled: false } }]` · 세 표 모두 `relrowsecurity: true`.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/117_erp_orders.sql
git commit -m "feat(erp): 마이그레이션 117 — 주문·주문라인·설정(deduct_enabled)"
```

---

### Task 2: 순수 로직 — 표준 라인 · 상태 · 연결 · 키 · 차감 판정 · 구간 · 옛 장부 계획

**Files:**
- Create: `src/lib/erp/orders/types.ts`, `status.ts`, `keys.ts`, `resolve.ts`, `deduct-plan.ts`, `window.ts`, `legacy.ts`
- Modify: `src/lib/cost-management/sale-shipping.ts`
- Test: `src/__tests__/lib/erp/orders/status.test.ts`, `keys.test.ts`, `resolve.test.ts`, `deduct-plan.test.ts`, `window.test.ts`, `legacy.test.ts`

#### 2-A. 타입 · 상태 · 키

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/erp/orders/status.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { naverStatus, tossStatus, wingStatus } from '@/lib/erp/orders/status';
import { SOLD, VOID } from '@/lib/erp/orders/types';

describe('표준 상태', () => {
  it('쿠팡 판매자배송: 발주서 상태 → 표준, 품목 취소·남은 수량 0은 canceled, 모르는 값은 unknown', () => {
    expect(wingStatus('ACCEPT', { shippingCount: 1 })).toBe('paid');
    expect(wingStatus('INSTRUCT', { shippingCount: 1 })).toBe('paid');
    expect(wingStatus('DEPARTURE', { shippingCount: 1 })).toBe('shipping');
    expect(wingStatus('NONE_TRACKING', { shippingCount: 1 })).toBe('shipping');
    expect(wingStatus('FINAL_DELIVERY', { shippingCount: 1 })).toBe('delivered');
    expect(wingStatus('ACCEPT', { shippingCount: 2, canceled: true })).toBe('canceled');
    expect(wingStatus('INSTRUCT', { shippingCount: 2, cancelCount: 2 })).toBe('canceled');
    expect(wingStatus('INSTRUCT', { shippingCount: 2, cancelCount: 1 })).toBe('paid');
    expect(wingStatus('SOMETHING_NEW', { shippingCount: 1 })).toBe('unknown');
  });

  it('네이버: 상품주문 상태 + 진행 중 취소·반품 요청', () => {
    expect(naverStatus('PAYMENT_WAITING', null, null)).toBe('unpaid');
    expect(naverStatus('PAYED', null, null)).toBe('paid');
    expect(naverStatus('DELIVERING', null, null)).toBe('shipping');
    expect(naverStatus('PURCHASE_DECIDED', null, null)).toBe('confirmed');
    expect(naverStatus('PAYED', 'CANCEL', 'CANCEL_REQUEST')).toBe('cancel_requested');
    expect(naverStatus('PAYED', 'CANCEL', 'CANCEL_REJECT')).toBe('paid');
    expect(naverStatus('DELIVERED', 'RETURN', 'COLLECTING')).toBe('return_requested');
    expect(naverStatus('CANCELED', 'CANCEL', 'CANCEL_DONE')).toBe('canceled');
    expect(naverStatus('RETURNED', 'RETURN', 'RETURN_DONE')).toBe('returned');
    expect(naverStatus('CANCELED_BY_NOPAYMENT', null, null)).toBe('canceled');
    expect(naverStatus('WHAT', null, null)).toBe('unknown');
  });

  it('토스: 주문상품 상태 20종', () => {
    expect(tossStatus('BEFORE_PAYMENT')).toBe('unpaid');
    expect(tossStatus('PAID')).toBe('paid');
    expect(tossStatus('PREPARING_PRODUCT')).toBe('paid');
    expect(tossStatus('DELAY_SHIPPING')).toBe('paid');
    expect(tossStatus('DELIVERING')).toBe('shipping');
    expect(tossStatus('CONFIRMED_ORDER')).toBe('confirmed');
    expect(tossStatus('CLAIM_REQUESTED_CANCEL')).toBe('cancel_requested');
    expect(tossStatus('CLAIM_REJECTED_CANCEL')).toBe('paid');
    expect(tossStatus('CANCELED_PAYMENT')).toBe('canceled');
    expect(tossStatus('ONGOING_RETURN')).toBe('return_requested');
    expect(tossStatus('CLAIM_COLLECTED')).toBe('return_requested');
    expect(tossStatus('COMPLETED_RETURN')).toBe('returned');
    expect(tossStatus('CLAIM_REJECTED_RETURN')).toBe('delivered');
    expect(tossStatus('COMPLETED_EXCHANGE')).toBe('exchange');
    expect(tossStatus('NEW_ONE')).toBe('unknown');
  });

  it('팔림·무효 집합은 겹치지 않고 unknown은 어디에도 없다', () => {
    for (const s of SOLD) expect(VOID.has(s)).toBe(false);
    expect(SOLD.has('unknown')).toBe(false);
    expect(VOID.has('unknown')).toBe(false);
    expect([...SOLD].sort()).toEqual(['cancel_requested', 'confirmed', 'delivered', 'exchange', 'paid', 'return_requested', 'shipping']);
    expect([...VOID].sort()).toEqual(['canceled', 'returned', 'unpaid']);
  });
});
```

`src/__tests__/lib/erp/orders/keys.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { assertExternalId, bareWingKey, legacyKeyOf, saleIdemKey } from '@/lib/erp/orders/keys';
import { assertIdemKey } from '@/lib/erp/ledger/plan';

describe('판매 멱등키', () => {
  it('sale:<channel>:<lineKey>:s<skuId>, 두 번째부터 @n — assertIdemKey를 통과한다', () => {
    const k1 = saleIdemKey('coupang_wing', '6200000001:70000000001', 7, 1);
    expect(k1).toBe('sale:coupang_wing:6200000001:70000000001:s7');
    expect(saleIdemKey('naver', '2026092611111111', 12, 2)).toBe('sale:naver:2026092611111111:s12@2');
    expect(() => assertIdemKey(k1)).not.toThrow();
    expect(() => assertIdemKey(saleIdemKey('toss', '9001', 3, 3))).not.toThrow();
  });

  it('SKU가 다르면 키가 다르고, 한 키가 다른 키의 # 접두가 되지 않는다', () => {
    const a = saleIdemKey('toss', '9001', 7, 1);
    const b = saleIdemKey('toss', '9001', 71, 1);
    expect(a).not.toBe(b);
    expect(b.startsWith(`${a}#`)).toBe(false);
    expect(saleIdemKey('toss', '9001', 7, 2).startsWith(`${a}#`)).toBe(false);
  });

  it('라인 키에 #·@·공백·빈 값은 거부한다', () => {
    expect(() => saleIdemKey('naver', 'a#1', 1, 1)).toThrow(RangeError);
    expect(() => saleIdemKey('naver', 'a@1', 1, 1)).toThrow(RangeError);
    expect(() => saleIdemKey('naver', 'a 1', 1, 1)).toThrow(RangeError);
    expect(() => assertExternalId('', '주문번호')).toThrow(RangeError);
    expect(() => saleIdemKey('naver', '1', 0, 1)).toThrow(RangeError);
    expect(() => saleIdemKey('naver', '1', 1, 0)).toThrow(RangeError);
  });
});

describe('옛 장부 키', () => {
  it('채널별로 옛 불러오기와 같은 키를 쓴다', () => {
    expect(legacyKeyOf({ channel: 'coupang_wing', externalOrderId: '31000000001', externalLineId: '6200000001:70000000001', productId: '70000000001' }))
      .toBe('wing-31000000001-70000000001');
    expect(legacyKeyOf({ channel: 'coupang_rg', externalOrderId: '41000000001', externalLineId: '41000000001:80000000001', productId: '80000000001' }))
      .toBe('rg-41000000001-80000000001');
    expect(legacyKeyOf({ channel: 'naver', externalOrderId: 'o1', externalLineId: '2026092611111111', productId: '1' })).toBe('naver-2026092611111111');
    expect(legacyKeyOf({ channel: 'toss', externalOrderId: '1', externalLineId: '9001', productId: '1' })).toBe('toss-9001');
  });

  it('Wing 키의 무접두 짝(상품별 불러오기가 남긴 키)', () => {
    expect(bareWingKey('wing-31000000001-70000000001')).toBe('31000000001-70000000001');
    expect(bareWingKey('rg-1-2')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/status.test.ts src/__tests__/lib/erp/orders/keys.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/erp/orders/status"`

- [ ] **Step 3: 구현**

`src/lib/cost-management/sale-shipping.ts`의
```ts
/** 배송비 산정 대상 임포트 소스 */
export type ShippingSource = 'wing' | 'rg' | 'naver';

/**
 * 임포트 소스별 건당 배송비.
 * 윙·네이버(판매자 택배) = 기본 택배비, RG(로켓그로스) = 0 (unit_rg_shipping_fee로 별도 반영).
 */
```
를 아래로 바꾼다(함수 본문은 그대로 — RG만 0이다).
```ts
/** 배송비 산정 대상 임포트 소스 */
export type ShippingSource = 'wing' | 'rg' | 'naver' | 'toss';

/**
 * 임포트 소스별 건당 배송비.
 * 윙·네이버·토스(판매자 택배) = 기본 택배비, RG(로켓그로스) = 0 (unit_rg_shipping_fee로 별도 반영).
 */
```

`src/lib/erp/orders/types.ts`:
```ts
// src/lib/erp/orders/types.ts
// 주문 수집의 공용 타입. 채널 어댑터는 응답을 OrderLine으로 옮기면서 구매자 칸을 버린다 — 이 타입에 개인정보 칸은 없다.
import type { Location } from '@/lib/erp/ledger/fifo';

export const ORDER_CHANNELS = ['coupang_wing', 'coupang_rg', 'naver', 'toss'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const CHANNEL_LABEL: Record<OrderChannel, string> = {
  coupang_wing: '쿠팡 판매자배송',
  coupang_rg: '쿠팡 RG',
  naver: '네이버',
  toss: '토스',
};

export const isOrderChannel = (v: unknown): v is OrderChannel =>
  typeof v === 'string' && (ORDER_CHANNELS as readonly string[]).includes(v);

export const STD_STATUSES = [
  'unpaid', 'paid', 'shipping', 'delivered', 'confirmed', 'cancel_requested', 'canceled',
  'return_requested', 'returned', 'exchange', 'unknown',
] as const;
export type StdStatus = (typeof STD_STATUSES)[number];

/** 팔림 — 결제됐고 취소·반품이 끝나지 않았다. 이 상태의 라인만 원장에서 뺀다(요청 중은 물건이 아직 안 돌아왔다) */
export const SOLD: ReadonlySet<StdStatus> = new Set<StdStatus>([
  'paid', 'shipping', 'delivered', 'confirmed', 'cancel_requested', 'return_requested', 'exchange',
]);
/** 무효 — 뺀 것이 있으면 역전표로 되돌린다. unknown은 어느 쪽도 아니다(지금 상태 유지) */
export const VOID: ReadonlySet<StdStatus> = new Set<StdStatus>(['unpaid', 'canceled', 'returned']);

/** 판매를 빼는 원장 위치: RG 주문은 RG, 나머지는 집 */
export const locationOf = (ch: OrderChannel): Location => (ch === 'coupang_rg' ? 'rg' : 'self');

export interface OrderLine {
  channel: OrderChannel;
  externalOrderId: string;
  /** 채널 안에서 유일한 라인 키 — 쿠팡 판매자배송 shipmentBoxId:vendorItemId · RG orderId:vendorItemId · 네이버 productOrderId · 토스 orderProductId */
  externalLineId: string;
  /** UTC ISO */
  orderedAt: string;
  /** UTC ISO. 결제 전이면 null */
  paidAt: string | null;
  rawStatus: string;
  status: StdStatus;
  /** 리스팅을 찾는 상품 키 — 쿠팡 vendorItemId · 네이버 원상품번호 · 토스 상품 ID */
  productId: string;
  /** 네이버 optionCode('' = 없음) · 토스 옵션명 · 쿠팡 '' */
  optionKey: string;
  /** 쿠팡 sellerProductId · 네이버 채널상품번호 · 토스 stockId — 옛 장부 연결·진단용 */
  altProductId: string | null;
  /** 상품명 · 옵션명(개인정보 아님) */
  productLabel: string;
  /** 채널 판매 단위 수량(> 0) */
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface FetchWindow {
  from: Date;
  to: Date;
}

export interface FetchResult {
  lines: OrderLine[];
  /** API가 실제로 거른 구간과 기준 칸([from, to), UTC ISO). 사라진 라인 판정에만 쓴다 */
  cover: { field: 'ordered_at' | 'paid_at'; from: string; to: string } | null;
  /** 응답에서 사라진 라인 = 취소(쿠팡 판매자배송·RG). 어댑터는 한 페이지라도 실패하면 던진다 — 여기 오면 끝까지 받은 것이다 */
  absenceMeansCancel: boolean;
}

export interface OrderAdapter {
  channel: OrderChannel;
  /** 커서와 별개로 매번 다시 읽는 최소 일수 — 주문일·결제일로 거르는 API는 늦은 취소를 48시간 겹침으로 못 잡는다 */
  tailDays: number;
  fetch(w: FetchWindow): Promise<FetchResult>;
}
```

`src/lib/erp/orders/status.ts`:
```ts
// src/lib/erp/orders/status.ts
// 채널 상태 문자열 → 표준 상태. 모르는 값은 'unknown' — 수집기는 기존 상태를 유지하고 unknown_status로 센다.
import type { StdStatus } from './types';

const WING: Record<string, StdStatus> = {
  ACCEPT: 'paid', INSTRUCT: 'paid',
  DEPARTURE: 'shipping', DELIVERING: 'shipping', NONE_TRACKING: 'shipping',
  FINAL_DELIVERY: 'delivered',
};

/** 쿠팡 발주서 상태 + 품목 취소. 남은 수량(shippingCount − cancelCount)이 0 이하면 취소 */
export function wingStatus(sheetStatus: string, item: { canceled?: boolean; shippingCount: number; cancelCount?: number }): StdStatus {
  if (item.canceled === true || item.shippingCount - (item.cancelCount ?? 0) <= 0) return 'canceled';
  return WING[sheetStatus] ?? 'unknown';
}

const NAVER: Record<string, StdStatus> = {
  PAYMENT_WAITING: 'unpaid', PAYED: 'paid', DELIVERING: 'shipping', DELIVERED: 'delivered', PURCHASE_DECIDED: 'confirmed',
  EXCHANGED: 'exchange', CANCELED: 'canceled', RETURNED: 'returned', CANCELED_BY_NOPAYMENT: 'canceled',
};
const NAVER_CANCEL_OPEN = new Set(['CANCEL_REQUEST', 'CANCELING']);
const NAVER_RETURN_OPEN = new Set(['RETURN_REQUEST', 'COLLECTING', 'COLLECT_DONE']);

/** 네이버 상품주문 상태 + 진행 중 클레임. 끝난 취소·반품은 상품주문 상태 자체가 CANCELED·RETURNED가 된다 */
export function naverStatus(productOrderStatus: string, claimType: string | null, claimStatus: string | null): StdStatus {
  const base = NAVER[productOrderStatus] ?? 'unknown';
  if (base === 'paid' || base === 'shipping' || base === 'delivered') {
    if (claimType === 'CANCEL' && claimStatus !== null && NAVER_CANCEL_OPEN.has(claimStatus)) return 'cancel_requested';
    if (claimType === 'RETURN' && claimStatus !== null && NAVER_RETURN_OPEN.has(claimStatus)) return 'return_requested';
  }
  return base;
}

// 토스 주문 v2 orderProductStatus 20종(공식 문서 GetOrderHistoriesCursorResponse) + 도착보장의 DELAY_SHIPPING
const TOSS: Record<string, StdStatus> = {
  BEFORE_PAYMENT: 'unpaid',
  PAID: 'paid', PREPARING_PRODUCT: 'paid', DELAY_SHIPPING: 'paid', CLAIM_REJECTED_CANCEL: 'paid',
  DELIVERING: 'shipping',
  DELIVERED: 'delivered', CLAIM_REJECTED_RETURN: 'delivered',
  CONFIRMED_ORDER: 'confirmed',
  CLAIM_REQUESTED_CANCEL: 'cancel_requested',
  CANCELED_PAYMENT: 'canceled',
  REQUESTED_RETURN: 'return_requested', ONGOING_RETURN: 'return_requested',
  CLAIM_COLLECTING: 'return_requested', CLAIM_COLLECTED: 'return_requested', CLAIM_DELIVERING: 'return_requested',
  COMPLETED_RETURN: 'returned',
  REQUESTED_EXCHANGE: 'exchange', ONGOING_EXCHANGE: 'exchange', COMPLETED_EXCHANGE: 'exchange', CLAIM_REJECTED_EXCHANGE: 'exchange',
};

export const tossStatus = (s: string): StdStatus => TOSS[s] ?? 'unknown';
```

`src/lib/erp/orders/keys.ts`:
```ts
// src/lib/erp/orders/keys.ts
// 외부 id 검사 · 판매 멱등키 · 옛 장부(sale_records) 키.
import { assertIdemKey } from '@/lib/erp/ledger/plan';
import type { ShippingSource } from '@/lib/cost-management/sale-shipping';
import type { OrderChannel } from './types';

// 라인 키는 멱등키 안에 들어간다: '#'(전표 순번)·'@'(차감 버전)·공백이 섞이면 다른 전표와 키가 겹친다. DB check와 같은 식
const EXT_ID = /^[0-9A-Za-z_-]+(:[0-9A-Za-z_-]+)*$/;

export function assertExternalId(v: string, what: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 120 || !EXT_ID.test(v)) {
    throw new RangeError(`${what}가 잘못됐다: ${String(v)}`);
  }
  return v;
}

/** 판매 차감 멱등키. SKU를 붙인다 — postConsume·reverse는 SKU 하나 단위라 bundle 라인의 SKU마다 키가 달라야 한다 */
export function saleIdemKey(channel: OrderChannel, externalLineId: string, skuId: number, version: number): string {
  assertExternalId(externalLineId, '라인 키');
  if (!Number.isInteger(skuId) || skuId <= 0) throw new RangeError(`skuId가 잘못됐다: ${skuId}`);
  if (!Number.isInteger(version) || version < 1) throw new RangeError(`차감 버전은 1 이상이다: ${version}`);
  const k = `sale:${channel}:${externalLineId}:s${skuId}${version >= 2 ? `@${version}` : ''}`;
  assertIdemKey(k);
  return k;
}

/** 옛 장부 키 — 옛 불러오기 버튼과 같은 형식이라 과거 행과 겹쳐도 두 번 세지 않는다 */
export function legacyKeyOf(l: { channel: OrderChannel; externalOrderId: string; externalLineId: string; productId: string }): string {
  switch (l.channel) {
    case 'coupang_wing':
      return `wing-${l.externalOrderId}-${l.productId}`;
    case 'coupang_rg':
      return `rg-${l.externalOrderId}-${l.productId}`;
    case 'naver':
      return `naver-${l.externalLineId}`;
    case 'toss':
      return `toss-${l.externalLineId}`;
  }
}

/** sale_records.channel */
export const LEGACY_CHANNEL: Record<OrderChannel, string> = {
  coupang_wing: 'coupang',
  coupang_rg: 'rocket_growth',
  naver: 'naver',
  toss: 'toss',
};

/** sale_records.shipping_fee 산정 소스(resolveSaleShippingFee) */
export const SHIPPING_SOURCE: Record<OrderChannel, ShippingSource> = {
  coupang_wing: 'wing',
  coupang_rg: 'rg',
  naver: 'naver',
  toss: 'toss',
};

/** 상품별 불러오기(coupang-import)가 남긴 무접두 Wing 키 `<orderId>-<vid>` — 새 키를 쓸 때 무효화한다(판매자배송 이중 기록 제거) */
export const bareWingKey = (legacyKey: string): string | null => (legacyKey.startsWith('wing-') ? legacyKey.slice('wing-'.length) : null);
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/status.test.ts src/__tests__/lib/erp/orders/keys.test.ts`
Expected: PASS(9 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/erp/orders/types.ts src/lib/erp/orders/status.ts src/lib/erp/orders/keys.ts src/lib/cost-management/sale-shipping.ts src/__tests__/lib/erp/orders/status.test.ts src/__tests__/lib/erp/orders/keys.test.ts
git commit -m "feat(erp): 주문 표준 라인·상태·판매 멱등키·옛 장부 키"
```

#### 2-B. 리스팅 → SKU 연결

- [ ] **Step 6: 실패하는 테스트 작성**

`src/__tests__/lib/erp/orders/resolve.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ListingIndex, normalizeOption, resolveLine, type ListingEntry } from '@/lib/erp/orders/resolve';
import type { OrderLine } from '@/lib/erp/orders/types';

const line = (o: Partial<OrderLine>): OrderLine => ({
  channel: 'coupang_wing', externalOrderId: '1', externalLineId: '1:70', orderedAt: '2026-09-27T01:00:00.000Z', paidAt: '2026-09-27T01:00:00.000Z',
  rawStatus: 'ACCEPT', status: 'paid', productId: '70', optionKey: '', altProductId: null, productLabel: 'x', qty: 2, unitPrice: 1000, amount: 2000, ...o,
});
const L = (o: Partial<ListingEntry>): ListingEntry => ({ listingId: 1, channel: 'coupang_wing', productId: '70', optionKey: '', linkMode: 'single', skus: [{ skuId: 7, multiplier: 1 }], ...o });

describe('resolveLine', () => {
  it('single: 수량 × 배수로 SKU 하나', () => {
    const idx = new ListingIndex([L({ skus: [{ skuId: 7, multiplier: 3 }] })]);
    expect(resolveLine(line({}), idx)).toEqual({
      listingId: 1, attribution: 'mapped', reason: null, alloc: [{ skuId: 7, qty: 6 }], listingSkus: [{ skuId: 7, multiplier: 3 }],
    });
  });

  it('bundle: 구성 SKU마다(SKU 오름차순) 수량 × 각 배수', () => {
    const idx = new ListingIndex([L({ linkMode: 'bundle', skus: [{ skuId: 9, multiplier: 2 }, { skuId: 4, multiplier: 1 }] })]);
    expect(resolveLine(line({ qty: 3 }), idx).alloc).toEqual([{ skuId: 4, qty: 3 }, { skuId: 9, qty: 6 }]);
  });

  it('any_of(또는 SKU 여럿인 single)는 미귀속 any_of — 판매 SKU를 가를 수 없다', () => {
    const two = [{ skuId: 4, multiplier: 1 }, { skuId: 9, multiplier: 1 }];
    expect(resolveLine(line({}), new ListingIndex([L({ linkMode: 'any_of', skus: two })]))).toMatchObject({ attribution: 'unattributed', reason: 'any_of', alloc: [], listingId: 1 });
    expect(resolveLine(line({}), new ListingIndex([L({ linkMode: 'single', skus: two })])).reason).toBe('any_of');
  });

  it('리스팅이 없으면 no_listing, SKU 연결이 없으면 no_sku_link', () => {
    expect(resolveLine(line({ productId: '99' }), new ListingIndex([L({})])).reason).toBe('no_listing');
    expect(resolveLine(line({ productId: '' }), new ListingIndex([L({})])).reason).toBe('no_listing');
    expect(resolveLine(line({}), new ListingIndex([L({ skus: [] })])).reason).toBe('no_sku_link');
  });

  it('채널이 다르면 같은 상품 키라도 찾지 않는다(Wing vid ≠ RG vid)', () => {
    expect(resolveLine(line({ channel: 'coupang_rg' }), new ListingIndex([L({})])).reason).toBe('no_listing');
  });

  it('네이버: (원상품번호, optionCode) → 없으면 그 상품의 유일한 리스팅 → 아니면 option_unmatched', () => {
    const idx = new ListingIndex([
      L({ listingId: 10, channel: 'naver', productId: '500', optionKey: '111', skus: [{ skuId: 1, multiplier: 1 }] }),
      L({ listingId: 11, channel: 'naver', productId: '500', optionKey: '112', skus: [{ skuId: 2, multiplier: 1 }] }),
      L({ listingId: 12, channel: 'naver', productId: '600', optionKey: '', skus: [{ skuId: 3, multiplier: 2 }] }),
    ]);
    const nv = (productId: string, optionKey: string) => line({ channel: 'naver', productId, optionKey, qty: 1 });
    expect(resolveLine(nv('500', '112'), idx)).toMatchObject({ listingId: 11, alloc: [{ skuId: 2, qty: 1 }] });
    expect(resolveLine(nv('600', ''), idx)).toMatchObject({ listingId: 12, alloc: [{ skuId: 3, qty: 2 }] });
    expect(resolveLine(nv('600', '999'), idx)).toMatchObject({ listingId: 12 });
    expect(resolveLine(nv('500', '999'), idx).reason).toBe('option_unmatched');
  });

  it('토스: 정확 일치 → 옵션명 정규화 일치 → 유일한 리스팅 → option_unmatched', () => {
    const idx = new ListingIndex([
      L({ listingId: 20, channel: 'toss', productId: '800', optionKey: '블랙 / L', skus: [{ skuId: 5, multiplier: 1 }] }),
      L({ listingId: 21, channel: 'toss', productId: '800', optionKey: '화이트 / L', skus: [{ skuId: 6, multiplier: 1 }] }),
    ]);
    const tv = (optionKey: string) => line({ channel: 'toss', productId: '800', optionKey, qty: 1 });
    expect(resolveLine(tv('블랙 / L'), idx).listingId).toBe(20);
    expect(resolveLine(tv('색상: 화이트 / 사이즈: L'), idx).listingId).toBe(21);
    expect(resolveLine(tv('화이트/L'), idx).listingId).toBe(21);
    expect(resolveLine(tv('그레이 / L'), idx).reason).toBe('option_unmatched');
  });

  it('옵션명 정규화: 칸마다 「이름:」 접두와 공백을 뗀다', () => {
    expect(normalizeOption('색상: 블랙 / 사이즈: 105(L)')).toBe('블랙/105(L)');
    expect(normalizeOption('블랙 / 105(L)')).toBe('블랙/105(L)');
    expect(normalizeOption('')).toBe('');
  });
});
```

- [ ] **Step 7: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/resolve.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/erp/orders/resolve"`

- [ ] **Step 8: 구현**

`src/lib/erp/orders/resolve.ts`:
```ts
// src/lib/erp/orders/resolve.ts
// 주문 라인 → 리스팅(erp.channel_listings) → SKU·수량. link_mode(110):
//   single = SKU 하나 · bundle = 연결된 SKU 전부를 각 배수만큼 · any_of = 그중 하나(주문만으로 못 가른다 → 미귀속, 1-C2b 대기열)
import type { OrderChannel, OrderLine } from './types';

export type LinkMode = 'single' | 'bundle' | 'any_of';

export interface ListingEntry {
  listingId: number;
  channel: OrderChannel;
  /** channel_listings.external_product_id */
  productId: string;
  /** channel_listings.external_option_key('' = 옵션 없음) */
  optionKey: string;
  linkMode: LinkMode;
  skus: { skuId: number; multiplier: number }[];
}

export type UnattributedReason = 'no_listing' | 'any_of' | 'option_unmatched' | 'no_sku_link';

export interface AllocItem {
  skuId: number;
  /** SKU 기준 단위 수량 = 주문 수량 × 배수 */
  qty: number;
}

export interface Resolution {
  listingId: number | null;
  attribution: 'mapped' | 'unattributed';
  reason: UnattributedReason | null;
  /** mapped일 때만. SKU 오름차순 */
  alloc: AllocItem[];
  /** 찾은 리스팅의 SKU 연결(미귀속이어도) — 옛 장부 product_cost 고르기에 쓴다 */
  listingSkus: { skuId: number; multiplier: number }[];
}

/** 토스 옵션명 비교용: '/'로 나눈 칸마다 「이름:」 접두와 공백을 뗀다. '색상: 블랙 / 사이즈: L' → '블랙/L' */
export function normalizeOption(s: string): string {
  return s
    .split('/')
    .map((seg) => seg.replace(/^[^:：]*[:：]/, '').replace(/\s+/g, ''))
    .filter((x) => x !== '')
    .join('/');
}

export class ListingIndex {
  private readonly exactMap = new Map<string, ListingEntry>();
  private readonly byProduct = new Map<string, ListingEntry[]>();

  constructor(entries: ListingEntry[]) {
    for (const e of entries) {
      this.exactMap.set(`${e.channel}|${e.productId}|${e.optionKey}`, e);
      const k = `${e.channel}|${e.productId}`;
      const list = this.byProduct.get(k) ?? [];
      list.push(e);
      this.byProduct.set(k, list);
    }
  }

  exact(ch: OrderChannel, productId: string, optionKey: string): ListingEntry | null {
    return this.exactMap.get(`${ch}|${productId}|${optionKey}`) ?? null;
  }

  ofProduct(ch: OrderChannel, productId: string): ListingEntry[] {
    return this.byProduct.get(`${ch}|${productId}`) ?? [];
  }
}

function findListing(l: OrderLine, idx: ListingIndex): { entry: ListingEntry | null; reason: UnattributedReason | null } {
  if (l.productId === '') return { entry: null, reason: 'no_listing' };
  const all = idx.ofProduct(l.channel, l.productId);
  if (all.length === 0) return { entry: null, reason: 'no_listing' };
  const exact = idx.exact(l.channel, l.productId, l.optionKey);
  if (exact) return { entry: exact, reason: null };
  if (l.channel === 'toss') {
    const want = normalizeOption(l.optionKey);
    const norm = all.filter((e) => normalizeOption(e.optionKey) === want);
    if (norm.length === 1) return { entry: norm[0], reason: null };
  }
  // 그 상품의 리스팅이 하나뿐이면 옵션 표기가 달라도 그것이다(네이버 단일상품 · 토스 옵션 하나)
  if (all.length === 1) return { entry: all[0], reason: null };
  return { entry: null, reason: 'option_unmatched' };
}

export function resolveLine(l: OrderLine, idx: ListingIndex): Resolution {
  const { entry, reason } = findListing(l, idx);
  if (!entry) return { listingId: null, attribution: 'unattributed', reason: reason ?? 'no_listing', alloc: [], listingSkus: [] };
  const skus = [...entry.skus].sort((a, b) => a.skuId - b.skuId);
  const base = { listingId: entry.listingId, listingSkus: skus };
  if (skus.length === 0) return { ...base, attribution: 'unattributed', reason: 'no_sku_link', alloc: [] };
  // single인데 SKU가 여럿이면 적재 규칙(draft.ts)상 any_of다 — 뺄 SKU를 고를 수 없다
  if (entry.linkMode === 'any_of' || (entry.linkMode === 'single' && skus.length > 1)) {
    return { ...base, attribution: 'unattributed', reason: 'any_of', alloc: [] };
  }
  return { ...base, attribution: 'mapped', reason: null, alloc: skus.map((s) => ({ skuId: s.skuId, qty: l.qty * s.multiplier })) };
}
```

- [ ] **Step 9: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/resolve.test.ts`
Expected: PASS(8 tests)

- [ ] **Step 10: 커밋**

```bash
git add src/lib/erp/orders/resolve.ts src/__tests__/lib/erp/orders/resolve.test.ts
git commit -m "feat(erp): 주문 라인 → 리스팅·SKU 연결(single·bundle·any_of)"
```

#### 2-C. 차감 판정표

- [ ] **Step 11: 실패하는 테스트 작성**

`src/__tests__/lib/erp/orders/deduct-plan.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { decideDeduction, type DeductInput } from '@/lib/erp/orders/deduct-plan';

const CUT = '2026-09-26T11:07:04.989Z';
const base = (o: Partial<DeductInput> = {}): DeductInput => ({
  channel: 'naver', externalLineId: '2026092611111111', status: 'paid', attribution: 'mapped',
  alloc: [{ skuId: 7, qty: 2 }], paidAt: '2026-09-27T01:00:00.000Z', state: 'none', version: 0, posted: [], ...o,
});
const ON = { enabled: true, cutover: CUT };
const OFF = { enabled: false, cutover: CUT };
const K1 = 'sale:naver:2026092611111111:s7';

describe('decideDeduction', () => {
  it('켜짐 + 팔림 + 연결됨 + 기초 이후 → 첫 차감(버전 1)', () => {
    expect(decideDeduction(base(), ON)).toEqual({
      reverse: [], post: { version: 1, items: [{ skuId: 7, qty: 2, idemKey: K1 }] }, state: 'posted', note: null,
    });
  });

  it('꺼짐이면 같은 라인은 pending(기록만)', () => {
    expect(decideDeduction(base(), OFF)).toEqual({ reverse: [], post: null, state: 'pending', note: null });
  });

  it('재고 부족으로 건너뛴 라인은 다음에 같은 버전으로 다시 시도한다', () => {
    expect(decideDeduction(base({ state: 'skipped_short' }), ON).post).toEqual({ version: 1, items: [{ skuId: 7, qty: 2, idemKey: K1 }] });
  });

  it('차감 대상이 아닌 이유를 남긴다: 기초 이전 · 미결제 · 미귀속 · 무효', () => {
    expect(decideDeduction(base({ paidAt: '2026-09-26T11:00:00.000Z' }), ON)).toEqual({ reverse: [], post: null, state: 'none', note: 'pre_cutover' });
    expect(decideDeduction(base({ paidAt: null }), ON).note).toBe('not_paid');
    expect(decideDeduction(base({ status: 'unpaid' }), ON).note).toBe('not_paid');
    expect(decideDeduction(base({ attribution: 'unattributed', alloc: [] }), ON).note).toBe('unattributed');
    expect(decideDeduction(base({ status: 'canceled' }), ON).note).toBe('voided');
  });

  it('뺀 라인이 취소되면 역전표만, 상태 reversed', () => {
    const posted = [{ skuId: 7, qty: 2, idemKey: K1 }];
    expect(decideDeduction(base({ status: 'canceled', state: 'posted', version: 1, posted }), ON))
      .toEqual({ reverse: [K1], post: null, state: 'reversed', note: 'voided' });
  });

  it('되돌린 라인이 다시 팔림이면 @2로 새로 뺀다', () => {
    expect(decideDeduction(base({ state: 'reversed', version: 1 }), ON).post)
      .toEqual({ version: 2, items: [{ skuId: 7, qty: 2, idemKey: `${K1}@2` }] });
  });

  it('뺀 수량·SKU가 바뀌면(부분 취소·연결 변경) 되돌리고 다음 버전으로 다시 뺀다', () => {
    const posted = [{ skuId: 7, qty: 2, idemKey: K1 }];
    expect(decideDeduction(base({ alloc: [{ skuId: 7, qty: 1 }], state: 'posted', version: 1, posted }), ON))
      .toEqual({ reverse: [K1], post: { version: 2, items: [{ skuId: 7, qty: 1, idemKey: `${K1}@2` }] }, state: 'posted', note: null });
  });

  it('뺀 것과 같으면 아무것도 하지 않는다', () => {
    const posted = [{ skuId: 7, qty: 2, idemKey: K1 }];
    expect(decideDeduction(base({ status: 'delivered', state: 'posted', version: 1, posted }), ON))
      .toEqual({ reverse: [], post: null, state: 'posted', note: null });
  });

  it('unknown 상태는 지금 상태를 그대로 둔다(뺀 것을 되돌리지 않는다)', () => {
    const posted = [{ skuId: 7, qty: 2, idemKey: K1 }];
    expect(decideDeduction(base({ status: 'unknown', state: 'posted', version: 1, posted }), ON))
      .toEqual({ reverse: [], post: null, state: 'posted', note: 'unknown_status' });
  });

  it('bundle 라인은 SKU마다 키 하나', () => {
    const p = decideDeduction(base({ channel: 'toss', externalLineId: '9001', alloc: [{ skuId: 4, qty: 1 }, { skuId: 9, qty: 2 }] }), ON);
    expect(p.post?.items.map((i) => i.idemKey)).toEqual(['sale:toss:9001:s4', 'sale:toss:9001:s9']);
  });

  it('되돌린 뒤 여전히 무효면 reversed를 유지한다(none으로 떨어지지 않는다)', () => {
    expect(decideDeduction(base({ status: 'returned', state: 'reversed', version: 1 }), ON).state).toBe('reversed');
  });
});
```

- [ ] **Step 12: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/deduct-plan.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/erp/orders/deduct-plan"`

- [ ] **Step 13: 구현**

`src/lib/erp/orders/deduct-plan.ts`:
```ts
// src/lib/erp/orders/deduct-plan.ts
// 차감 판정표(순수). 라인 하나의 지금 상태와 「뺀 것(posted)」을 보고 이번에 할 일을 정한다 — DB는 deduct.ts가 쓴다.
//   대상 = 팔림(SOLD) · 연결됨(mapped) · 결제 시각이 기초재고 시각 이후
//   뺀 것 = 대상 alloc이면 그대로, 다르면(취소·부분 취소·연결 변경) 역전표 → (대상이면) 다음 버전으로 다시 뺀다
//   unknown 상태는 아무것도 바꾸지 않는다
import type { AllocItem } from './resolve';
import { saleIdemKey } from './keys';
import { SOLD, type OrderChannel, type StdStatus } from './types';

export type DeductionState = 'pending' | 'posted' | 'skipped_short' | 'reversed' | 'none';
export type DeductNote = 'pre_cutover' | 'not_paid' | 'voided' | 'unattributed' | 'unknown_status';

export interface PostedItem {
  skuId: number;
  qty: number;
  idemKey: string;
}

export interface DeductInput {
  channel: OrderChannel;
  externalLineId: string;
  status: StdStatus;
  attribution: 'mapped' | 'unattributed';
  alloc: AllocItem[];
  paidAt: string | null;
  state: DeductionState;
  /** 지금까지 차감한 횟수 */
  version: number;
  posted: PostedItem[];
}

export interface DeductPlan {
  /** 되돌릴 원 멱등키(뺀 순서대로) */
  reverse: string[];
  post: { version: number; items: PostedItem[] } | null;
  /** 성공했을 때의 상태. post가 재고 부족이면 실행기가 skipped_short로 바꾼다 */
  state: DeductionState;
  note: DeductNote | null;
}

function notTargetReason(l: DeductInput, cutover: string): DeductNote | null {
  if (l.status === 'unpaid') return 'not_paid';
  if (!SOLD.has(l.status)) return 'voided';
  if (l.attribution !== 'mapped' || l.alloc.length === 0) return 'unattributed';
  if (l.paidAt === null) return 'not_paid';
  if (Date.parse(l.paidAt) < Date.parse(cutover)) return 'pre_cutover';
  return null;
}

const sig = (items: { skuId: number; qty: number }[]) =>
  [...items].sort((a, b) => a.skuId - b.skuId).map((i) => `${i.skuId}x${i.qty}`).join(',');

function build(l: DeductInput, version: number): { version: number; items: PostedItem[] } {
  return {
    version,
    items: [...l.alloc]
      .sort((a, b) => a.skuId - b.skuId)
      .map((a) => ({ skuId: a.skuId, qty: a.qty, idemKey: saleIdemKey(l.channel, l.externalLineId, a.skuId, version) })),
  };
}

export function decideDeduction(l: DeductInput, ctx: { enabled: boolean; cutover: string }): DeductPlan {
  if (l.status === 'unknown') return { reverse: [], post: null, state: l.state, note: 'unknown_status' };
  const note = notTargetReason(l, ctx.cutover);
  const target = note === null;

  if (l.state === 'posted') {
    if (target && sig(l.posted) === sig(l.alloc)) return { reverse: [], post: null, state: 'posted', note: null };
    const reverse = l.posted.map((p) => p.idemKey);
    if (!target) return { reverse, post: null, state: 'reversed', note };
    if (!ctx.enabled) return { reverse, post: null, state: 'pending', note: null };
    return { reverse, post: build(l, l.version + 1), state: 'posted', note: null };
  }

  if (!target) return { reverse: [], post: null, state: l.state === 'reversed' ? 'reversed' : 'none', note };
  if (!ctx.enabled) return { reverse: [], post: null, state: 'pending', note: null };
  return { reverse: [], post: build(l, l.version + 1), state: 'posted', note: null };
}
```

- [ ] **Step 14: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/deduct-plan.test.ts`
Expected: PASS(11 tests)

- [ ] **Step 15: 커밋**

```bash
git add src/lib/erp/orders/deduct-plan.ts src/__tests__/lib/erp/orders/deduct-plan.test.ts
git commit -m "feat(erp): 판매 차감 판정표 — 기록 모드·소급·역전표·@n 재차감"
```

#### 2-D. 수집 구간 · 시각

- [ ] **Step 16: 실패하는 테스트 작성**

`src/__tests__/lib/erp/orders/window.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { addDays, dayChunks, hourChunks, isoFromChannel, kstDay, kstDayStart, kstIso, windowFor } from '@/lib/erp/orders/window';

const CUT = '2026-09-26T11:07:04.989Z';
const H = 3600_000;

describe('windowFor', () => {
  it('첫 실행(커서 없음)은 기초재고 시각부터', () => {
    const now = new Date('2026-09-27T00:00:00.000Z');
    expect(windowFor({ cursor: null, cutover: CUT, now, tailDays: 7 })).toEqual({ from: new Date(CUT), to: now });
  });

  it('커서에서 48시간 겹친다(기초 시각보다 앞으로는 가지 않는다)', () => {
    const now = new Date('2026-10-10T00:00:00.000Z');
    const w = windowFor({ cursor: '2026-10-09T23:45:00.000Z', cutover: CUT, now, tailDays: 0 });
    expect(w.from.toISOString()).toBe(new Date(Date.parse('2026-10-09T23:45:00.000Z') - 48 * H).toISOString());
    expect(windowFor({ cursor: '2026-09-27T00:00:00.000Z', cutover: CUT, now, tailDays: 0 }).from.toISOString()).toBe(CUT);
  });

  it('꼬리일수가 겹침보다 길면 꼬리일수만큼 읽는다(늦은 취소)', () => {
    const now = new Date('2026-10-10T00:00:00.000Z');
    const w = windowFor({ cursor: '2026-10-09T23:45:00.000Z', cutover: CUT, now, tailDays: 7 });
    expect(w.from.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });
});

describe('KST 날짜·시각', () => {
  it('kstDay / kstDayStart / addDays', () => {
    expect(kstDay(new Date('2026-09-26T15:30:00.000Z'))).toBe('2026-09-27');
    expect(kstDayStart('2026-09-27').toISOString()).toBe('2026-09-26T15:00:00.000Z');
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('kstIso는 +09:00 표기, isoFromChannel은 오프셋 없는 채널 시각을 KST로 읽는다', () => {
    expect(kstIso(new Date('2026-09-26T15:00:00.000Z'))).toBe('2026-09-27T00:00:00.000+09:00');
    expect(isoFromChannel('2026-09-27T09:10:11')).toBe('2026-09-27T00:10:11.000Z');
    expect(isoFromChannel('2026-09-27 09:10:11')).toBe('2026-09-27T00:10:11.000Z');
    expect(isoFromChannel('2026-09-27T09:10:11.000+09:00')).toBe('2026-09-27T00:10:11.000Z');
    expect(isoFromChannel('2026-09-27T00:10:11Z')).toBe('2026-09-27T00:10:11.000Z');
    expect(() => isoFromChannel('어제')).toThrow(RangeError);
  });

  it('dayChunks는 시작·끝 포함 maxDays씩', () => {
    expect(dayChunks('2026-09-01', '2026-10-05', 30)).toEqual([
      { from: '2026-09-01', to: '2026-09-30' }, { from: '2026-10-01', to: '2026-10-05' },
    ]);
    expect(dayChunks('2026-09-27', '2026-09-27', 29)).toEqual([{ from: '2026-09-27', to: '2026-09-27' }]);
  });

  it('hourChunks는 24시간 미만 조각으로 빈틈없이 잇는다', () => {
    const from = new Date('2026-09-26T11:07:04.989Z');
    const to = new Date('2026-09-28T12:00:00.000Z');
    const cs = hourChunks({ from, to });
    expect(cs[0].from).toEqual(from);
    expect(cs[cs.length - 1].to).toEqual(to);
    for (let i = 1; i < cs.length; i++) expect(cs[i].from).toEqual(cs[i - 1].to);
    for (const c of cs) expect(c.to.getTime() - c.from.getTime()).toBeLessThan(24 * H);
  });
});
```

- [ ] **Step 17: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/window.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/erp/orders/window"`

- [ ] **Step 18: 구현**

`src/lib/erp/orders/window.ts`:
```ts
// src/lib/erp/orders/window.ts
// 수집 구간과 KST 날짜·시각 도우미. 채널 API는 KST 날짜(쿠팡·토스)나 +09:00 시각(네이버)으로 거른다.
import { kstDate } from '@/lib/erp/stock/count-queue';
import type { FetchWindow } from './types';

export const OVERLAP_MS = 48 * 3600_000;
const DAY_MS = 86_400_000;
const KST_MS = 9 * 3600_000;

/** Date·ISO → KST 날짜 YYYY-MM-DD */
export const kstDay = (v: Date | string): string => kstDate(v);

/** KST 날짜의 0시 */
export const kstDayStart = (day: string): Date => new Date(`${day}T00:00:00+09:00`);

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** [from, to] 날짜(둘 다 포함)를 maxDays일씩 */
export function dayChunks(from: string, to: string, maxDays: number): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (let cur = from; cur <= to; ) {
    const end = addDays(cur, maxDays - 1) < to ? addDays(cur, maxDays - 1) : to;
    out.push({ from: cur, to: end });
    cur = addDays(end, 1);
  }
  return out;
}

/** '2026-09-27T00:00:00.000+09:00' 형식(네이버 변경 조회 파라미터) */
export function kstIso(d: Date): string {
  return new Date(d.getTime() + KST_MS).toISOString().replace('Z', '+09:00');
}

/** 채널 시각 문자열 → UTC ISO. 오프셋이 없으면 KST로 읽는다(쿠팡·토스는 KST 현지 시각을 준다) */
export function isoFromChannel(s: string): string {
  const v = String(s ?? '').trim().replace(' ', 'T');
  const t = /([zZ]|[+-]\d{2}:?\d{2})$/.test(v) ? Date.parse(v) : Date.parse(`${v}+09:00`);
  if (!v || Number.isNaN(t)) throw new RangeError(`시각을 읽을 수 없다: ${s}`);
  return new Date(t).toISOString();
}

/**
 * 이번 수집 구간. 시작 = max(기초 시각, min(커서 − 48h, 지금 − 꼬리일수)). 끝 = 지금.
 * 첫 실행(커서 없음)은 기초 시각부터.
 */
export function windowFor(p: { cursor: string | null; cutover: string; now: Date; tailDays: number }): FetchWindow {
  const cut = Date.parse(p.cutover);
  const now = p.now.getTime();
  const fromCursor = p.cursor === null ? cut : Date.parse(p.cursor) - OVERLAP_MS;
  const fromTail = now - p.tailDays * DAY_MS;
  return { from: new Date(Math.max(cut, Math.min(fromCursor, fromTail))), to: new Date(now) };
}

/** [from, to)를 24시간 미만 조각으로 빈틈없이(네이버 변경 조회는 한 번에 24시간까지) */
export function hourChunks(w: FetchWindow, spanMs = DAY_MS - 1000): FetchWindow[] {
  const out: FetchWindow[] = [];
  for (let t = w.from.getTime(); t < w.to.getTime(); t += spanMs) {
    out.push({ from: new Date(t), to: new Date(Math.min(t + spanMs, w.to.getTime())) });
  }
  return out;
}
```

- [ ] **Step 19: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/window.test.ts`
Expected: PASS(7 tests)

- [ ] **Step 20: 커밋**

```bash
git add src/lib/erp/orders/window.ts src/__tests__/lib/erp/orders/window.test.ts
git commit -m "feat(erp): 주문 수집 구간(48시간 겹침·꼬리일수)·KST 도우미"
```

#### 2-E. 옛 장부 계획

- [ ] **Step 21: 실패하는 테스트 작성**

`src/__tests__/lib/erp/orders/legacy.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { pickLegacy, planLegacy, type LegacyIndex, type LegacyLine } from '@/lib/erp/orders/legacy';
import type { Resolution } from '@/lib/erp/orders/resolve';
import type { OrderLine } from '@/lib/erp/orders/types';

const PC_A = '00000000-0000-4000-8000-00000000000a';
const PC_B = '00000000-0000-4000-8000-00000000000b';
const PC_C = '00000000-0000-4000-8000-00000000000c';
const idx = (o: Partial<LegacyIndex> = {}): LegacyIndex => ({
  skuLegacy: new Map([[7, [PC_A, PC_B]], [9, [PC_C]]]),
  pcc: new Map([['coupang_wing:70', [{ productCostId: PC_B, multiplier: 2 }]]]),
  pcByVendorItem: new Map(),
  pcByNaverChannelNo: new Map([['555', PC_C]]),
  ...o,
});
const line = (o: Partial<OrderLine>): OrderLine => ({
  channel: 'coupang_wing', externalOrderId: '1', externalLineId: '1:70', orderedAt: '2026-09-27T01:00:00.000Z', paidAt: '2026-09-27T01:00:00.000Z',
  rawStatus: 'ACCEPT', status: 'paid', productId: '70', optionKey: '', altProductId: null, productLabel: 'x', qty: 2, unitPrice: 1000, amount: 2000, ...o,
});
const mapped = (alloc: { skuId: number; qty: number }[], listingSkus = alloc.map((a) => ({ skuId: a.skuId, multiplier: 1 }))): Resolution =>
  ({ listingId: 1, attribution: 'mapped', reason: null, alloc, listingSkus });
const none: Resolution = { listingId: null, attribution: 'unattributed', reason: 'no_listing', alloc: [], listingSkus: [] };

describe('pickLegacy', () => {
  it('SKU의 옛 상품 중 리스팅과 맞는 것(쿠팡 product_cost_channels)을 고르고 수량은 SKU 수량', () => {
    expect(pickLegacy(line({}), mapped([{ skuId: 7, qty: 4 }]), idx())).toEqual({ productCostId: PC_B, qty: 4 });
  });

  it('맞는 것이 없으면 SKU의 첫 옛 상품', () => {
    expect(pickLegacy(line({ productId: '71' }), mapped([{ skuId: 7, qty: 2 }]), idx())).toEqual({ productCostId: PC_A, qty: 2 });
  });

  it('미귀속(any_of)이면 리스팅 SKU들로 고르고 수량 = 주문 수량 × 가장 작은 배수', () => {
    const r: Resolution = { listingId: 3, attribution: 'unattributed', reason: 'any_of', alloc: [], listingSkus: [{ skuId: 9, multiplier: 2 }, { skuId: 7, multiplier: 3 }] };
    expect(pickLegacy(line({ productId: '99' }), r, idx())).toEqual({ productCostId: PC_A, qty: 4 });
  });

  it('SKU가 없으면 옛 불러오기의 직접 매칭(쿠팡 pcc 배수) → RG vendor_item_id → 네이버 채널상품번호', () => {
    expect(pickLegacy(line({}), none, idx())).toEqual({ productCostId: PC_B, qty: 4 });
    expect(pickLegacy(line({ channel: 'coupang_rg', productId: '80' }), none, idx({ pcByVendorItem: new Map([['80', PC_A]]) })))
      .toEqual({ productCostId: PC_A, qty: 2 });
    expect(pickLegacy(line({ channel: 'naver', productId: '500', altProductId: '555', qty: 1 }), none, idx())).toEqual({ productCostId: PC_C, qty: 1 });
  });

  it('아무것도 없으면 null(옛 장부에 쓰지 않는다)', () => {
    expect(pickLegacy(line({ channel: 'toss', productId: '800' }), none, idx())).toBeNull();
  });
});

const L = (o: Partial<LegacyLine>): LegacyLine => ({
  legacyKey: 'wing-1-70', channel: 'coupang_wing', status: 'paid', orderQty: 1, legacyQty: 2, amount: 1000,
  paidAt: '2026-09-26T16:00:00.000Z', orderedAt: '2026-09-26T16:00:00.000Z', productCostId: PC_A, ...o,
});

describe('planLegacy', () => {
  it('같은 키(분리배송 박스)는 합산, 판매일 = 결제 KST 날짜, 단가 = 금액 ÷ 주문 수량', () => {
    const p = planLegacy([L({}), L({ orderQty: 2, legacyQty: 4, amount: 2000 })]);
    expect(p).toEqual({
      upsert: [{ key: 'wing-1-70', productCostId: PC_A, channel: 'coupang', soldAt: '2026-09-27', quantity: 6, sellingPrice: 1000, saleAmount: 3000, shippingSource: 'wing' }],
      voidKeys: [],
    });
  });

  it('살아 있는 라인이 없고 무효 라인이 있으면 무효화, unknown만 있으면 건드리지 않는다', () => {
    expect(planLegacy([L({ status: 'canceled' })])).toEqual({ upsert: [], voidKeys: ['wing-1-70'] });
    expect(planLegacy([L({ status: 'unknown' })])).toEqual({ upsert: [], voidKeys: [] });
  });

  it('옛 상품을 못 고른 라인은 쓰지 않는다', () => {
    expect(planLegacy([L({ productCostId: null, legacyQty: null })])).toEqual({ upsert: [], voidKeys: [] });
  });

  it('토스·RG·네이버 채널 값과 배송비 소스', () => {
    const p = planLegacy([
      L({ legacyKey: 'toss-9', channel: 'toss' }), L({ legacyKey: 'rg-1-80', channel: 'coupang_rg' }), L({ legacyKey: 'naver-2', channel: 'naver' }),
    ]);
    expect(p.upsert.map((u) => [u.key, u.channel, u.shippingSource])).toEqual([
      ['toss-9', 'toss', 'toss'], ['rg-1-80', 'rocket_growth', 'rg'], ['naver-2', 'naver', 'naver'],
    ]);
  });
});
```

- [ ] **Step 22: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/legacy.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/erp/orders/legacy"`

- [ ] **Step 23: 구현**

`src/lib/erp/orders/legacy.ts`:
```ts
// src/lib/erp/orders/legacy.ts
// 옛 장부(sale_records) — 수익·원가 화면이 버튼 없이 채워지게 수집 라인마다 한 행(키가 같으면 합산).
// product_cost 고르기(설계 해석 #13): 라인 SKU(미귀속이면 리스팅 SKU)의 legacy_product_cost_ids 중 리스팅과 맞는 것 → 첫 값
//   → SKU가 없으면 옛 불러오기의 직접 매칭 → 그래도 없으면 쓰지 않는다.
import type { ShippingSource } from '@/lib/cost-management/sale-shipping';
import { LEGACY_CHANNEL, SHIPPING_SOURCE } from './keys';
import type { Resolution } from './resolve';
import { SOLD, VOID, type OrderChannel, type OrderLine, type StdStatus } from './types';
import { kstDay } from './window';

export interface LegacyIndex {
  /** SKU → legacy_product_cost_ids(순서 유지) */
  skuLegacy: Map<number, string[]>;
  /** `${channel_type}:${external_id}` → product_cost_channels 행들(쿠팡 wing·rg) */
  pcc: Map<string, { productCostId: string; multiplier: number }[]>;
  /** product_costs.vendor_item_id → id(RG 옛 경로) */
  pcByVendorItem: Map<string, string>;
  /** product_costs.naver_channel_product_no → id */
  pcByNaverChannelNo: Map<string, string>;
}

export interface LegacyTarget {
  productCostId: string;
  /** sale_records.quantity(배수 적용) */
  qty: number;
}

function direct(l: OrderLine, idx: LegacyIndex): { productCostId: string; multiplier: number }[] {
  if (l.channel === 'coupang_wing' || l.channel === 'coupang_rg') {
    const rows = [...(idx.pcc.get(`${l.channel}:${l.productId}`) ?? [])];
    const byVid = l.channel === 'coupang_rg' ? idx.pcByVendorItem.get(l.productId) : undefined;
    if (byVid && !rows.some((r) => r.productCostId === byVid)) rows.push({ productCostId: byVid, multiplier: 1 });
    return rows;
  }
  if (l.channel === 'naver' && l.altProductId) {
    const pc = idx.pcByNaverChannelNo.get(l.altProductId);
    return pc ? [{ productCostId: pc, multiplier: 1 }] : [];
  }
  return [];
}

export function pickLegacy(l: OrderLine, r: Resolution, idx: LegacyIndex): LegacyTarget | null {
  const skuIds = (r.alloc.length > 0 ? r.alloc.map((a) => a.skuId) : r.listingSkus.map((s) => s.skuId)).sort((a, b) => a - b);
  const candidates = skuIds.flatMap((s) => idx.skuLegacy.get(s) ?? []);
  const matches = direct(l, idx);
  if (candidates.length > 0) {
    const hit = matches.find((m) => candidates.includes(m.productCostId));
    const qty = r.alloc.length > 0
      ? r.alloc.reduce((s, a) => s + a.qty, 0)
      : l.qty * Math.min(...r.listingSkus.map((s) => s.multiplier));
    return { productCostId: hit ? hit.productCostId : candidates[0], qty };
  }
  if (matches.length > 0) return { productCostId: matches[0].productCostId, qty: l.qty * Math.max(1, matches[0].multiplier) };
  return null;
}

export interface LegacyLine {
  legacyKey: string;
  channel: OrderChannel;
  status: StdStatus;
  orderQty: number;
  legacyQty: number | null;
  amount: number;
  paidAt: string | null;
  orderedAt: string;
  productCostId: string | null;
}

export interface LegacyRow {
  key: string;
  productCostId: string;
  /** sale_records.channel */
  channel: string;
  /** KST YYYY-MM-DD */
  soldAt: string;
  quantity: number;
  sellingPrice: number;
  saleAmount: number;
  shippingSource: ShippingSource;
}

/** 키별로 묶어 쓸 행·무효화할 키를 정한다. 살아 있는 라인 = 팔림 + 옛 상품 있음 + 수량 > 0 */
export function planLegacy(lines: LegacyLine[]): { upsert: LegacyRow[]; voidKeys: string[] } {
  const groups = new Map<string, LegacyLine[]>();
  for (const l of lines) {
    const g = groups.get(l.legacyKey) ?? [];
    g.push(l);
    groups.set(l.legacyKey, g);
  }
  const upsert: LegacyRow[] = [];
  const voidKeys: string[] = [];
  for (const [key, g] of groups) {
    const live = g.filter((l) => SOLD.has(l.status) && l.productCostId !== null && (l.legacyQty ?? 0) > 0);
    if (live.length === 0) {
      if (g.some((l) => VOID.has(l.status))) voidKeys.push(key);
      continue;
    }
    const saleAmount = live.reduce((s, l) => s + l.amount, 0);
    const orderQty = live.reduce((s, l) => s + l.orderQty, 0);
    const first = live[0];
    const soldAtIso = live.map((l) => l.paidAt ?? l.orderedAt).sort()[0];
    upsert.push({
      key,
      productCostId: first.productCostId as string,
      channel: LEGACY_CHANNEL[first.channel],
      soldAt: kstDay(soldAtIso),
      quantity: live.reduce((s, l) => s + (l.legacyQty ?? 0), 0),
      sellingPrice: orderQty > 0 ? Math.round(saleAmount / orderQty) : 0,
      saleAmount,
      shippingSource: SHIPPING_SOURCE[first.channel],
    });
  }
  return { upsert, voidKeys };
}
```

- [ ] **Step 24: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/ && npx tsc --noEmit`
Expected: PASS(6 files) · tsc 0

- [ ] **Step 25: 커밋**

```bash
git add src/lib/erp/orders/legacy.ts src/__tests__/lib/erp/orders/legacy.test.ts
git commit -m "feat(erp): 옛 장부(sale_records) 대상 고르기·키별 합산 계획"
```

---
### Task 3: 채널 어댑터 4종 — 녹화 응답으로 시험

**Files:**
- Modify: `src/lib/listing/naver-commerce-client.ts`, `src/lib/listing/toss-shopping-client.ts`
- Create: `src/lib/erp/orders/adapters/coupang-wing.ts`, `coupang-rg.ts`, `naver.ts`, `toss.ts`, `index.ts`
- Create (fixture): `src/__tests__/fixtures/orders/coupang-wing-ordersheets.json`, `coupang-rg-orders.json`, `naver-last-changed.json`, `naver-product-orders.json`, `toss-orders.json`
- Test: `src/__tests__/lib/erp/orders/_pii.ts`(도우미 — `.test.ts`가 아니라 수집되지 않는다), `src/__tests__/lib/erp/orders/adapters.test.ts`

> 픽스처는 각 클라이언트의 **타입과 공식 문서 형식**대로 손으로 쓴 녹화 응답이다. 구매자 칸은 누가 봐도 가짜인 값만 넣는다 — 어댑터가 버리는지 테스트가 확인한다. 실제 응답 모양이 다르면 Task 9 첫 실행에서 드러난다(드라이런 결과를 컨트롤러가 본다).

#### 3-A. 클라이언트 보강

- [ ] **Step 1: 네이버 클라이언트 — 원 칸 살리기 · 변경 조회 · 상세 조회**

`src/lib/listing/naver-commerce-client.ts`:

(1) 원 응답 타입(69행부터)
```ts
// product-orders/query API 실제 응답 구조 (data 배열의 각 원소)
interface NaverOrderRawItem {
  order: {
    orderId: string;
    orderDate: string;
    ordererName?: string;
    ordererTel?: string;
    paymentDate?: string;
  };
  productOrder: {
    productOrderId: string;
    productName: string;
    productId?: string;
    quantity: number;
```
를 아래로 바꾼다(`export` + 원상품번호·옵션 코드·클레임 칸).
```ts
// product-orders/query API 실제 응답 구조 (data 배열의 각 원소)
// 🔴 order.ordererName·ordererTel·productOrder.shippingAddress는 구매자 개인정보다 — 주문 수집(erp/orders/adapters/naver.ts)은 버린다
export interface NaverOrderRawItem {
  order: {
    orderId: string;
    orderDate: string;
    ordererName?: string;
    ordererTel?: string;
    paymentDate?: string;
  };
  productOrder: {
    productOrderId: string;
    productName: string;
    productId?: string;
    /** 원상품번호(originProductNo) — ERP 리스팅의 external_product_id */
    originalProductId?: string;
    /** 옵션 조합 id — ERP 리스팅의 external_option_key(없으면 단일상품) */
    optionCode?: string;
    claimType?: string;
    claimStatus?: string;
    quantity: number;
```

(2) 정규화 타입 `NaverOrder`의
```ts
  productName: string;
  channelProductNo: number | null;
```
를 아래로 바꾼다.
```ts
  productName: string;
  channelProductNo: number | null;
  /** 원상품번호 — 2026-09-26까지 버려지던 칸(ERP 1-C2a에서 살림) */
  originalProductId?: string | null;
  /** 옵션 조합 id */
  optionCode?: string | null;
```

(3) `normalizeNaverOrder`의
```ts
    channelProductNo: productOrder.productId ? Number(productOrder.productId) || null : null,
```
를 아래로 바꾼다.
```ts
    channelProductNo: productOrder.productId ? Number(productOrder.productId) || null : null,
    originalProductId: productOrder.originalProductId ?? null,
    optionCode: productOrder.optionCode ?? null,
```

(4) `// ─── 정산 조회 ─` 줄 바로 위(`getOrders` 끝난 뒤)에 더한다.
```ts
  /**
   * 변경 상품주문 한 페이지(ERP 주문 수집). lastChangedType을 생략해 모든 변경(결제·발송·취소·반품·교환)을 받는다.
   * from~to는 24시간 이하, +09:00 ISO. 응답 data.more가 있으면 more.moreFrom·moreSequence로 다음 페이지를 부른다.
   * getOrders와 달리 실패를 삼키지 않는다 — 수집기는 「끝까지 받았다」를 믿어야 한다.
   */
  async getLastChangedStatuses(p: { from: string; to: string; moreSequence?: string }): Promise<{
    statuses: { productOrderId: string }[];
    more: { moreFrom: string; moreSequence: string } | null;
  }> {
    const query = new URLSearchParams({ lastChangedFrom: p.from, lastChangedTo: p.to, limitCount: '300' });
    if (p.moreSequence) query.set('moreSequence', p.moreSequence);
    const res = await this.request<{
      data?: { lastChangeStatuses?: { productOrderId: string }[]; more?: { moreFrom: string; moreSequence: string } | null };
    }>('GET', `/external/v1/pay-order/seller/product-orders/last-changed-statuses?${query.toString()}`);
    return { statuses: res.data?.lastChangeStatuses ?? [], more: res.data?.more ?? null };
  }

  /** 상품주문 상세(최대 300건). 응답에는 구매자 정보가 있다 — 호출자가 버린다 */
  async queryProductOrders(productOrderIds: string[]): Promise<NaverOrderRawItem[]> {
    if (productOrderIds.length === 0) return [];
    if (productOrderIds.length > 300) throw new RangeError(`상품주문 상세는 한 번에 300건까지다: ${productOrderIds.length}`);
    const res = await this.request<{ data?: NaverOrderRawItem[] }>(
      'POST',
      '/external/v1/pay-order/seller/product-orders/query',
      { productOrderIds },
    );
    return res.data ?? [];
  }

```

- [ ] **Step 2: 토스 클라이언트 — 상품 ID·재고 ID · 한 페이지 메서드 · 본문 로그 제거**

`src/lib/listing/toss-shopping-client.ts`:

(1) import 줄
```ts
import { proxyFetch } from '@/lib/proxy-fetch';
```
를 아래로 바꾼다.
```ts
import { proxyFetch } from '@/lib/proxy-fetch';
import { maskPII } from '@/lib/jobs/mask';
```

(2) `TossOrder`의
```ts
export interface TossOrder {
  orderId: number;
  orderProductId: number;
  orderedAt: string;
```
를 아래로 바꾼다.
```ts
// 🔴 orderer*·receiver*·address·detailAddress·zipCode·shippingNote는 구매자 개인정보다 — 주문 수집(erp/orders/adapters/toss.ts)은 버린다
export interface TossOrder {
  orderId: number;
  orderProductId: number;
  /** 상품 ID — ERP 리스팅의 external_product_id(공식 문서 GetOrderHistoriesCursorResponse, 필수 칸) */
  productId: number;
  /** 재고 ID(옵션) */
  stockId: number;
  orderedAt: string;
```

(3) `request()` 안의
```ts
    const text = await res.text();
    console.log(`[toss-shopping] GET ${path} → HTTP ${res.status} | ${text.slice(0, 300)}`);

    if (!res.ok) {
      throw new Error(`토스쇼핑 API 오류 (${res.status}): ${text.slice(0, 200)}`);
    }
```
를 아래로 바꾼다(응답 본문에는 구매자 이름·전화가 들어 있다 — 로그에 남기지 않는다).
```ts
    const text = await res.text();
    console.log(`[toss-shopping] GET ${path} → HTTP ${res.status}`);

    if (!res.ok) {
      throw new Error(`토스쇼핑 API 오류 (${res.status}): ${maskPII(text.slice(0, 200))}`);
    }
```

(4) `getOrders` 메서드 전체(`async getOrders(params: {` 부터 그 메서드의 `return allOrders;\n  }` 까지)를 아래 두 메서드로 바꾼다(`getOrders`의 동작 — 20페이지 상한 — 은 그대로).
```ts
  /** 주문 내역 한 페이지. nextCursor가 null이면 마지막 페이지 */
  async getOrdersPage(params: {
    startDate: string; // yyyy-MM-dd
    endDate: string;   // yyyy-MM-dd (startDate로부터 최대 31일)
    status?: string;
    nextCursor?: string;
  }): Promise<{ results: TossOrder[]; nextCursor: string | null }> {
    const queryParams: Record<string, string> = {
      startDate: params.startDate,
      endDate: params.endDate,
      limit: '50',
    };
    if (params.status) queryParams.status = params.status;
    if (params.nextCursor) queryParams.nextCursor = params.nextCursor;

    const res = await this.request<TossOrderListSuccess>('/api/v3/shopping-fep/orders/v2', queryParams);
    if (res.resultType === 'FAIL' || !res.success) {
      const code = res.error?.errorCode ?? 'UNKNOWN';
      const reason = res.error?.reason ?? '알 수 없는 오류';
      throw new Error(`토스쇼핑 주문 조회 실패 (${code}): ${reason}`);
    }
    return { results: res.success.results ?? [], nextCursor: res.success.nextCursor ?? null };
  }

  async getOrders(params: {
    startDate: string; // yyyy-MM-dd
    endDate: string;   // yyyy-MM-dd (startDate로부터 최대 31일)
    /**
     * 대부분의 값이 400(INVALID_REQUEST)이다. 2026-08-11 실측에서 통과한 것은
     * `DELIVERED`뿐이고 PAYMENT_COMPLETED/PREPARING/SHIPPING/CONFIRMED/CANCELED/ALL은
     * 모두 거부됐다. 생략하고 orderProductStatus로 거르는 편이 안전하다.
     */
    status?: string;
  }): Promise<TossOrder[]> {
    const allOrders: TossOrder[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await this.getOrdersPage({ ...params, nextCursor: cursor });
      allOrders.push(...page.results);
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < MAX_PAGES);
    return allOrders;
  }
```

- [ ] **Step 3: 타입과 기존 테스트 확인**

Run: `npx tsc --noEmit && npx vitest run src/__tests__/api/toss-orders.test.ts src/__tests__/api/orders-auth.test.ts`
Expected: tsc 0 · PASS(기존 동작 그대로 — 토스 라우트는 `getOrders`만 부른다)

- [ ] **Step 4: 커밋**

```bash
git add src/lib/listing/naver-commerce-client.ts src/lib/listing/toss-shopping-client.ts
git commit -m "feat(listing): 네이버 원상품번호·옵션 코드·변경 조회(more) · 토스 상품 ID·한 페이지 조회·응답 본문 로그 제거"
```

#### 3-B. 녹화 응답(fixture)

- [ ] **Step 5: 픽스처 5개 작성**

`src/__tests__/fixtures/orders/coupang-wing-ordersheets.json` — 키 `<status>|<nextToken>`(없는 키는 빈 페이지):
```json
{
  "_note": "쿠팡 발주서 조회(v4 ordersheets) 녹화 형식(CoupangOrder 타입). 구매자 칸은 가짜 값 — 어댑터가 버려야 한다",
  "pages": {
    "ACCEPT|": {
      "items": [
        {
          "shipmentBoxId": 6200000001, "orderId": 31000000001,
          "orderedAt": "2026-09-27T10:15:00", "paidAt": "2026-09-27T10:15:30", "status": "ACCEPT",
          "shippingPrice": 0, "remoteArea": false, "parcelPrintMessage": "문 앞에 두세요", "splitShipping": false,
          "orderer": { "name": "테스트구매자", "email": "fake@example.com", "safeNumber": "010-0000-0000" },
          "receiver": { "name": "테스트수령인", "safeNumber": "010-0000-0000", "addr1": "가상시 가상구 1", "addr2": "101호", "postCode": "00000" },
          "orderItems": [
            { "vendorItemPackageName": "", "productId": 1, "vendorItemId": 70000000001, "vendorItemName": "왜건 블랙", "sellerProductId": 16000000001,
              "sellerProductName": "접이식 왜건", "sellerProductItemName": "블랙", "shippingCount": 2, "salesPrice": 15900, "orderPrice": 31800,
              "discountPrice": 0, "cancelCount": 0, "estimatedShippingDate": "2026-09-28", "canceled": false },
            { "vendorItemPackageName": "", "productId": 1, "vendorItemId": 70000000002, "vendorItemName": "왜건 그레이", "sellerProductId": 16000000001,
              "sellerProductName": "접이식 왜건", "sellerProductItemName": "그레이", "shippingCount": 1, "salesPrice": 9900, "orderPrice": 9900,
              "discountPrice": 0, "cancelCount": 1, "estimatedShippingDate": "2026-09-28", "canceled": true }
          ],
          "deliveryCompanyName": "", "invoiceNumber": "", "inTrasitDateTime": "", "deliveredDate": ""
        }
      ],
      "nextToken": "t2"
    },
    "ACCEPT|t2": {
      "items": [
        {
          "shipmentBoxId": 6200000002, "orderId": 31000000002,
          "orderedAt": "2026-09-27T11:00:00", "paidAt": "2026-09-27T11:00:10", "status": "ACCEPT",
          "shippingPrice": 0, "remoteArea": false, "parcelPrintMessage": "", "splitShipping": false,
          "orderer": { "name": "테스트구매자", "email": "fake@example.com", "safeNumber": "010-0000-0000" },
          "receiver": { "name": "테스트수령인", "safeNumber": "010-0000-0000", "addr1": "가상시 가상구 1", "addr2": "101호", "postCode": "00000" },
          "orderItems": [
            { "vendorItemPackageName": "", "productId": 1, "vendorItemId": 70000000001, "vendorItemName": "왜건 블랙", "sellerProductId": 16000000001,
              "sellerProductName": "접이식 왜건", "sellerProductItemName": "블랙", "shippingCount": 3, "salesPrice": 15900, "orderPrice": 47700,
              "discountPrice": 0, "cancelCount": 1, "estimatedShippingDate": "2026-09-28", "canceled": false }
          ],
          "deliveryCompanyName": "", "invoiceNumber": "", "inTrasitDateTime": "", "deliveredDate": ""
        }
      ],
      "nextToken": null
    },
    "FINAL_DELIVERY|": {
      "items": [
        {
          "shipmentBoxId": 6200000003, "orderId": 31000000003,
          "orderedAt": "2026-09-26T21:00:00", "paidAt": null, "status": "FINAL_DELIVERY",
          "shippingPrice": 0, "remoteArea": false, "parcelPrintMessage": "", "splitShipping": false,
          "orderer": { "name": "테스트구매자", "email": "fake@example.com", "safeNumber": "010-0000-0000" },
          "receiver": { "name": "테스트수령인", "safeNumber": "010-0000-0000", "addr1": "가상시 가상구 1", "addr2": "101호", "postCode": "00000" },
          "orderItems": [
            { "vendorItemPackageName": "", "productId": 2, "vendorItemId": 70000000003, "vendorItemName": "쿨매트", "sellerProductId": 16000000002,
              "sellerProductName": "쿨매트", "sellerProductItemName": "", "shippingCount": 1, "salesPrice": 12000, "orderPrice": 12000,
              "discountPrice": 0, "cancelCount": 0, "estimatedShippingDate": "2026-09-27", "canceled": false }
          ],
          "deliveryCompanyName": "CJ대한통운", "invoiceNumber": "000000000000", "inTrasitDateTime": "2026-09-27T09:00:00", "deliveredDate": "2026-09-27T18:00:00"
        }
      ],
      "nextToken": null
    }
  }
}
```

`src/__tests__/fixtures/orders/coupang-rg-orders.json` — 키 `<paidDateFrom>|<paidDateTo>|<nextToken>`(클라이언트 정규화 뒤 모양 — RG 응답에는 구매자 칸이 없다):
```json
{
  "_note": "쿠팡 RG 주문 조회(rg_open_api) — getRocketGrowthOrders 반환 모양. paidAt은 ms 문자열. paidDateTo는 배타 끝",
  "pages": {
    "2026-09-26|2026-09-28|": {
      "items": [
        { "orderId": "41000000001", "paidAt": "1790470800000", "orderItems": [
          { "vendorItemId": 80000000001, "productName": "퓨어틴 커피 330ml 6개입", "salesQuantity": 1, "unitSalesPrice": 21900, "currency": "KRW" },
          { "vendorItemId": 80000000001, "productName": "퓨어틴 커피 330ml 6개입", "salesQuantity": 1, "unitSalesPrice": 21900, "currency": "KRW" },
          { "vendorItemId": 80000000002, "productName": "샘플", "salesQuantity": 0, "unitSalesPrice": 0, "currency": "KRW" }
        ] }
      ],
      "nextToken": "n2"
    },
    "2026-09-26|2026-09-28|n2": {
      "items": [
        { "orderId": "41000000002", "paidAt": "1790476200000", "orderItems": [
          { "vendorItemId": 80000000003, "productName": "니트 건조대 2단", "salesQuantity": 3, "unitSalesPrice": 5000, "currency": "KRW" }
        ] }
      ],
      "nextToken": null
    }
  }
}
```

`src/__tests__/fixtures/orders/naver-last-changed.json` — 키 = 넘긴 `moreSequence`(첫 페이지는 `""`):
```json
{
  "_note": "네이버 변경 상품주문(last-changed-statuses) data 모양. more가 있으면 moreFrom·moreSequence로 다음 페이지",
  "pages": {
    "": {
      "statuses": [{ "productOrderId": "2026092700000001" }, { "productOrderId": "2026092700000002" }],
      "more": { "moreFrom": "2026-09-27T09:00:00.000+09:00", "moreSequence": "0000000002" }
    },
    "0000000002": {
      "statuses": [{ "productOrderId": "2026092700000003" }, { "productOrderId": "2026092700000001" }],
      "more": null
    }
  }
}
```

`src/__tests__/fixtures/orders/naver-product-orders.json`:
```json
{
  "_note": "네이버 상품주문 상세(product-orders/query) data 모양. 구매자 칸은 가짜 값 — 어댑터가 버려야 한다",
  "data": [
    {
      "order": { "orderId": "2026092712340001", "orderDate": "2026-09-27T09:05:00.0+09:00", "paymentDate": "2026-09-27T09:06:00.0+09:00",
                 "ordererName": "테스트구매자", "ordererTel": "010-0000-0000" },
      "productOrder": { "productOrderId": "2026092700000001", "productName": "쿨매트", "productId": "8800000001", "originalProductId": "8700000001",
                        "optionCode": "12345", "productOption": "블루 / S", "quantity": 2, "unitPrice": 12900, "totalPaymentAmount": 25800,
                        "productOrderStatus": "PAYED", "deliveryFeeAmount": 0,
                        "shippingAddress": { "name": "테스트수령인", "tel1": "010-0000-0000", "baseAddress": "가상시 가상구 1", "detailedAddress": "101호", "zipCode": "00000" } },
      "delivery": null, "claim": null
    },
    {
      "order": { "orderId": "2026092712340002", "orderDate": "2026-09-27T10:00:00.0+09:00", "paymentDate": "2026-09-27T10:00:30.0+09:00",
                 "ordererName": "테스트구매자", "ordererTel": "010-0000-0000" },
      "productOrder": { "productOrderId": "2026092700000002", "productName": "파우치", "productId": "8800000002", "originalProductId": "8700000002",
                        "quantity": 1, "totalPaymentAmount": 9900, "productOrderStatus": "CANCELED", "claimType": "CANCEL", "claimStatus": "CANCEL_DONE",
                        "shippingAddress": { "name": "테스트수령인", "tel1": "010-0000-0000", "baseAddress": "가상시 가상구 1", "detailedAddress": "101호", "zipCode": "00000" } },
      "delivery": null, "claim": { "claimStatus": "CANCEL_DONE" }
    },
    {
      "order": { "orderId": "2026092712340003", "orderDate": "2026-09-26T21:00:00.0+09:00", "paymentDate": "2026-09-26T21:01:00.0+09:00",
                 "ordererName": "테스트구매자", "ordererTel": "010-0000-0000" },
      "productOrder": { "productOrderId": "2026092700000003", "productName": "니트 건조대", "productId": "8800000003", "originalProductId": "8700000003",
                        "optionCode": "777", "productOption": "2단", "quantity": 1, "unitPrice": 15000, "totalPaymentAmount": 15000,
                        "productOrderStatus": "DELIVERED", "claimType": "RETURN", "claimStatus": "RETURN_REQUEST",
                        "shippingAddress": { "name": "테스트수령인", "tel1": "010-0000-0000", "baseAddress": "가상시 가상구 1", "detailedAddress": "101호", "zipCode": "00000" } },
      "delivery": { "deliveryCompany": "CJGLS", "trackingNumber": "000000000000", "deliveryStatus": "DELIVERY_COMPLETION" },
      "claim": { "claimStatus": "RETURN_REQUEST" }
    }
  ]
}
```

`src/__tests__/fixtures/orders/toss-orders.json` — 키 = 넘긴 `nextCursor`(첫 페이지 `""`):
```json
{
  "_note": "토스 주문 v2(orders/v2) success 모양(GetOrderHistoriesCursorResponse). 구매자 칸은 가짜 값 — 어댑터가 버려야 한다",
  "pages": {
    "": {
      "results": [
        { "orderId": 5100000001, "orderProductId": 9100000001, "productId": 7700000001, "stockId": 6600000001, "orderedAt": "2026-09-27T10:00:00",
          "ordererName": "테스트구매자", "ordererPhone": "010-0000-0000", "receiverName": "테스트수령인", "receiverPhone": "010-0000-0000",
          "address": "가상시 가상구 1", "detailAddress": "101호", "zipCode": "00000", "shippingNote": "문 앞에 두세요",
          "productName": "극세사 타월", "optionName": "그레이 / 10매", "quantity": 2, "price": 25800, "originPrice": 30000,
          "deliveryCompanyCode": "", "shippingTrackingNumber": "", "deliveryFee": 0, "orderProductStatus": "PAID", "canceledAt": null, "confirmedAt": null },
        { "orderId": 5100000002, "orderProductId": 9100000002, "productId": 7700000002, "stockId": 6600000002, "orderedAt": "2026-09-27T11:00:00",
          "ordererName": "테스트구매자", "ordererPhone": "010-0000-0000", "receiverName": "테스트수령인", "receiverPhone": "010-0000-0000",
          "address": "가상시 가상구 1", "detailAddress": "101호", "zipCode": "00000", "shippingNote": "",
          "productName": "쿨매트", "optionName": "블루 / S", "quantity": 1, "price": 12900, "originPrice": 12900,
          "deliveryCompanyCode": "", "shippingTrackingNumber": "", "deliveryFee": 0, "orderProductStatus": "CANCELED_PAYMENT", "canceledAt": "2026-09-27T11:30:00", "confirmedAt": null }
      ],
      "nextCursor": "c2"
    },
    "c2": {
      "results": [
        { "orderId": 5100000003, "orderProductId": 9100000003, "productId": 7700000001, "stockId": 6600000003, "orderedAt": "2026-09-27T12:00:00",
          "ordererName": "테스트구매자", "ordererPhone": "010-0000-0000", "receiverName": "테스트수령인", "receiverPhone": "010-0000-0000",
          "address": "가상시 가상구 1", "detailAddress": "101호", "zipCode": "00000", "shippingNote": "",
          "productName": "극세사 타월", "optionName": "화이트 / 10매", "quantity": 1, "price": 12900, "originPrice": 15000,
          "deliveryCompanyCode": "", "shippingTrackingNumber": "", "deliveryFee": 0, "orderProductStatus": "BEFORE_PAYMENT", "canceledAt": null, "confirmedAt": null }
      ],
      "nextCursor": null
    }
  }
}
```

#### 3-C. 어댑터

- [ ] **Step 6: 실패하는 테스트 작성**

`src/__tests__/lib/erp/orders/_pii.ts`:
```ts
// 어댑터 테스트 공용: 표준 라인에 구매자 정보가 없고, 정해진 칸 말고는 아무것도 없는지(칸이 늘면 개인정보가 새어 들어올 수 있다)
import { expect } from 'vitest';

// 우편번호 '00000'은 넣지 않는다 — 주문번호(예: 2026092700000001)에 같은 숫자열이 있어 오탐한다
export const FAKE_PII = ['테스트구매자', '테스트수령인', '010-0000-0000', '가상시 가상구', 'fake@example.com', '문 앞에 두세요', '101호'];

export const LINE_KEYS = [
  'altProductId', 'amount', 'channel', 'externalLineId', 'externalOrderId', 'optionKey', 'orderedAt', 'paidAt',
  'productId', 'productLabel', 'qty', 'rawStatus', 'status', 'unitPrice',
].sort();

export function expectNoPII(lines: object[]): void {
  const s = JSON.stringify(lines);
  for (const p of FAKE_PII) expect(s).not.toContain(p);
  for (const l of lines) expect(Object.keys(l).sort()).toEqual(LINE_KEYS);
}
```

`src/__tests__/lib/erp/orders/adapters.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import wingFx from '@/__tests__/fixtures/orders/coupang-wing-ordersheets.json';
import rgFx from '@/__tests__/fixtures/orders/coupang-rg-orders.json';
import nvChangedFx from '@/__tests__/fixtures/orders/naver-last-changed.json';
import nvOrdersFx from '@/__tests__/fixtures/orders/naver-product-orders.json';
import tossFx from '@/__tests__/fixtures/orders/toss-orders.json';
import { createWingAdapter, WING_STATUSES } from '@/lib/erp/orders/adapters/coupang-wing';
import { createRgAdapter } from '@/lib/erp/orders/adapters/coupang-rg';
import { createNaverAdapter } from '@/lib/erp/orders/adapters/naver';
import { createTossAdapter } from '@/lib/erp/orders/adapters/toss';
import { expectNoPII } from './_pii';

const W = { from: new Date('2026-09-26T11:07:04.989Z'), to: new Date('2026-09-27T03:00:00.000Z') };
const EMPTY = { items: [], nextToken: null };

describe('쿠팡 판매자배송 어댑터', () => {
  const pages = wingFx.pages as Record<string, unknown>;
  const getOrders = vi.fn(async (p: { createdAtFrom: string; createdAtTo: string; status?: string; nextToken?: string }) => (pages[`${p.status}|${p.nextToken ?? ''}`] ?? EMPTY) as never);
  const adapter = createWingAdapter({ getOrders });

  it('상태 6종을 날짜 구간으로 끝까지 넘기고 라인 키 = shipmentBoxId:vendorItemId', async () => {
    const r = await adapter.fetch(W);
    expect(getOrders.mock.calls.map((c) => [c[0].status, c[0].nextToken ?? ''])).toEqual([
      ['ACCEPT', ''], ['ACCEPT', 't2'], ...WING_STATUSES.slice(1).map((s) => [s, '']),
    ]);
    for (const [p] of getOrders.mock.calls) expect([p.createdAtFrom, p.createdAtTo]).toEqual(['2026-09-26', '2026-09-27']);
    expect(r.lines.map((l) => [l.externalLineId, l.status, l.qty, l.amount])).toEqual([
      ['6200000001:70000000001', 'paid', 2, 31800],
      ['6200000001:70000000002', 'canceled', 1, 9900],
      ['6200000002:70000000001', 'paid', 2, 31800],
      ['6200000003:70000000003', 'delivered', 1, 12000],
    ]);
    expect(r.lines[0]).toMatchObject({
      channel: 'coupang_wing', externalOrderId: '31000000001', productId: '70000000001', optionKey: '', altProductId: '16000000001',
      orderedAt: '2026-09-27T01:15:00.000Z', paidAt: '2026-09-27T01:15:30.000Z', rawStatus: 'ACCEPT', productLabel: '접이식 왜건 · 블랙', unitPrice: 15900,
    });
    // 결제 시각이 없으면 주문 시각(발주서는 결제완료부터 보인다)
    expect(r.lines[3].paidAt).toBe('2026-09-26T12:00:00.000Z');
    expect(r.lines[1].rawStatus).toBe('ACCEPT/CANCELED');
    expect(r.cover).toEqual({ field: 'ordered_at', from: '2026-09-25T15:00:00.000Z', to: '2026-09-27T15:00:00.000Z' });
    expect(r.absenceMeansCancel).toBe(true);
    expectNoPII(r.lines);
  });

  it('페이지 조회가 실패하면 던진다(일부만 받은 결과를 돌려주지 않는다)', async () => {
    const bad = createWingAdapter({ getOrders: vi.fn(async () => { throw new Error('429'); }) });
    await expect(bad.fetch(W)).rejects.toThrow('429');
  });
});

describe('쿠팡 RG 어댑터', () => {
  const pages = rgFx.pages as Record<string, unknown>;
  const getRocketGrowthOrders = vi.fn(async (p: { paidDateFrom: string; paidDateTo: string; nextToken?: string }) =>
    (pages[`${p.paidDateFrom}|${p.paidDateTo}|${p.nextToken ?? ''}`] ?? EMPTY) as never);
  const adapter = createRgAdapter({ getRocketGrowthOrders });

  it('끝 날짜 포함 — paidDateTo = 마지막 날 + 1(배타), 같은 vid 품목은 합치고 수량 0은 뺀다', async () => {
    const r = await adapter.fetch(W);
    expect(getRocketGrowthOrders.mock.calls.map((c) => [c[0].paidDateFrom, c[0].paidDateTo, c[0].nextToken ?? ''])).toEqual([
      ['2026-09-26', '2026-09-28', ''], ['2026-09-26', '2026-09-28', 'n2'],
    ]);
    expect(r.lines.map((l) => [l.externalLineId, l.qty, l.amount, l.paidAt])).toEqual([
      ['41000000001:80000000001', 2, 43800, '2026-09-27T01:00:00.000Z'],
      ['41000000002:80000000003', 3, 15000, '2026-09-27T02:30:00.000Z'],
    ]);
    expect(r.lines[0]).toMatchObject({ channel: 'coupang_rg', status: 'paid', rawStatus: 'PAID', productId: '80000000001', orderedAt: '2026-09-27T01:00:00.000Z' });
    expect(r.cover).toEqual({ field: 'paid_at', from: '2026-09-25T15:00:00.000Z', to: '2026-09-27T15:00:00.000Z' });
    expect(r.absenceMeansCancel).toBe(true);
    expectNoPII(r.lines);
  });

  it('30일이 넘는 구간은 29일(시작·끝 포함)씩 나눠 각 끝 날짜 + 1을 넘긴다', async () => {
    const f = vi.fn(async (_p: { paidDateFrom: string; paidDateTo: string; nextToken?: string }) => EMPTY as never);
    await createRgAdapter({ getRocketGrowthOrders: f }).fetch({ from: new Date('2026-10-01T00:00:00+09:00'), to: new Date('2026-11-05T12:00:00+09:00') });
    expect(f.mock.calls.map((c) => [c[0].paidDateFrom, c[0].paidDateTo])).toEqual([['2026-10-01', '2026-10-30'], ['2026-10-30', '2026-11-06']]);
  });
});

describe('네이버 어댑터', () => {
  const changed = nvChangedFx.pages as Record<string, { statuses: { productOrderId: string }[]; more: { moreFrom: string; moreSequence: string } | null }>;
  const getLastChangedStatuses = vi.fn(async (p: { from: string; to: string; moreSequence?: string }) => changed[p.moreSequence ?? '']);
  const queryProductOrders = vi.fn(async (ids: string[]) =>
    (nvOrdersFx.data as { productOrder: { productOrderId: string } }[]).filter((d) => ids.includes(d.productOrder.productOrderId)) as never);
  const adapter = createNaverAdapter({ getLastChangedStatuses, queryProductOrders }, { sleepMs: 0 });

  it('변경 조회를 more로 끝까지 넘기고(다음 페이지 시작 = moreFrom) 상세는 한 번에, 원상품번호·옵션 코드를 쓴다', async () => {
    const r = await adapter.fetch(W);
    expect(getLastChangedStatuses.mock.calls.map((c) => c[0])).toEqual([
      { from: '2026-09-26T20:07:04.989+09:00', to: '2026-09-27T12:00:00.000+09:00', moreSequence: undefined },
      { from: '2026-09-27T09:00:00.000+09:00', to: '2026-09-27T12:00:00.000+09:00', moreSequence: '0000000002' },
    ]);
    expect(queryProductOrders).toHaveBeenCalledWith(['2026092700000001', '2026092700000002', '2026092700000003']);
    expect(r.lines.map((l) => [l.externalLineId, l.status, l.productId, l.optionKey, l.altProductId, l.qty, l.amount])).toEqual([
      ['2026092700000001', 'paid', '8700000001', '12345', '8800000001', 2, 25800],
      ['2026092700000002', 'canceled', '8700000002', '', '8800000002', 1, 9900],
      ['2026092700000003', 'return_requested', '8700000003', '777', '8800000003', 1, 15000],
    ]);
    expect(r.lines[0]).toMatchObject({
      externalOrderId: '2026092712340001', orderedAt: '2026-09-27T00:05:00.000Z', paidAt: '2026-09-27T00:06:00.000Z',
      rawStatus: 'PAYED', productLabel: '쿨매트 · 블루 / S', unitPrice: 12900,
    });
    expect(r.lines[1].rawStatus).toBe('CANCELED/CANCEL_DONE');
    expect(r.cover).toBeNull();
    expect(r.absenceMeansCancel).toBe(false);
    expectNoPII(r.lines);
  });

  it('변경 조회가 실패하면 던진다(옛 getOrders처럼 삼키지 않는다)', async () => {
    const bad = createNaverAdapter({ getLastChangedStatuses: vi.fn(async () => { throw new Error('[네이버 API] 500'); }), queryProductOrders }, { sleepMs: 0 });
    await expect(bad.fetch(W)).rejects.toThrow('500');
  });

  it('상세 조회는 300건씩 나눈다', async () => {
    const many = Array.from({ length: 301 }, (_, i) => ({ productOrderId: String(1000 + i) }));
    const q = vi.fn(async (_ids: string[]) => [] as never);
    await createNaverAdapter({ getLastChangedStatuses: vi.fn(async () => ({ statuses: many, more: null })), queryProductOrders: q }, { sleepMs: 0 }).fetch(W);
    expect(q.mock.calls.map((c) => c[0].length)).toEqual([300, 1]);
  });
});

describe('토스 어댑터', () => {
  const pages = tossFx.pages as Record<string, unknown>;
  const getOrdersPage = vi.fn(async (p: { startDate: string; endDate: string; nextCursor?: string }) => pages[p.nextCursor ?? ''] as never);
  const adapter = createTossAdapter({ getOrdersPage });

  it('nextCursor로 끝까지 넘기고 상품 ID·옵션명·재고 ID를 쓴다. 결제 상태면 주문 시각 = 결제 시각', async () => {
    const r = await adapter.fetch(W);
    expect(getOrdersPage.mock.calls.map((c) => [c[0].startDate, c[0].endDate, c[0].nextCursor ?? ''])).toEqual([
      ['2026-09-26', '2026-09-27', ''], ['2026-09-26', '2026-09-27', 'c2'],
    ]);
    expect(r.lines.map((l) => [l.externalLineId, l.status, l.productId, l.optionKey, l.altProductId, l.qty, l.unitPrice, l.amount, l.paidAt])).toEqual([
      ['9100000001', 'paid', '7700000001', '그레이 / 10매', '6600000001', 2, 12900, 25800, '2026-09-27T01:00:00.000Z'],
      ['9100000002', 'canceled', '7700000002', '블루 / S', '6600000002', 1, 12900, 12900, '2026-09-27T02:00:00.000Z'],
      ['9100000003', 'unpaid', '7700000001', '화이트 / 10매', '6600000003', 1, 12900, 12900, null],
    ]);
    expect(r.lines[0]).toMatchObject({ channel: 'toss', externalOrderId: '5100000001', orderedAt: '2026-09-27T01:00:00.000Z', productLabel: '극세사 타월 · 그레이 / 10매' });
    expect(r.absenceMeansCancel).toBe(false);
    expectNoPII(r.lines);
  });

  it('페이지 상한(200)을 넘으면 조용히 자르지 않고 던진다', async () => {
    const endless = vi.fn(async () => ({ results: [], nextCursor: 'again' }) as never);
    await expect(createTossAdapter({ getOrdersPage: endless }).fetch(W)).rejects.toThrow(/200페이지/);
  });
});
```

- [ ] **Step 7: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/adapters.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/erp/orders/adapters/coupang-wing"`

- [ ] **Step 8: 구현**

`src/lib/erp/orders/adapters/coupang-wing.ts`:
```ts
// src/lib/erp/orders/adapters/coupang-wing.ts
// 쿠팡 판매자배송 — 발주서 조회(v4 ordersheets). 상태별로 부르고 nextToken을 끝까지 넘긴다.
// 🔴 orderer·receiver·parcelPrintMessage(구매자 정보)는 옮기지 않는다.
// 취소: 품목 canceled / 남은 수량 0 → canceled. 결제완료 취소처럼 목록에서 사라진 주문은 수집기가 cover 구간의 「사라짐」으로 취소 처리한다
// (absenceMeansCancel). 상태를 진행 순서대로 부르므로, 조회 중 상태가 앞으로 넘어간 주문도 뒤 상태 조회에서 잡힌다.
import type { CoupangClient, CoupangOrder } from '@/lib/listing/coupang-client';
import { assertExternalId } from '../keys';
import { wingStatus } from '../status';
import type { OrderAdapter, OrderLine } from '../types';
import { addDays, dayChunks, isoFromChannel, kstDay, kstDayStart } from '../window';

export const WING_STATUSES = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY', 'NONE_TRACKING'] as const;
const MAX_PAGES = 200;

export type WingClient = Pick<CoupangClient, 'getOrders'>;

export function normalizeWingOrder(o: CoupangOrder): OrderLine[] {
  const orderedAt = isoFromChannel(o.orderedAt);
  // 발주서는 결제완료(ACCEPT)부터 보인다 — 결제 시각이 비어 있으면 주문 시각으로
  const paidAt = o.paidAt ? isoFromChannel(o.paidAt) : orderedAt;
  const out: OrderLine[] = [];
  for (const it of o.orderItems ?? []) {
    const ordered = Number(it.shippingCount) || 0;
    if (ordered <= 0) continue;
    const left = ordered - (Number(it.cancelCount) || 0);
    const qty = left > 0 ? left : ordered;
    out.push({
      channel: 'coupang_wing',
      externalOrderId: assertExternalId(String(o.orderId), '주문번호'),
      externalLineId: assertExternalId(`${o.shipmentBoxId}:${it.vendorItemId}`, '라인 키'),
      orderedAt,
      paidAt,
      rawStatus: it.canceled ? `${o.status}/CANCELED` : o.status,
      status: wingStatus(o.status, { canceled: it.canceled, shippingCount: ordered, cancelCount: Number(it.cancelCount) || 0 }),
      productId: String(it.vendorItemId),
      optionKey: '',
      altProductId: it.sellerProductId ? String(it.sellerProductId) : null,
      productLabel: [it.sellerProductName, it.sellerProductItemName].filter(Boolean).join(' · '),
      qty,
      unitPrice: Number(it.salesPrice) || 0,
      // 발주서에는 품목 실매출이 없다 — 주문 금액을 남은 수량 비율로(설계 해석 #8)
      amount: Math.round(((Number(it.orderPrice) || 0) * qty) / ordered),
    });
  }
  return out;
}

export function createWingAdapter(client: WingClient): OrderAdapter {
  return {
    channel: 'coupang_wing',
    tailDays: 7,
    async fetch(w) {
      const fromDay = kstDay(w.from);
      const toDay = kstDay(w.to);
      const lines = new Map<string, OrderLine>();
      for (const c of dayChunks(fromDay, toDay, 31)) {
        for (const status of WING_STATUSES) {
          let token: string | undefined;
          let pages = 0;
          do {
            const r = await client.getOrders({ createdAtFrom: c.from, createdAtTo: c.to, status, maxPerPage: 50, nextToken: token });
            for (const o of r.items) for (const l of normalizeWingOrder(o)) lines.set(l.externalLineId, l);
            token = r.nextToken ? r.nextToken : undefined;
            if (++pages >= MAX_PAGES && token) throw new Error(`쿠팡 발주서 ${status} ${c.from}~${c.to}: ${MAX_PAGES}페이지를 넘었다`);
          } while (token);
        }
      }
      return {
        lines: [...lines.values()],
        cover: { field: 'ordered_at', from: kstDayStart(fromDay).toISOString(), to: kstDayStart(addDays(toDay, 1)).toISOString() },
        absenceMeansCancel: true,
      };
    },
  };
}
```

`src/lib/erp/orders/adapters/coupang-rg.ts`:
```ts
// src/lib/erp/orders/adapters/coupang-rg.ts
// 쿠팡 RG — 로켓그로스 주문 조회(rg_open_api). paidDateTo는 배타 끝이라 「마지막 날 + 1」을 넘긴다(옛 rg-bulk-import 경계 버그 재발 금지).
// RG API는 취소를 플래그로 주지 않고 응답에서 뺀다 → absenceMeansCancel. 같은 주문의 같은 vid 품목은 합친다(옛 불러오기와 같다).
import type { CoupangClient } from '@/lib/listing/coupang-client';
import { assertExternalId } from '../keys';
import type { OrderAdapter, OrderLine } from '../types';
import { addDays, dayChunks, isoFromChannel, kstDay, kstDayStart } from '../window';

const MAX_PAGES = 200;
/** 한 번에 29일(시작·끝 포함). 배타 끝을 더해도 조회 폭이 30일을 넘지 않는다 */
const CHUNK_DAYS = 29;

export type RgClient = Pick<CoupangClient, 'getRocketGrowthOrders'>;
type RgOrder = Awaited<ReturnType<CoupangClient['getRocketGrowthOrders']>>['items'][number];

function paidIso(v: string): string {
  if (/^\d+$/.test(v)) return new Date(Number(v)).toISOString();
  return isoFromChannel(v);
}

export function normalizeRgOrder(o: RgOrder): OrderLine[] {
  const paidAt = paidIso(o.paidAt);
  const byVid = new Map<number, { qty: number; amount: number; unit: number; name: string }>();
  for (const it of o.orderItems) {
    if (!(it.salesQuantity > 0)) continue;
    const cur = byVid.get(it.vendorItemId) ?? { qty: 0, amount: 0, unit: it.unitSalesPrice, name: it.productName };
    cur.qty += it.salesQuantity;
    cur.amount += it.unitSalesPrice * it.salesQuantity;
    byVid.set(it.vendorItemId, cur);
  }
  return [...byVid].map(([vid, v]) => ({
    channel: 'coupang_rg' as const,
    externalOrderId: assertExternalId(String(o.orderId), '주문번호'),
    externalLineId: assertExternalId(`${o.orderId}:${vid}`, '라인 키'),
    orderedAt: paidAt,
    paidAt,
    rawStatus: 'PAID',
    status: 'paid' as const,
    productId: String(vid),
    optionKey: '',
    altProductId: null,
    productLabel: v.name,
    qty: v.qty,
    unitPrice: v.unit,
    amount: v.amount,
  }));
}

export function createRgAdapter(client: RgClient): OrderAdapter {
  return {
    channel: 'coupang_rg',
    tailDays: 7,
    async fetch(w) {
      const fromDay = kstDay(w.from);
      const toDay = kstDay(w.to);
      const lines = new Map<string, OrderLine>();
      for (const c of dayChunks(fromDay, toDay, CHUNK_DAYS)) {
        let token: string | undefined;
        let pages = 0;
        do {
          const r = await client.getRocketGrowthOrders({ paidDateFrom: c.from, paidDateTo: addDays(c.to, 1), nextToken: token });
          for (const o of r.items) for (const l of normalizeRgOrder(o)) lines.set(l.externalLineId, l);
          token = r.nextToken ? r.nextToken : undefined;
          if (++pages >= MAX_PAGES && token) throw new Error(`RG 주문 ${c.from}~${c.to}: ${MAX_PAGES}페이지를 넘었다`);
        } while (token);
      }
      return {
        lines: [...lines.values()],
        cover: { field: 'paid_at', from: kstDayStart(fromDay).toISOString(), to: kstDayStart(addDays(toDay, 1)).toISOString() },
        absenceMeansCancel: true,
      };
    },
  };
}
```

`src/lib/erp/orders/adapters/naver.ts`:
```ts
// src/lib/erp/orders/adapters/naver.ts
// 네이버 — 변경 상품주문(24시간 조각 · more를 끝까지) → 상품주문 상세(300건씩). 변경 시각으로 거르므로 꼬리일수 0(48시간 겹침이면 된다).
// 🔴 order.ordererName·ordererTel·shippingAddress는 옮기지 않는다. 리스팅 연결은 원상품번호 + 옵션 코드.
import type { NaverCommerceClient, NaverOrderRawItem } from '@/lib/listing/naver-commerce-client';
import { assertExternalId } from '../keys';
import { naverStatus } from '../status';
import type { OrderAdapter, OrderLine } from '../types';
import { hourChunks, isoFromChannel, kstIso } from '../window';

const MAX_PAGES = 200;
const DETAIL_BATCH = 300;

export type NaverClient = Pick<NaverCommerceClient, 'getLastChangedStatuses' | 'queryProductOrders'>;

export function normalizeNaverItem(raw: NaverOrderRawItem): OrderLine {
  const { order, productOrder: po } = raw;
  const claimStatus = po.claimStatus ?? raw.claim?.claimStatus ?? null;
  const qty = Number(po.quantity);
  const amount = Number(po.totalPaymentAmount) || 0;
  return {
    channel: 'naver',
    externalOrderId: assertExternalId(String(order.orderId), '주문번호'),
    externalLineId: assertExternalId(String(po.productOrderId), '상품주문번호'),
    orderedAt: isoFromChannel(order.orderDate),
    paidAt: order.paymentDate ? isoFromChannel(order.paymentDate) : null,
    rawStatus: claimStatus ? `${po.productOrderStatus}/${claimStatus}` : po.productOrderStatus,
    status: naverStatus(po.productOrderStatus, po.claimType ?? null, claimStatus),
    productId: po.originalProductId ? String(po.originalProductId) : '',
    optionKey: po.optionCode ? String(po.optionCode) : '',
    altProductId: po.productId ? String(po.productId) : null,
    productLabel: [po.productName, po.productOption].filter(Boolean).join(' · '),
    qty,
    unitPrice: po.unitPrice ?? (qty > 0 ? Math.round(amount / qty) : 0),
    amount,
  };
}

export function createNaverAdapter(client: NaverClient, opts: { sleepMs?: number } = {}): OrderAdapter {
  // 연속 호출 429 방지(옛 getOrders와 같은 500ms)
  const pause = () => new Promise<void>((r) => setTimeout(r, opts.sleepMs ?? 500));
  return {
    channel: 'naver',
    tailDays: 0,
    async fetch(w) {
      const ids = new Set<string>();
      for (const c of hourChunks(w)) {
        let from = kstIso(c.from);
        const to = kstIso(c.to);
        let seq: string | undefined;
        let pages = 0;
        do {
          await pause();
          const r = await client.getLastChangedStatuses({ from, to, moreSequence: seq });
          for (const s of r.statuses) ids.add(String(s.productOrderId));
          if (r.more && r.more.moreSequence) {
            from = r.more.moreFrom;
            seq = r.more.moreSequence;
          } else {
            seq = undefined;
          }
          if (++pages >= MAX_PAGES && seq) throw new Error(`네이버 변경 조회 ${to}: ${MAX_PAGES}페이지를 넘었다`);
        } while (seq);
      }
      const all = [...ids];
      const lines: OrderLine[] = [];
      for (let i = 0; i < all.length; i += DETAIL_BATCH) {
        await pause();
        const raw = await client.queryProductOrders(all.slice(i, i + DETAIL_BATCH));
        lines.push(...raw.map(normalizeNaverItem));
      }
      return { lines, cover: null, absenceMeansCancel: false };
    },
  };
}
```

`src/lib/erp/orders/adapters/toss.ts`:
```ts
// src/lib/erp/orders/adapters/toss.ts
// 토스 — 주문 v2(nextCursor를 끝까지). 상태가 명시되므로 사라짐 판정은 하지 않는다. 주문일로 거르므로 꼬리일수 7.
// 🔴 orderer*·receiver*·address·detailAddress·zipCode·shippingNote는 옮기지 않는다.
// 결제 시각 칸이 없다 — 결제 상태면 주문 시각을 결제 시각으로(설계 해석 #10).
import type { TossOrder, TossShoppingClient } from '@/lib/listing/toss-shopping-client';
import { assertExternalId } from '../keys';
import { tossStatus } from '../status';
import type { OrderAdapter, OrderLine } from '../types';
import { dayChunks, isoFromChannel, kstDay } from '../window';

const MAX_PAGES = 200;

export type TossClient = Pick<TossShoppingClient, 'getOrdersPage'>;

export function normalizeTossOrder(o: TossOrder): OrderLine {
  const status = tossStatus(o.orderProductStatus);
  const orderedAt = isoFromChannel(o.orderedAt);
  const qty = Number(o.quantity);
  const amount = Number(o.price) || 0;
  return {
    channel: 'toss',
    externalOrderId: assertExternalId(String(o.orderId), '주문번호'),
    externalLineId: assertExternalId(String(o.orderProductId), '주문상품번호'),
    orderedAt,
    paidAt: status === 'unpaid' ? null : orderedAt,
    rawStatus: o.orderProductStatus,
    status,
    productId: o.productId ? String(o.productId) : '',
    optionKey: o.optionName ?? '',
    altProductId: o.stockId ? String(o.stockId) : null,
    productLabel: [o.productName, o.optionName].filter(Boolean).join(' · '),
    qty,
    // price = 판매가 × 주문 수량(공식 문서)
    unitPrice: qty > 0 ? Math.round(amount / qty) : 0,
    amount,
  };
}

export function createTossAdapter(client: TossClient): OrderAdapter {
  return {
    channel: 'toss',
    tailDays: 7,
    async fetch(w) {
      const lines = new Map<string, OrderLine>();
      for (const c of dayChunks(kstDay(w.from), kstDay(w.to), 30)) {
        let cursor: string | undefined;
        let pages = 0;
        do {
          const r = await client.getOrdersPage({ startDate: c.from, endDate: c.to, nextCursor: cursor });
          for (const o of r.results) {
            const l = normalizeTossOrder(o);
            lines.set(l.externalLineId, l);
          }
          cursor = r.nextCursor ?? undefined;
          if (++pages >= MAX_PAGES && cursor) throw new Error(`토스 주문 ${c.from}~${c.to}: ${MAX_PAGES}페이지를 넘었다`);
        } while (cursor);
      }
      return { lines: [...lines.values()], cover: null, absenceMeansCancel: false };
    },
  };
}
```

`src/lib/erp/orders/adapters/index.ts`:
```ts
// src/lib/erp/orders/adapters/index.ts
// 채널 → 실제 클라이언트로 만든 어댑터. 클라이언트 생성자는 환경변수가 없으면 던진다 — 수집기가 채널마다 따로 잡도록 지연 생성한다.
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import { getTossShoppingClient } from '@/lib/listing/toss-shopping-client';
import type { OrderAdapter, OrderChannel } from '../types';
import { createWingAdapter } from './coupang-wing';
import { createRgAdapter } from './coupang-rg';
import { createNaverAdapter } from './naver';
import { createTossAdapter } from './toss';

export const ADAPTER_FACTORIES: Record<OrderChannel, () => OrderAdapter> = {
  coupang_wing: () => createWingAdapter(getCoupangClient()),
  coupang_rg: () => createRgAdapter(getCoupangClient()),
  naver: () => createNaverAdapter(getNaverCommerceClient()),
  toss: () => createTossAdapter(getTossShoppingClient()),
};
```

- [ ] **Step 9: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/adapters.test.ts && npx tsc --noEmit`
Expected: PASS(9 tests) · tsc 0. 🔴 `expectNoPII`가 실패하면 어댑터가 구매자 칸을 옮긴 것이다 — 테스트를 고치지 말고 어댑터를 고친다.

- [ ] **Step 10: 커밋**

```bash
git add src/lib/erp/orders/adapters/ src/__tests__/fixtures/orders/ src/__tests__/lib/erp/orders/_pii.ts src/__tests__/lib/erp/orders/adapters.test.ts
git commit -m "feat(erp): 주문 어댑터 4종(쿠팡 판매자배송·RG·네이버·토스) — 끝까지 넘기기·구매자 칸 버림·녹화 응답 시험"
```

---
### Task 4: 수집기 — 채널 잠금 · 겹침 · upsert · 사라진 라인 · 옛 장부

**Files:**
- Create: `src/lib/erp/orders/store.ts`, `src/lib/erp/orders/legacy-store.ts`, `src/lib/erp/orders/collect.ts`
- Test: `src/__tests__/lib/erp/orders/store.test.ts`, `src/__tests__/lib/erp/orders/collect.test.ts`

> 차감 실행기(`deduct.ts`)는 Task 5다. 이 Task의 수집기는 차감을 **주입받는 함수**(`DeductRunner`)로 부르고, 실제 연결(`collectOrders`)은 Task 5 Step 7에서 더한다.

#### 4-A. DB 읽기·쓰기

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/erp/orders/store.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { advanceCursor, markAbsentCanceled, readCutover, upsertOrderLines, type ResolvedLine } from '@/lib/erp/orders/store';
import { syncLegacySales } from '@/lib/erp/orders/legacy-store';
import type { Db } from '@/lib/erp/ledger/store';

type Call = { sql: string; params: unknown[] };
function fakeDb(route: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number } | undefined) {
  const calls: Call[] = [];
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      const r = route(sql, params);
      if (!r) throw new Error(`예상 못 한 SQL: ${sql.slice(0, 70)}`);
      return { rows: r.rows as any[], rowCount: r.rowCount ?? r.rows.length };
    },
  };
  return { db, calls };
}

const PC = '00000000-0000-4000-8000-00000000000a';
const line = (o: Partial<ResolvedLine>): ResolvedLine => ({
  channel: 'coupang_wing', externalOrderId: '31000000001', externalLineId: '6200000001:70000000001',
  orderedAt: '2026-09-27T01:15:00.000Z', paidAt: '2026-09-27T01:15:30.000Z', rawStatus: 'ACCEPT', status: 'paid',
  productId: '70000000001', optionKey: '', altProductId: '16000000001', productLabel: '접이식 왜건 · 블랙', qty: 2, unitPrice: 15900, amount: 31800,
  resolution: { listingId: 5, attribution: 'mapped', reason: null, alloc: [{ skuId: 7, qty: 2 }], listingSkus: [{ skuId: 7, multiplier: 1 }] },
  legacyKey: 'wing-31000000001-70000000001', legacy: { productCostId: PC, qty: 2 }, ...o,
});

describe('upsertOrderLines', () => {
  it('주문별로 orders를 upsert하고 라인은 (channel, external_line_id)로 upsert — unknown 상태는 기존 상태를 지킨다', async () => {
    let nextOrder = 10;
    let nextLine = 100;
    const f = fakeDb((sql) => {
      if (sql.startsWith('insert into erp.orders')) return { rows: [{ id: nextOrder++ }] };
      if (sql.startsWith('insert into erp.order_lines')) return { rows: [{ id: nextLine++, inserted: nextLine === 101 }] };
      return undefined;
    });
    const bundle = line({
      externalLineId: '6200000001:70000000009', productId: '70000000009', legacyKey: 'wing-31000000001-70000000009', legacy: null,
      resolution: { listingId: 6, attribution: 'mapped', reason: null, alloc: [{ skuId: 4, qty: 1 }, { skuId: 9, qty: 2 }], listingSkus: [] },
    });
    const other = line({ externalOrderId: '31000000002', externalLineId: '6200000002:70000000001', status: 'canceled', rawStatus: 'ACCEPT/CANCELED' });
    const r = await upsertOrderLines(f.db, [line({}), bundle, other]);
    expect(r).toEqual({ ids: [100, 101, 102], inserted: 1, updated: 2 });

    const orders = f.calls.filter((c) => c.sql.startsWith('insert into erp.orders'));
    expect(orders.map((c) => [c.params[1], c.params[4]])).toEqual([['31000000001', 'paid'], ['31000000002', 'canceled']]);
    const lines = f.calls.filter((c) => c.sql.startsWith('insert into erp.order_lines'));
    expect(lines[0].sql).toContain("case when excluded.status = 'unknown' then erp.order_lines.status else excluded.status end");
    // [0]order_id [3]listing_id [4]sku_id [5]alloc [6]attribution [8]order_qty [9]sku_qty [12]status [20]legacy_key [21]legacy_pc [22]legacy_qty
    expect([lines[0].params[0], lines[0].params[3], lines[0].params[4], lines[0].params[5], lines[0].params[6], lines[0].params[9], lines[0].params[21], lines[0].params[22]])
      .toEqual([10, 5, 7, '[{"skuId":7,"qty":2}]', 'mapped', 2, PC, 2]);
    expect([lines[1].params[4], lines[1].params[9], lines[1].params[21]]).toEqual([null, 3, null]);
    expect(lines[2].params[0]).toBe(11);
    // 구매자 칸은 SQL에도 파라미터에도 없다
    expect(JSON.stringify(f.calls)).not.toMatch(/orderer|receiver|address|phone|tel/i);
  });

  it('빈 목록이면 아무것도 쓰지 않는다', async () => {
    const f = fakeDb(() => undefined);
    expect(await upsertOrderLines(f.db, [])).toEqual({ ids: [], inserted: 0, updated: 0 });
  });
});

describe('markAbsentCanceled', () => {
  const cover = { field: 'paid_at' as const, from: '2026-09-25T15:00:00.000Z', to: '2026-09-27T15:00:00.000Z' };

  it('cover 구간에서 이번 응답에 없는 라인만 취소로 바꾸고 주문 상태를 맞춘다', async () => {
    const f = fakeDb((sql) => {
      if (sql.startsWith('select id, legacy_key from erp.order_lines')) return { rows: [{ id: 5, legacy_key: 'rg-1-80' }] };
      if (sql.startsWith('update erp.order_lines')) return { rows: [{ order_id: 3 }] };
      if (sql.startsWith('update erp.orders')) return { rows: [] };
      return undefined;
    });
    const r = await markAbsentCanceled(f.db, 'coupang_rg', cover, ['41000000001:80000000001']);
    expect(r).toEqual({ ids: [5], legacyKeys: ['rg-1-80'] });
    expect(f.calls[0].sql).toContain('paid_at >= $2 and paid_at < $3');
    expect(f.calls[0].params).toEqual(['coupang_rg', cover.from, cover.to, ['41000000001:80000000001']]);
    expect(f.calls[1].sql).toContain("status = 'canceled', raw_status = 'ABSENT'");
  });

  it('사라진 라인이 5건 이상이고 받은 라인보다 많으면 응답이 비었을 수 있어 멈춘다', async () => {
    const f = fakeDb((sql) => (sql.startsWith('select id, legacy_key') ? { rows: [1, 2, 3, 4, 5, 6].map((id) => ({ id, legacy_key: `rg-${id}` })) } : undefined));
    await expect(markAbsentCanceled(f.db, 'coupang_rg', cover, ['a'])).rejects.toThrow(/사라진 라인 6건/);
    expect(f.calls.some((c) => c.sql.startsWith('update'))).toBe(false);
  });
});

describe('커서·기초 시각', () => {
  it('기초 시각이 없으면 던진다(기초재고 전에는 수집하지 않는다)', async () => {
    await expect(readCutover(fakeDb(() => ({ rows: [] })).db)).rejects.toThrow(/ledger_cutover/);
  });

  it('커서는 더 늦은 쪽만 남긴다', async () => {
    const f = fakeDb(() => ({ rows: [] }));
    await advanceCursor(f.db, 'naver', '2026-09-27T00:00:00.000Z');
    expect(f.calls[0].sql).toContain('greatest(erp.sync_cursors.cursor_at, excluded.cursor_at)');
    expect(f.calls[0].params).toEqual(['orders:naver', '2026-09-27T00:00:00.000Z']);
  });
});

describe('syncLegacySales', () => {
  it('키별 합산 행을 upsert(product_costs.user_id)하고 라인에 행 id를 적는다 · Wing 무접두 행 무효화 · 무효 키', async () => {
    const f = fakeDb((sql, params) => {
      if (sql.startsWith('select legacy_key')) {
        return { rows: [
          { legacy_key: 'wing-1-70', channel: 'coupang_wing', status: 'paid', order_qty: 2, legacy_qty: 2, amount: 31800, paid_at: new Date('2026-09-27T01:15:30Z'), ordered_at: new Date('2026-09-27T01:15:00Z'), pc: PC },
          { legacy_key: 'toss-9', channel: 'toss', status: 'paid', order_qty: 1, legacy_qty: 1, amount: 12900, paid_at: new Date('2026-09-27T01:00:00Z'), ordered_at: new Date('2026-09-27T01:00:00Z'), pc: PC },
          { legacy_key: 'naver-5', channel: 'naver', status: 'canceled', order_qty: 1, legacy_qty: 1, amount: 9900, paid_at: null, ordered_at: new Date('2026-09-27T01:00:00Z'), pc: PC },
        ] };
      }
      if (sql.startsWith('insert into sale_records')) return { rows: [{ id: `sr-${params[6]}`, inserted: true }] };
      if (sql.startsWith('update erp.order_lines set legacy_sale_id')) return { rows: [] };
      if (sql.startsWith('update sale_records set voided_at')) return { rows: [], rowCount: 1 };
      return undefined;
    });
    const r = await syncLegacySales(f.db, ['wing-1-70', 'toss-9', 'naver-5']);
    expect(r).toEqual({ upserted: 2, inserted: 2, voided: 2 });
    const ins = f.calls.filter((c) => c.sql.startsWith('insert into sale_records'));
    expect(ins[0].sql).toContain('from product_costs pc where pc.id = $1::uuid');
    expect(ins[0].sql).not.toMatch(/coupon_discount|shipping_fee = excluded|product_cost_id = excluded/);
    // [0]pc [1]sold_at [2]qty [3]price [4]amount [5]channel [6]key [7]shipping_fee
    expect(ins.map((c) => [c.params[1], c.params[2], c.params[3], c.params[5], c.params[6], c.params[7]])).toEqual([
      ['2026-09-27', 2, 15900, 'coupang', 'wing-1-70', 3500],
      ['2026-09-27', 1, 12900, 'toss', 'toss-9', 3500],
    ]);
    const voids = f.calls.filter((c) => c.sql.startsWith('update sale_records set voided_at'));
    expect(voids.map((c) => c.params[0])).toEqual(['1-70', ['naver-5']]);
  });

  it('키가 없으면 아무것도 하지 않는다', async () => {
    expect(await syncLegacySales(fakeDb(() => undefined).db, [])).toEqual({ upserted: 0, inserted: 0, voided: 0 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/store.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/erp/orders/store"`

- [ ] **Step 3: 구현**

`src/lib/erp/orders/store.ts`:
```ts
// src/lib/erp/orders/store.ts
// 주문 수집의 DB 읽기·쓰기. 호출자가 트랜잭션을 연다(collect.ts). 구매자 정보 칸은 표에도 SQL에도 없다.
import type { Db } from '@/lib/erp/ledger/store';
import type { LegacyIndex, LegacyTarget } from './legacy';
import { ListingIndex, type LinkMode, type Resolution } from './resolve';
import type { FetchResult, OrderChannel, OrderLine, StdStatus } from './types';

export interface ResolvedLine extends OrderLine {
  resolution: Resolution;
  legacyKey: string;
  legacy: LegacyTarget | null;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export async function loadListingIndex(db: Db): Promise<ListingIndex> {
  const { rows } = await db.query(
    `select l.id, l.channel, l.external_product_id, l.external_option_key, l.link_mode,
            coalesce(json_agg(json_build_object('skuId', ls.sku_id, 'multiplier', ls.multiplier) order by ls.sku_id)
                     filter (where ls.sku_id is not null), '[]'::json) as skus
       from erp.channel_listings l
       left join erp.listing_skus ls on ls.listing_id = l.id
      where l.active
      group by l.id`,
  );
  return new ListingIndex(rows.map((r) => ({
    listingId: Number(r.id),
    channel: r.channel as OrderChannel,
    productId: String(r.external_product_id),
    optionKey: String(r.external_option_key ?? ''),
    linkMode: r.link_mode as LinkMode,
    skus: (r.skus as { skuId: number | string; multiplier: number | string }[]).map((s) => ({ skuId: Number(s.skuId), multiplier: Number(s.multiplier) })),
  })));
}

export async function loadLegacyIndex(db: Db): Promise<LegacyIndex> {
  const skus = await db.query(`select id, legacy_product_cost_ids::text[] as legacy from erp.skus`);
  const pcc = await db.query(
    `select channel_type, external_id::text as external_id, product_cost_id::text as product_cost_id, unit_multiplier
       from product_cost_channels where channel_type in ('coupang_wing', 'coupang_rg')`,
  );
  const pcs = await db.query(
    `select id::text as id, vendor_item_id::text as vid, naver_channel_product_no::text as naver from product_costs`,
  );
  const idx: LegacyIndex = { skuLegacy: new Map(), pcc: new Map(), pcByVendorItem: new Map(), pcByNaverChannelNo: new Map() };
  for (const r of skus.rows) idx.skuLegacy.set(Number(r.id), (r.legacy ?? []) as string[]);
  for (const r of pcc.rows) {
    const k = `${r.channel_type}:${r.external_id}`;
    const list = idx.pcc.get(k) ?? [];
    list.push({ productCostId: String(r.product_cost_id), multiplier: Number(r.unit_multiplier) >= 1 ? Number(r.unit_multiplier) : 1 });
    idx.pcc.set(k, list);
  }
  for (const r of pcs.rows) {
    if (r.vid) idx.pcByVendorItem.set(String(r.vid), String(r.id));
    if (r.naver) idx.pcByNaverChannelNo.set(String(r.naver), String(r.id));
  }
  return idx;
}

/** 기초재고 시각 — 수집 시작점이자 차감 기준. 없으면 던진다(기초재고 전에는 주문을 수집하지 않는다) */
export async function readCutover(db: Db): Promise<string> {
  const { rows } = await db.query(`select cursor_at from erp.sync_cursors where name = 'ledger_cutover'`);
  if (rows.length === 0) throw new Error('ledger_cutover가 없다 — 기초재고 전에는 주문을 수집하지 않는다');
  return iso(rows[0].cursor_at);
}

export const cursorName = (ch: OrderChannel): string => `orders:${ch}`;

export async function readCursor(db: Db, ch: OrderChannel): Promise<string | null> {
  const { rows } = await db.query(`select cursor_at from erp.sync_cursors where name = $1`, [cursorName(ch)]);
  return rows.length === 0 ? null : iso(rows[0].cursor_at);
}

/** 수집 커서. 겹친 실행이 커서를 뒤로 돌리지 않게 더 늦은 쪽만 남긴다 */
export async function advanceCursor(db: Db, ch: OrderChannel, at: string): Promise<void> {
  await db.query(
    `insert into erp.sync_cursors (name, cursor_at) values ($1, $2)
     on conflict (name) do update set cursor_at = greatest(erp.sync_cursors.cursor_at, excluded.cursor_at), updated_at = now()`,
    [cursorName(ch), at],
  );
}

export interface DeductSetting {
  enabled: boolean;
  enabledAt: string | null;
  by: string | null;
}

/** 차감 스위치(erp.settings 'deduct_enabled'). forUpdate = 켜는 트랜잭션이 행을 잡는다 */
export async function readDeductSetting(db: Db, forUpdate = false): Promise<DeductSetting> {
  const { rows } = await db.query(`select value from erp.settings where name = 'deduct_enabled'${forUpdate ? ' for update' : ''}`);
  if (rows.length === 0) throw new Error('erp.settings에 deduct_enabled가 없다 — 마이그레이션 117 확인');
  const v = (rows[0].value ?? {}) as { enabled?: boolean; enabledAt?: string; by?: string };
  return { enabled: v.enabled === true, enabledAt: v.enabledAt ?? null, by: v.by ?? null };
}

export async function writeDeductEnabled(db: Db, p: { by: string; at: string }): Promise<void> {
  await db.query(
    `update erp.settings set value = jsonb_build_object('enabled', true, 'enabledAt', $1::text, 'by', $2::text), updated_at = now()
      where name = 'deduct_enabled'`,
    [p.at, p.by],
  );
}

/** 주문 표준 상태: 라인이 모두 같으면 그 값, 섞이면 mixed */
export function orderStatusOf(statuses: StdStatus[]): StdStatus | 'mixed' {
  return new Set(statuses).size === 1 ? statuses[0] : 'mixed';
}

/** 주문·라인 upsert. 반환 ids는 넘긴 라인 순서 그대로 */
export async function upsertOrderLines(db: Db, lines: ResolvedLine[]): Promise<{ ids: number[]; inserted: number; updated: number }> {
  const byOrder = new Map<string, ResolvedLine[]>();
  for (const l of lines) {
    const g = byOrder.get(l.externalOrderId) ?? [];
    g.push(l);
    byOrder.set(l.externalOrderId, g);
  }
  const idOf = new Map<string, number>();
  let inserted = 0;
  for (const [orderId, ls] of byOrder) {
    const first = ls[0];
    const paid = ls.map((l) => l.paidAt).filter((x): x is string => x !== null).sort()[0] ?? null;
    const ordered = ls.map((l) => l.orderedAt).sort()[0];
    const { rows: o } = await db.query(
      `insert into erp.orders (channel, external_order_id, ordered_at, paid_at, status, raw_status)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (channel, external_order_id) do update set
         paid_at = coalesce(excluded.paid_at, erp.orders.paid_at), status = excluded.status,
         raw_status = excluded.raw_status, updated_at = now()
       returning id`,
      [first.channel, orderId, ordered, paid, orderStatusOf(ls.map((l) => l.status)), [...new Set(ls.map((l) => l.rawStatus))].join(',')],
    );
    const orderPk = Number(o[0].id);
    for (const l of ls) {
      const alloc = l.resolution.alloc;
      const { rows } = await db.query(
        `insert into erp.order_lines (order_id, channel, external_line_id, listing_id, sku_id, alloc, attribution, unattributed_reason,
           order_qty, sku_qty, unit_price, amount, status, raw_status, ordered_at, paid_at, product_id, option_key, alt_product_id,
           product_label, legacy_key, legacy_product_cost_id, legacy_qty)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::uuid, $23)
         on conflict (channel, external_line_id) do update set
           order_id = excluded.order_id, listing_id = excluded.listing_id, sku_id = excluded.sku_id, alloc = excluded.alloc,
           attribution = excluded.attribution, unattributed_reason = excluded.unattributed_reason,
           order_qty = excluded.order_qty, sku_qty = excluded.sku_qty, unit_price = excluded.unit_price, amount = excluded.amount,
           status = case when excluded.status = 'unknown' then erp.order_lines.status else excluded.status end,
           raw_status = excluded.raw_status, paid_at = coalesce(excluded.paid_at, erp.order_lines.paid_at),
           product_id = excluded.product_id, option_key = excluded.option_key, alt_product_id = excluded.alt_product_id,
           product_label = excluded.product_label, legacy_key = excluded.legacy_key,
           legacy_product_cost_id = excluded.legacy_product_cost_id, legacy_qty = excluded.legacy_qty, updated_at = now()
         returning id, (xmax = 0) as inserted`,
        [
          orderPk, l.channel, l.externalLineId, l.resolution.listingId, alloc.length === 1 ? alloc[0].skuId : null, JSON.stringify(alloc),
          l.resolution.attribution, l.resolution.reason, l.qty, alloc.reduce((s, a) => s + a.qty, 0), l.unitPrice, l.amount,
          l.status, l.rawStatus, l.orderedAt, l.paidAt, l.productId, l.optionKey, l.altProductId, l.productLabel,
          l.legacyKey, l.legacy?.productCostId ?? null, l.legacy?.qty ?? null,
        ],
      );
      idOf.set(l.externalLineId, Number(rows[0].id));
      if (rows[0].inserted === true) inserted++;
    }
  }
  const ids = lines.map((l) => idOf.get(l.externalLineId) as number);
  return { ids, inserted, updated: ids.length - inserted };
}

/** 응답이 비었을 가능성: 사라진 라인이 5건 이상이고 이번에 받은 라인보다 많다 */
export const absenceSuspicious = (absent: number, seen: number): boolean => absent >= 5 && absent > seen;

/**
 * cover 구간(API가 실제로 거른 구간)에서 이번 응답에 없는 라인 = 취소(쿠팡 판매자배송·RG). 호출자는 채널을 끝까지 받은 경우에만 부른다.
 * 되살아나면(다음 응답에 다시 나오면) upsert가 상태를 되돌리고 차감이 @n으로 다시 뺀다.
 */
export async function markAbsentCanceled(
  db: Db,
  ch: OrderChannel,
  cover: NonNullable<FetchResult['cover']>,
  seen: string[],
): Promise<{ ids: number[]; legacyKeys: string[] }> {
  const col = cover.field === 'paid_at' ? 'paid_at' : 'ordered_at';
  const { rows } = await db.query(
    `select id, legacy_key from erp.order_lines
      where channel = $1 and ${col} >= $2 and ${col} < $3 and status <> 'canceled'
        and not (external_line_id = any($4::text[]))`,
    [ch, cover.from, cover.to, seen],
  );
  if (rows.length === 0) return { ids: [], legacyKeys: [] };
  if (absenceSuspicious(rows.length, seen.length)) {
    throw new Error(`사라진 라인 ${rows.length}건 > 받은 라인 ${seen.length}건 — 응답이 비었을 수 있어 멈춘다(${ch})`);
  }
  const ids = rows.map((r) => Number(r.id));
  const { rows: upd } = await db.query(
    `update erp.order_lines set status = 'canceled', raw_status = 'ABSENT', updated_at = now()
      where id = any($1::bigint[]) returning order_id`,
    [ids],
  );
  await db.query(
    `update erp.orders o set status = 'canceled', updated_at = now()
      where o.id = any($1::bigint[])
        and not exists (select 1 from erp.order_lines x where x.order_id = o.id and x.status <> 'canceled')`,
    [[...new Set(upd.map((r) => Number(r.order_id)))]],
  );
  return { ids, legacyKeys: rows.map((r) => r.legacy_key).filter((k): k is string => typeof k === 'string') };
}
```

`src/lib/erp/orders/legacy-store.ts`:
```ts
// src/lib/erp/orders/legacy-store.ts
// 옛 장부(sale_records) 쓰기. 무엇을 쓸지는 legacy.ts planLegacy가 정한다. 호출자가 트랜잭션을 연다.
// 이미 있는 행(옛 불러오기가 만든 같은 키)은 수량·단가·금액·판매일·무효만 갱신한다 — 상품·쿠폰·배송비는 사람이 고쳤을 수 있다.
import type { Db } from '@/lib/erp/ledger/store';
import { resolveSaleShippingFee } from '@/lib/cost-management/sale-shipping';
import { bareWingKey } from './keys';
import { planLegacy, type LegacyLine } from './legacy';
import type { OrderChannel, StdStatus } from './types';

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export async function syncLegacySales(db: Db, keys: string[]): Promise<{ upserted: number; inserted: number; voided: number }> {
  const out = { upserted: 0, inserted: 0, voided: 0 };
  if (keys.length === 0) return out;
  const { rows } = await db.query(
    `select legacy_key, channel, status, order_qty, legacy_qty, amount, paid_at, ordered_at, legacy_product_cost_id::text as pc
       from erp.order_lines where legacy_key = any($1::text[])`,
    [keys],
  );
  const lines: LegacyLine[] = rows.map((r) => ({
    legacyKey: String(r.legacy_key),
    channel: r.channel as OrderChannel,
    status: r.status as StdStatus,
    orderQty: Number(r.order_qty),
    legacyQty: r.legacy_qty === null || r.legacy_qty === undefined ? null : Number(r.legacy_qty),
    amount: Number(r.amount),
    paidAt: iso(r.paid_at),
    orderedAt: iso(r.ordered_at) as string,
    productCostId: r.pc ?? null,
  }));
  const plan = planLegacy(lines);
  for (const r of plan.upsert) {
    const res = await db.query(
      `insert into sale_records (user_id, product_cost_id, sold_at, quantity, selling_price, sale_amount, channel, coupang_order_item_id, shipping_fee)
       select pc.user_id, pc.id, $2::date, $3, $4, $5, $6, $7, $8 from product_costs pc where pc.id = $1::uuid
       on conflict (coupang_order_item_id) do update set
         quantity = excluded.quantity, selling_price = excluded.selling_price, sale_amount = excluded.sale_amount,
         sold_at = excluded.sold_at, voided_at = null
       returning id, (xmax = 0) as inserted`,
      [r.productCostId, r.soldAt, r.quantity, r.sellingPrice, r.saleAmount, r.channel, r.key, resolveSaleShippingFee(r.shippingSource)],
    );
    if (res.rows.length === 0) continue; // 그 사이 옛 상품이 지워졌다
    out.upserted++;
    if (res.rows[0].inserted === true) out.inserted++;
    await db.query(`update erp.order_lines set legacy_sale_id = $1 where legacy_key = $2`, [res.rows[0].id, r.key]);
    const bare = bareWingKey(r.key);
    if (bare) {
      const v = await db.query(`update sale_records set voided_at = now() where coupang_order_item_id = $1 and voided_at is null`, [bare]);
      out.voided += v.rowCount ?? 0;
    }
  }
  if (plan.voidKeys.length > 0) {
    const v = await db.query(
      `update sale_records set voided_at = now() where coupang_order_item_id = any($1::text[]) and voided_at is null`,
      [plan.voidKeys],
    );
    out.voided += v.rowCount ?? 0;
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/store.test.ts`
Expected: PASS(8 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/erp/orders/store.ts src/lib/erp/orders/legacy-store.ts src/__tests__/lib/erp/orders/store.test.ts
git commit -m "feat(erp): 주문 라인 upsert·사라진 라인 취소·커서·스위치 읽기 · 옛 장부 쓰기"
```

#### 4-B. 채널 수집 한 번

- [ ] **Step 6: 실패하는 테스트 작성**

`src/__tests__/lib/erp/orders/collect.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ListingIndex } from '@/lib/erp/orders/resolve';
import type { OrderAdapter, OrderLine } from '@/lib/erp/orders/types';

const m = vi.hoisted(() => ({
  readCutover: vi.fn(), readCursor: vi.fn(), advanceCursor: vi.fn(), loadListingIndex: vi.fn(), loadLegacyIndex: vi.fn(),
  upsertOrderLines: vi.fn(), markAbsentCanceled: vi.fn(), readDeductSetting: vi.fn(), writeDeductEnabled: vi.fn(), syncLegacySales: vi.fn(),
}));
vi.mock('@/lib/erp/orders/store', () => ({
  readCutover: m.readCutover, readCursor: m.readCursor, advanceCursor: m.advanceCursor, loadListingIndex: m.loadListingIndex,
  loadLegacyIndex: m.loadLegacyIndex, upsertOrderLines: m.upsertOrderLines, markAbsentCanceled: m.markAbsentCanceled, readDeductSetting: m.readDeductSetting,
  // Task 5에서 collect.ts가 deduct.ts를 불러오면 필요하다
  writeDeductEnabled: m.writeDeductEnabled,
}));
vi.mock('@/lib/erp/orders/legacy-store', () => ({ syncLegacySales: m.syncLegacySales }));

import { collectChannel } from '@/lib/erp/orders/collect';

const CUT = '2026-09-26T11:07:04.989Z';
const NOW = new Date('2026-09-27T03:00:00.000Z');
const LINE: OrderLine = {
  channel: 'coupang_rg', externalOrderId: '41000000001', externalLineId: '41000000001:80000000001', orderedAt: '2026-09-27T01:00:00.000Z',
  paidAt: '2026-09-27T01:00:00.000Z', rawStatus: 'PAID', status: 'paid', productId: '80000000001', optionKey: '', altProductId: null,
  productLabel: '퓨어틴', qty: 2, unitPrice: 21900, amount: 43800,
};
const COVER = { field: 'paid_at' as const, from: '2026-09-25T15:00:00.000Z', to: '2026-09-27T15:00:00.000Z' };

let seq: string[];
let lockOk: boolean;
const client = {
  query: vi.fn(async (sql: string) => {
    seq.push(sql.split(' ')[0] === 'select' ? sql.slice(0, 30) : sql);
    if (sql.startsWith('select pg_try_advisory_lock')) return { rows: [{ ok: lockOk }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }),
  release: vi.fn(),
};
const pool = { connect: vi.fn(async () => client as never) };
const deduct = vi.fn(async (_db: unknown, _p: { enabled: boolean; cutover: string; lineIds: number[]; channel: string; at: string }) =>
  ({ posted: 1, reversed: 0, short: 0, pending: 0, unchanged: 0 }));
const adapter = (o: Partial<OrderAdapter> = {}): OrderAdapter => ({
  channel: 'coupang_rg', tailDays: 7,
  fetch: vi.fn(async () => { seq.push('FETCH'); return { lines: [LINE], cover: COVER, absenceMeansCancel: true }; }),
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  seq = [];
  lockOk = true;
  m.readCutover.mockResolvedValue(CUT);
  m.readCursor.mockResolvedValue(null);
  m.loadListingIndex.mockResolvedValue(new ListingIndex([
    { listingId: 5, channel: 'coupang_rg', productId: '80000000001', optionKey: '', linkMode: 'single', skus: [{ skuId: 7, multiplier: 1 }] },
  ]));
  m.loadLegacyIndex.mockResolvedValue({ skuLegacy: new Map(), pcc: new Map(), pcByVendorItem: new Map(), pcByNaverChannelNo: new Map() });
  m.upsertOrderLines.mockResolvedValue({ ids: [100], inserted: 1, updated: 0 });
  m.markAbsentCanceled.mockResolvedValue({ ids: [90], legacyKeys: ['rg-1-2'] });
  m.syncLegacySales.mockResolvedValue({ upserted: 1, inserted: 1, voided: 1 });
  m.readDeductSetting.mockResolvedValue({ enabled: false, enabledAt: null, by: null });
});

describe('collectChannel', () => {
  it('채널 잠금을 못 잡으면 busy — 채널을 부르지 않는다', async () => {
    lockOk = false;
    const a = adapter();
    const r = await collectChannel(pool, a, { now: NOW, dryRun: false, deduct });
    expect(r).toMatchObject({ channel: 'coupang_rg', ok: true, skipped: 'busy' });
    expect(a.fetch).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
    expect(seq.some((s) => s.startsWith('select pg_advisory_unlock'))).toBe(false);
  });

  it('첫 실행은 기초 시각부터 가져오고(트랜잭션 밖) 한 트랜잭션에서 upsert → 사라짐 → 옛 장부 → 차감 → 커서', async () => {
    const a = adapter();
    const r = await collectChannel(pool, a, { now: NOW, dryRun: false, deduct });
    expect(a.fetch).toHaveBeenCalledWith({ from: new Date(CUT), to: NOW });
    expect(seq.indexOf('FETCH')).toBeLessThan(seq.indexOf('BEGIN'));
    expect(m.upsertOrderLines.mock.calls[0][1][0]).toMatchObject({
      externalLineId: '41000000001:80000000001', legacyKey: 'rg-41000000001-80000000001',
      resolution: { attribution: 'mapped', alloc: [{ skuId: 7, qty: 2 }] }, legacy: null,
    });
    expect(m.markAbsentCanceled).toHaveBeenCalledWith(client, 'coupang_rg', COVER, ['41000000001:80000000001']);
    expect(m.syncLegacySales).toHaveBeenCalledWith(client, ['rg-41000000001-80000000001', 'rg-1-2']);
    expect(deduct).toHaveBeenCalledWith(client, { enabled: false, cutover: CUT, lineIds: [100, 90], channel: 'coupang_rg', at: NOW.toISOString() });
    expect(m.advanceCursor).toHaveBeenCalledWith(client, 'coupang_rg', NOW.toISOString());
    expect(seq.filter((s) => /^(BEGIN|COMMIT|ROLLBACK)/.test(s))).toEqual(['BEGIN', 'COMMIT']);
    expect(seq[seq.length - 1]).toMatch(/^select pg_advisory_unlock/);
    expect(r).toMatchObject({ ok: true, skipped: null, fetched: 1, inserted: 1, updated: 0, absent: 1, unattributed: 0,
      legacy: { upserted: 1, inserted: 1, voided: 1 }, deduct: { posted: 1 }, window: { from: CUT, to: NOW.toISOString() } });
  });

  it('사라짐 판정은 absenceMeansCancel이 참일 때만', async () => {
    await collectChannel(pool, adapter({ fetch: vi.fn(async () => ({ lines: [LINE], cover: null, absenceMeansCancel: false })) }), { now: NOW, dryRun: false, deduct });
    expect(m.markAbsentCanceled).not.toHaveBeenCalled();
    expect(deduct.mock.calls[0][1].lineIds).toEqual([100]);
  });

  it('dryRun은 가져와서 연결만 세고 쓰지 않는다', async () => {
    const r = await collectChannel(pool, adapter(), { now: NOW, dryRun: true, deduct });
    expect(r).toMatchObject({ ok: true, dryRun: true, fetched: 1, unattributed: 0 });
    expect(seq).not.toContain('BEGIN');
    expect(m.upsertOrderLines).not.toHaveBeenCalled();
    expect(m.advanceCursor).not.toHaveBeenCalled();
  });

  it('쓰다 실패하면 ROLLBACK · 커서 그대로 · 오류는 개인정보를 가린다 · 잠금은 푼다', async () => {
    m.upsertOrderLines.mockRejectedValue(new Error('수령인 010-1234-5678 때문에 실패'));
    const r = await collectChannel(pool, adapter(), { now: NOW, dryRun: false, deduct });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('010-****-5678');
    expect(seq).toContain('ROLLBACK');
    expect(m.advanceCursor).not.toHaveBeenCalled();
    expect(seq[seq.length - 1]).toMatch(/^select pg_advisory_unlock/);
  });

  it('채널 호출이 실패하면 트랜잭션을 열지 않고 실패로 돌려준다', async () => {
    const r = await collectChannel(pool, adapter({ fetch: vi.fn(async () => { throw new Error('RG 429'); }) }), { now: NOW, dryRun: false, deduct });
    expect(r).toMatchObject({ ok: false, error: 'RG 429' });
    expect(seq).not.toContain('BEGIN');
  });

  it('커서가 있으면 48시간 겹침·꼬리일수(7)로 시작한다', async () => {
    m.readCursor.mockResolvedValue('2026-10-10T00:00:00.000Z');
    const a = adapter();
    await collectChannel(pool, a, { now: new Date('2026-10-10T00:15:00.000Z'), dryRun: true, deduct });
    expect((a.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0].from.toISOString()).toBe('2026-10-03T00:15:00.000Z');
  });
});
```

- [ ] **Step 7: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/collect.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/erp/orders/collect"`

- [ ] **Step 8: 구현**

`src/lib/erp/orders/collect.ts`:
```ts
// src/lib/erp/orders/collect.ts
// 채널 수집 한 번. 순서: 채널 세션 잠금(pg_try_advisory_lock — 못 잡으면 busy) → 구간(window.ts) → 채널 호출(트랜잭션 밖 — 수십 초)
//   → 리스팅 연결·옛 장부 대상 → 한 트랜잭션[upsert → 사라진 라인 취소 → 옛 장부 → 차감 → 커서] → 잠금 해제.
// 실패는 던지지 않고 보고서(ok:false)로 돌려준다 — 한 채널 실패가 다른 채널을 막지 않는다. 오류 문구는 maskPII를 거친다.
import type { PoolClient } from 'pg';
import type { Db } from '@/lib/erp/ledger/store';
import { maskPII } from '@/lib/jobs/mask';
import { legacyKeyOf } from './keys';
import { pickLegacy } from './legacy';
import { syncLegacySales } from './legacy-store';
import { resolveLine } from './resolve';
import {
  advanceCursor, loadLegacyIndex, loadListingIndex, markAbsentCanceled, readCursor, readCutover, readDeductSetting, upsertOrderLines,
  type ResolvedLine,
} from './store';
import type { OrderAdapter, OrderChannel } from './types';
import { windowFor } from './window';

/** 주문 수집 세션 잠금 네임스페이스(원장 SKU 잠금 7101과 겹치지 않는다) */
const LOCK_NS = 7102;
const CHANNEL_LOCK: Record<OrderChannel, number> = { coupang_wing: 1, coupang_rg: 2, naver: 3, toss: 4 };

export interface DeductSummary {
  posted: number;
  reversed: number;
  short: number;
  pending: number;
  unchanged: number;
}

export type DeductRunner = (
  db: Db,
  p: { enabled: boolean; cutover: string; lineIds: number[]; channel: OrderChannel; at: string },
) => Promise<DeductSummary>;

export interface ChannelReport {
  channel: OrderChannel;
  ok: boolean;
  skipped: 'busy' | null;
  dryRun: boolean;
  window: { from: string; to: string } | null;
  fetched: number;
  inserted: number;
  updated: number;
  absent: number;
  unattributed: number;
  unknownStatus: number;
  legacy: { upserted: number; inserted: number; voided: number };
  deduct: DeductSummary | null;
  error: string | null;
}

export interface Connectable {
  connect(): Promise<PoolClient>;
}

export const emptyReport = (channel: OrderChannel, dryRun: boolean): ChannelReport => ({
  channel, ok: false, skipped: null, dryRun, window: null, fetched: 0, inserted: 0, updated: 0, absent: 0,
  unattributed: 0, unknownStatus: 0, legacy: { upserted: 0, inserted: 0, voided: 0 }, deduct: null, error: null,
});

const errText = (e: unknown) => maskPII(e instanceof Error ? e.message : String(e));

export async function collectChannel(
  pool: Connectable,
  adapter: OrderAdapter,
  opts: { now: Date; dryRun: boolean; deduct: DeductRunner },
): Promise<ChannelReport> {
  const ch = adapter.channel;
  const report = emptyReport(ch, opts.dryRun);
  const c = await pool.connect();
  let locked = false;
  try {
    const lock = await c.query('select pg_try_advisory_lock($1::int, $2::int) as ok', [LOCK_NS, CHANNEL_LOCK[ch]]);
    locked = lock.rows[0]?.ok === true;
    if (!locked) return { ...report, ok: true, skipped: 'busy' };

    const cutover = await readCutover(c);
    const cursor = await readCursor(c, ch);
    const w = windowFor({ cursor, cutover, now: opts.now, tailDays: adapter.tailDays });
    report.window = { from: w.from.toISOString(), to: w.to.toISOString() };

    // 채널 호출은 트랜잭션 밖 — 수십 초 동안 원장 잠금을 잡지 않는다
    const res = await adapter.fetch(w);

    const listings = await loadListingIndex(c);
    const legacyIdx = await loadLegacyIndex(c);
    const resolved: ResolvedLine[] = res.lines.map((l) => {
      const resolution = resolveLine(l, listings);
      return { ...l, resolution, legacyKey: legacyKeyOf(l), legacy: pickLegacy(l, resolution, legacyIdx) };
    });
    report.fetched = resolved.length;
    report.unattributed = resolved.filter((r) => r.resolution.attribution === 'unattributed').length;
    report.unknownStatus = resolved.filter((r) => r.status === 'unknown').length;
    if (opts.dryRun) return { ...report, ok: true };

    await c.query('BEGIN');
    try {
      const up = await upsertOrderLines(c, resolved);
      const absent = res.absenceMeansCancel && res.cover
        ? await markAbsentCanceled(c, ch, res.cover, resolved.map((r) => r.externalLineId))
        : { ids: [] as number[], legacyKeys: [] as string[] };
      const legacy = await syncLegacySales(c, [...new Set([...resolved.map((r) => r.legacyKey), ...absent.legacyKeys])]);
      const setting = await readDeductSetting(c);
      const deduct = await opts.deduct(c, {
        enabled: setting.enabled, cutover, lineIds: [...up.ids, ...absent.ids], channel: ch, at: opts.now.toISOString(),
      });
      await advanceCursor(c, ch, opts.now.toISOString());
      await c.query('COMMIT');
      return { ...report, ok: true, inserted: up.inserted, updated: up.updated, absent: absent.ids.length, legacy, deduct };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    }
  } catch (e) {
    return { ...report, ok: false, error: errText(e) };
  } finally {
    if (locked) await c.query('select pg_advisory_unlock($1::int, $2::int)', [LOCK_NS, CHANNEL_LOCK[ch]]).catch(() => {});
    c.release();
  }
}
```

- [ ] **Step 9: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/ && npx tsc --noEmit`
Expected: PASS · tsc 0

- [ ] **Step 10: 커밋**

```bash
git add src/lib/erp/orders/collect.ts src/__tests__/lib/erp/orders/collect.test.ts
git commit -m "feat(erp): 채널 수집기 — 세션 잠금·트랜잭션 밖 호출·한 트랜잭션 쓰기·실패 보고"
```

---
### Task 5: 차감 모듈 — 스위치 · 소급 · 재고 부족 · 역전표 · 자가시험

**Files:**
- Create: `src/lib/erp/orders/deduct.ts`
- Modify: `src/lib/erp/orders/collect.ts`(전 채널 수집 `collectOrders` · 작업 기록 숫자 `reportCounts`)
- Test: `src/__tests__/lib/erp/orders/deduct.test.ts`, `src/__tests__/lib/erp/orders/collect.test.ts`(추가)
- Create: `scripts/erp/orders-selftest.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/erp/orders/deduct.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InsufficientStockError } from '@/lib/erp/ledger/fifo';
import type { Db } from '@/lib/erp/ledger/store';

const m = vi.hoisted(() => ({
  lockSku: vi.fn(), postConsume: vi.fn(), reverse: vi.fn(),
  readCutover: vi.fn(), readDeductSetting: vi.fn(), writeDeductEnabled: vi.fn(),
}));
vi.mock('@/lib/erp/ledger/store', () => ({ lockSku: m.lockSku, postConsume: m.postConsume, reverse: m.reverse }));
vi.mock('@/lib/erp/orders/store', () => ({ readCutover: m.readCutover, readDeductSetting: m.readDeductSetting, writeDeductEnabled: m.writeDeductEnabled }));

import { DeductSwitchError, enableDeduction, previewBackfill, runDeductions } from '@/lib/erp/orders/deduct';

const CUT = '2026-09-26T11:07:04.989Z';
const AT = '2026-09-27T03:00:00.000Z';
const PAID = new Date('2026-09-27T01:00:00.000Z');

type Row = Record<string, unknown>;
const row = (o: Row): Row => ({
  id: 1, channel: 'naver', external_line_id: '2026092700000001', external_order_id: '2026092712340001', status: 'paid', attribution: 'mapped',
  alloc: [{ skuId: 4, qty: 2 }], paid_at: PAID, deduction_state: 'pending', deduction_note: null, ledger_version: 0, posted: [], ...o,
});

let lines: Row[];
let onHand: Row[];
let calls: { sql: string; params: unknown[] }[];
let order: string[];
const db: Db = {
  async query(sql: string, params: unknown[] = []) {
    calls.push({ sql, params });
    order.push(sql.split(' ').slice(0, 2).join(' '));
    if (sql.startsWith('select l.id, l.channel')) return { rows: lines, rowCount: lines.length };
    if (/^(savepoint|release savepoint|rollback to savepoint)/.test(sql)) return { rows: [], rowCount: null };
    if (sql.startsWith('update erp.order_lines set deduction_state')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('select sku_id, location, qty from erp.stock_on_hand')) return { rows: onHand, rowCount: onHand.length };
    if (sql.startsWith('select id, name, option_label from erp.skus')) return { rows: [{ id: 4, name: '쿨매트', option_label: '블루' }, { id: 9, name: '퓨어틴', option_label: '' }], rowCount: 2 };
    throw new Error(`예상 못 한 SQL: ${sql.slice(0, 60)}`);
  },
};
const updates = () => calls.filter((c) => c.sql.startsWith('update erp.order_lines set deduction_state')).map((c) => ({
  id: c.params[0], state: c.params[1], note: c.params[2], posted: JSON.parse(c.params[3] as string), version: c.params[4],
}));

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  order = [];
  onHand = [];
  m.lockSku.mockImplementation(async (_db: Db, id: number) => { order.push(`lock ${id}`); });
  m.postConsume.mockImplementation(async (_db: Db, p: { skuId: number }) => { order.push(`post ${p.skuId}`); return { posted: true, ids: [1] }; });
  m.reverse.mockResolvedValue({ posted: true, ids: [2] });
  m.readCutover.mockResolvedValue(CUT);
});

describe('runDeductions', () => {
  it('대상 라인을 행 잠금으로 읽고, SKU를 오름차순으로 먼저 잠근 뒤 결제 시각으로 뺀다(RG = rg, 나머지 = self)', async () => {
    lines = [
      row({ id: 1, channel: 'coupang_rg', external_line_id: '41000000001:80000000001', external_order_id: '41000000001', alloc: [{ skuId: 9, qty: 1 }] }),
      row({ id: 2, alloc: [{ skuId: 4, qty: 2 }] }),
    ];
    const s = await runDeductions(db, { enabled: true, cutover: CUT, lineIds: [1], channel: null, at: AT });
    expect(calls[0].sql).toContain('for update of l');
    expect(calls[0].params).toEqual([[1], null, true]);
    expect(order.filter((o) => /^(lock|post)/.test(o))).toEqual(['lock 4', 'lock 9', 'post 9', 'post 4']);
    expect(m.postConsume.mock.calls[0][1]).toEqual({
      skuId: 9, location: 'rg', qty: 1, kind: 'sale', occurredAt: PAID.toISOString(), idemKey: 'sale:coupang_rg:41000000001:80000000001:s9',
      refType: 'order_line', refId: '1', note: '쿠팡 RG 주문 41000000001',
    });
    expect(m.postConsume.mock.calls[1][1]).toMatchObject({ location: 'self', idemKey: 'sale:naver:2026092700000001:s4', note: '네이버 주문 2026092712340001' });
    expect(updates()).toEqual([
      { id: 1, state: 'posted', note: null, posted: [{ skuId: 9, qty: 1, idemKey: 'sale:coupang_rg:41000000001:80000000001:s9' }], version: 1 },
      { id: 2, state: 'posted', note: null, posted: [{ skuId: 4, qty: 2, idemKey: 'sale:naver:2026092700000001:s4' }], version: 1 },
    ]);
    expect(s).toEqual({ posted: 2, reversed: 0, short: 0, pending: 0, unchanged: 0 });
  });

  it('재고 부족이면 그 라인만 savepoint로 되돌리고 skipped_short — 다음 라인은 계속한다', async () => {
    lines = [row({ id: 1 }), row({ id: 2, external_line_id: '2026092700000002', alloc: [{ skuId: 9, qty: 1 }] })];
    m.postConsume.mockImplementationOnce(async () => { throw new InsufficientStockError(2, 0); });
    const s = await runDeductions(db, { enabled: true, cutover: CUT, lineIds: [], channel: 'naver', at: AT });
    expect(order).toContain('rollback to');
    expect(updates()[0]).toMatchObject({ id: 1, state: 'skipped_short', posted: [], version: 0 });
    expect(updates()[0].note).toMatch(/^재고 부족/);
    expect(updates()[1]).toMatchObject({ id: 2, state: 'posted', version: 1 });
    expect(s).toMatchObject({ posted: 1, short: 1 });
  });

  it('bundle 라인의 둘째 SKU가 모자라면 첫째 SKU 차감도 함께 되돌린다(savepoint)', async () => {
    lines = [row({ alloc: [{ skuId: 4, qty: 1 }, { skuId: 9, qty: 2 }] })];
    m.postConsume.mockImplementation(async (_db: Db, p: { skuId: number }) => {
      if (p.skuId === 9) throw new Error('SKU 9 · rg · lot 3의 재고가 음수가 된다 (-1)');
      return { posted: true, ids: [1] };
    });
    await runDeductions(db, { enabled: true, cutover: CUT, lineIds: [1], channel: null, at: AT });
    const sp = calls.map((c) => c.sql).filter((q) => /savepoint/.test(q));
    expect(sp).toEqual(['savepoint erp_sale', 'rollback to savepoint erp_sale', 'release savepoint erp_sale']);
    expect(updates()[0]).toMatchObject({ state: 'skipped_short', posted: [] });
  });

  it('뺀 라인이 취소되면 역전표(수집 시각 · 취소·반품 메모) → reversed', async () => {
    const posted = [{ skuId: 4, qty: 2, idemKey: 'sale:naver:2026092700000001:s4' }];
    lines = [row({ status: 'canceled', deduction_state: 'posted', ledger_version: 1, posted })];
    const s = await runDeductions(db, { enabled: true, cutover: CUT, lineIds: [1], channel: null, at: AT });
    expect(m.reverse).toHaveBeenCalledWith(db, 'sale:naver:2026092700000001:s4', { occurredAt: AT, note: '네이버 주문 2026092712340001 취소·반품' });
    expect(m.postConsume).not.toHaveBeenCalled();
    expect(updates()).toEqual([{ id: 1, state: 'reversed', note: 'voided', posted: [], version: 1 }]);
    expect(s.reversed).toBe(1);
  });

  it('스위치가 꺼져 있으면 원장을 건드리지 않고 pending으로 둔다', async () => {
    lines = [row({ deduction_state: 'none' })];
    const s = await runDeductions(db, { enabled: false, cutover: CUT, lineIds: [1], channel: null, at: AT });
    expect(m.lockSku).not.toHaveBeenCalled();
    expect(m.postConsume).not.toHaveBeenCalled();
    expect(updates()).toEqual([{ id: 1, state: 'pending', note: null, posted: [], version: 0 }]);
    expect(s.pending).toBe(1);
  });

  it('바뀐 것이 없는 라인은 다시 쓰지 않는다', async () => {
    lines = [row({ status: 'delivered', deduction_state: 'posted', ledger_version: 1, posted: [{ skuId: 4, qty: 2, idemKey: 'sale:naver:2026092700000001:s4' }] })];
    const s = await runDeductions(db, { enabled: true, cutover: CUT, lineIds: [1], channel: null, at: AT });
    expect(updates()).toEqual([]);
    expect(s.unchanged).toBe(1);
  });

  it('재고 부족이 아닌 오류는 되돌린 뒤 다시 던진다(수집 트랜잭션이 통째로 롤백)', async () => {
    lines = [row({})];
    m.postConsume.mockRejectedValueOnce(new Error('connection reset'));
    await expect(runDeductions(db, { enabled: true, cutover: CUT, lineIds: [1], channel: null, at: AT })).rejects.toThrow('connection reset');
  });

  it('includeOpen:false면 넘긴 라인만(자가시험·개별 재처리)', async () => {
    lines = [];
    await runDeductions(db, { enabled: true, cutover: CUT, lineIds: [7], channel: 'toss', at: AT, includeOpen: false });
    expect(calls[0].params).toEqual([[7], 'toss', false]);
  });
});

describe('previewBackfill', () => {
  it('켜면 뺄 라인·SKU·집/RG 감소량과 재고가 모자라는 SKU를 보인다(기초 이전·미귀속은 빠진다)', async () => {
    lines = [
      row({ id: 1, alloc: [{ skuId: 4, qty: 2 }] }),
      row({ id: 2, channel: 'coupang_rg', external_line_id: '41000000001:80000000001', alloc: [{ skuId: 9, qty: 3 }], paid_at: new Date('2026-09-27T02:00:00Z') }),
      row({ id: 3, deduction_state: 'skipped_short', alloc: [{ skuId: 4, qty: 1 }] }),
      row({ id: 4, paid_at: new Date('2026-09-26T10:00:00Z') }),
    ];
    onHand = [{ sku_id: 4, location: 'self', qty: 10 }, { sku_id: 9, location: 'rg', qty: 1 }];
    const p = await previewBackfill(db);
    expect(p).toEqual({
      cutover: CUT, lines: 3, skus: 2, self: 3, rg: 3,
      firstPaidAt: '2026-09-27T01:00:00.000Z', lastPaidAt: '2026-09-27T02:00:00.000Z',
      byChannel: { coupang_wing: 0, coupang_rg: 1, naver: 2, toss: 0 },
      shortages: [{ skuId: 9, name: '퓨어틴', option: '', location: 'rg', need: 3, have: 1 }],
    });
  });
});

describe('enableDeduction', () => {
  beforeEach(() => {
    lines = [row({ id: 1 })];
    onHand = [{ sku_id: 4, location: 'self', qty: 10 }];
  });

  it('이미 켜져 있으면 already', async () => {
    m.readDeductSetting.mockResolvedValue({ enabled: true, enabledAt: AT, by: 'u' });
    await expect(enableDeduction(db, { expectedLines: 1, by: 'u-1', at: AT })).rejects.toMatchObject({ code: 'already' });
    expect(m.writeDeductEnabled).not.toHaveBeenCalled();
  });

  it('화면이 본 소급 라인 수와 다르면 stale — 켜지 않는다', async () => {
    m.readDeductSetting.mockResolvedValue({ enabled: false, enabledAt: null, by: null });
    const e = await enableDeduction(db, { expectedLines: 5, by: 'u-1', at: AT }).catch((x) => x);
    expect(e).toBeInstanceOf(DeductSwitchError);
    expect(e.code).toBe('stale');
    expect(m.writeDeductEnabled).not.toHaveBeenCalled();
    expect(m.postConsume).not.toHaveBeenCalled();
  });

  it('설정 행을 잡고(for update) 켠 뒤 모든 채널의 대기 라인을 소급한다', async () => {
    m.readDeductSetting.mockResolvedValue({ enabled: false, enabledAt: null, by: null });
    const r = await enableDeduction(db, { expectedLines: 1, by: 'u-1', at: AT });
    expect(m.readDeductSetting).toHaveBeenCalledWith(db, true);
    expect(m.writeDeductEnabled).toHaveBeenCalledWith(db, { by: 'u-1', at: AT });
    expect(r.preview.lines).toBe(1);
    expect(r.summary.posted).toBe(1);
    const sel = calls.filter((c) => c.sql.startsWith('select l.id, l.channel'));
    expect(sel[sel.length - 1].params).toEqual([[], null, true]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/deduct.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/erp/orders/deduct"`

- [ ] **Step 3: 구현**

`src/lib/erp/orders/deduct.ts`:
```ts
// src/lib/erp/orders/deduct.ts
// 판매 차감 실행. 무엇을 할지는 deduct-plan.ts decideDeduction이 정하고, 여기서는 원장(1-B store.ts)에 쓴다. 호출자가 트랜잭션을 연다.
// 순서: 대상 라인 행 잠금(for update — 크론과 「차감 켜기」가 겹쳐도 한 라인을 두 번 처리하지 않는다) → 판정
//   → 관련 SKU 오름차순 lockSku(1-B 인계) → 라인마다 [역전표 → savepoint 안에서 SKU별 postConsume] → 라인 상태.
// 재고 부족(InsufficientStockError · 지연 제약 「음수가 된다」)은 그 라인만 savepoint로 되돌리고 skipped_short — 다음 수집에서 다시 시도한다.
import { InsufficientStockError } from '@/lib/erp/ledger/fifo';
import { lockSku, postConsume, reverse, type Db } from '@/lib/erp/ledger/store';
import type { DeductSummary } from './collect';
import { decideDeduction, type DeductInput, type DeductionState, type PostedItem } from './deduct-plan';
import type { AllocItem } from './resolve';
import { readCutover, readDeductSetting, writeDeductEnabled } from './store';
import { CHANNEL_LABEL, ORDER_CHANNELS, locationOf, type OrderChannel, type StdStatus } from './types';

interface LineRow extends DeductInput {
  id: number;
  externalOrderId: string;
  note: string | null;
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

function toRow(r: Record<string, unknown>): LineRow {
  return {
    id: Number(r.id),
    channel: r.channel as OrderChannel,
    externalLineId: String(r.external_line_id),
    externalOrderId: String(r.external_order_id ?? ''),
    status: r.status as StdStatus,
    attribution: r.attribution as 'mapped' | 'unattributed',
    alloc: ((r.alloc ?? []) as AllocItem[]).map((a) => ({ skuId: Number(a.skuId), qty: Number(a.qty) })),
    paidAt: iso(r.paid_at),
    state: r.deduction_state as DeductionState,
    note: (r.deduction_note ?? null) as string | null,
    version: Number(r.ledger_version),
    posted: ((r.posted ?? []) as PostedItem[]).map((p) => ({ skuId: Number(p.skuId), qty: Number(p.qty), idemKey: String(p.idemKey) })),
  };
}

const LINE_COLS = `l.id, l.channel, l.external_line_id, o.external_order_id, l.status, l.attribution, l.alloc, l.paid_at,
            l.deduction_state, l.deduction_note, l.ledger_version, l.posted`;

async function loadLines(db: Db, p: { lineIds: number[]; channel: OrderChannel | null; includeOpen: boolean }): Promise<LineRow[]> {
  const { rows } = await db.query(
    `select ${LINE_COLS}
       from erp.order_lines l join erp.orders o on o.id = l.order_id
      where (l.id = any($1::bigint[]) or ($3::boolean and l.deduction_state in ('pending', 'skipped_short')))
        and ($2::text is null or l.channel = $2)
      order by l.paid_at nulls last, l.id
      for update of l`,
    [p.lineIds, p.channel, p.includeOpen],
  );
  return rows.map(toRow);
}

export const isShortError = (e: unknown): boolean =>
  e instanceof InsufficientStockError || (e instanceof Error && /음수가 된다/.test(e.message));

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param lineIds 이번 수집이 건드린 라인(상태가 바뀌었을 수 있다)
 * @param includeOpen true(기본) = pending·skipped_short 라인도 함께(재고를 고치면 풀린다 · 켜는 순간 소급)
 */
export async function runDeductions(
  db: Db,
  p: { enabled: boolean; cutover: string; lineIds: number[]; channel: OrderChannel | null; at: string; includeOpen?: boolean },
): Promise<DeductSummary> {
  const lines = await loadLines(db, { lineIds: p.lineIds, channel: p.channel, includeOpen: p.includeOpen ?? true });
  const planned = lines.map((l) => ({ l, plan: decideDeduction(l, { enabled: p.enabled, cutover: p.cutover }) }));

  const skus = new Set<number>();
  for (const { l, plan } of planned) {
    if (plan.reverse.length > 0) for (const x of l.posted) skus.add(x.skuId);
    for (const it of plan.post?.items ?? []) skus.add(it.skuId);
  }
  for (const id of [...skus].sort((a, b) => a - b)) await lockSku(db, id);

  const sum: DeductSummary = { posted: 0, reversed: 0, short: 0, pending: 0, unchanged: 0 };
  for (const { l, plan } of planned) {
    const label = `${CHANNEL_LABEL[l.channel]} 주문 ${l.externalOrderId}`;
    let state: DeductionState = plan.state;
    let note: string | null = plan.note;
    let posted: PostedItem[] = l.posted;
    let version = l.version;
    let deducted = false;

    if (plan.reverse.length > 0) {
      // 역전표는 재고를 늘리므로 부족으로 실패하지 않는다 — 먼저 쓴다
      for (const k of plan.reverse) await reverse(db, k, { occurredAt: p.at, note: `${label} 취소·반품` });
      posted = [];
      sum.reversed++;
    }
    if (plan.post) {
      await db.query('savepoint erp_sale');
      try {
        for (const it of plan.post.items) {
          await postConsume(db, {
            skuId: it.skuId, location: locationOf(l.channel), qty: it.qty, kind: 'sale', occurredAt: l.paidAt ?? p.at,
            idemKey: it.idemKey, refType: 'order_line', refId: String(l.id), note: label,
          });
        }
        await db.query('release savepoint erp_sale');
        posted = plan.post.items;
        version = plan.post.version;
        deducted = true;
        sum.posted++;
      } catch (e) {
        await db.query('rollback to savepoint erp_sale');
        await db.query('release savepoint erp_sale');
        if (!isShortError(e)) throw e;
        state = 'skipped_short';
        note = `재고 부족 — ${(e as Error).message}`.slice(0, 200);
        sum.short++;
      }
    } else if (plan.reverse.length === 0) {
      if (state === 'pending') sum.pending++;
      else sum.unchanged++;
    }

    if (state === l.state && note === l.note && version === l.version && same(posted, l.posted)) continue;
    await db.query(
      `update erp.order_lines set deduction_state = $2, deduction_note = $3, posted = $4::jsonb, ledger_version = $5,
              deducted_at = case when $6::boolean then now() else deducted_at end, updated_at = now()
        where id = $1`,
      [l.id, state, note, JSON.stringify(posted), version, deducted],
    );
  }
  return sum;
}

export interface BackfillShortage {
  skuId: number;
  name: string;
  option: string;
  location: 'self' | 'rg';
  need: number;
  have: number;
}

export interface BackfillPreview {
  cutover: string;
  /** 켜면 빼는 라인 수(확인 창이 이 값을 expectedLines로 되돌려 보낸다) */
  lines: number;
  skus: number;
  /** 집에서 빠지는 수량 합 */
  self: number;
  /** RG에서 빠지는 수량 합 */
  rg: number;
  firstPaidAt: string | null;
  lastPaidAt: string | null;
  byChannel: Record<OrderChannel, number>;
  /** 원장 재고보다 많이 빼야 하는 (SKU·위치) — 켜면 그 라인들은 skipped_short로 남는다 */
  shortages: BackfillShortage[];
}

/** 「차감 켜기」 확인 창의 숫자 — 켜면 무엇이 빠지는지(읽기 전용) */
export async function previewBackfill(db: Db): Promise<BackfillPreview> {
  const cutover = await readCutover(db);
  const { rows } = await db.query(
    `select l.id, l.channel, l.external_line_id, o.external_order_id, l.status, l.attribution, l.alloc, l.paid_at,
            l.deduction_state, l.deduction_note, l.ledger_version, l.posted
       from erp.order_lines l join erp.orders o on o.id = l.order_id
      where l.deduction_state in ('pending', 'skipped_short')
      order by l.paid_at nulls last, l.id`,
  );
  const byChannel = Object.fromEntries(ORDER_CHANNELS.map((c) => [c, 0])) as Record<OrderChannel, number>;
  const need = new Map<string, { skuId: number; location: 'self' | 'rg'; qty: number }>();
  const paid: string[] = [];
  let lines = 0;
  let self = 0;
  let rg = 0;
  for (const l of rows.map(toRow)) {
    const plan = decideDeduction(l, { enabled: true, cutover });
    if (!plan.post) continue;
    lines++;
    byChannel[l.channel]++;
    if (l.paidAt) paid.push(l.paidAt);
    const location = locationOf(l.channel) === 'rg' ? 'rg' : 'self';
    for (const it of plan.post.items) {
      const k = `${it.skuId}:${location}`;
      const cur = need.get(k) ?? { skuId: it.skuId, location, qty: 0 };
      cur.qty += it.qty;
      need.set(k, cur);
      if (location === 'rg') rg += it.qty;
      else self += it.qty;
    }
  }
  const skuIds = [...new Set([...need.values()].map((n) => n.skuId))].sort((a, b) => a - b);
  const shortages: BackfillShortage[] = [];
  if (skuIds.length > 0) {
    const { rows: have } = await db.query(
      `select sku_id, location, qty from erp.stock_on_hand where sku_id = any($1::bigint[])`, [skuIds],
    );
    const haveOf = new Map(have.map((h) => [`${Number(h.sku_id)}:${h.location}`, Number(h.qty)]));
    const { rows: names } = await db.query(`select id, name, option_label from erp.skus where id = any($1::bigint[])`, [skuIds]);
    const nameOf = new Map(names.map((n) => [Number(n.id), { name: String(n.name), option: String(n.option_label ?? '') }]));
    for (const n of [...need.values()].sort((a, b) => a.skuId - b.skuId || a.location.localeCompare(b.location))) {
      const h = haveOf.get(`${n.skuId}:${n.location}`) ?? 0;
      if (n.qty > h) shortages.push({ skuId: n.skuId, ...(nameOf.get(n.skuId) ?? { name: `SKU ${n.skuId}`, option: '' }), location: n.location, need: n.qty, have: h });
    }
  }
  paid.sort();
  return {
    cutover, lines, skus: skuIds.length, self, rg, firstPaidAt: paid[0] ?? null, lastPaidAt: paid[paid.length - 1] ?? null, byChannel, shortages,
  };
}

export class DeductSwitchError extends Error {
  constructor(public readonly code: 'already' | 'stale', message: string) {
    super(message);
    this.name = 'DeductSwitchError';
  }
}

/**
 * 「차감 켜기」 — 호출자가 연 트랜잭션 안에서. 설정 행을 잡고(for update), 화면이 본 소급 라인 수와 지금 수가 같을 때만 켜고
 * 모든 채널의 대기 라인을 결제 시각 순으로 소급한다(기초 이전 결제는 판정표가 뺀다). 끄는 길은 없다.
 */
export async function enableDeduction(
  db: Db,
  p: { expectedLines: number; by: string; at: string },
): Promise<{ preview: BackfillPreview; summary: DeductSummary }> {
  const setting = await readDeductSetting(db, true);
  if (setting.enabled) throw new DeductSwitchError('already', `이미 켜져 있다(${setting.enabledAt ?? '시각 모름'})`);
  const preview = await previewBackfill(db);
  if (preview.lines !== p.expectedLines) {
    throw new DeductSwitchError('stale', `소급할 라인이 바뀌었다 — 화면 ${p.expectedLines}건, 지금 ${preview.lines}건. 창을 다시 연다`);
  }
  await writeDeductEnabled(db, { by: p.by, at: p.at });
  const summary = await runDeductions(db, { enabled: true, cutover: preview.cutover, lineIds: [], channel: null, at: p.at });
  return { preview, summary };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/deduct.test.ts`
Expected: PASS(12 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/erp/orders/deduct.ts src/__tests__/lib/erp/orders/deduct.test.ts
git commit -m "feat(erp): 판매 차감 실행 — 행 잠금·SKU 오름차순·savepoint 재고 부족·역전표·소급 미리보기·차감 켜기"
```

- [ ] **Step 6: 전 채널 수집 — 실패하는 테스트 추가**

`src/__tests__/lib/erp/orders/collect.test.ts` 끝에 더한다.
```ts

describe('collectOrders · reportCounts', () => {
  it('채널을 차례로 돌고, 어댑터를 못 만든 채널(환경변수 없음)은 실패 보고만 남긴다', async () => {
    const { collectOrders, reportCounts } = await import('@/lib/erp/orders/collect');
    const factories = {
      coupang_wing: () => { throw new Error('COUPANG_ACCESS_KEY가 없다'); },
      coupang_rg: () => adapter(),
      naver: () => adapter({ channel: 'naver', fetch: vi.fn(async () => ({ lines: [], cover: null, absenceMeansCancel: false })) }),
      toss: () => adapter(),
    };
    const reports = await collectOrders({ channels: ['coupang_wing', 'coupang_rg', 'naver'], dryRun: false, now: NOW, pool, factories });
    expect(reports.map((r) => [r.channel, r.ok])).toEqual([['coupang_wing', false], ['coupang_rg', true], ['naver', true]]);
    expect(reports[0].error).toContain('COUPANG_ACCESS_KEY');
    const counts = reportCounts(reports);
    expect(counts).toMatchObject({ channels: 3, errors: 1, coupang_wing_error: 1, coupang_rg_error: 0, coupang_rg_fetched: 1, coupang_rg_new: 1, naver_fetched: 0 });
  });
});
```

Run: `npx vitest run src/__tests__/lib/erp/orders/collect.test.ts`
Expected: FAIL — `collectOrders is not a function`

- [ ] **Step 7: 구현 — `collect.ts`에 더한다**

`src/lib/erp/orders/collect.ts`의 import 블록
```ts
import type { PoolClient } from 'pg';
import type { Db } from '@/lib/erp/ledger/store';
import { maskPII } from '@/lib/jobs/mask';
```
을 아래로 바꾼다.
```ts
import type { PoolClient } from 'pg';
import type { Db } from '@/lib/erp/ledger/store';
import { maskPII } from '@/lib/jobs/mask';
import { getSourcingPool } from '@/lib/sourcing/db';
import { ADAPTER_FACTORIES } from './adapters';
import { runDeductions } from './deduct';
```

파일 끝에 더한다.
```ts

/** 크론·화면 공용: 채널을 차례로 수집한다. 한 채널 실패(어댑터 생성 포함)가 다른 채널을 막지 않는다 */
export async function collectOrders(p: {
  channels: OrderChannel[];
  dryRun: boolean;
  now?: Date;
  pool?: Connectable;
  factories?: Record<OrderChannel, () => OrderAdapter>;
}): Promise<ChannelReport[]> {
  const pool = p.pool ?? getSourcingPool();
  const factories = p.factories ?? ADAPTER_FACTORIES;
  const now = p.now ?? new Date();
  const out: ChannelReport[] = [];
  for (const ch of p.channels) {
    let adapter: OrderAdapter;
    try {
      adapter = factories[ch]();
    } catch (e) {
      out.push({ ...emptyReport(ch, p.dryRun), error: errText(e) });
      continue;
    }
    out.push(await collectChannel(pool, adapter, { now, dryRun: p.dryRun, deduct: runDeductions }));
  }
  return out;
}

/** erp.job_runs.counts — 채널별 <ch>_fetched·<ch>_new·<ch>_error(0/1) + 합계. 수집 현황 패널이 마지막 실행의 채널 성패를 여기서 읽는다 */
export function reportCounts(reports: ChannelReport[]): Record<string, number> {
  const counts: Record<string, number> = { channels: reports.length, errors: 0, fetched: 0, inserted: 0, posted: 0, short: 0, unattributed: 0 };
  for (const r of reports) {
    counts[`${r.channel}_fetched`] = r.fetched;
    counts[`${r.channel}_new`] = r.inserted;
    counts[`${r.channel}_error`] = r.ok ? 0 : 1;
    counts.errors += r.ok ? 0 : 1;
    counts.fetched += r.fetched;
    counts.inserted += r.inserted;
    counts.posted += r.deduct?.posted ?? 0;
    counts.short += r.deduct?.short ?? 0;
    counts.unattributed += r.unattributed;
  }
  return counts;
}
```

Run: `npx vitest run src/__tests__/lib/erp/orders/ && npx tsc --noEmit`
Expected: PASS · tsc 0

- [ ] **Step 8: 운영 DB 자가시험 작성**

`scripts/erp/orders-selftest.ts`:
```ts
// scripts/erp/orders-selftest.ts
// 사용법: npx --no-install tsx scripts/erp/orders-selftest.ts
// 운영 DB에서 주문 upsert·옛 장부·판매 차감·역전표·@n·재고 부족·기초 이전·bundle·any_of·사라진 라인을 **한 트랜잭션에서 시험하고 반드시 ROLLBACK**한다.
// 커밋하는 경로가 없으므로 기초재고가 있는 원장에서도 돈다(ledger-selftest.ts와 다르다). 임시 SKU는 status='archived'.
// 주문 시각을 2099년으로 둬 실제 주문과 사라짐 판정 구간이 겹치지 않게 한다. 채널 API는 부르지 않는다.
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { postLotCreate } from '@/lib/erp/ledger/store';
import { runDeductions } from '@/lib/erp/orders/deduct';
import { legacyKeyOf } from '@/lib/erp/orders/keys';
import { pickLegacy } from '@/lib/erp/orders/legacy';
import { syncLegacySales } from '@/lib/erp/orders/legacy-store';
import { resolveLine } from '@/lib/erp/orders/resolve';
import { loadLegacyIndex, loadListingIndex, markAbsentCanceled, readCutover, upsertOrderLines, type ResolvedLine } from '@/lib/erp/orders/store';
import type { OrderLine } from '@/lib/erp/orders/types';

loadEnvLocal();

const results: { check: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push({ check: name, ok, detail });

(async () => {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const T = Date.now();
  const tag = `selftest-orders:${T}`;
  try {
    await c.query('BEGIN');
    const cutover = await readCutover(c);
    const now = () => new Date().toISOString();

    // 임시 옛 상품 · SKU 둘 · 리스팅 셋(single · bundle · any_of) — 전부 롤백된다
    const pc = String((await c.query(`insert into product_costs (product_name) values ($1) returning id`, [`${tag} 옛 상품`])).rows[0].id);
    const mkSku = async (suffix: string, legacy: string[]) => Number((await c.query(
      `insert into erp.skus (key, name, origin, status, legacy_product_cost_ids) values ($1, '주문 자가시험', 'manual', 'archived', $2::uuid[]) returning id`,
      [`${tag}:${suffix}`, legacy],
    )).rows[0].id);
    const s1 = await mkSku('a', [pc]);
    const s2 = await mkSku('b', []);
    const mkListing = async (vid: string, mode: string, links: [number, number][]) => {
      const id = Number((await c.query(
        `insert into erp.channel_listings (channel, external_product_id, external_option_key, label, active, link_mode, origin)
         values ('coupang_wing', $1, '', $2, true, $3, 'manual') returning id`,
        [vid, tag, mode],
      )).rows[0].id);
      for (const [skuId, mul] of links) {
        await c.query(`insert into erp.listing_skus (listing_id, sku_id, multiplier, origin) values ($1, $2, $3, 'manual')`, [id, skuId, mul]);
      }
    };
    const vSingle = `9${T}1`;
    const vBundle = `9${T}2`;
    const vAny = `9${T}3`;
    await mkListing(vSingle, 'single', [[s1, 1]]);
    await mkListing(vBundle, 'bundle', [[s1, 1], [s2, 2]]);
    await mkListing(vAny, 'any_of', [[s1, 1], [s2, 1]]);
    await postLotCreate(c, { skuId: s1, location: 'self', qty: 5, unitCost: 1000, kind: 'receipt', occurredAt: now(), idemKey: `${tag}:r1` });

    const selfQty = async (s: number) =>
      Number((await c.query(`select coalesce(sum(qty), 0)::int q from erp.stock_ledger where sku_id = $1 and location = 'self'`, [s])).rows[0].q);
    const AT = '2099-01-01T01:00:00.000Z';
    const mk = (n: number, o: Partial<OrderLine> = {}): OrderLine => ({
      channel: 'coupang_wing', externalOrderId: `st${T}o${n}`, externalLineId: `st${T}b${n}:${o.productId ?? vSingle}`,
      orderedAt: AT, paidAt: AT, rawStatus: 'ACCEPT', status: 'paid', productId: vSingle, optionKey: '', altProductId: null,
      productLabel: tag, qty: 1, unitPrice: 1000, amount: 1000, ...o,
    });
    const collect = async (lines: OrderLine[]) => {
      const index = await loadListingIndex(c);
      const lidx = await loadLegacyIndex(c);
      const resolved: ResolvedLine[] = lines.map((l) => {
        const resolution = resolveLine(l, index);
        return { ...l, resolution, legacyKey: legacyKeyOf(l), legacy: pickLegacy(l, resolution, lidx) };
      });
      const up = await upsertOrderLines(c, resolved);
      await syncLegacySales(c, resolved.map((r) => r.legacyKey));
      await runDeductions(c, { enabled: true, cutover, lineIds: up.ids, channel: 'coupang_wing', at: now(), includeOpen: false });
      return up.ids;
    };
    const lineRow = async (id: number) => (await c.query(
      `select status, raw_status, deduction_state, deduction_note, ledger_version, posted from erp.order_lines where id = $1`, [id],
    )).rows[0];
    const sale = async (key: string) => (await c.query(`select quantity, voided_at from sale_records where coupang_order_item_id = $1`, [key])).rows[0];

    // 1. 결제 → 차감
    const A = mk(1, { qty: 2 });
    const [a] = await collect([A]);
    let r = await lineRow(a);
    check('결제 라인 → 집 2 차감 · posted · 버전 1', r.deduction_state === 'posted' && r.ledger_version === 1 && (await selfQty(s1)) === 3, JSON.stringify(r));
    const key1 = String(r.posted[0]?.idemKey);
    check('판매 전표 키 = sale:coupang_wing:<라인키>:s<sku>', key1 === `sale:coupang_wing:${A.externalLineId}:s${s1}`, key1);
    const led = (await c.query(`select kind, ref_type, note from erp.stock_ledger where idem_key like $1 order by id limit 1`, [`${key1}#%`])).rows[0];
    check('판매 전표 kind sale · ref_type order_line · 메모에 채널·주문번호', led?.kind === 'sale' && led?.ref_type === 'order_line' && led?.note === `쿠팡 판매자배송 주문 ${A.externalOrderId}`, JSON.stringify(led));
    const lk = `wing-${A.externalOrderId}-${vSingle}`;
    let sr = await sale(lk);
    check('옛 장부 한 행(수량 2 · 무효 아님)', !!sr && Number(sr.quantity) === 2 && sr.voided_at === null, JSON.stringify(sr));

    // 2. 취소 → 역전표
    await collect([{ ...A, status: 'canceled', rawStatus: 'ACCEPT/CANCELED' }]);
    r = await lineRow(a);
    sr = await sale(lk);
    check('취소 → 역전표 · reversed · 집 5 · 옛 장부 무효', r.deduction_state === 'reversed' && (await selfQty(s1)) === 5 && sr?.voided_at !== null, JSON.stringify({ r, sr }));

    // 3. 다시 결제 → @2
    await collect([A]);
    r = await lineRow(a);
    sr = await sale(lk);
    check('되살아나면 @2로 다시 차감 · 집 3 · 옛 장부 무효 해제',
      r.posted[0]?.idemKey === `${key1}@2` && r.ledger_version === 2 && (await selfQty(s1)) === 3 && sr?.voided_at === null, JSON.stringify({ r, sr }));

    // 4. 재고 부족
    const [b] = await collect([mk(2, { qty: 10 })]);
    r = await lineRow(b);
    check('재고 부족 → skipped_short · 원장 그대로(집 3)', r.deduction_state === 'skipped_short' && /재고 부족/.test(r.deduction_note ?? '') && (await selfQty(s1)) === 3, JSON.stringify(r));

    // 5. 기초재고 이전 결제
    const [pre] = await collect([mk(3, { orderedAt: '2026-01-01T00:00:00.000Z', paidAt: '2026-01-01T00:00:00.000Z' })]);
    r = await lineRow(pre);
    check('기초재고 이전 결제 → none(pre_cutover)', r.deduction_state === 'none' && r.deduction_note === 'pre_cutover', JSON.stringify(r));

    // 6. bundle
    await postLotCreate(c, { skuId: s2, location: 'self', qty: 10, unitCost: 500, kind: 'receipt', occurredAt: now(), idemKey: `${tag}:r2` });
    const B = mk(4, { productId: vBundle, qty: 2 });
    const [bd] = await collect([B]);
    r = await lineRow(bd);
    check('bundle → SKU마다 한 전표(s1 −2 · s2 −4)', r.deduction_state === 'posted' && r.posted.length === 2 && (await selfQty(s1)) === 1 && (await selfQty(s2)) === 6, JSON.stringify(r));

    // 7. any_of
    const [an] = await collect([mk(5, { productId: vAny })]);
    r = await lineRow(an);
    check('any_of → 미귀속 · none(unattributed)', r.deduction_state === 'none' && r.deduction_note === 'unattributed', JSON.stringify(r));

    // 8. 응답에서 사라진 라인 = 취소
    const ab = await markAbsentCanceled(c, 'coupang_wing', { field: 'ordered_at', from: '2099-01-01T00:00:00.000Z', to: '2099-01-02T00:00:00.000Z' },
      [A.externalLineId, B.externalLineId]);
    await runDeductions(c, { enabled: true, cutover, lineIds: ab.ids, channel: 'coupang_wing', at: now(), includeOpen: false });
    const rb = await lineRow(b);
    check('사라진 라인 2건 → canceled(ABSENT) · 부족 라인은 대상에서 빠진다(none · voided)',
      ab.ids.length === 2 && rb.status === 'canceled' && rb.raw_status === 'ABSENT' && rb.deduction_state === 'none' && rb.deduction_note === 'voided', JSON.stringify({ ab, rb }));
  } catch (e) {
    check('예상 못 한 오류', false, (e as Error).message);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
  }
  const left = (await c.query(`select count(*)::int n from erp.skus where key like 'selftest-orders:%'`)).rows[0].n;
  check('롤백 뒤 흔적 없음', left === 0, String(left));
  await c.end();
  for (const x of results) console.log(`${x.ok ? '✅' : '❌'} ${x.check}${x.ok || !x.detail ? '' : ` — ${x.detail}`}`);
  if (results.some((x) => !x.ok)) process.exitCode = 1;
})();
```

- [ ] **Step 9: 자가시험 실행** (운영 DB — ROLLBACK만)

Run: `npx --no-install tsx scripts/erp/orders-selftest.ts; echo "exit $?"`
Expected: 12행 전부 ✅, `exit 0`. `product_costs` insert가 다른 not null 칸 때문에 실패하면 그 칸을 기본값과 함께 insert에 더하고(롤백되므로 값은 무엇이든 된다) 다시 돌린다 — 차감 로직을 고치지 않는다.

- [ ] **Step 10: 커밋**

```bash
git add src/lib/erp/orders/collect.ts src/__tests__/lib/erp/orders/collect.test.ts scripts/erp/orders-selftest.ts
git commit -m "feat(erp): 전 채널 수집(collectOrders)·작업 기록 숫자 · 주문 자가시험(ROLLBACK 전용)"
```

---
### Task 6: 수집 API — 크론 라우트 · 화면 트리거 · pg_cron 118

**Files:**
- Create: `src/lib/erp/orders/run.ts`, `src/app/api/cron/orders-sync/route.ts`, `src/app/api/erp/orders/sync/route.ts`
- Create: `supabase/migrations/118_pg_cron_orders_sync.sql`(**적용은 Task 9 Step 5**)
- Test: `src/__tests__/api/cron-orders-sync.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/api/cron-orders-sync.test.ts`:
```ts
// src/__tests__/api/cron-orders-sync.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  collectOrders: vi.fn(),
  withJobRun: vi.fn(async (_job: string, fn: () => Promise<{ value: unknown; counts?: Record<string, number> }>) => (await fn()).value),
  send: vi.fn(async () => undefined),
  getCurrentUser: vi.fn(),
}));
vi.mock('@/lib/erp/orders/collect', async () => {
  const actual = await vi.importActual<typeof import('@/lib/erp/orders/collect')>('@/lib/erp/orders/collect');
  return { ...actual, collectOrders: m.collectOrders };
});
vi.mock('@/lib/jobs/run-log', () => ({ withJobRun: m.withJobRun }));
vi.mock('@/lib/telegram/client', () => ({ sendTelegramMessage: m.send }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: m.getCurrentUser }));

const rep = (channel: string, ok: boolean, error: string | null = null) => ({
  channel, ok, skipped: null, dryRun: false, window: null, fetched: ok ? 3 : 0, inserted: ok ? 2 : 0, updated: 1, absent: 0,
  unattributed: 0, unknownStatus: 0, legacy: { upserted: 0, inserted: 0, voided: 0 }, deduct: null, error,
});
const cron = (qs = '', token = 's3cret') =>
  new NextRequest(`http://localhost/api/cron/orders-sync${qs}`, { headers: { authorization: `Bearer ${token}` } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.stubEnv('JOB_ALERT_TELEGRAM_CHAT_ID', 'chat-1');
  m.collectOrders.mockResolvedValue([rep('coupang_wing', true), rep('coupang_rg', true), rep('naver', true), rep('toss', true)]);
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/cron/orders-sync', () => {
  it('비밀값이 틀리거나 비어 있으면 401이고 작업을 기록하지 않는다', async () => {
    const { GET } = await import('@/app/api/cron/orders-sync/route');
    expect((await GET(cron('', 'x'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(cron('', ''))).status).toBe(401);
    expect(m.withJobRun).not.toHaveBeenCalled();
  });

  it('4채널을 orders-sync 작업(cron)으로 기록하고 채널별 counts를 남긴다', async () => {
    const { GET } = await import('@/app/api/cron/orders-sync/route');
    const res = await GET(cron());
    expect(res.status).toBe(200);
    expect(m.withJobRun).toHaveBeenCalledWith('orders-sync', expect.any(Function), { trigger: 'cron' });
    expect(m.collectOrders).toHaveBeenCalledWith({ channels: ['coupang_wing', 'coupang_rg', 'naver', 'toss'], dryRun: false });
    const outcome = await m.withJobRun.mock.calls[0][1]();
    expect(outcome.counts).toMatchObject({ channels: 4, errors: 0, fetched: 12, naver_fetched: 3, naver_new: 2, toss_error: 0 });
    expect(m.send).not.toHaveBeenCalled();
    expect((await res.json()).reports).toHaveLength(4);
  });

  it('?channel=naver&dryRun=1 — 한 채널 드라이런은 manual로 기록한다', async () => {
    m.collectOrders.mockResolvedValue([rep('naver', true)]);
    const { GET } = await import('@/app/api/cron/orders-sync/route');
    await GET(cron('?channel=naver&dryRun=1'));
    expect(m.collectOrders).toHaveBeenCalledWith({ channels: ['naver'], dryRun: true });
    expect(m.withJobRun).toHaveBeenCalledWith('orders-sync', expect.any(Function), { trigger: 'manual' });
  });

  it('없는 채널은 400', async () => {
    const { GET } = await import('@/app/api/cron/orders-sync/route');
    expect((await GET(cron('?channel=karrot'))).status).toBe(400);
    expect(m.collectOrders).not.toHaveBeenCalled();
  });

  it('일부 채널만 실패하면 200 · 텔레그램에 채널별 실패', async () => {
    m.collectOrders.mockResolvedValue([rep('coupang_wing', true), rep('naver', false, '[네이버 API] 500')]);
    const { GET } = await import('@/app/api/cron/orders-sync/route');
    const res = await GET(cron());
    expect(res.status).toBe(200);
    expect(m.send).toHaveBeenCalledWith('chat-1', expect.stringContaining('네이버 — [네이버 API] 500'));
  });

  it('모든 채널이 실패하면 500(작업 실패로 남는다)', async () => {
    m.collectOrders.mockResolvedValue([rep('naver', false, 'x'), rep('toss', false, 'y')]);
    const { GET } = await import('@/app/api/cron/orders-sync/route');
    const res = await GET(cron());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/모든 채널 실패/);
  });
});

describe('POST /api/erp/orders/sync', () => {
  const post = (body: unknown) => new NextRequest('http://localhost/api/erp/orders/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('로그인하지 않으면 401이고 수집하지 않는다', async () => {
    m.getCurrentUser.mockResolvedValue(null);
    const { POST } = await import('@/app/api/erp/orders/sync/route');
    expect((await POST(post({}))).status).toBe(401);
    expect(m.collectOrders).not.toHaveBeenCalled();
  });

  it('화면의 「지금 수집」 — 4채널을 manual로 · 결과를 data로', async () => {
    m.getCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
    const { POST } = await import('@/app/api/erp/orders/sync/route');
    const res = await POST(post({}));
    expect(res.status).toBe(200);
    expect(m.withJobRun).toHaveBeenCalledWith('orders-sync', expect.any(Function), { trigger: 'manual' });
    expect((await res.json()).data).toHaveLength(4);
  });

  it('채널 하나만 · 없는 채널은 400', async () => {
    m.getCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
    const { POST } = await import('@/app/api/erp/orders/sync/route');
    await POST(post({ channel: 'toss' }));
    expect(m.collectOrders).toHaveBeenCalledWith({ channels: ['toss'], dryRun: false });
    expect((await POST(post({ channel: 'x' }))).status).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/api/cron-orders-sync.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/cron/orders-sync/route"`

- [ ] **Step 3: 구현**

`src/lib/erp/orders/run.ts`:
```ts
// src/lib/erp/orders/run.ts
// 주문 수집 한 번을 erp.job_runs('orders-sync')에 남긴다 — 크론과 화면 「지금 수집」이 같이 쓴다.
// 모든 채널이 실패하면 던진다(withJobRun이 failed로 남기고 텔레그램 JOB_ALERT). 일부만 실패하면 ok로 남기고 같은 채팅에 채널별 실패를 보낸다.
import { withJobRun } from '@/lib/jobs/run-log';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { collectOrders, reportCounts, type ChannelReport } from './collect';
import { CHANNEL_LABEL, type OrderChannel } from './types';

export async function runOrdersSync(p: { channels: OrderChannel[]; dryRun: boolean; trigger: 'cron' | 'manual' }): Promise<ChannelReport[]> {
  const reports = await withJobRun(
    'orders-sync',
    async () => {
      const r = await collectOrders({ channels: p.channels, dryRun: p.dryRun });
      if (r.length > 0 && r.every((x) => !x.ok)) {
        throw new Error(`모든 채널 실패: ${r.map((x) => `${CHANNEL_LABEL[x.channel]} ${x.error ?? ''}`).join(' / ')}`);
      }
      return { value: r, counts: reportCounts(r) };
    },
    { trigger: p.trigger },
  );
  const failed = reports.filter((r) => !r.ok);
  const chatId = process.env.JOB_ALERT_TELEGRAM_CHAT_ID ?? '';
  if (failed.length > 0 && chatId) {
    // 채널 오류 문구는 수집기가 maskPII를 거쳤다
    const text = `🟡 주문 수집 일부 실패\n${failed.map((f) => `${CHANNEL_LABEL[f.channel]} — ${f.error ?? '알 수 없음'}`).join('\n')}`;
    await sendTelegramMessage(chatId, text).catch((e) => console.error('[orders-sync] 텔레그램 실패:', e));
  }
  return reports;
}
```

`src/app/api/cron/orders-sync/route.ts`:
```ts
// src/app/api/cron/orders-sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { maskPII } from '@/lib/jobs/mask';
import { runOrdersSync } from '@/lib/erp/orders/run';
import { ORDER_CHANNELS, isOrderChannel } from '@/lib/erp/orders/types';

/** 네이버 변경 조회(500ms 간격)·RG(1.3초 간격)가 겹치면 1분을 넘긴다 */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/orders-sync — 4채널 주문 수집(ERP 1-C2a). 채널 API는 읽기만 한다(발주확인·송장·재고 쓰기 없음).
 *
 * 호출은 Supabase pg_cron(supabase/migrations/118_pg_cron_orders_sync.sql)이 15분마다 한다. 실행 기록은 erp.job_runs('orders-sync').
 * `?dryRun=1` = 가져와서 연결만 세고 쓰지 않는다 · `?channel=<coupang_wing|coupang_rg|naver|toss>` = 그 채널만. 둘 중 하나라도 있으면 manual로 남는다.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? '';
  const auth = request.headers.get('authorization') ?? '';
  if (!cronSecret || auth.replace('Bearer ', '') !== cronSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const sp = request.nextUrl.searchParams;
  const channel = sp.get('channel');
  if (channel !== null && !isOrderChannel(channel)) {
    return NextResponse.json({ success: false, error: `채널이 잘못됐다: ${channel}` }, { status: 400 });
  }
  const dryRun = sp.get('dryRun') === '1';
  const manual = dryRun || channel !== null || sp.get('trigger') === 'manual';
  try {
    const reports = await runOrdersSync({ channels: channel ? [channel] : [...ORDER_CHANNELS], dryRun, trigger: manual ? 'manual' : 'cron' });
    return NextResponse.json({ success: true, reports });
  } catch (e) {
    return NextResponse.json({ success: false, error: maskPII(e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
```

`src/app/api/erp/orders/sync/route.ts`:
```ts
// POST /api/erp/orders/sync — 화면의 「지금 수집」(재고현황 수집 패널 · 원가관리·상품별 「판매 가져오기」). body { channel? }
// 크론과 같은 수집(기초재고 시각 이후 · 겹침 · 옛 장부 · 스위치가 켜져 있으면 차감). 날짜는 받지 않는다 — 과거 복구는 1-C2b.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { maskPII } from '@/lib/jobs/mask';
import { runOrdersSync } from '@/lib/erp/orders/run';
import { ORDER_CHANNELS, isOrderChannel } from '@/lib/erp/orders/types';
import { badRequest } from '@/lib/erp/stock/http';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { channel?: unknown } | null;
  const channel = body?.channel;
  if (channel !== undefined && channel !== null && !isOrderChannel(channel)) return badRequest(`채널이 잘못됐다: ${String(channel)}`);
  try {
    const data = await runOrdersSync({ channels: isOrderChannel(channel) ? [channel] : [...ORDER_CHANNELS], dryRun: false, trigger: 'manual' });
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ success: false, code: 'server', error: maskPII(e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
```

`supabase/migrations/118_pg_cron_orders_sync.sql`:
```sql
-- 118_pg_cron_orders_sync.sql
-- ERP 1-C2a. 주문 수집을 15분마다(pg_cron → /api/cron/orders-sync). 108(stock-sync)과 같은 방식 — URL·비밀값은 Vault(app_url, cron_secret).
-- 🔴 운영 앱에 /api/cron/orders-sync가 배포되고 컨트롤러가 첫 실행을 확인한 뒤에 적용한다(1-C2a 계획 Task 9 Step 5).
--    먼저 걸면 옛 배포에 라우트가 없어 15분마다 404가 나고 erp.job_runs에도 남지 않는다.
do $$ begin
  if (select count(*) from vault.decrypted_secrets
      where name in ('app_url','cron_secret') and coalesce(decrypted_secret,'') <> '') <> 2 then
    raise exception 'vault 비밀값(app_url, cron_secret)이 없다 — scripts/ops/set-cron-secrets.mjs 먼저 실행';
  end if;
end $$;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('orders-sync') where exists (select 1 from cron.job where jobname = 'orders-sync');

select cron.schedule(
  'orders-sync',
  '*/15 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/orders-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $job$
);
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/api/cron-orders-sync.test.ts && npx tsc --noEmit`
Expected: PASS(9 tests) · tsc 0

- [ ] **Step 5: 커밋**

```bash
git add src/lib/erp/orders/run.ts src/app/api/cron/orders-sync/route.ts src/app/api/erp/orders/sync/route.ts supabase/migrations/118_pg_cron_orders_sync.sql src/__tests__/api/cron-orders-sync.test.ts
git commit -m "feat(erp): 주문 수집 크론 라우트·화면 트리거·pg_cron 15분(118, 적용은 배포 뒤)"
```

---
### Task 7: 화면 — 수집 현황 패널 · 그날 라인 목록 · 「차감 켜기…」

**Files:**
- Create: `src/lib/erp/orders/queries.ts`
- Create: `src/app/api/erp/orders/status/route.ts`, `lines/route.ts`, `deduct-preview/route.ts`, `deduct-enable/route.ts`
- Create: `src/components/erp/stock/OrdersSyncPanel.tsx`, `OrderLinesDialog.tsx`, `DeductEnableDialog.tsx`
- Modify: `src/components/erp/stock/api.ts`, `src/components/erp/stock/StockClient.tsx`
- Create: `scripts/erp/orders-daily-counts.ts`(게이트 ① 건수표)
- Test: `src/__tests__/lib/erp/orders/queries.test.ts`, `src/__tests__/api/erp-orders.test.ts`, `src/__tests__/components/erp-orders-sync-panel.test.tsx`

#### 7-A. 조회 · API

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/erp/orders/queries.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ordersStatus } from '@/lib/erp/orders/queries';
import type { Db } from '@/lib/erp/ledger/store';

describe('ordersStatus', () => {
  it('KST 오늘 기준 채널별 건수 · 없는 채널은 0 · 마지막 실행의 채널별 오류', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const db: Db = {
      async query(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        if (sql.startsWith('select channel,')) {
          return { rows: [{ channel: 'naver', t_orders: 2, t_lines: 3, y_orders: 1, y_lines: 1, l3_orders: 4, l3_lines: 6, unattributed: 1, short: 0, pending: 5, unknown: 0 }], rowCount: 1 };
        }
        if (sql.startsWith('select name, cursor_at')) {
          return { rows: [{ name: 'ledger_cutover', cursor_at: new Date('2026-09-26T11:07:04.989Z') }, { name: 'orders:naver', cursor_at: new Date('2026-09-27T02:45:00Z') }], rowCount: 2 };
        }
        if (sql.startsWith('select started_at')) {
          return { rows: [{ started_at: new Date('2026-09-27T02:45:00Z'), finished_at: new Date('2026-09-27T02:45:40Z'), status: 'ok', counts: { naver_error: 0, toss_error: 1 }, error: null }], rowCount: 1 };
        }
        if (sql.startsWith('select value from erp.settings')) return { rows: [{ value: { enabled: false } }], rowCount: 1 };
        throw new Error(`예상 못 한 SQL: ${sql.slice(0, 50)}`);
      },
    };
    const s = await ordersStatus(db, new Date('2026-09-26T16:00:00.000Z'));
    expect(calls[0].params).toEqual(['2026-09-27']);
    expect(s.today).toBe('2026-09-27');
    expect(s.cutover).toBe('2026-09-26T11:07:04.989Z');
    expect(s.deduct).toEqual({ enabled: false, enabledAt: null, by: null });
    expect(s.channels.map((c) => c.channel)).toEqual(['coupang_wing', 'coupang_rg', 'naver', 'toss']);
    expect(s.channels[2]).toEqual({
      channel: 'naver', label: '네이버', today: { orders: 2, lines: 3 }, yesterday: { orders: 1, lines: 1 }, last3: { orders: 4, lines: 6 },
      unattributed: 1, short: 0, pending: 5, unknownStatus: 0, cursorAt: '2026-09-27T02:45:00.000Z', lastError: 0,
    });
    expect(s.channels[0]).toMatchObject({ today: { orders: 0, lines: 0 }, cursorAt: null, lastError: null });
    expect(s.channels[3].lastError).toBe(1);
    expect(s.lastRun).toEqual({ startedAt: '2026-09-27T02:45:00.000Z', finishedAt: '2026-09-27T02:45:40.000Z', status: 'ok', error: null });
  });
});
```

`src/__tests__/api/erp-orders.test.ts`:
```ts
// src/__tests__/api/erp-orders.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getPool: vi.fn(),
  ordersStatus: vi.fn(), dayLines: vi.fn(), previewBackfill: vi.fn(), enableDeduction: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: m.getPool }));
vi.mock('@/lib/erp/orders/queries', () => ({ ordersStatus: m.ordersStatus, dayLines: m.dayLines }));
vi.mock('@/lib/erp/orders/deduct', async () => {
  const actual = await vi.importActual<typeof import('@/lib/erp/orders/deduct')>('@/lib/erp/orders/deduct');
  return { ...actual, previewBackfill: m.previewBackfill, enableDeduction: m.enableDeduction };
});

import { DeductSwitchError } from '@/lib/erp/orders/deduct';

const client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })), release: vi.fn() };
const pool = { query: vi.fn(), connect: vi.fn(async () => client) };
const get = (path: string) => new NextRequest(`http://localhost${path}`);
const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  m.getCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  m.getPool.mockReturnValue(pool);
});

describe('/api/erp/orders/*', () => {
  it('로그인하지 않으면 네 라우트 모두 401', async () => {
    m.getCurrentUser.mockResolvedValue(null);
    const status = await import('@/app/api/erp/orders/status/route');
    const lines = await import('@/app/api/erp/orders/lines/route');
    const preview = await import('@/app/api/erp/orders/deduct-preview/route');
    const enable = await import('@/app/api/erp/orders/deduct-enable/route');
    expect((await status.GET(get('/api/erp/orders/status'))).status).toBe(401);
    expect((await lines.GET(get('/api/erp/orders/lines?channel=naver&date=2026-09-27'))).status).toBe(401);
    expect((await preview.GET(get('/api/erp/orders/deduct-preview'))).status).toBe(401);
    expect((await enable.POST(post('/api/erp/orders/deduct-enable', { confirm: true, expectedLines: 1 }))).status).toBe(401);
    expect(m.enableDeduction).not.toHaveBeenCalled();
  });

  it('GET status — 수집 현황', async () => {
    m.ordersStatus.mockResolvedValue({ today: '2026-09-27', channels: [] });
    const { GET } = await import('@/app/api/erp/orders/status/route');
    const res = await GET(get('/api/erp/orders/status'));
    expect((await res.json()).data.today).toBe('2026-09-27');
    expect(m.ordersStatus).toHaveBeenCalledWith(pool, expect.any(Date));
  });

  it('GET lines — 채널·날짜를 검사한다', async () => {
    m.dayLines.mockResolvedValue([{ id: 1 }]);
    const { GET } = await import('@/app/api/erp/orders/lines/route');
    expect((await GET(get('/api/erp/orders/lines?channel=karrot&date=2026-09-27'))).status).toBe(400);
    expect((await GET(get('/api/erp/orders/lines?channel=naver&date=2026-9-27'))).status).toBe(400);
    const res = await GET(get('/api/erp/orders/lines?channel=naver&date=2026-09-27'));
    expect((await res.json()).data).toEqual([{ id: 1 }]);
    expect(m.dayLines).toHaveBeenCalledWith(pool, 'naver', '2026-09-27');
  });

  it('GET deduct-preview', async () => {
    m.previewBackfill.mockResolvedValue({ lines: 3 });
    const { GET } = await import('@/app/api/erp/orders/deduct-preview/route');
    expect((await (await GET(get('/api/erp/orders/deduct-preview'))).json()).data).toEqual({ lines: 3 });
  });

  it('POST deduct-enable — confirm·expectedLines 필수, 한 트랜잭션에서 켠 사람과 함께', async () => {
    const { POST } = await import('@/app/api/erp/orders/deduct-enable/route');
    expect((await POST(post('/api/erp/orders/deduct-enable', { expectedLines: 1 }))).status).toBe(400);
    expect((await POST(post('/api/erp/orders/deduct-enable', { confirm: true, expectedLines: '1' }))).status).toBe(400);
    m.enableDeduction.mockResolvedValue({ preview: { lines: 1 }, summary: { posted: 1 } });
    const res = await POST(post('/api/erp/orders/deduct-enable', { confirm: true, expectedLines: 1 }));
    expect(res.status).toBe(200);
    expect(m.enableDeduction).toHaveBeenCalledWith(client, { expectedLines: 1, by: 'u-1', at: expect.any(String) });
    expect(client.query.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['BEGIN', 'COMMIT']);
  });

  it('POST deduct-enable — 이미 켜짐·수가 바뀜은 409(코드 그대로) · 롤백', async () => {
    const { POST } = await import('@/app/api/erp/orders/deduct-enable/route');
    m.enableDeduction.mockRejectedValue(new DeductSwitchError('stale', '소급할 라인이 바뀌었다'));
    const res = await POST(post('/api/erp/orders/deduct-enable', { confirm: true, expectedLines: 1 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, code: 'stale' });
    expect(client.query.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['BEGIN', 'ROLLBACK']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/queries.test.ts src/__tests__/api/erp-orders.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/erp/orders/queries"`

- [ ] **Step 3: 구현**

`src/lib/erp/orders/queries.ts`:
```ts
// src/lib/erp/orders/queries.ts
// 주문 수집 화면·게이트 ① 조회(읽기 전용). 날짜는 주문 시각의 KST 날짜(설계 해석 #22).
import type { Db } from '@/lib/erp/ledger/store';
import { readDeductSetting, type DeductSetting } from './store';
import { CHANNEL_LABEL, ORDER_CHANNELS, type OrderChannel, type StdStatus } from './types';
import { kstDay } from './window';

export interface DayCount {
  orders: number;
  lines: number;
}

export interface ChannelStatus {
  channel: OrderChannel;
  label: string;
  today: DayCount;
  yesterday: DayCount;
  /** 오늘 포함 3일 */
  last3: DayCount;
  /** 미귀속(취소·미결제 제외) — 1-C2b 대기열 */
  unattributed: number;
  /** 재고 부족으로 건너뛴 라인 */
  short: number;
  /** 차감 대기(스위치 꺼짐) */
  pending: number;
  unknownStatus: number;
  /** 마지막 성공 수집 시각(커서) */
  cursorAt: string | null;
  /** 마지막 실행에서 이 채널이 실패했나(1) · 성공(0) · 기록 없음(null) */
  lastError: 0 | 1 | null;
}

export interface OrdersStatus {
  /** KST 오늘 */
  today: string;
  cutover: string | null;
  deduct: DeductSetting;
  channels: ChannelStatus[];
  lastRun: { startedAt: string; finishedAt: string | null; status: string; error: string | null } | null;
}

export interface DayLine {
  id: number;
  externalOrderId: string;
  externalLineId: string;
  orderedAt: string;
  paidAt: string | null;
  status: StdStatus;
  rawStatus: string;
  productLabel: string;
  orderQty: number;
  skuQty: number;
  amount: number;
  attribution: 'mapped' | 'unattributed';
  unattributedReason: string | null;
  deductionState: string;
  deductionNote: string | null;
  /** '쿨매트 · 블루 ×2, …' */
  skuLabels: string;
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const n = (v: unknown) => Number(v ?? 0);

export async function ordersStatus(db: Db, now: Date): Promise<OrdersStatus> {
  const today = kstDay(now);
  const { rows } = await db.query(
    `select channel,
            count(distinct order_id) filter (where d = $1::date)::int as t_orders, count(*) filter (where d = $1::date)::int as t_lines,
            count(distinct order_id) filter (where d = $1::date - 1)::int as y_orders, count(*) filter (where d = $1::date - 1)::int as y_lines,
            count(distinct order_id) filter (where d between $1::date - 2 and $1::date)::int as l3_orders,
            count(*) filter (where d between $1::date - 2 and $1::date)::int as l3_lines,
            count(*) filter (where attribution = 'unattributed' and status not in ('canceled', 'unpaid'))::int as unattributed,
            count(*) filter (where deduction_state = 'skipped_short')::int as short,
            count(*) filter (where deduction_state = 'pending')::int as pending,
            count(*) filter (where status = 'unknown')::int as unknown
       from (select l.*, (l.ordered_at at time zone 'Asia/Seoul')::date as d from erp.order_lines l) x
      group by channel`,
    [today],
  );
  const byCh = new Map(rows.map((r) => [String(r.channel), r]));
  const cursors = await db.query(`select name, cursor_at from erp.sync_cursors where name = 'ledger_cutover' or name like 'orders:%'`);
  const cursorOf = new Map(cursors.rows.map((r) => [String(r.name), iso(r.cursor_at)]));
  const run = await db.query(
    `select started_at, finished_at, status, counts, error from erp.job_runs where job = 'orders-sync' order by started_at desc limit 1`,
  );
  const last = run.rows[0];
  const counts = (last?.counts ?? {}) as Record<string, number>;
  const deduct = await readDeductSetting(db);
  return {
    today,
    cutover: cursorOf.get('ledger_cutover') ?? null,
    deduct,
    channels: ORDER_CHANNELS.map((ch) => {
      const r = byCh.get(ch) ?? {};
      const errKey = `${ch}_error`;
      return {
        channel: ch,
        label: CHANNEL_LABEL[ch],
        today: { orders: n(r.t_orders), lines: n(r.t_lines) },
        yesterday: { orders: n(r.y_orders), lines: n(r.y_lines) },
        last3: { orders: n(r.l3_orders), lines: n(r.l3_lines) },
        unattributed: n(r.unattributed),
        short: n(r.short),
        pending: n(r.pending),
        unknownStatus: n(r.unknown),
        cursorAt: cursorOf.get(`orders:${ch}`) ?? null,
        lastError: last && errKey in counts ? (Number(counts[errKey]) > 0 ? 1 : 0) : null,
      };
    }),
    lastRun: last
      ? { startedAt: iso(last.started_at) as string, finishedAt: iso(last.finished_at), status: String(last.status), error: last.error ?? null }
      : null,
  };
}

export async function dayLines(db: Db, channel: OrderChannel, day: string): Promise<DayLine[]> {
  const { rows } = await db.query(
    `select l.id, o.external_order_id, l.external_line_id, l.ordered_at, l.paid_at, l.status, l.raw_status, l.product_label,
            l.order_qty, l.sku_qty, l.amount, l.attribution, l.unattributed_reason, l.deduction_state, l.deduction_note,
            coalesce((select string_agg(s.name || case when s.option_label <> '' then ' · ' || s.option_label else '' end || ' ×' || (a->>'qty'), ', ' order by s.id)
                        from jsonb_array_elements(l.alloc) a join erp.skus s on s.id = (a->>'skuId')::bigint), '') as sku_labels
       from erp.order_lines l join erp.orders o on o.id = l.order_id
      where l.channel = $1 and (l.ordered_at at time zone 'Asia/Seoul')::date = $2::date
      order by l.ordered_at, l.id`,
    [channel, day],
  );
  return rows.map((r) => ({
    id: Number(r.id), externalOrderId: String(r.external_order_id), externalLineId: String(r.external_line_id),
    orderedAt: iso(r.ordered_at) as string, paidAt: iso(r.paid_at), status: r.status as StdStatus, rawStatus: String(r.raw_status),
    productLabel: String(r.product_label ?? ''), orderQty: n(r.order_qty), skuQty: n(r.sku_qty), amount: n(r.amount),
    attribution: r.attribution, unattributedReason: r.unattributed_reason ?? null, deductionState: String(r.deduction_state),
    deductionNote: r.deduction_note ?? null, skuLabels: String(r.sku_labels ?? ''),
  }));
}

export interface DailyCountRow {
  day: string;
  channel: OrderChannel;
  orders: number;
  lines: number;
  qty: number;
  canceled: number;
  unattributed: number;
}

/** 게이트 ①: KST 날짜 × 채널 건수(주문 수 · 라인 수 · 수량 · 취소 · 미귀속) */
export async function dailyCounts(db: Db, fromDay: string): Promise<DailyCountRow[]> {
  const { rows } = await db.query(
    `select (ordered_at at time zone 'Asia/Seoul')::date::text as day, channel,
            count(distinct order_id)::int as orders, count(*)::int as lines, coalesce(sum(order_qty), 0)::int as qty,
            count(*) filter (where status in ('canceled', 'returned'))::int as canceled,
            count(*) filter (where attribution = 'unattributed')::int as unattributed
       from erp.order_lines
      where (ordered_at at time zone 'Asia/Seoul')::date >= $1::date
      group by 1, 2 order by 1, 2`,
    [fromDay],
  );
  return rows.map((r) => ({
    day: String(r.day), channel: r.channel as OrderChannel, orders: n(r.orders), lines: n(r.lines), qty: n(r.qty), canceled: n(r.canceled), unattributed: n(r.unattributed),
  }));
}
```

`src/app/api/erp/orders/status/route.ts`:
```ts
// GET /api/erp/orders/status — 주문 수집 현황(채널별 오늘·어제·3일 · 미귀속 · 재고 부족 · 대기 · 마지막 수집 · 차감 스위치)
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { ordersStatus } from '@/lib/erp/orders/queries';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ success: true, data: await ordersStatus(getSourcingPool(), new Date()) });
  } catch (e) {
    return erpError(e);
  }
}
```

`src/app/api/erp/orders/lines/route.ts`:
```ts
// GET /api/erp/orders/lines?channel=naver&date=2026-09-27 — 그 채널·KST 날짜(주문 시각)의 라인(구매자 정보 없음)
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { dayLines } from '@/lib/erp/orders/queries';
import { isOrderChannel } from '@/lib/erp/orders/types';
import { badRequest, erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const sp = request.nextUrl.searchParams;
  const channel = sp.get('channel');
  const date = sp.get('date') ?? '';
  if (!isOrderChannel(channel)) return badRequest(`채널이 잘못됐다: ${channel}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return badRequest(`날짜는 YYYY-MM-DD다: ${date}`);
  try {
    return NextResponse.json({ success: true, data: await dayLines(getSourcingPool(), channel, date) });
  } catch (e) {
    return erpError(e);
  }
}
```

`src/app/api/erp/orders/deduct-preview/route.ts`:
```ts
// GET /api/erp/orders/deduct-preview — 「차감 켜기」를 누르면 소급해서 빠질 것(라인·SKU·집/RG 감소량·재고 부족 SKU). 읽기 전용
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { previewBackfill } from '@/lib/erp/orders/deduct';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ success: true, data: await previewBackfill(getSourcingPool()) });
  } catch (e) {
    return erpError(e);
  }
}
```

`src/app/api/erp/orders/deduct-enable/route.ts`:
```ts
// POST /api/erp/orders/deduct-enable — 판매 차감 켜기(되돌리는 화면 없음). body { confirm: true, expectedLines }
// 한 트랜잭션: 설정 행 잠금 → 미리보기 다시 계산(화면이 본 소급 라인 수와 다르면 409 stale) → 켬(켠 시각·사람) → 기초재고 시각 이후 대기 라인 소급.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { DeductSwitchError, enableDeduction } from '@/lib/erp/orders/deduct';
import { badRequest, erpError, withTx } from '@/lib/erp/stock/http';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { confirm?: unknown; expectedLines?: unknown } | null;
  if (body?.confirm !== true) return badRequest('확인(confirm: true)이 없다');
  const expected = body.expectedLines;
  if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 0) return badRequest(`expectedLines는 0 이상 정수다: ${String(expected)}`);
  try {
    const data = await withTx((c) => enableDeduction(c, { expectedLines: expected, by: auth.userId, at: new Date().toISOString() }));
    return NextResponse.json({ success: true, data });
  } catch (e) {
    if (e instanceof DeductSwitchError) return NextResponse.json({ success: false, code: e.code, error: e.message }, { status: 409 });
    return erpError(e);
  }
}
```

`scripts/erp/orders-daily-counts.ts`:
```ts
// scripts/erp/orders-daily-counts.ts
// 사용법: npx --no-install tsx scripts/erp/orders-daily-counts.ts [--from=YYYY-MM-DD]
// 게이트 ①(1-C2a): KST 날짜 × 채널 주문 수·라인 수·수량·취소·미귀속. 사용자가 채널 관리자 화면(주문일 기준)과 대조한다.
// 읽기 전용(BEGIN READ ONLY). 구매자 정보는 표에 없다.
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { dailyCounts } from '@/lib/erp/orders/queries';
import { CHANNEL_LABEL } from '@/lib/erp/orders/types';

loadEnvLocal();

(async () => {
  const from = process.argv.find((a) => a.startsWith('--from='))?.slice('--from='.length) ?? '2026-09-26';
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const rows = await dailyCounts(c, from);
    console.log('날짜(KST 주문일) | 채널 | 주문 | 라인 | 수량 | 취소·반품 | 미귀속');
    for (const r of rows) {
      console.log(`${r.day} | ${CHANNEL_LABEL[r.channel]} | ${r.orders} | ${r.lines} | ${r.qty} | ${r.canceled} | ${r.unattributed}`);
    }
    const run = (await c.query(`select started_at, status, counts, error from erp.job_runs where job = 'orders-sync' order by started_at desc limit 1`)).rows[0];
    console.log(run ? `마지막 수집: ${new Date(run.started_at).toISOString()} · ${run.status}${run.error ? ` · ${run.error}` : ''}` : '수집 기록 없음');
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
})();
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/orders/queries.test.ts src/__tests__/api/erp-orders.test.ts && npx tsc --noEmit`
Expected: PASS(7 tests) · tsc 0

- [ ] **Step 5: 커밋**

```bash
git add src/lib/erp/orders/queries.ts src/app/api/erp/orders/ scripts/erp/orders-daily-counts.ts src/__tests__/lib/erp/orders/queries.test.ts src/__tests__/api/erp-orders.test.ts
git commit -m "feat(erp): 주문 수집 현황·날짜별 라인·소급 미리보기·차감 켜기 API · 게이트 ① 건수표 스크립트"
```

#### 7-B. 화면

- [ ] **Step 6: 실패하는 테스트 작성**

`src/__tests__/components/erp-orders-sync-panel.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import OrdersSyncPanel from '@/components/erp/stock/OrdersSyncPanel';
import { server } from '../mocks/server';

const ch = (channel: string, label: string, o: Record<string, unknown> = {}) => ({
  channel, label, today: { orders: 0, lines: 0 }, yesterday: { orders: 0, lines: 0 }, last3: { orders: 0, lines: 0 },
  unattributed: 0, short: 0, pending: 0, unknownStatus: 0, cursorAt: '2026-09-27T02:45:00.000Z', lastError: 0, ...o,
});
const STATUS = {
  today: '2026-09-27', cutover: '2026-09-26T11:07:04.989Z', deduct: { enabled: false, enabledAt: null, by: null },
  channels: [
    ch('coupang_wing', '쿠팡 판매자배송', { today: { orders: 3, lines: 4 } }),
    ch('coupang_rg', '쿠팡 RG'),
    ch('naver', '네이버', { unattributed: 2, pending: 5 }),
    ch('toss', '토스', { lastError: 1 }),
  ],
  lastRun: { startedAt: '2026-09-27T02:45:00.000Z', finishedAt: '2026-09-27T02:45:40.000Z', status: 'ok', error: null },
};
const PREVIEW = {
  cutover: '2026-09-26T11:07:04.989Z', lines: 7, skus: 4, self: 6, rg: 3, firstPaidAt: '2026-09-26T12:00:00.000Z', lastPaidAt: '2026-09-27T02:00:00.000Z',
  byChannel: { coupang_wing: 3, coupang_rg: 2, naver: 2, toss: 0 },
  shortages: [{ skuId: 9, name: '퓨어틴 커피', option: '', location: 'rg', need: 3, have: 1 }],
};

describe('OrdersSyncPanel', () => {
  it('채널별 건수·미귀속·실패를 보이고, 날짜 칸을 누르면 그날 라인을 연다', async () => {
    const seen: string[] = [];
    server.use(
      http.get('/api/erp/orders/status', () => HttpResponse.json({ success: true, data: STATUS })),
      http.get('/api/erp/orders/lines', ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ success: true, data: [{
          id: 1, externalOrderId: '31000000001', externalLineId: '6200000001:70000000001', orderedAt: '2026-09-27T01:15:00.000Z', paidAt: '2026-09-27T01:15:30.000Z',
          status: 'paid', rawStatus: 'ACCEPT', productLabel: '접이식 왜건 · 블랙', orderQty: 2, skuQty: 2, amount: 31800, attribution: 'mapped',
          unattributedReason: null, deductionState: 'pending', deductionNote: null, skuLabels: '왜건 · 블랙 ×2',
        }] });
      }),
    );
    render(<OrdersSyncPanel onChanged={vi.fn()} />);
    expect(await screen.findByText('쿠팡 판매자배송')).toBeInTheDocument();
    expect(screen.getByText(/기록만/)).toBeInTheDocument();
    expect(screen.getByText('실패')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '쿠팡 판매자배송 2026-09-27 3건 4줄' }));
    expect(await screen.findByText('접이식 왜건 · 블랙')).toBeInTheDocument();
    expect(seen).toEqual(['?channel=coupang_wing&date=2026-09-27']);
    expect(screen.getByText('왜건 · 블랙 ×2')).toBeInTheDocument();
  });

  it('「차감 켜기…」 — 미리보기를 보이고, 대조 확인을 체크해야 켜며, 본 라인 수를 보낸다', async () => {
    let body: unknown = null;
    server.use(
      http.get('/api/erp/orders/status', () => HttpResponse.json({ success: true, data: STATUS })),
      http.get('/api/erp/orders/deduct-preview', () => HttpResponse.json({ success: true, data: PREVIEW })),
      http.post('/api/erp/orders/deduct-enable', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { preview: PREVIEW, summary: { posted: 6, reversed: 0, short: 1, pending: 0, unchanged: 0 } } });
      }),
    );
    const onChanged = vi.fn();
    render(<OrdersSyncPanel onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: '차감 켜기…' }));
    expect(await screen.findByText(/소급 7줄/)).toBeInTheDocument();
    expect(screen.getByText(/집 −6개/)).toBeInTheDocument();
    expect(screen.getByText(/RG −3개/)).toBeInTheDocument();
    expect(screen.getByText(/퓨어틴 커피/)).toBeInTheDocument();
    const go = screen.getByRole('button', { name: '차감 켜기' });
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /3일 건수를 대조했습니다/ }));
    fireEvent.click(go);
    await waitFor(() => expect(body).toEqual({ confirm: true, expectedLines: 7 }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('「지금 수집」은 수집 API를 부르고 현황을 다시 읽는다', async () => {
    let statusCalls = 0;
    let synced = false;
    server.use(
      http.get('/api/erp/orders/status', () => { statusCalls++; return HttpResponse.json({ success: true, data: STATUS }); }),
      http.post('/api/erp/orders/sync', () => {
        synced = true;
        return HttpResponse.json({ success: true, data: [{ channel: 'naver', ok: true, inserted: 2, error: null }] });
      }),
    );
    render(<OrdersSyncPanel onChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /지금 수집/ }));
    await waitFor(() => expect(synced).toBe(true));
    await waitFor(() => expect(statusCalls).toBe(2));
  });
});
```

- [ ] **Step 7: 실패 확인**

Run: `npx vitest run src/__tests__/components/erp-orders-sync-panel.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/erp/stock/OrdersSyncPanel"`

- [ ] **Step 8: 구현**

`src/components/erp/stock/api.ts`:

(1) import 블록 끝
```ts
import type { CountQueueResponse } from '@/lib/erp/stock/count-queue';
```
을 아래로 바꾼다.
```ts
import type { CountQueueResponse } from '@/lib/erp/stock/count-queue';
import type { DayLine, OrdersStatus } from '@/lib/erp/orders/queries';
import type { BackfillPreview } from '@/lib/erp/orders/deduct';
import type { ChannelReport, DeductSummary } from '@/lib/erp/orders/collect';
```

(2) `export const fetchCountQueue = …` 줄 바로 아래에 더한다.
```ts
export const fetchOrdersStatus = () => call<OrdersStatus>('/api/erp/orders/status');
export const fetchDayLines = (channel: string, date: string) =>
  call<DayLine[]>(`/api/erp/orders/lines?channel=${encodeURIComponent(channel)}&date=${encodeURIComponent(date)}`);
export const fetchDeductPreview = () => call<BackfillPreview>('/api/erp/orders/deduct-preview');
export const postDeductEnable = (expectedLines: number) =>
  call<{ preview: BackfillPreview; summary: DeductSummary }>('/api/erp/orders/deduct-enable', { confirm: true, expectedLines });
export const postOrdersSync = (channel?: string) => call<ChannelReport[]>('/api/erp/orders/sync', channel ? { channel } : {});
```

`src/components/erp/stock/OrderLinesDialog.tsx`:
```tsx
'use client';

/** 그날(KST 주문일) 한 채널의 주문 라인. 구매자 정보는 서버에도 없다. 재고 부족·미귀속 줄은 색으로 구분한다 */
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { bandStyle, numTdStyle, thStyle } from '@/components/orders/erp-ui';
import type { DayLine } from '@/lib/erp/orders/queries';
import { fetchDayLines } from './api';
import { fmtKst, won } from './stock-view';

const REASON: Record<string, string> = {
  no_listing: '리스팅 없음', any_of: '옵션 여럿(any_of)', option_unmatched: '옵션 불일치', no_sku_link: 'SKU 연결 없음',
};
const STATE: Record<string, string> = {
  pending: '대기(꺼짐)', posted: '차감', skipped_short: '재고 부족', reversed: '되돌림', none: '대상 아님',
};
const NOTE: Record<string, string> = {
  pre_cutover: '기초 이전', not_paid: '미결제', voided: '취소·반품', unattributed: '미귀속', unknown_status: '모르는 상태',
};
const td: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`, borderRight: `1px solid ${E.lineSoft}`, padding: '4px 6px', fontSize: 11.5, whiteSpace: 'nowrap',
};

interface Props {
  channel: string;
  label: string;
  date: string;
  onClose: () => void;
}

export default function OrderLinesDialog({ channel, label, date, onClose }: Props) {
  const [items, setItems] = useState<DayLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchDayLines(channel, date).then((r) => {
      if (!alive) return;
      if (!r.ok) setError(r.error);
      else setItems(r.data);
    });
    return () => {
      alive = false;
    };
  }, [channel, date]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)' }} />
      <div
        role="dialog"
        aria-label={`${label} ${date} 주문 라인`}
        style={{ position: 'relative', width: 'min(1200px, 96vw)', maxHeight: '88vh', overflow: 'auto', background: E.surface, border: `1px solid ${E.line}`, color: E.ink, fontSize: 12 }}
      >
        <div style={{ ...bandStyle, justifyContent: 'space-between' }}>
          <span>{label} — {date} 주문 라인{items ? ` ${items.length}줄` : ''}</span>
          <button type="button" aria-label="닫기" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex' }}><X size={13} /></button>
        </div>
        {error && <div role="alert" style={{ padding: 10, color: E.loss }}>{error}</div>}
        {!items && !error && <div style={{ padding: 10, color: E.inkMute }}>불러오는 중…</div>}
        {items && items.length === 0 && <div style={{ padding: 10, color: E.inkMute }}>이날 수집한 라인이 없습니다</div>}
        {items && items.length > 0 && (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>{['주문 시각', '주문번호', '상품', '수량', 'SKU', '금액', '채널 상태', '연결', '차감'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {items.map((l) => {
                const tone = l.deductionState === 'skipped_short' ? E.loss : l.attribution === 'unattributed' ? E.warn : E.ink;
                return (
                  <tr key={l.id} style={{ color: tone }}>
                    <td style={td}>{fmtKst(l.orderedAt)}</td>
                    <td style={{ ...td, fontFamily: E.mono }}>{l.externalOrderId}</td>
                    <td style={{ ...td, whiteSpace: 'normal', maxWidth: 280 }}>{l.productLabel}</td>
                    <td style={{ ...numTdStyle, fontSize: 11.5 }}>{won(l.orderQty)}</td>
                    <td style={{ ...td, whiteSpace: 'normal', maxWidth: 220 }}>{l.skuLabels || '—'}</td>
                    <td style={{ ...numTdStyle, fontSize: 11.5 }}>{won(l.amount)}</td>
                    <td style={td}>{l.rawStatus}</td>
                    <td style={td}>{l.attribution === 'mapped' ? '연결' : REASON[l.unattributedReason ?? ''] ?? '미귀속'}</td>
                    <td style={{ ...td, whiteSpace: 'normal', maxWidth: 220 }}>
                      {STATE[l.deductionState] ?? l.deductionState}
                      {l.deductionNote ? ` · ${NOTE[l.deductionNote] ?? l.deductionNote}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

`src/components/erp/stock/DeductEnableDialog.tsx`:
```tsx
'use client';

/**
 * 「차감 켜기…」 확인 창(게이트 ②). 켜면 기초재고 시각 이후 결제된 대기 라인을 결제 시각 순으로 원장에서 뺀다 — 끄는 화면은 없다.
 * 서버가 다시 센 소급 라인 수가 이 창이 본 수와 다르면 409 stale → 미리보기를 다시 읽는다.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { toast } from '@/components/ui/toast';
import { bandStyle, btnStyle, disabledBtnStyle, primaryBtnStyle } from '@/components/orders/erp-ui';
import type { BackfillPreview } from '@/lib/erp/orders/deduct';
import { CHANNEL_LABEL, ORDER_CHANNELS } from '@/lib/erp/orders/types';
import { fetchDeductPreview, postDeductEnable } from './api';
import { LOC_LABEL, fmtKst, won } from './stock-view';

interface Props {
  onClose: () => void;
  onDone: () => void;
}

export default function DeductEnableDialog({ onClose, onDone }: Props) {
  const [preview, setPreview] = useState<BackfillPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setPreview(null);
    const r = await fetchDeductPreview();
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setPreview(r.data);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 창을 열 때 미리보기를 읽는다
  useEffect(() => { void load(); }, [load]);

  async function enable() {
    if (!preview) return;
    setBusy(true);
    const r = await postDeductEnable(preview.lines);
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      if (r.code === 'stale') { setChecked(false); await load(); }
      return;
    }
    const s = r.data.summary;
    toast.success(`판매 차감을 켰습니다 — ${won(s.posted)}줄 차감${s.short > 0 ? ` · 재고 부족 ${won(s.short)}줄(재고를 고치면 다음 수집에서 빠집니다)` : ''}`);
    onDone();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)' }} />
      <div
        role="dialog"
        aria-label="판매 차감 켜기"
        style={{ position: 'relative', width: 'min(720px, 94vw)', maxHeight: '88vh', overflow: 'auto', background: E.surface, border: `1px solid ${E.line}`, color: E.ink, fontSize: 12 }}
      >
        <div style={{ ...bandStyle, justifyContent: 'space-between' }}>
          <span>판매 차감 켜기 — 기초재고 시각부터 소급</span>
          <button type="button" aria-label="닫기" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex' }}><X size={13} /></button>
        </div>
        {error && <div role="alert" style={{ margin: 12, padding: 8, border: `1px solid ${E.loss}`, color: E.loss }}>{error}</div>}
        {!preview && !error && <div style={{ padding: 12, color: E.inkMute }}>계산하는 중…</div>}
        {preview && (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 14, fontFamily: E.mono, flexWrap: 'wrap' }}>
              <span>소급 {won(preview.lines)}줄</span>
              <span>SKU {won(preview.skus)}개</span>
              <span>집 −{won(preview.self)}개</span>
              <span>RG −{won(preview.rg)}개</span>
            </div>
            <div style={{ color: E.inkSub }}>
              채널: {ORDER_CHANNELS.map((c) => `${CHANNEL_LABEL[c]} ${won(preview.byChannel[c])}`).join(' · ')}
              {preview.firstPaidAt && ` · 결제 ${fmtKst(preview.firstPaidAt)} ~ ${fmtKst(preview.lastPaidAt ?? preview.firstPaidAt)}`}
            </div>
            <div style={{ color: E.inkSub }}>
              기초재고 시각 {fmtKst(preview.cutover)} 이전 결제는 빼지 않습니다(기초재고에 이미 반영). 취소·반품 완료 라인은 되돌림 전표가 자동으로 남습니다 —
              그 물건을 재고현황에서 「반품입고」로 다시 올리지 않습니다.
            </div>
            {preview.shortages.length > 0 && (
              <div style={{ border: `1px solid ${E.warn}`, background: E.warnSoft, color: E.warn, padding: 8 }}>
                <b>재고 부족 {preview.shortages.length}건 — 이 SKU의 라인은 「재고 부족」으로 남고, 재고를 고치면 다음 수집에서 빠집니다</b>
                {preview.shortages.map((s) => (
                  <div key={`${s.skuId}:${s.location}`}>
                    · {s.name}{s.option ? ` · ${s.option}` : ''} — {LOC_LABEL[s.location]} 필요 {won(s.need)} / 원장 {won(s.have)}
                  </div>
                ))}
              </div>
            )}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              채널 관리자 화면과 3일 건수를 대조했습니다
            </label>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={btnStyle}>닫기</button>
              <button type="button" disabled={!checked || busy} onClick={() => void enable()} style={!checked || busy ? disabledBtnStyle : primaryBtnStyle}>
                {busy ? '켜는 중…' : '차감 켜기'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

`src/components/erp/stock/OrdersSyncPanel.tsx`:
```tsx
'use client';

/**
 * 주문 수집 현황(재고현황 위 · 1-C2a). 채널별 오늘·어제·3일 건수 · 미귀속 · 재고 부족 · 차감 대기 · 마지막 수집 · 마지막 실행 성패.
 * 날짜 칸을 누르면 그날 라인. 스위치가 꺼져 있으면(기록만) 「차감 켜기…」 확인 창을 연다.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShoppingCart } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { toast } from '@/components/ui/toast';
import { Tag, bandStyle, btnStyle, disabledBtnStyle, numTdStyle, primaryBtnStyle, thStyle } from '@/components/orders/erp-ui';
import type { DayCount, OrdersStatus } from '@/lib/erp/orders/queries';
import { addDays } from '@/lib/erp/orders/window';
import { fetchOrdersStatus, postOrdersSync } from './api';
import OrderLinesDialog from './OrderLinesDialog';
import DeductEnableDialog from './DeductEnableDialog';
import { fmtKst, won } from './stock-view';

interface Props {
  /** 차감을 켜거나 수집으로 원장이 바뀌었을 때 — 재고 표를 다시 읽는다 */
  onChanged: () => void;
}

const textTd: React.CSSProperties = {
  borderBottom: `1px solid ${E.lineSoft}`, borderRight: `1px solid ${E.lineSoft}`, padding: '4px 8px', fontSize: 12, whiteSpace: 'nowrap',
};
const cellBtn: React.CSSProperties = { border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: E.ink, fontFamily: E.mono, fontSize: 12 };

export default function OrdersSyncPanel({ onChanged }: Props) {
  const [status, setStatus] = useState<OrdersStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(true);
  const [lines, setLines] = useState<{ channel: string; label: string; date: string } | null>(null);
  const [enabling, setEnabling] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchOrdersStatus();
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setStatus(r.data);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 진입 시 수집 현황을 읽는다
  useEffect(() => { void load(); }, [load]);

  async function syncNow() {
    setSyncing(true);
    const r = await postOrdersSync();
    setSyncing(false);
    if (!r.ok) {
      toast.error(r.error);
    } else {
      const bad = r.data.filter((x) => !x.ok);
      const added = r.data.reduce((s, x) => s + (x.inserted ?? 0), 0);
      if (bad.length > 0) toast.error(`일부 채널 실패 — ${bad.map((b) => `${b.channel}: ${b.error ?? ''}`).join(' / ')}`);
      else toast.success(`수집했습니다 — 새 라인 ${won(added)}줄`);
      onChanged();
    }
    await load();
  }

  const day = (c: { channel: string; label: string }, date: string, v: DayCount) => (
    <button
      type="button"
      aria-label={`${c.label} ${date} ${v.orders}건 ${v.lines}줄`}
      onClick={() => setLines({ channel: c.channel, label: c.label, date })}
      style={cellBtn}
    >
      {won(v.orders)}건 · {won(v.lines)}줄
    </button>
  );

  const enabled = status?.deduct.enabled === true;
  return (
    <div style={{ background: E.surface, border: `1px solid ${E.line}`, marginBottom: 10 }}>
      <div style={{ ...bandStyle, justifyContent: 'space-between' }}>
        <button type="button" onClick={() => setOpen((v) => !v)} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: E.ink }}>
          <ShoppingCart size={12} /> 주문 수집 —{' '}
          {enabled
            ? <span style={{ color: E.profit }}>판매 차감 켜짐{status?.deduct.enabledAt ? `(${fmtKst(status.deduct.enabledAt)}부터)` : ''}</span>
            : <span style={{ color: E.warn }}>기록만(판매 차감 꺼짐)</span>}
        </button>
        <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" disabled={syncing} onClick={() => void syncNow()} style={syncing ? disabledBtnStyle : btnStyle}>
            <RefreshCw size={12} /> {syncing ? '수집 중…' : '지금 수집'}
          </button>
          {status && !enabled && (
            <button type="button" onClick={() => setEnabling(true)} style={primaryBtnStyle}>차감 켜기…</button>
          )}
        </span>
      </div>
      {error && <div role="alert" style={{ padding: 8, color: E.loss }}>{error}</div>}
      {open && status && (
        <>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>{['채널', `오늘 ${status.today}`, '어제', '3일', '미귀속', '재고 부족', '차감 대기', '마지막 수집', '상태'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {status.channels.map((c) => (
                <tr key={c.channel}>
                  <td style={textTd}>{c.label}</td>
                  <td style={textTd}>{day(c, status.today, c.today)}</td>
                  <td style={textTd}>{day(c, addDays(status.today, -1), c.yesterday)}</td>
                  <td style={{ ...textTd, fontFamily: E.mono }}>{won(c.last3.orders)}건 · {won(c.last3.lines)}줄</td>
                  <td style={{ ...numTdStyle, color: c.unattributed > 0 ? E.warn : E.ink }}>{won(c.unattributed)}</td>
                  <td style={{ ...numTdStyle, color: c.short > 0 ? E.loss : E.ink }}>{won(c.short)}</td>
                  <td style={numTdStyle}>{won(c.pending)}</td>
                  <td style={textTd}>{c.cursorAt ? fmtKst(c.cursorAt) : '—'}</td>
                  <td style={textTd}>
                    {c.lastError === 1 ? <Tag tone={E.loss}>실패</Tag> : c.lastError === 0 ? <Tag tone={E.profit}>정상</Tag> : <Tag tone={E.inkMute}>기록 없음</Tag>}
                    {c.unknownStatus > 0 && <span style={{ marginLeft: 4, color: E.warn }}>모르는 상태 {c.unknownStatus}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '6px 10px', color: E.inkSub, fontSize: 11 }}>
            15분마다 자동 수집합니다(기초재고 시각 {status.cutover ? fmtKst(status.cutover) : '—'} 이후). 건수는 주문 시각(KST) 기준입니다.
            {status.lastRun && ` 마지막 실행 ${fmtKst(status.lastRun.startedAt)} · ${status.lastRun.status}${status.lastRun.error ? ` · ${status.lastRun.error}` : ''}`}
            {enabled && ' 취소·반품 완료 라인은 자동으로 되돌립니다 — 그 물건을 「반품입고」로 다시 올리지 않습니다.'}
          </div>
        </>
      )}
      {lines && <OrderLinesDialog channel={lines.channel} label={lines.label} date={lines.date} onClose={() => setLines(null)} />}
      {enabling && (
        <DeductEnableDialog
          onClose={() => setEnabling(false)}
          onDone={() => { setEnabling(false); void load(); onChanged(); }}
        />
      )}
    </div>
  );
}
```

`src/components/erp/stock/StockClient.tsx`:

(1) import 줄
```ts
import CountQueuePanel from './CountQueuePanel';
```
을 아래로 바꾼다.
```ts
import CountQueuePanel from './CountQueuePanel';
import OrdersSyncPanel from './OrdersSyncPanel';
```

(2) 본문의
```tsx
      <CountQueuePanel rowById={rowById} busy={saving} onSave={saveOne} />
```
를 아래로 바꾼다.
```tsx
      <OrdersSyncPanel onChanged={() => void load()} />

      <CountQueuePanel rowById={rowById} busy={saving} onSave={saveOne} />
```

(3) RG 반영 확인 문구의 `판매 차감(1-C2) 전이라 RG 판매도 차이로 보입니다. 확인한 것만 반영하세요.`를 `판매 차감이 꺼져 있으면(기록만) RG 판매도 차이로 보입니다. 확인한 것만 반영하세요.`로 바꾼다.

- [ ] **Step 9: 통과 확인**

Run: `npx vitest run src/__tests__/components/erp-orders-sync-panel.test.tsx src/__tests__/components/ && npx tsc --noEmit`
Expected: 새 3건 PASS · 기존 컴포넌트 테스트 그대로 · tsc 0. 🔵 기존 `StockClient`를 그리는 테스트가 있으면(Task 0 이후 생겼다면) `/api/erp/orders/status` 모의가 없어 경고만 날 수 있다 — msw `onUnhandledRequest` 설정이 `error`면 그 테스트에 `http.get('/api/erp/orders/status', …)`를 더한다.

- [ ] **Step 10: 커밋**

```bash
git add src/components/erp/stock/OrdersSyncPanel.tsx src/components/erp/stock/OrderLinesDialog.tsx src/components/erp/stock/DeductEnableDialog.tsx src/components/erp/stock/api.ts src/components/erp/stock/StockClient.tsx src/__tests__/components/erp-orders-sync-panel.test.tsx
git commit -m "feat(erp): 재고현황 주문 수집 패널 · 그날 라인 목록 · 차감 켜기 확인 창"
```

- [ ] **Step 11: 🔴 화면 확인(컨트롤러 — 서브에이전트에게 맡기지 않는다)**

`npm run dev`(백그라운드) → 사용자가 `http://localhost:3000/login`에서 직접 로그인 → `/erp/stock`(1440px). 이 시점에는 수집 기록이 없으므로 패널은 **모든 채널 0건 · 「기록 없음」 · 「기록만(판매 차감 꺼짐)」**이어야 한다.
- 「차감 켜기…」를 **열기만** 한다: 「소급 0줄 · SKU 0개 · 집 −0개 · RG −0개」, 체크 전 「차감 켜기」 비활성. **누르지 않고 「닫기」**(스위치는 게이트 ②에서만).
- 「지금 수집」은 **누르지 않는다**(첫 실제 수집은 Task 9에서 운영 배포 뒤 컨트롤러가 한다 — 로컬에서 누르면 운영 DB에 쓴다).
- 입출 이력(표에서 SKU 선택) 패널이 그대로인지 본다.

---
### Task 8: 옛 불러오기 버튼 → 새 수집 · 옛 라우트 410

**Files:**
- Modify: `src/components/orders/import-summary.ts`, `src/components/orders/CostManagementTab.tsx`, `src/components/orders/SaleEntryPanel.tsx`
- Modify(410으로 교체): `src/app/api/cost-management/rg-bulk-import/route.ts`, `wing-bulk-import/route.ts`, `naver-bulk-import/route.ts`, `products/[id]/coupang-import/route.ts`
- Test: `src/__tests__/components/import-summary.test.ts`(추가), `src/__tests__/api/legacy-import-gone.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/components/import-summary.test.ts`의 import 줄
```ts
import { buildImportSummary } from '@/components/orders/import-summary';
```
을 아래로 바꾼다.
```ts
import { buildImportSummary, summarizeOrdersSync } from '@/components/orders/import-summary';
```
파일 끝에 더한다.
```ts

describe('summarizeOrdersSync', () => {
  it('주문 수집 보고서를 옛 결과 창 모양으로 — 신규 = 새 라인, 스킵 = 갱신, 취소 = 옛 장부 무효화', () => {
    const s = summarizeOrdersSync([
      { channel: 'coupang_wing', ok: true, fetched: 5, inserted: 2, updated: 3, legacy: { upserted: 5, inserted: 2, voided: 1 }, error: null },
      { channel: 'naver', ok: false, fetched: 0, inserted: 0, updated: 0, legacy: { upserted: 0, inserted: 0, voided: 0 }, error: '[네이버 API] 500' },
    ]);
    expect(s.channels).toEqual([
      { channel: '윙', success: true, imported: 2, skipped: 3, total: 5, voided: 1 },
      { channel: '네이버', success: false, imported: 0, skipped: 0, total: 0, voided: 0, error: '[네이버 API] 500' },
    ]);
    expect(s).toMatchObject({ totalImported: 2, totalVoided: 1, hasError: true });
  });
});
```

`src/__tests__/api/legacy-import-gone.test.ts`:
```ts
// 옛 판매 불러오기 4개는 410 — 새 주문 수집(sale_records까지 기록)과 이중 기록되지 않게(ERP 1-C2a)
import { describe, it, expect } from 'vitest';

describe('옛 판매 불러오기 라우트', () => {
  it.each([
    ['rg-bulk-import', () => import('@/app/api/cost-management/rg-bulk-import/route')],
    ['wing-bulk-import', () => import('@/app/api/cost-management/wing-bulk-import/route')],
    ['naver-bulk-import', () => import('@/app/api/cost-management/naver-bulk-import/route')],
    ['coupang-import', () => import('@/app/api/cost-management/products/[id]/coupang-import/route')],
  ])('%s — 410 gone', async (_name, load) => {
    const { POST } = await load();
    const res = await POST();
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ success: false, code: 'gone' });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/components/import-summary.test.ts src/__tests__/api/legacy-import-gone.test.ts`
Expected: FAIL — `summarizeOrdersSync is not a function` · 410이 아니다(옛 라우트는 인증 없이 401)

- [ ] **Step 3: 구현**

`src/components/orders/import-summary.ts` 끝에 더한다.
```ts

/** 주문 수집 보고서(ERP 1-C2a, /api/erp/orders/sync)에서 결과 창에 필요한 칸만 */
export interface OrdersSyncReportLike {
  channel: string;
  ok: boolean;
  fetched: number;
  inserted: number;
  updated: number;
  legacy?: { voided: number };
  error: string | null;
}

const SYNC_LABEL: Record<string, string> = { coupang_wing: '윙', coupang_rg: 'RG', naver: '네이버', toss: '토스' };

/** 원가관리 「판매 가져오기」 결과 창을 새 수집 결과로 채운다. 신규 = 새 라인 · 스킵 = 이미 있던 라인 갱신 · 취소 = 옛 장부 무효화 */
export function summarizeOrdersSync(reports: OrdersSyncReportLike[]): ImportSummary {
  const channels: ChannelImportResult[] = reports.map((r) =>
    r.ok
      ? { channel: SYNC_LABEL[r.channel] ?? r.channel, success: true, imported: r.inserted, skipped: r.updated, total: r.fetched, voided: r.legacy?.voided ?? 0 }
      : { channel: SYNC_LABEL[r.channel] ?? r.channel, success: false, imported: 0, skipped: 0, total: 0, voided: 0, error: r.error ?? '실패' },
  );
  return {
    channels,
    totalImported: channels.reduce((s, c) => s + c.imported, 0),
    totalVoided: channels.reduce((s, c) => s + c.voided, 0),
    hasError: channels.some((c) => !c.success),
  };
}
```

`src/components/orders/CostManagementTab.tsx`:

(1) 18행
```ts
import { buildImportSummary, type ImportSummary } from './import-summary';
```
을 아래로 바꾼다.
```ts
import { summarizeOrdersSync, type ImportSummary } from './import-summary';
```

(2) `runAllBulkImport` 함수 전체(`async function runAllBulkImport() {` 부터 그 함수의 닫는 `}`까지 — `runBulkSetupVariants` 바로 위)를 아래로 바꾼다.
```ts
  async function runAllBulkImport() {
    setImportingAll(true);
    try {
      // ERP 1-C2a: 채널별 옛 불러오기 3개 대신 주문 수집을 한 번 돌린다(기초재고 시각 이후 · 옛 장부 자동 기록 · 15분마다 자동)
      const res = await fetch('/api/erp/orders/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => null);
      setImportResult(
        json?.success
          ? summarizeOrdersSync(json.data)
          : {
              channels: [{ channel: '주문 수집', success: false, imported: 0, skipped: 0, total: 0, voided: 0, error: json?.error ?? `요청 실패 (${res.status})` }],
              totalImported: 0,
              totalVoided: 0,
              hasError: true,
            },
      );
      setLastSyncedAt(
        new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      );
      load();
    } finally {
      setImportingAll(false);
    }
  }
```

(3) 버튼
```tsx
        <button
          onClick={runAllBulkImport}
          disabled={importingAll}
          style={{ ...btnStyle, opacity: importingAll ? 0.6 : 1, cursor: importingAll ? 'not-allowed' : 'pointer' }}
        >
```
를 아래로 바꾼다(제목 속성만 더한다).
```tsx
        <button
          onClick={runAllBulkImport}
          disabled={importingAll}
          title="판매는 15분마다 자동 수집됩니다(2026-09-26 기초재고 이후). 누르면 지금 한 번 더 수집합니다"
          style={{ ...btnStyle, opacity: importingAll ? 0.6 : 1, cursor: importingAll ? 'not-allowed' : 'pointer' }}
        >
```

`src/components/orders/SaleEntryPanel.tsx`:

(1) 50~53행
```ts
interface ImportForm {
  from: string;
  to: string;
}
```
을 지운다(빈 줄 하나만 남긴다).

(2) 89~92행
```ts
  const [importForm, setImportForm] = useState<ImportForm>({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });
```
을 지운다.

(3) `runImport` 함수 전체를 아래로 바꾼다.
```ts
  async function runImport() {
    setImporting(true);
    try {
      // ERP 1-C2a: 상품별 채널 조회(옛 coupang-import — 무접두 키로 이중 기록) 대신 주문 수집을 한 번 돌린다
      const res = await fetch('/api/erp/orders/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => null);
      if (json?.success) {
        const reports = json.data as { ok: boolean; inserted: number }[];
        const added = reports.reduce((s, r) => s + (r.inserted ?? 0), 0);
        const failed = reports.filter((r) => !r.ok).length;
        toast.success(`주문 수집 — 새 라인 ${added}건${failed > 0 ? ` · 실패 채널 ${failed}개` : ''}`);
        await load();
        onChanged();
        setShowImportForm(false);
      } else {
        toast.error(json?.error ?? '수집에 실패했습니다.');
      }
    } finally {
      setImporting(false);
    }
  }
```

(4) 날짜 입력 폼
```tsx
            <input type="date" value={importForm.from} onChange={(e) => setImportForm((f) => ({ ...f, from: e.target.value }))}
              style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #bae6fd', fontSize: '11px', color: '#18181b' }} />
            <span style={{ color: '#64748b' }}>~</span>
            <input type="date" value={importForm.to} onChange={(e) => setImportForm((f) => ({ ...f, to: e.target.value }))}
              style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid #bae6fd', fontSize: '11px', color: '#18181b' }} />
            <button onClick={runImport} disabled={importing}
              style={{ padding: '3px 10px', borderRadius: '4px', background: '#1d4ed8', color: '#fff', border: 'none', fontSize: '11px', cursor: importing ? 'not-allowed' : 'pointer' }}>
              {importing ? '가져오는 중...' : '실행'}
            </button>
```
를 아래로 바꾼다.
```tsx
            <span style={{ color: '#475569' }}>
              판매는 15분마다 모든 채널에서 자동 수집됩니다(2026-09-26 기초재고 이후). 그 전 기간은 다시 불러오지 않습니다.
            </span>
            <button onClick={runImport} disabled={importing}
              style={{ padding: '3px 10px', borderRadius: '4px', background: '#1d4ed8', color: '#fff', border: 'none', fontSize: '11px', cursor: importing ? 'not-allowed' : 'pointer' }}>
              {importing ? '수집 중...' : '지금 수집'}
            </button>
```

옛 라우트 4개는 **파일 전체를** 아래 모양으로 바꾼다(첫 줄 주석의 경로만 파일마다 다르다). 옛 구현은 git 기록에 남는다.

`src/app/api/cost-management/rg-bulk-import/route.ts`:
```ts
// POST /api/cost-management/rg-bulk-import — 2026-09-26 ERP 1-C2a로 폐지(410).
// 판매는 주문 수집(/api/cron/orders-sync 15분 · 화면 「지금 수집」 = POST /api/erp/orders/sync)이 sale_records까지 기록한다.
// 옛 구현은 RG 청크 끝 날짜를 배타로 넘겨 하루씩 잃었고(무효 1,062건), 상품별 불러오기는 무접두 키로 판매자배송을 이중 기록했다 —
// 살려 두면 다시 쓴다. 옛 코드는 git 기록에 있다. 기초재고 이전 행 복구는 1-C2b.
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { success: false, code: 'gone', error: '이 불러오기는 폐지됐습니다 — 판매는 15분마다 자동 수집됩니다(재고현황·원가관리의 「지금 수집」)' },
    { status: 410 },
  );
}
```
`wing-bulk-import/route.ts` · `naver-bulk-import/route.ts` · `products/[id]/coupang-import/route.ts`도 같은 내용(첫 줄의 경로만 `POST /api/cost-management/wing-bulk-import` · `…/naver-bulk-import` · `…/products/[id]/coupang-import`로).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/components/import-summary.test.ts src/__tests__/api/legacy-import-gone.test.ts && npx tsc --noEmit && grep -rn "bulk-import\|coupang-import" src --include='*.ts' --include='*.tsx' | grep -v "^src/app/api/cost-management" | grep -v "__tests__"`
Expected: PASS · tsc 0 · 마지막 grep 출력 없음(화면이 옛 라우트를 부르지 않는다). `src/lib/cost-management/cancel-sync.ts`는 이제 쓰는 곳이 없지만 지우지 않는다(자체 테스트가 있고 1-C2b 과거 복구에서 참고한다).

- [ ] **Step 5: 커밋**

```bash
git add src/components/orders/import-summary.ts src/components/orders/CostManagementTab.tsx src/components/orders/SaleEntryPanel.tsx src/app/api/cost-management/rg-bulk-import/route.ts src/app/api/cost-management/wing-bulk-import/route.ts src/app/api/cost-management/naver-bulk-import/route.ts "src/app/api/cost-management/products/[id]/coupang-import/route.ts" src/__tests__/components/import-summary.test.ts src/__tests__/api/legacy-import-gone.test.ts
git commit -m "feat(erp): 판매 가져오기 버튼 → 주문 수집 · 옛 불러오기 4개 라우트 410"
```

- [ ] **Step 6: 🔴 화면 확인(컨트롤러)**

`/orders`(원가관리 탭) — 수익·원가 표가 그대로 뜨는지(행·합계가 Task 0 전과 같다), 「판매 가져오기」에 마우스를 올리면 새 안내 문구. 상품 하나의 판매 내역 패널 → 「판매 가져오기」를 **열기만** 해서 날짜 입력 대신 안내 문구와 「지금 수집」이 보이는지. **누르지 않는다**(운영 DB에 쓴다 — 첫 수집은 Task 9).

---

### Task 9: 마무리 — 테스트·빌드·리뷰·PR · 병합 뒤 첫 실행과 크론

- [ ] **Step 1: 전체 확인**

Run: `npx vitest run 2>&1 | tail -6 && npx tsc --noEmit && npx next build 2>&1 | tail -20 && npx --no-install tsx scripts/erp/orders-selftest.ts`
Expected: 실패 수 ≤ 기준선(Task 0) · tsc 0 · 빌드 성공(새 라우트 `/api/cron/orders-sync`·`/api/erp/orders/*` 목록에 보인다. 실패하면 main에서도 실패하는지 먼저 확인해 원인을 가른다) · 자가시험 12행 ✅.

- [ ] **Step 2: 개인정보 점검**

Run: `grep -rnE "orderer|receiver|shippingAddress|ordererTel|receiverPhone|address" src/lib/erp/orders supabase/migrations/117_erp_orders.sql supabase/migrations/118_pg_cron_orders_sync.sql`
Expected: 어댑터 주석(「옮기지 않는다」)에만 나온다. 표·SQL·표준 라인 칸에는 없다.

- [ ] **Step 3: 최종 리뷰와 PR — 🔴 병합은 사용자 확인 후**

superpowers:requesting-code-review로 설계서 §1~§6·이 계획서 「설계 해석」 표를 기준으로 리뷰한다. 지적은 고치고 `fix(erp): …`로 커밋한다. 브랜치 푸시 → `gh pr create`(제목 `ERP 1-C2a — 주문 수집·판매 차감(기록 모드)`). 본문: Task 1~8 요약 · 마이그레이션 117(운영 적용됨)·118(병합 뒤 적용) · 「설계 해석」 표 · 게이트 ①②는 병합 뒤 · 「하지 않는 것」 표 · 끝에 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. 사용자가 병합을 허락하면 병합하고 Vercel 배포 성공을 확인한다(`gh api repos/stan070628/smart-seller-studio/commits/<병합 SHA>/status`).

- [ ] **Step 4: 🔴 첫 실제 수집(컨트롤러 — 운영 배포에 대고, 채널은 읽기만)**

(1) 드라이런 — 쓰지 않는다. Vault의 `app_url`·`cron_secret`을 읽어 부르고 **값은 출력하지 않는다**:
```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
const v=Object.fromEntries((await c.query(\"select name, decrypted_secret from vault.decrypted_secrets where name in ('app_url','cron_secret')\")).rows.map(r=>[r.name,r.decrypted_secret]));await c.end();
const res=await fetch(v.app_url+'/api/cron/orders-sync'+(process.argv[1]||''),{headers:{Authorization:'Bearer '+v.cron_secret}});const j=await res.json().catch(()=>({}));
console.log('HTTP',res.status,j.error??'');for(const r of j.reports??[])console.log(r.channel,r.ok?'ok':'FAIL',JSON.stringify({fetched:r.fetched,inserted:r.inserted,absent:r.absent,unattributed:r.unattributed,unknownStatus:r.unknownStatus,window:r.window,error:r.error}))})()" '?dryRun=1'
```
Expected: HTTP 200 · 4채널 `ok` · 창 시작 = 기초 시각(`2026-09-26T11:07:04.989Z`) · `unknownStatus` 0. 채널마다 `fetched`가 기초 시각 이후 채널 관리자 화면의 주문 수와 비슷한지 사용자에게 보인다. 🔴 한 채널이라도 FAIL이거나 응답 모양이 픽스처와 다르면(예: 네이버 `originalProductId`가 비어 전부 미귀속, 토스 옵션명 형식이 달라 전부 `option_unmatched`, 쿠팡 `createdAtTo`가 배타라 오늘이 빠짐) **실제 수집 전에 멈추고** 어댑터를 고쳐 PR로 다시 배포한다(녹화 응답도 그 모양으로 고친다).

(2) 실제 수집 — (1)의 명령에서 마지막 인자 `'?dryRun=1'`을 `''`로 바꿔 한 번 부른다. Expected: 4채널 `ok`, `inserted` > 0(주문이 있었다면). 스위치는 꺼져 있으므로 원장은 그대로다. 그다음 DB를 본다(읽기 전용):
```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();await c.query('BEGIN READ ONLY');
console.log((await c.query(\"select channel, deduction_state, attribution, count(*)::int from erp.order_lines group by 1,2,3 order by 1,2,3\")).rows);
console.log((await c.query(\"select kind, count(*)::int from erp.stock_ledger group by 1 order by 1\")).rows);
console.log((await c.query(\"select name, cursor_at from erp.sync_cursors order by 1\")).rows);
console.log((await c.query(\"select channel, left(coupang_order_item_id, strpos(coupang_order_item_id,'-')) pfx, count(*)::int, count(voided_at)::int voided from sale_records where created_at > now() - interval '1 hour' or sold_at >= '2026-09-26' group by 1,2 order by 1,2\")).rows);
await c.query('ROLLBACK');await c.end()})()"
```
Expected: 라인 상태는 `pending`(연결됨·기초 이후 결제) · `none`(미귀속·취소·기초 이전)뿐 · 원장 `kind`에 `sale` 없음 · 커서 `orders:<채널>` 4줄 · `sale_records`에 `naver-`·`toss-` 행이 새로 생겼다.

- [ ] **Step 5: pg_cron 118 적용 · 다음 실행 확인**

Run: `node scripts/apply-migration.mjs 118`
Expected: `✅ 118_pg_cron_orders_sync.sql`. 15~20분 뒤 확인:
```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
console.log((await c.query(\"select jobname, schedule from cron.job order by 1\")).rows);
console.log((await c.query(\"select started_at, trigger, status, counts->>'errors' errors, error from erp.job_runs where job='orders-sync' order by started_at desc limit 3\")).rows);await c.end()})()"
```
Expected: `orders-sync */15 * * * *`와 `stock-sync` · 최근 실행에 `trigger: 'cron'`·`status: 'ok'`·`errors: '0'`.

- [ ] **Step 6: 기록과 커밋**

이 계획서 끝 「실행 기록」에 적는다: 병합 SHA · 드라이런 채널별 fetched/unattributed · 첫 실제 수집 결과 · 118 적용 시각 · 첫 크론 실행 결과. 어댑터를 고쳤다면 무엇을 왜.
```bash
git add docs/superpowers/plans/2026-09-26-erp-phase1c2a-orders.md
git commit -m "docs(erp): 1-C2a 첫 수집·크론 가동 기록"
```

---

### Task 10: 🔴 게이트 ① — 3일 건수 대조(기록 모드)

> 사용자가 채널 관리자 화면과 대조한다. 컨트롤러는 매일 표를 보여주고 결과를 적는다. 서브에이전트에게 맡기지 않는다. **이 동안 스위치는 꺼져 있다.**

- [ ] **Step 1: 매일(3일) 건수표**

Run: `npx --no-install tsx scripts/erp/orders-daily-counts.ts --from=<어제 KST 날짜>`
Expected: `날짜 | 채널 | 주문 | 라인 | 수량 | 취소·반품 | 미귀속` 표와 마지막 수집 시각. 컨트롤러가 **어제(하루 전체)** 줄을 사용자에게 보이고 사용자가 대조한다:

| 채널 | 대조할 화면(주문일 기준) | 세는 단위 |
|---|---|---|
| 쿠팡 판매자배송 | Wing 주문/배송 관리 — 판매자배송, 기간 = 어제 | 주문 수(주문번호) |
| 쿠팡 RG | Wing 로켓그로스 주문 — 결제일 어제 | 주문 수 |
| 네이버 | 스마트스토어 주문통합검색 — 결제일 어제 | 상품주문 수 = 이 표의 **라인** |
| 토스 | 토스쇼핑 파트너스 주문 → 전체 주문 조회 — 어제 | 주문상품 수 = 이 표의 **라인** |

🔵 2026-09-26은 기초 시각(20:07 KST) 이후만 수집했으므로 대조에서 뺀다. 첫 비교일은 2026-09-27.
또 확인한다: 재고현황 패널의 「미귀속」(원인: 그날 라인 목록의 「연결」 칸) · 「상태」(최근 실행 실패 없음) · 원가관리 수익 표에 네이버·토스 판매가 보이는지.

- [ ] **Step 2: 어긋나면**

차이가 나면 그날 라인 목록(패널의 날짜 칸)과 채널 화면을 주문번호로 맞춰 본다. 흔한 원인: 날짜 기준(주문일/결제일), 사라짐 오판(`raw_status = 'ABSENT'`인데 채널에서는 살아 있음), 페이지 끝까지 못 읽음, 상태 표준화 누락(`unknown`). 원인을 고치는 PR → 배포 → **3일을 다시 센다**. 미귀속만 있는 경우(연결 안 된 리스팅)는 건수 대조와 별개 — 1-C2b 대기열로 남기되, 차감 켜기 전에 연결할지 사용자에게 묻는다.

- [ ] **Step 3: 기록**

「실행 기록」에 날짜별로 적는다: `2026-09-27 — 판매자배송 n/n · RG n/n · 네이버 n/n · 토스 n/n(시스템/채널) · 미귀속 k · 일치|불일치(원인)`. 3일 연속 일치하면 Task 11로.
```bash
git add docs/superpowers/plans/2026-09-26-erp-phase1c2a-orders.md
git commit -m "docs(erp): 1-C2a 게이트 ① 건수 대조 기록"
```

---

### Task 11: 🔴 게이트 ② — 소급 확인 → 승인 → 차감 켜기 → 재고·RG 대조

> 사용자가 화면에서 승인하고 누른다. 컨트롤러는 숫자를 읽어 주고 검증한다.

- [ ] **Step 1: 켜기 전 사진** (읽기 전용)

```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();await c.query('BEGIN READ ONLY');
console.log((await c.query(\"select location, sum(qty)::int qty, sum(value)::bigint value from erp.stock_on_hand group by 1 order by 1\")).rows);
console.log((await c.query(\"select deduction_state, count(*)::int from erp.order_lines group by 1 order by 1\")).rows);
await c.query('ROLLBACK');await c.end()})()"
```
「실행 기록」에 위치별 재고·평가액과 라인 상태 수를 적는다.

- [ ] **Step 2: 미리보기 → 사용자 승인**

사용자가 `/erp/stock`(운영 앱, 로그인) → 수집 패널 「차감 켜기…」. 컨트롤러가 창의 숫자를 읽어 준다: 소급 N줄 · SKU M개 · 집 −X · RG −Y · 채널별 줄 수 · 결제 시각 범위 · **재고 부족 목록**. 재고 부족이 있으면 사용자에게 고른다: (a) 먼저 재고현황에서 그 SKU를 실사(「지금 개수」)로 맞춘 뒤 창을 다시 연다, (b) 그대로 켠다(그 라인은 「재고 부족」으로 남고 재고를 고치면 다음 수집에서 빠진다). **사용자 승인** → 사용자가 「채널 관리자 화면과 3일 건수를 대조했습니다」를 체크하고 「차감 켜기」.
Expected: 토스트 「판매 차감을 켰습니다 — n줄 차감 · 재고 부족 k줄」, 패널 머리 「판매 차감 켜짐(…부터)」, 「차감 켜기…」 버튼이 사라진다.

- [ ] **Step 3: 검증** (컨트롤러, 읽기 전용)

```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();await c.query('BEGIN READ ONLY');
console.log((await c.query(\"select value from erp.settings where name='deduct_enabled'\")).rows[0]);
console.log((await c.query(\"select deduction_state, count(*)::int, sum(sku_qty)::int from erp.order_lines group by 1 order by 1\")).rows);
console.log((await c.query(\"select location, -sum(qty)::int sold from erp.stock_ledger where kind='sale' group by 1 order by 1\")).rows);
console.log((await c.query(\"select count(*)::int bad from erp.order_lines where deduction_state='posted' and paid_at < (select cursor_at from erp.sync_cursors where name='ledger_cutover')\")).rows[0]);
console.log((await c.query(\"select location, sum(qty)::int qty, sum(value)::bigint value from erp.stock_on_hand group by 1 order by 1\")).rows);
await c.query('ROLLBACK');await c.end()})()"
```
Expected: `{ enabled: true, enabledAt, by }` · `pending` 0(재고 부족은 `skipped_short`) · 원장 판매 합(위치별) = 미리보기의 집·RG 감소량에서 재고 부족 라인 몫을 뺀 값 · 기초 이전 결제 차감 `bad: 0` · 위치별 재고가 Step 1보다 그만큼 줄었다.

그리고 RG 대조:
Run: `npx --no-install tsx scripts/erp/rg-reconcile.ts`
Expected: 불일치가 있으면 SKU마다 **판매·입고중으로 설명되는지** 사용자와 본다 — (가) 원장 RG > 실재고: 켠 뒤 들어온 RG 판매가 아직 수집 전(15분 이내)이거나 미귀속 RG 판매 (나) 원장 RG < 실재고: RG입고중이 실제로 입고 완료됨 → 재고현황 「입고 완료 m개 옮기기」(1-C2b 전까지 수동). 설명되지 않는 차이만 「반영」으로 맞추고 사유를 적는다.

- [ ] **Step 4: 화면 확인** (사용자·컨트롤러)

재고현황에서 판매가 있었던 SKU 하나를 골라 입출 이력에 「판매」 전표(메모 `<채널> 주문 <주문번호>`)가 보이는지, 되돌리기 버튼이 **없는지**(판매는 채널 상태가 되돌린다). 다음 크론(15분) 뒤 새 주문이 바로 빠지는지(`job_runs` counts `posted`).

- [ ] **Step 5: 기록과 커밋**

「실행 기록」에 적는다: 켠 시각·사람 · 미리보기 숫자 · 결과(차감 줄·재고 부족 줄) · 켜기 전후 위치별 재고·평가액 · `rg-reconcile` 결과와 설명 · 반영한 것.
```bash
git add docs/superpowers/plans/2026-09-26-erp-phase1c2a-orders.md
git commit -m "docs(erp): 1-C2a 게이트 ② 판매 차감 켜기 기록"
```

---

## 이 계획에서 하지 않는 것 (1-C2b 이후)

| 항목 | 이유 · 할 곳 |
|---|---|
| 당근 수동 판매 | 1-C2b — 채널 값 `karrot`을 더할 때 117의 채널 검사도 함께 고친다 |
| 미귀속 대기열 화면(any_of·옵션 불일치 라인을 사람이 SKU에 붙이면 차감) | 1-C2b. 1-C2a는 저장·건수·그날 목록의 「연결」 칸까지 |
| **RG 자동 입고 완료**(RG 판매 가능 수량 증가로 판정) · 입고중 7일 경보 · `rg-reconcile` 매일 | 1-C2b 첫 작업. 그전에는 재고현황 「입고 완료 옮기기」 수동 |
| 이상 SKU 표시(판매 대비 재고가 이상한 SKU) | 1-C2b — 판매 차감이 켜진 뒤 며칠 데이터가 있어야 의미가 있다 |
| 기초재고 이전 `sale_records` 복구(RG 무효 1,062건 · 네이버 누락 · Wing 무접두 중복) | 1-C2b. 1-C2a는 기초 이후 행만 새 키로 쓰고, 같은 키의 옛 무효를 해제한다 |
| 쿠폰 할인(`sale_records.coupon_discount`) | 상품별 불러오기가 쿠팡 주문별로 조회해 채우던 값 — 새 수집은 채우지 않고 기존 행의 값은 덮지 않는다. 필요하면 1-C2b에서 수집기에 붙인다 |
| 발주확인·송장 쓰기 | 로지아이 몫. 토스는 새 채널 확정(2026-09-27 수업) 뒤 |
| 채널 재고 전송 | 1-D(any_of 리스팅의 재고 = 연결 SKU 합계) |
| 주문/매출 화면 교체(채널 API 직접 조회 → 주문 표) | 2단계 |
| 판매 차감 끄기 화면 · 판매 전표의 화면 되돌리기 | 판매는 채널 상태가 정한다. 사람이 되돌리면 다음 수집이 다시 뺀다. 급하면 `erp.settings`를 SQL로 되돌리고 원인을 고친다(사용자 결정 후) |
| 쿠팡 판매자배송의 **배송 후 반품** 자동 역전표 | 발주서에 나타나지 않는다(반품 API는 이번 범위 밖). 물건이 돌아오면 재고현황 「반품입고」 |
| 네이버·토스 **교환** 재출고 차감 | 교환은 판매 유지(`exchange`)로만 본다. 교환 재출고가 재고를 더 쓰면 조정으로 맞춘다 |
| 새 판매 채널(2026-09-27 수업 뒤) | 어댑터 하나 + 채널 값 추가로 받는다(스펙 열린 질문) |
| 옛 `cancel-sync.ts` 정리 | 쓰는 곳이 없어졌지만 테스트가 있고 1-C2b 과거 복구에서 참고한다 |

---

## 실행 기록

> 실행 중 사용자 답·결정을 즉시 적는다(세션이 끊겨도 같은 질문을 반복하지 않게).

- 기준선(Task 0 Step 1):
- 117 적용(Task 1):
- 자가시험(Task 5 Step 9):
- 병합·배포(Task 9):
- 드라이런·첫 수집(Task 9 Step 4):
- 118·첫 크론(Task 9 Step 5):
- 게이트 ① 대조(Task 10): 2026-09-27 — · 2026-09-28 — · 2026-09-29 —
- 게이트 ② 차감 켜기(Task 11):
