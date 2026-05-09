# 주문/매출 탭 재편 — 수익·원가 통합 설계

## 배경 및 목적

현재 주문/매출 탭에는 4개의 서브탭(주문관리, 매출분석, 채널설정, 원가관리)이 있다. 아래 세 가지 기능 중복 문제가 있다:

1. **매출 숫자가 두 군데** — 매출분석(API 기반 실제값) vs 원가관리(수동 입력 기반 추정값)
2. **상품별 매출이 두 군데** — 매출분석의 Top 상품 vs 원가관리의 상품별 행
3. **이중 작업** — 주문관리에서 주문 확인 → 원가관리에서 쿠팡 주문 import

이를 해소하기 위해 4탭을 3탭으로 재편하고, 원가관리를 수익 분석까지 아우르는 단일 탭으로 강화한다.

## 확정 결정 사항

- 탭 통합 방식: **기능별 재편 (3탭)**
- 매출 데이터 연동: **수동 import 유지** (쿠팡 주문 자동 연동 없음)
- 수익·원가 탭 내부 레이아웃: **단일 스크롤 뷰** (기간 필터 하나로 전체 제어)

## 탭 구조 변경

| | 현재 | 변경 후 |
|---|---|---|
| 탭 1 | 주문관리 | 주문·배송 (이름만 변경) |
| 탭 2 | 매출분석 | **제거** |
| 탭 3 | 채널설정 | 채널설정 (변경 없음) |
| 탭 4 | 원가관리 | 수익·원가 (기능 확장) |

`OrdersClient.tsx` 기준 서브탭 ID:
- `orders` → 주문·배송
- `analytics` → **삭제**
- `channels` → 채널설정
- `cost` → 수익·원가 (탭 레이블만 변경, 컴포넌트 교체)

## "수익·원가" 탭 내부 구조

### 기간 필터 (단일, 전체 제어)
이번 달 / 지난 달 / 3개월 / 6개월 / 전체 / 직접 입력
기간 선택이 바뀌면 아래 두 섹션 모두 재조회된다.

### 섹션 A — 실제 매출 (쿠팡+네이버 API 기반)
기존 `AnalyticsTab`의 fetch 로직을 이식한다. 표시 항목:
- 실제 총 매출 + 전기 대비 증감률
- 주문 건수 + 전기 대비 증감률
- 채널별 매출 (쿠팡 / 네이버 금액 및 비중)
- 취소/반품 건수

데이터 출처: `/api/orders/coupang`, `/api/orders/naver` (병렬 fetch, 기존 로직 그대로)

### 섹션 B — 원가·수익 요약 (수동 입력 DB 기반)
기존 `CostManagementTab`의 요약 카드 그대로 유지:
- 관리 상품 수
- 기간 총 매입비
- 추정 순이익
- 마진율

데이터 출처: `/api/cost-management/products` (기존 그대로)

### 구분선

### 섹션 C — 상품별 원가·수익 테이블
기존 `CostManagementTab`의 상품 테이블 그대로 유지:
- 상품 추가 / 배송비 그룹 / 검색
- 상품명, 평균원가, 판매가, 마진율, 재고, 순이익
- 행 클릭 → 입고 내역·판매 내역 드로어 (기존 그대로)

## 코드 변경 범위

### 삭제
- `src/components/orders/AnalyticsTab.tsx` — 기능이 CostManagementTab으로 이동하므로 파일 삭제

### 수정 1 — `src/components/orders/OrdersClient.tsx`
- `analytics` 서브탭 항목 제거
- 탭 레이블 변경: `주문관리` → `주문·배송`, `원가관리` → `수익·원가`
- `AnalyticsTab` import 및 렌더링 코드 제거
- `SubTab` 타입에서 `'analytics'` 제거

### 수정 2 — `src/components/orders/CostManagementTab.tsx`
- 기존 기간 필터를 상단에 유지하되, 기간 선택 시 섹션 A(API 매출)도 함께 재조회되도록 연결
- **기간 필터 시스템 통일**: CostManagementTab의 기존 프리셋(이번 달/지난 달/3개월/6개월/전체/직접 입력)을 그대로 사용. AnalyticsTab은 `getMonths` 방식이었으나, 기존 `getDateRange(preset)` 함수가 반환하는 `{ from, to }` 날짜 문자열을 그대로 섹션 A API 호출에 전달하면 호환됨
- 기존 요약 카드 4개 위에 **섹션 A** 추가:
  - `AnalyticsTab`의 `fetchOrdersForPeriod(from, to)` 함수를 CostManagementTab 내부로 이식
  - 실제 매출, 주문 건수, 채널별 매출(쿠팡/네이버), 전기 대비 증감 카드 렌더링
  - 쿠팡/네이버 API 에러는 경고 배너로 표시 (기존 AnalyticsTab과 동일 UX)
  - `preset === 'all'`일 때는 섹션 A API 조회 범위가 무제한이므로 성능 경고 문구 표시
- 기존 요약 카드·테이블은 아래로 내려 **섹션 B/C**로 유지

### 유지 (변경 없음)
- `src/components/orders/OrdersTab.tsx`
- `src/components/orders/ChannelsTab.tsx`
- `src/components/orders/SaleEntryPanel.tsx`
- `src/components/orders/CostEntryDrawer.tsx`
- `src/components/orders/AddProductModal.tsx`
- `src/components/orders/ShippingGroupModal.tsx`
- `src/app/api/orders/coupang/route.ts`
- `src/app/api/orders/naver/route.ts`
- `src/app/api/cost-management/**`

## 데이터 흐름

```
기간 필터 변경
  ├── 섹션 A: /api/orders/coupang + /api/orders/naver (병렬) → 실제 매출 카드
  └── 섹션 B/C: /api/cost-management/products → 원가·수익 요약 + 상품 테이블
```

두 fetch는 독립적으로 실행되며, 각각 로딩 상태를 별도 관리한다. 한쪽 API가 실패해도 나머지는 정상 표시된다.

## 엣지 케이스

- **쿠팡/네이버 API 실패**: 섹션 A에 경고 배너 표시 (기존 AnalyticsTab 동작과 동일). 섹션 B/C는 영향 없음
- **원가 데이터 없음**: 섹션 B/C에 "상품을 추가해주세요" 안내 (기존 동작 유지)
- **두 섹션의 기간 불일치 가능성 없음**: 기간 필터가 단일이므로 항상 같은 기간 조회

## 범위 밖 (이번 작업에서 제외)

- 쿠팡/네이버 주문 자동 연동 (import 자동화)
- API 실제 매출과 수동 원가의 상품 단위 매칭
- 차트/그래프 시각화 추가
