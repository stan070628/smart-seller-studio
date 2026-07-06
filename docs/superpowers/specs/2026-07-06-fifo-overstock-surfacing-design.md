# FIFO 재고초과 노출 설계

> 작성일: 2026-07-06
> 대상: `products/route.ts` + `cost-table/` 행 컴포넌트
> 선행 문서: [업그레이드 로드맵](./2026-07-05-cost-management-upgrade-roadmap.md) §1.3 (A)

## 0. 문제

`products/route.ts:199-201`에서 판매 수량이 입고 수량을 초과하면 `calculateFifo`가 `RangeError`를 던지고, catch가 `console.warn`만 한 뒤 `fifoResult`를 0 기본값으로 남긴다. 결과적으로 그 상품은 실현손익·재고가 **조용히 0**으로 표시된다. 사용자는 숫자가 왜 0인지(재고초과 때문인지) 알 수 없고 고칠 단서도 없다.

## 1. 목표

- 재고초과(FIFO 계산 실패) 상품을 테이블에서 **명확히 표시**하고, 오해 소지 있는 0 대신 "확인 필요"를 보여준다.
- 상세 패널에 **원인·해결 안내**를 준다.

**성공 기준:** 재고초과 상품은 상품명 옆 경고 배지 + 실현손익 "확인 필요"로 표시되고, 상세를 펼치면 "입고를 추가하거나 판매를 확인하라"는 안내가 보인다.

## 2. API 플래그 (`products/route.ts`)

- FIFO try 블록 앞에 `let fifoError = false;` 선언.
- catch에서 `fifoError = true;` 설정(기존 `console.warn` 유지).
- 응답 객체에 `fifo_error: fifoError` 추가.

값(0 기본값)은 그대로 두되 플래그로 신뢰불가를 표시한다.

## 3. 리프행 경고 (`ProductRow` + 타입)

- `CostManagementTab.tsx`의 `ProductRow` 인터페이스에 `fifo_error: boolean` 추가. `ProductRow.tsx`의 `RowProduct`에도 추가.
- **상품명 옆 경고 배지**: `fifo_error`일 때 ⚠ 배지(빨강 배경) + `title` 툴팁 "판매 수량이 입고 수량을 초과했습니다".
- **실현손익 셀**: `fifo_error`일 때 기존 0/`—` 대신 **"확인 필요"**(빨강). (마진율·ROAS는 그대로 — 배지가 신뢰불가를 알림)

## 4. 상세 패널 안내 (`ProductDetailPanel`)

- `ProductDetailPanel`의 Props에 `fifoError?: boolean` 추가(리프행에서 전달).
- `fifoError`일 때 수치 스트립 위에 안내 줄:
  > ⚠ 판매 수량이 입고 수량을 초과했습니다. 입고를 추가하거나 판매 내역을 확인하세요. (재고·실현손익이 정확히 계산되지 않습니다.)

## 5. 그룹행 배지 (`GroupRow`)

- `GroupRow`에서 `group.children.some((c) => c.fifo_error)`이면 그룹명 옆에 동일한 ⚠ 배지. (그룹 집계 자체는 자식 값 합이라 재고초과 자식이 있으면 신뢰불가 신호)

## 6. 경고 배지 컴포넌트

- 재사용을 위해 작은 인라인 배지를 `ProductRow`/`GroupRow`에서 공유. 별도 파일은 만들지 않고 각 컴포넌트에 인라인(WinnerBadge 패턴처럼 단순). 또는 `cost-table/`에 `OverstockBadge.tsx`(⚠ 배지) 하나를 두어 ProductRow·GroupRow·DetailPanel 안내가 참조. → **`OverstockBadge.tsx` 신규**(한 곳 정의, 3곳 사용)로 DRY.

## 7. 테스트

- **`OverstockBadge`**: 렌더 스냅샷(⚠ 텍스트·title 존재) 단위 테스트.
- **`ProductRow`**: `fifo_error=true`면 경고 배지 렌더 + 실현손익 셀 "확인 필요"; `false`면 배지 없음.
- **`ProductDetailPanel`**: `fifoError=true`면 안내 줄 렌더; `false`면 없음.
- **`GroupRow`**: 자식 중 `fifo_error`면 배지 렌더.
- API 플래그(route.ts)는 SQL/런타임이라 단위 테스트 불가 → 리뷰 + 수동 검증(재고초과 상품 존재 시).

## 8. 파일 요약

| 파일 | 변경 |
|---|---|
| `src/app/api/cost-management/products/route.ts` | `fifo_error` 플래그 + 응답 필드 |
| `src/components/orders/CostManagementTab.tsx` | `ProductRow` 타입에 `fifo_error`; 리프행/상세에 prop 전달 |
| `src/components/orders/cost-table/OverstockBadge.tsx` | 신규 — ⚠ 재고초과 배지 |
| `src/components/orders/cost-table/ProductRow.tsx` | 배지 + 실현손익 "확인 필요" |
| `src/components/orders/cost-table/ProductDetailPanel.tsx` | 안내 줄 |
| `src/components/orders/cost-table/GroupRow.tsx` | 자식 재고초과 시 배지 |
| 테스트 | OverstockBadge, ProductRow, ProductDetailPanel, GroupRow 확장 |

## 9. 범위 밖

- 재고초과 자체 방지(입고<판매 입력 차단) — 별도.
- `fifo-summary` 드로어 — 이미 422 반환(별도 처리됨).
- 재고초과 상품 목록/필터 — 후속.

## 10. 리스크

| 리스크 | 완화 |
|---|---|
| 정상 상품에 오검출 배지 | `fifo_error`는 `calculateFifo`가 실제 throw할 때만 true. 정상 계산은 false |
| 배지가 위너 배지와 시각 충돌 | 위너=초록/관찰=노랑, 재고초과=빨강 ⚠로 구분. 상품명 옆 나란히 |
| 그룹 배지 오탐(자식 1개만 초과) | 의도된 동작 — 그룹 집계에 신뢰불가 자식이 있음을 알림 |
