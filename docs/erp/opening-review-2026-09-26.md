# 기초재고 실사표 점검 2026-09-26

- 활성 SKU 215 · RG 재고 응답 89건(수량>0 20)
- RG 실재고 합계 236 · 자체보관 미리 채운 합계 891 · **빈칸(옵션별 실사 필요) 67행**

## 채우는 법

1. `opening-count-2026-09-26.csv`를 연다(Numbers·엑셀).
2. `self_count` = **지금 집에 있는 개수**(SKU 기준 단위). 미리 채운 값은 옛 장부 계산이다 — 다르면 고친다. 빈칸은 옵션별로 세서 적는다.
3. `rg_inbound` = RG로 보냈는데 아직 쿠팡 판매 가능 수량에 안 잡힌 개수. 없으면 0.
4. `unit_cost` 빈칸인데 재고가 있으면 개당 매입가를 적는다.
5. `rg_actual`은 적재 때 API로 다시 읽으므로 고치지 않는다.

## 이슈 34건

| 종류 | 대상 | 내용 |
|---|---|---|
| rg_vid_unmapped | 95812283106 | RG 재고 1개인 vendorItemId가 어느 RG 리스팅에도 없다 |
| rg_vid_unmapped | 95932746388 | RG 재고 1개인 vendorItemId가 어느 RG 리스팅에도 없다 |
| rg_vid_unmapped | 95833506834 | RG 재고 3개인 vendorItemId가 어느 RG 리스팅에도 없다 |
| rg_vid_unmapped | 95693450298 | RG 재고 3개인 vendorItemId가 어느 RG 리스팅에도 없다 |
| group_spans_skus | g3 | SKU 2개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| group_spans_skus | g8 | SKU 3개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| group_spans_skus | g11 | SKU 2개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| cost_unknown | cp:16273945706:핑크 | 재고는 있는데 옛 입고 기록이 없어 단가를 모른다 — 실사표 unit_cost에 적는다 |
| cost_unknown | cp:16284903958:블루 구름 (베개형 패드) / S | 재고는 있는데 옛 입고 기록이 없어 단가를 모른다 — 실사표 unit_cost에 적는다 |
| group_spans_skus | g28 | SKU 2개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| self_estimate_negative | cp:16162161669:화이트 S | 자체보관 추정 -1 — 판매가 입고보다 많거나 RG 재고가 옛 입고 밖에서 왔다 |
| group_spans_skus | g37 | SKU 9개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| self_estimate_negative | cp:16166471789:M(100) 네이비 | 자체보관 추정 -2 — 판매가 입고보다 많거나 RG 재고가 옛 입고 밖에서 왔다 |
| group_spans_skus | g38 | SKU 5개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| self_estimate_negative | cp:16263936282:45g | 자체보관 추정 -21 — 판매가 입고보다 많거나 RG 재고가 옛 입고 밖에서 왔다 |
| group_spans_skus | g60 | SKU 8개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| group_spans_skus | g61 | SKU 2개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| group_spans_skus | g65 | SKU 2개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| group_spans_skus | g66 | SKU 2개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| self_estimate_negative | cp:16262230452:100ml | 자체보관 추정 -24 — 판매가 입고보다 많거나 RG 재고가 옛 입고 밖에서 왔다 |
| group_spans_skus | g68 | SKU 4개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| self_estimate_negative | cp:16320666229:1개입 | 자체보관 추정 -11 — 판매가 입고보다 많거나 RG 재고가 옛 입고 밖에서 왔다 |
| group_spans_skus | g72 | SKU 3개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| cost_unknown | cp:16351744951:105(L) 블랙 | 재고는 있는데 옛 입고 기록이 없어 단가를 모른다 — 실사표 unit_cost에 적는다 |
| self_estimate_negative | cp:16339304983:L(100) 아이보리 | 자체보관 추정 -4 — 판매가 입고보다 많거나 RG 재고가 옛 입고 밖에서 왔다 |
| group_spans_skus | g87 | SKU 12개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| self_estimate_negative | cp:16344861379:110(XL) 그레이 | 자체보관 추정 -4 — 판매가 입고보다 많거나 RG 재고가 옛 입고 밖에서 왔다 |
| group_spans_skus | g88 | SKU 4개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| cost_partial | g88 | 보유 수량이 옛 입고 합계보다 많아 모자란 만큼 최근 단가로 채웠다 |
| group_spans_skus | g90 | SKU 2개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| cost_unknown | cp:16346825120:화이트+그레이스트라이프 150 | 재고는 있는데 옛 입고 기록이 없어 단가를 모른다 — 실사표 unit_cost에 적는다 |
| group_spans_skus | g101 | SKU 9개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| group_spans_skus | g104 | SKU 3개가 옛 원가 행을 공유한다 — 자체보관을 옵션별로 실사한다 |
| cost_unknown | cp:16278657003:화이트그레이 2단 | 재고는 있는데 옛 입고 기록이 없어 단가를 모른다 — 실사표 unit_cost에 적는다 |

## 기준 단위 미정 — 배수 > 1인 SKU 4건

배수 1이 무엇인지(예: 「6팩」 「낱포 1개」)를 정해야 실사 개수를 셀 수 있다. 답은 `docs/erp/sku-overrides.json`의 `baseUnit`에 넣는다.

| SKU | 상품 | 최대 배수 |
|---|---|---|
| cp:16262230452:100ml | 다슈 울트라 홀딩 파워 왁스 | 3 |
| cp:16294880149:750ml | 이볼루덤 미셀라 워터, 프랑스 메이크업 클렌징, 아침 세안, 코스트코 인기 제품 | 2 |
| cp:16368156484:330ml | 매일유업 퓨어틴 초코 쉐이크 330ml 단백질쉐이크 단백질음료 프로틴음료 | 2 |
| cp:16376323038:330ml | 매일유업 퓨어틴 커피 쉐이크 330ml 단백질쉐이크 단백질커피 프로틴음료 | 2 |

`rg_vid_unmapped`·`rg_listing_multi_sku`가 남아 있으면 적재가 멈춘다. 원장에 넣지 않을 vid는 `docs/erp/opening-overrides.json`의 `ignoreRgVids`에 사유와 함께 적는다.
