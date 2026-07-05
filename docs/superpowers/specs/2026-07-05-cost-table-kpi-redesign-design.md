# 수익·원가 테이블 KPI 재편 설계

> 작성일: 2026-07-05
> 대상: `/orders?tab=cost` (수익·원가) — `src/components/orders/CostManagementTab.tsx` 및 `src/app/api/cost-management/products/route.ts`
> 선행 문서: [업그레이드 로드맵](./2026-07-05-cost-management-upgrade-roadmap.md) §1.1
> 검토: Fable 5 코드 기반 타당성 검토 반영(조건부 승인 4건 수정 완료)

## 0. 목적

상품 테이블이 17~19개 열을 한 번에 펼쳐 핵심 KPI(실현손익·마진율·재고·ROAS)가 운영용 열 사이에 묻힌다. 정산·마진 관리 툴 관례(손익 중심)를 따라 **항상 보이는 핵심 열을 7개로 축소**하고, 나머지 수치·액션은 **행별 chevron으로 여는 인라인 상세 패널**로 옮긴다. 상단의 매출 개념 2종은 라벨로 관계를 명확히 한다. 과대한 `CostManagementTab.tsx`(약 1,300줄)의 행 렌더를 별도 컴포넌트로 분해해 테스트 가능하게 만든다.

**성공 기준**
- 테이블 첫 화면에 상품별 실현손익·마진율·매출·ROAS가 한눈에 들어온다.
- 재고·원가·배송비·수수료 등 상세는 상품명 옆 chevron으로 펼쳐 본다.
- 입고/판매 편집은 기존 드로어를 그대로 재사용한다(신규 편집 UI 없음).
- 분해된 행 컴포넌트는 props 기반 RTL 단위 테스트로 검증된다.

## 1. 표시 열 (항상 보임)

| # | 열 | 내용 | 비고 |
|---|---|---|---|
| 1 | 채널 | 쿠팡/네이버 배지 + 옵션 관리 (기존 `ChannelCell`) | 셀 전체 `stopPropagation` |
| 2 | 상품명 | 상품명 + **위너 배지** + chevron(▾/▸) 토글 | chevron만 상세 토글 |
| 3 | 매출(수량) | `total_sales_amount` (판매수량 `sale_quantity`) | 관리 손익 기준 |
| 4 | 실현손익 | `total_realized_profit` | 흑자 초록 / 적자 빨강 |
| 5 | 마진율 | `margin_rate × 100` | |
| 6 | ROAS | `ad_roas` (광고 없으면 `—`) | `breakeven_roas` 기준 색상 유지 |
| 7 | ⋯ | 액션 메뉴: 숨기기 · 삭제 | 메뉴 버튼 `stopPropagation` |

- 그룹행(옵션 여러 개)은 집계값(매출·실현손익·마진율)만 큰 글씨로. 그룹 ROAS는 빈칸(현행 유지).
- RG 실재고 열(`channelFilter==='rg'`)은 표시 열에서 빼고 **상세 패널 스트립으로 이동**.

## 2. 상세 패널 (chevron으로 펼침)

행 아래 `<tr><td colSpan={999}>`로 펼쳐지며 두 부분:

**(a) 수치 스트립** — 읽기 전용, 한 줄:
```
원가(가중평균) · 배송비 · RG배송비 · 재고 · 재고가치 · 수수료율 · [RG실재고(rg 필터 시)]
```
필드: `weighted_avg_cost`, `weighted_avg_shipping`, `weighted_avg_rg_shipping`, `current_stock`, `stock_value`, `platform_fee_rate`. 모두 API 응답에 존재.

**(b) 액션**:
- `[입고·판매 관리]` → 기존 `CostEntryDrawer` 오픈 (`setDrawerProductId(p.id)`). 드로어가 이미 좌:입고 / 우:판매(내장 `SaleEntryPanel`) 2컬럼이라 단일 진입점으로 충분.
- `[광고비]` → 인라인 편집(단일 월 기간에서만, `isEditablePeriod`). 편집 state는 상세 패널 로컬로 이동.

> **결정 근거(Fable):** `SaleEntryPanel`은 `CostEntryDrawer` 내부에 내장돼 단독 오픈 불가(`CostEntryDrawer.tsx:483-493`). 따라서 판매 편집도 동일 드로어로 연다. 별도 판매 드로어는 만들지 않는다(YAGNI).

## 3. 펼침 인터랙션 (전용 chevron)

- 상품명 셀의 chevron(▾/▸)**만** 상세 패널을 토글한다. 행의 다른 영역 클릭은 상세를 열지 않는다 → 전파 충돌 최소화(Fable 권장).
- 상세 열림 상태는 `expandedDetailIds: Set<string>`(productId)로 관리.
- 그룹행의 옵션 펼침(기존 `toggleGroup` / `expandedGroups`)은 그대로 유지. 그룹행 클릭 = 옵션 펼침, 리프행 chevron = 상세 펼침. 두 축은 독립.
- **동반 버그 수정:** 그룹 숨김 버튼(`CostManagementTab.tsx:676` `toggleGroupHide`)이 `stopPropagation` 없이 그룹 토글까지 유발하는 기존 잠복 버그를 이 작업에서 함께 고친다.

## 4. 위너 배지 — 간이 판정으로 부활

**문제(Fable):** 현재 `isWinner(0, 0, adRoas, qtySold)`(`products/route.ts:227`)가 클릭·전환율을 0으로 하드코딩해 4기준 중 최대 2개만 통과 → 항상 `'normal'` → `WinnerBadge`가 `null`(`WinnerBadge.tsx:18`). 배지가 절대 표시되지 않음.

**해결:** 사용 가능한 2축(판매수량 + ROAS vs 손익분기)으로 판정하는 순수 함수를 신설한다.

```
determineWinnerStatus(qtySold, adRoas, breakevenRoas):
  hasAds = adRoas > 0
  adEfficient = !hasAds || adRoas >= breakevenRoas   // 광고 없으면 효율 조건 통과로 간주
  if qtySold >= 5 && adEfficient      → 'winner'   // 잘 팔리고 광고 손익분기 이상(또는 광고 없음)
  if qtySold >= 5                      → 'watch'    // 잘 팔리지만 광고 비효율
  if qtySold >= 1 && hasAds && adEfficient → 'watch' // 소량이나 광고 효율 좋음
  else                                 → 'normal'
```

- 위치: `src/lib/roi/calculations.ts`에 `determineWinnerStatus` 추가(순수·단위 테스트 대상). 기존 `isWinner`는 클릭/전환율 데이터 연동 시를 위해 남겨둔다.
- `products/route.ts:227`에서 `winner_status`를 `determineWinnerStatus(totalQtySold, adRoas, breakevenRoas)`로 계산.
- 임계값(5, breakeven)은 상수로 명시.

## 5. 판매수량 필드 추가

**문제(Fable):** `sale_count`는 판매 "건수"(`pFilteredSales.length`)지 수량이 아님. 수량 합 `totalQtySold`는 `products/route.ts:222`에서 이미 계산되나 응답에 없음.

**해결:**
- `products/route.ts` 응답 상품 객체에 `sale_quantity: totalQtySold` 한 줄 추가.
- `CostManagementTab.tsx`의 `ProductRow` 타입에 `sale_quantity: number` 추가.
- 표시 열 3의 수량 표기에 사용. 그룹 집계는 자식 `sale_quantity` 합.

## 6. 상단 매출 카드 2종 — 라벨만 명확히 (카드 수 유지)

- 섹션 A 헤더(`:951`) "실제 매출 (…API · 취소/반품 제외)" → **"실제 매출 · 플랫폼 확정"** (부제: 쿠팡+네이버+RG API 집계).
- 섹션 B 헤더(`:1010`) "원가·수익 (수동 입력 기반)" → **"관리 손익 · 내 입력 기반"** (부제: 입고·판매 수동 관리).
- 두 섹션 사이 한 줄 안내: *"실제 매출은 플랫폼 API 실시간 집계, 관리 손익은 입력한 원가·판매 기반 계산이라 값이 다를 수 있습니다."*
- 카드 개수/구성(API 5장 + 수동 3장)은 변경하지 않음.

## 7. 파일 분해 (구조 개선)

`CostManagementTab.tsx`가 과대해 행 렌더 로직을 분리한다. 신규 디렉터리 `src/components/orders/cost-table/`:

| 파일 | 책임 | 주요 props |
|---|---|---|
| `ProductRow.tsx` | 리프행(단일/옵션 자식): 7개 KPI 열 + ⋯ 메뉴 + chevron | `product`, `isChild`, `expanded`, `onToggleDetail`, `onOpenDrawer`, `onSaveAdSpend`, `onHide`, `onDelete`, `onEditChannel`, `onProductUpdate`, `isEditablePeriod`, `channelFilter`, `rgInventory` |
| `ProductDetailPanel.tsx` | 인라인 상세: 수치 스트립 + [입고·판매 관리]·[광고비] | `product`, `isEditablePeriod`, `onOpenDrawer`, `onSaveAdSpend`, `rgInventory`, `channelFilter` |
| `GroupRow.tsx` | 그룹 집계행: 집계 KPI + 옵션 펼침 토글 + 그룹 ⋯ | `group`, `expanded`, `onToggleGroup`, `onToggleGroupHide`, `channelFilter` |

- **props 다이어트(Fable):** 광고비 편집 state 5종(`editingAdSpendId/Value`, setter, `saveTriggeredByKey`)을 상세 패널 로컬 state로 내리고 상위엔 `onSaveAdSpend(id, value)` 콜백 하나만 노출. 상세는 한 번에 하나만 열리므로 "행 간 단일 편집 보장"이 자연 해소.
- `CostManagementTab.tsx`는 데이터 로드·필터·상단 카드·조립만 담당. `buildTableItems`/`product-grouping`은 그대로 재사용.
- **RTL 주의:** `<tr>` 반환 컴포넌트는 테스트 시 `<table><tbody>`로 감싸 렌더.

## 8. 테스트 전략

- **순수 함수 단위 테스트** (`src/lib/roi/__tests__/` 또는 `src/__tests__/lib/`): `determineWinnerStatus` — winner/watch/normal 경계값(qtySold 4/5, ROAS < / ≥ breakeven, 광고 유무).
- **컴포넌트 테스트** (`src/__tests__/components/`):
  - `ProductRow`: 7개 KPI 열 렌더, 위너 배지 조건부 표시, chevron 클릭 시 `onToggleDetail` 호출, ⋯ 메뉴에서 숨기기/삭제 콜백, ChannelCell/⋯ 클릭이 상세 토글을 유발하지 않음(전파 차단).
  - `ProductDetailPanel`: 수치 스트립 값 표시, [입고·판매 관리] 클릭 시 `onOpenDrawer`, 광고비 편집 저장.
  - `GroupRow`: 집계값 렌더, 옵션 토글 콜백, 그룹 숨김 버튼이 그룹 토글을 유발하지 않음(전파 버그 수정 검증).
- **회귀:** 기존 products API 응답 스키마 변경(`sale_quantity` 추가)은 하위호환(필드 추가만). `winner_status` 계산 경로만 교체.

## 9. 범위 밖 (명시적 제외)

- 상단 매출 카드의 **구조 재설계**(카드 통합/그래프화) — 라벨만.
- 클릭·전환율 기반 정식 위너 판정 — 광고 데이터 연동 시 별도.
- 열 표시/순서 사용자 커스터마이즈 저장 — 후속.
- 성능(products GET 전량 로드) — 로드맵 P3 별도 항목.

## 10. 리스크

| 리스크 | 완화 |
|---|---|
| 행 렌더 분해 중 상위 state 배선 누락 | props 목록을 §7 표로 고정, 광고비 state만 하향 |
| 전파 충돌 재발 | chevron 전용 토글(행 클릭 없음)로 표면적 축소 + ChannelCell/⋯ 차단 |
| 위너 판정 완화가 과다 노출 | 임계값 상수화 + 단위 테스트로 경계 고정 |
| 드로어 재조회(load) 시 열린 상세 행 사라짐 | 무해(패널 자동 정리), 인지만 |
