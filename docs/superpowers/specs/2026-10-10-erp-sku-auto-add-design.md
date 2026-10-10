# 원가관리 상품 추가 → SKU 자동 추가 설계

> **TL;DR** 원가관리에 **쿠팡 상품번호가 있는 상품**을 저장하면, 서버가 그 상품의 쿠팡 옵션을 읽어 **SKU·리스팅·연결을 바로 만든다**(그 상품만, 기존 원가 연결 보존). 이미 SKU가 있는 상품은 건드리지 않는다 — 보정(`sku-overrides.json`)이 걸린 기존 상품은 전체 적재가 맡는다. 빠진 상품은 재고현황의 「SKU 다시 맞추기」로 채운다.

- 계기(2026-10-10): 10-10 원가관리에 추가한 상품 4개가 코스트코 영수증 입고에서 조회되지 않았다. 앱에 새 상품을 SKU로 만드는 경로가 없고, SKU 마스터는 1-A 적재(09-27) 뒤로 늘지 않았다. 전체 적재(`sku-collect` → `sku-apply`)를 다시 돌려 해결했고, 그때 적재가 **손으로 붙인 원가 연결을 지우려 한 결함**을 고쳤다(PR #41, 이 브랜치의 앞 커밋).
- 사용자 결정(2026-10-10): 「등록할 때 바로」 → **원가관리 추가 시점**(쿠팡 등록은 상품마다 다른 CLI 스크립트라 걸 곳이 하나가 아니다. 모든 상품이 원가관리를 거친다).

## 1. 동작

| 단계 | 내용 |
|---|---|
| 1 | `POST /api/cost-management/products`(한 개) · `.../products/bulk`(여러 개)가 `product_costs`를 저장한 **뒤** `seller_product_id`가 있으면 `syncSellerProduct`를 부른다 |
| 2 | 그 상품번호의 리스팅(`erp.channel_listings.alt_product_id = 상품번호` 또는 SKU 키 `cp:<상품번호>:…`)이 **이미 있으면 건너뛴다**(`exists`) |
| 3 | 쿠팡 `getProductDetail(상품번호)` → 옵션별 Wing·RG vid |
| 4 | DB에서 그 상품의 `product_costs`·`product_cost_channels`·`stock_sync_links`(그 vid들)·`sale_records` 귀속을 읽어 **`buildDraft`(1-A와 같은 순수 함수)**에 넣는다 — 키·옵션 이름·배수·원가 연결이 전체 적재와 같은 규칙으로 정해진다 |
| 5 | 초안에서 **그 상품의 SKU·리스팅·연결만** 골라, 한 트랜잭션에서 upsert한다(SKU 적재와 같은 advisory lock). `origin = 'draft'` — 다음 전체 적재가 같은 행으로 본다 |
| 6 | 보관·비활성화·연결 삭제는 **하지 않는다**(전체 적재 전용). 원가 연결은 DB ∪ 초안 |

- 원가관리 응답에 `skuSync: { status: 'created' | 'exists' | 'skipped' | 'failed', skus: number, error?: string }`를 싣는다. `skipped` = 상품번호 없음.
- **SKU 추가가 실패해도 원가관리 저장은 성공**한다(저장 트랜잭션 밖에서 부른다). 화면은 실패 시 「SKU 자동 추가 실패 — 재고현황의 「SKU 다시 맞추기」로 다시 시도」.

## 2. 「SKU 다시 맞추기」

- `POST /api/erp/skus/sync-missing` — `seller_product_id > 0`인 `product_costs` 중 리스팅이 없는 상품번호를 모아 하나씩 `syncSellerProduct`. 한 번에 최대 20개(쿠팡 호출 1.3초 간격 기준 Vercel 300초 안).
- 재고현황(`/erp/stock`) 상단에 버튼 하나 — 결과 「SKU N개 추가 · 이미 있음 N · 실패 N(상품번호…)」.

## 3. 구조 — 전체 적재와 공유

| 단위 | 책임 | 비고 |
|---|---|---|
| `src/lib/erp/sku/coupang-input.ts` | 쿠팡 상품 상세 → `DraftInput.coupangProducts` 한 줄 | `sku-collect.ts`의 변환을 옮긴다(Wing vid는 `marketplaceItemData`에도 있다 — 2026-09-26 실측 주석 유지) |
| `src/lib/erp/sku/db-input.ts` | DB → `DraftInput`의 나머지(전체 또는 상품번호 필터) | `sku-collect.ts`의 `collectDb`를 옮긴다 |
| `src/lib/erp/sku/upsert.ts` | 초안 행 upsert(SKU·리스팅·연결), 원가 연결 합집합 | `sku-apply.ts`의 upsert를 옮긴다. 정리(보관·비활성화·삭제)는 스크립트에 남긴다 |
| `src/lib/erp/sku/sync-product.ts` | `syncSellerProduct(db, client, sellerProductId)` | 위 셋을 조합 |
| 스크립트 두 개 | 위 lib를 쓰도록 바꾼다 — **출력·동작 불변**(점검 dry-run 결과가 지금과 같아야 한다) | |

## 4. 한계(수용)

- 네이버·토스 리스팅은 추가 시점에 `stock_sync_links`에 그 연결이 이미 있을 때만 생긴다. 나중에 네이버에 등록하면 전체 적재가 채운다(「SKU 다시 맞추기」는 리스팅이 하나라도 있으면 건너뛰므로 채우지 않는다).
- 보정(`sku-overrides.json` — 합치기·배수·이름)이 필요한 상품은 자동 추가 뒤 전체 적재로 고친다.

## 5. 테스트

| 대상 | 경우 |
|---|---|
| `syncSellerProduct` | 새 상품 → 옵션별 SKU·Wing/RG 리스팅·연결 생성 · 이미 리스팅 있음 → `exists`(쓰기 없음) · 쿠팡 조회 실패 → `failed` · 원가 연결 합집합 · 다른 상품 행 미변경 |
| 원가관리 라우트 | 상품번호 있음 → `skuSync.created` · SKU 실패해도 201·저장됨 · 상품번호 없음 → `skipped` · bulk는 상품별 결과 |
| sync-missing | 리스팅 없는 상품만 · 20개 상한 |
| 스크립트 회귀 | 리팩터 뒤 `sku-apply.ts`(점검)가 「삽입 0 · 갱신 0 · 동일 220」 그대로 |
| 운영 대조(읽기 전용) | 10-10 상품 4개에 대해 `syncSellerProduct`의 **초안 단계까지만**(쓰기 없이) 돌려, 방금 전체 적재로 만든 행(SKU 1071~1075 등)과 키·옵션·연결이 같은지 비교 |
