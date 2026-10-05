# ERP 1-C2c — RG 취소·반품 복귀 (재고) 설계

> **TL;DR** RG 취소·반품은 API로 알 수 없다. 그래서 매일 RG 대조에서 **입고중으로 설명되지 않는 RG 실재고 증가를, 그 SKU 최근 30일 RG 판매량까지 「취소·반품 복귀」로 원장에 더한다.** 넘는 증가는 지금처럼 「보낸 기록 없는 증가」로 알린다. RG 수집기의 「응답에서 사라지면 취소」 가정은 틀렸으므로 끈다. 매출 보정(Wing 순판매)은 이번 범위가 아니다.

- 선행: 1-C2b(PR #34~#36). 차감 스위치 꺼짐(게이트 ② 대기). 위키 근거: 「스마트셀러스튜디오 ERP 재구성 설계 2026-09-25」 · 「RG 차이의 원인 확정」 절.
- 사용자 결정(2026-10-05): ① 재고만(매출 보정은 별도 과제) ② 복귀 한도 = 최근 30일 RG 판매량 기준(전부 복귀·고정 개수 기각).

## 배경 — 실측 (2026-10-05)

| 확인 | 결과 |
|---|---|
| ERP vs Wing 판매분석(09-28~10-04) | RG가 거의 매일 ERP 1건 많다. Wing 「주문」은 *"주문수량 (취소 및 반품 제외)"* |
| RG 주문 API 직접 조회 | 09-29~10-04 ERP와 날짜별로 같다 — **취소분이 응답에 남는다.** 상태 필드 없음(`vendorId·orderId·paidAt·orderItems`) |
| `paidDateFrom` | UTC 날짜로 거른다(KST 09시 이전 주문이 전날로 간다). 어댑터의 첫날 사라짐 판정 제외·배타 끝 +1일이 흡수 — 수집 누락 아님 |
| 일반 반품·취소 API(v6 `returnRequests`) | RG 주문 0건 |
| RG 전용 API 8종 · Wing 고객반품 관리 | 취소·반품 건별 경로 없음(반품분석은 상품별 월간) |

→ 결제 시 차감하면 취소된 RG 판매분이 원장에서 빠진 채 남는다. 실재고(쿠팡 RG 재고 API)는 그것을 반영하므로 **차이가 「실재고 > 원장」으로 나타난다.** 지금 `planRgAuto`는 그 차이를 입고 완료로만 읽어, 취소분을 입고중에서 잘못 옮기거나 「보낸 기록 없는 증가」로 매일 알린다.

## 1. 판정 규칙 (`rg-auto.ts` `planRgAuto` — 순수)

SKU마다 `d = actual − ledger`.

| 순서 | d > 0 | 처리 |
|---|---|---|
| ① | `inbound > 0` | `move = min(d, inbound)` — 입고중 → RG (지금과 같다) |
| ② | 남은 `d − move` | `ret = min(d − move, returnRoom)` — **취소·반품 복귀** |
| ③ | 그래도 남음 | `unsent_increase` 알림(수량 = 남은 값) |

- `returnRoom = max(0, sold30 − returned30)`
  - `sold30` = 그 SKU의 최근 30일(실행 시각 기준) `coupang_rg` 주문 줄 `sku_qty` 합. 상태 무관(취소 표시가 없으므로)
  - `returned30` = 그 SKU의 최근 30일 `reason = 'rg_return'` 원장 줄 qty 합(역전표로 되돌린 줄은 짝으로 뺀다)
- d < 0: 바꾸지 않는다(2회 연속이면 `decrease`).
- `RgAutoRow`에 `returnRoom: number`를 더하고, 결과에 `returns: { skuId, qty }[]`를 더한다.
- **한계(수용)**: 같은 날 취소와 입고중이 겹치면 취소분을 입고로 먼저 옮긴다. RG 총량은 맞고 「입고중↔RG」 칸이 잠시 엇갈린다. 실제 입고가 도착하면 남는 증가가 복귀로 잡혀 자연히 맞는다.

## 2. 원장 기록 (`rg-auto-run.ts`)

| 항목 | 값 |
|---|---|
| kind / reason | `adjust` / **`rg_return`**(신설). 기존 `return_in`(사람 입력)과 섞지 않는다 |
| location / qty | `rg` / +ret |
| 단가 | ① SKU의 원장 최근 단가(`adjust-store.ts`의 최근 단가 함수) → ② `legacyUnitCost` → ③ 둘 다 없으면 **기록하지 않고** `return_no_cost` 알림 |
| 멱등키 | `rg-return:<skuId>:<KST 날짜>` — 같은 날 여러 번 돌려도 한 번 |
| 잠금 | 입고 이동과 같은 트랜잭션·같은 SKU 잠금 안에서, 잠금 뒤 원장 RG·입고중·returned30을 다시 읽어 재계산 → SKU별 savepoint(실패는 그 SKU만 되돌리고 `move_failed`) |
| 스위치 | `rg_auto_arrive_enabled`가 꺼져 있거나 forceDry면 「복귀 예정」만 기록(입고 이동과 같다) |

- `rg_recon_snapshots`에 `planned_return int not null default 0 check (>= 0)` · `returned int not null default 0 check (>= 0)` 추가.
- `GET /api/erp/stock/rg-auto`(`RgAutoLast.rows`)에 `plannedReturn`·`returned`를 더하고, 재고현황 「RG 실재고 대조」 마지막 결과 표에 「복귀 예정 / 복귀」 칸을 보인다.

## 3. 수집기 (`adapters/coupang-rg.ts`)

- `absenceMeansCancel: true` → **`false`**. RG API는 취소를 응답에서 빼지 않는다(위 실측). 이 판정으로 취소된 RG 줄은 0건이라 되돌릴 데이터가 없다.
- 파일 머리 주석의 「RG API는 취소를 플래그로 주지 않고 응답에서 뺀다」를 실측으로 고친다. `paidDateFrom`이 UTC 날짜라는 사실도 적는다.
- Wing 어댑터는 그대로(판매자배송 취소 2건을 이 판정이 정확히 잡았다).

## 4. 알림

- `RgAlert`에 `{ kind: 'return_no_cost'; skuId; qty }` 추가. `alertKey`는 `return_no_cost:<skuId>` — 기존 중복 방지(직전 실행 대비 새 알림만)에 그대로 탄다.
- 복귀를 실제로 기록했거나 예정이 직전 실행과 달라지면 하루 요약 한 줄: `🔵 RG 취소·반품 복귀 — <SKU명> <수량> · …`(dry면 「복귀 예정」). 입고 이동 알림과 같은 메시지에 싣는다.
- `unsent_increase`는 이제 복귀 한도를 넘는 수량만.

## 5. 마이그레이션 125

- `stock_ledger_reason_chk`에 `'rg_return'` 추가(drop → add).
- `rg_recon_snapshots`에 `planned_return`·`returned` 추가.
- 운영 적용은 병합 뒤(차감 꺼짐이라 대조 실행기는 건너뛴다 — 영향 없음).

## 6. 테스트 (TDD)

| 대상 | 경우 |
|---|---|
| `planRgAuto` | 입고 먼저 · 한도까지만 복귀 · 넘는 수량 알림 · 한도 0 → 전부 알림 · 입고+복귀 겹침 · 감소 불변 · 음수 한도 방어 |
| 실행기 | 같은 날 두 번 → 전표 1건(멱등) · 잠금 뒤 재계산(그 사이 복귀가 이미 기록됨) · 단가 없음 → 보류 알림 · 스위치 꺼짐 → 예정만 · 스냅샷 칸 기록 |
| 한도 쿼리 | sold30 날짜 경계 · returned30에서 역전표 짝 제외 |
| RG 어댑터 | `absenceMeansCancel === false` |
| API·화면 | 복귀 칸 표시 |

## 7. 운영 게이트

1. 병합 · 마이그레이션 125 적용 — 차감 꺼짐이라 대조는 건너뜀(영향 없음).
2. **게이트 ②(사용자 승인)** 차감 켜기.
3. 켠 직후 사용자가 재고현황 「RG 실재고 대조」에서 1-C1 미승인 8개 「반영」.
4. 자동 이동 스위치를 끈 채 **3회** 「입고 예정·복귀 예정」을 보고 → 사용자 승인으로 스위치 켜기.

## 범위 밖

- 매출 보정(Wing 판매분석 순판매로 옛 장부 RG 매출 맞추기) — 별도 과제.
- RG 반품이 재입고되지 않은 경우(폐기·반품 재판매)는 실재고가 늘지 않으므로 할 일이 없다 — 원장에서 이미 빠져 있는 것이 맞다.
