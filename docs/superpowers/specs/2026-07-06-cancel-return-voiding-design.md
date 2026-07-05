# 취소/반품 소급 반영 설계

> 작성일: 2026-07-06
> 대상: `sale_records` + 일괄 임포트(wing/naver) + FIFO 로드 경로
> 선행 문서: [업그레이드 로드맵](./2026-07-05-cost-management-upgrade-roadmap.md) §2.2

## 0. 문제

임포트는 **가져오는 시점에만** 취소/반품을 거른다(wing-bulk `saleType==='SALE'`, naver-bulk `CANCELLED_STATUSES` 제외 등). 이미 임포트된 뒤 취소·반품된 주문은 `sale_records`에 **영구 잔존**해 매출·실현손익을 과대 계상한다. `sale_records`엔 취소를 반영할 수단(상태 컬럼)이 없다.

라이브 "실제 매출" 섹션은 이미 취소를 제외하므로(`CostManagementTab.tsx:131,175`), "관리 손익"(sale_records)만 어긋난다.

## 1. 목표

- 임포트 후 취소·반품된 주문을 `sale_records`에서 **소프트 무효화**해 FIFO·집계에서 제외한다.
- 무효화 감지를 기존 "판매 가져오기"(일괄 임포트)에 **피기백**한다(새 UX·추가 API 호출 최소).

**성공 기준:** 취소된 주문은 다음 "판매 가져오기" 후 실현손익·재고에서 빠진다. 무효 기록은 삭제되지 않고 `voided_at`으로 감사·복구 가능하다.

## 2. 소프트 무효화 컬럼 (마이그레이션)

`supabase/migrations/085_sale_records_voided.sql`:
```sql
ALTER TABLE sale_records
  ADD COLUMN IF NOT EXISTS voided_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN sale_records.voided_at IS
  '취소/반품으로 무효화된 시각. NULL이면 유효 판매. FIFO·집계에서 제외.';
```

## 3. FIFO·집계에서 제외 (4곳)

`sale_records`를 손익·재고 계산에 쓰는 로드에 `AND voided_at IS NULL` 추가:

| 파일 | 현재 | 변경 |
|---|---|---|
| `products/route.ts:76` | `... WHERE user_id = $1` | `... WHERE user_id = $1 AND voided_at IS NULL` |
| `products/[id]/fifo-summary/route.ts:32` | `... WHERE product_cost_id = $1` | `+ AND voided_at IS NULL` |
| `products/[id]/variant-stock/route.ts:34` | `... FROM sale_records ...` | `+ AND voided_at IS NULL` |
| `products/[id]/sales/route.ts` (GET, 패널 목록) | 전체 조회 | `+ AND voided_at IS NULL` (무효 판매는 목록에서 숨김, 일관성) |

무효 판매는 계산·목록 모두에서 사라진다. FIFO 엔진(`fifo.ts`) 자체는 변경 없음(무효 건이 애초에 전달 안 됨).

## 4. 취소 감지 = 일괄 임포트 피기백 (Wing·Naver)

각 일괄 라우트가 이미 기간 내 주문을 조회하므로, **같은 응답에서 취소 건의 키를 수집**해 매칭 `sale_records`를 void한다.

**wing-bulk-import** (`route.ts`):
- 현재 `if (order.saleType !== 'SALE') continue;`로 취소류를 버림.
- 변경: 비-SALE 주문의 items 중 **우리 상품과 매칭되는** 건의 키 `wing-${order.orderId}-${item.vendorItemId}`를 `cancelledKeys: Set<string>`에 수집(레코드로는 넣지 않음).
- 레코드 INSERT 후:
```sql
UPDATE sale_records
   SET voided_at = now()
 WHERE user_id = $1
   AND coupang_order_item_id = ANY($2)
   AND voided_at IS NULL
```
`$2` = `Array.from(cancelledKeys)`. 영향 행 수 = `voided`.

**naver-bulk-import** (`route.ts`):
- 현재 `if (CANCELLED_STATUSES.has(...)) continue;`
- 변경: 취소 상태 주문 중 매칭 건의 키 `naver-${order.productOrderId}`를 수집 → 동일 void UPDATE.

**RG (rg-bulk)는 제외.** RG 주문 API가 주문별 취소를 명확히 주지 않고 수량 감소로만 반영 → 신뢰 감지 불가. 로드맵 후속으로 기록.

**재활성(취소→재판매)은 범위 밖.** void는 단방향(취소 시 무효화). 재활성은 드물어 후속. INSERT는 기존대로 `ON CONFLICT DO NOTHING`(무효 행을 되살리지 않음).

## 5. 결과 리포트

- 일괄 임포트 응답 `data`에 `voided: number` 추가(wing/naver). rg는 `voided: 0`.
- `src/components/orders/import-summary.ts`의 `ChannelImportResult`/`buildImportSummary`에 `voided` 반영, 임포트 결과 패널에 "취소 반영 N건" 라인 추가(신규 0·스킵 0 옆).

## 6. 테스트

- **마이그레이션 적용 확인**(로컬).
- **취소키 추출 순수 헬퍼**: wing/naver 각각 "주문 목록 + 상품 매핑 → { activeRecords, cancelledKeys }"를 반환하는 순수 함수로 뽑아 단위 테스트(취소 상태 분기, 매칭/비매칭, 수량 0 스킵). 라우트는 이 헬퍼를 호출.
- **`buildImportSummary` voided 확장**: 채널별 voided 집계·패널 표기 테스트.
- FIFO 제외(SQL WHERE)는 단위 테스트 불가 → 리뷰 + 수동 검증(무효 처리 후 실현손익 감소 확인).

## 7. 파일 요약

| 파일 | 변경 |
|---|---|
| `supabase/migrations/085_sale_records_voided.sql` | 신규 — `voided_at` 컬럼 |
| `src/app/api/cost-management/products/route.ts` | FIFO 로드에 `voided_at IS NULL` |
| `src/app/api/cost-management/products/[id]/fifo-summary/route.ts` | 동일 |
| `src/app/api/cost-management/products/[id]/variant-stock/route.ts` | 동일 |
| `src/app/api/cost-management/products/[id]/sales/route.ts` | GET 목록에 동일 |
| `src/lib/cost-management/cancel-sync.ts` | 신규 — 취소키 추출 순수 헬퍼(wing/naver) |
| `src/app/api/cost-management/wing-bulk-import/route.ts` | 취소키 수집 + void UPDATE + `voided` 응답 |
| `src/app/api/cost-management/naver-bulk-import/route.ts` | 동일 |
| `src/app/api/cost-management/rg-bulk-import/route.ts` | 응답에 `voided: 0`만 추가(형태 통일) |
| `src/components/orders/import-summary.ts` | `voided` 필드 |
| `src/components/orders/CostManagementTab.tsx` | 결과 패널에 "취소 반영 N건" |
| 테스트 | cancel-sync 헬퍼, import-summary 확장 |

## 8. 리스크

| 리스크 | 완화 |
|---|---|
| 잘못된 키 매칭으로 유효 판매를 void | 키는 기존 임포트와 동일 규칙(`wing-`/`naver-` 접두사) 사용, `voided_at IS NULL` 조건으로 이미 무효 건 재처리 방지 |
| 윙 단건/일괄 키 불일치(§2.5)로 단건 임포트 건은 void 안 됨 | 알려진 한계 — 윙 키 정규화(§2.5 후속)와 함께 해소. 이 스펙은 일괄 키 기준 |
| 취소 조회가 API 페이지네이션 일부만 커버 | 기존 임포트와 동일 페이지네이션 범위라 커버리지 동일 |
| voided_at 제외 누락 지점 | §3의 4곳을 grep(`FROM sale_records`)로 전수 확인 |

## 9. 범위 밖

- RG 취소 감지, 판매 패널의 무효 이력 표시 UI, 취소→재판매 재활성, 단건 임포트 피기백, 과거 이미 취소된 주문의 일괄 소급(다음 "판매 가져오기" 시 자연 반영되나 즉시 전량 스캔은 안 함).
