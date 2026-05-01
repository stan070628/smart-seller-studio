# 대시보드 재설계 — 운영 중심 + 플랜 통합

작성일: 2026-04-26

## 배경 / 동기

현재 대시보드는 소싱(도매꾹/코스트코/니치) 중심으로 구성되어 있어 **일상적인 운영 데이터(주문/배송/정산)를 한눈에 보기 어렵다**. 셀러가 매일 아침 처음 열었을 때 "지금 무슨 일을 해야 하는지"가 즉시 보여야 한다.

동시에 사용자는 별도로 운영하는 [3개월 1천만원 플랜(`/plan`)](../../../src/components/plan/PlanClient.tsx) 의 핵심 정보를 대시보드에서도 확인하길 원한다.

## 목표

1. **소싱 데이터 전부 제거** — 도매꾹/코스트코/니치 KPI, 채널 탭, 관련 퀵액션 모두 삭제
2. **주문 파이프라인 5단계 시각화** — `주문 → 배송중 → 배송완료 → 구매확정 → 정산완료`, 쿠팡/네이버 분리 표시
3. **플랜 진행 통합** — 현재 주차/매출 목표 진행률, 이번주 핵심 미션, 12주 누적 매출 추세
4. **정산 API 신규 연동** — 쿠팡 Wing `revenue-history`, 네이버 커머스 `settlements` 호출

## 비목표 (YAGNI)

- 모바일 반응형 완성도 (가로 스크롤 폴백만 보장)
- 차트 라이브러리 도입 (SVG 직접 렌더)
- 자동 폴링/실시간 업데이트
- 시각적 회귀 테스트
- 다른 페이지(소싱/에디터/상품등록 등)는 변경 없음

---

## UI 레이아웃

위→아래 흐름. 데스크탑 폭 1200px 기준.

```
┌─ Header (기존 유지) ────────────────────────────────────────┐

┌─ 플랜 카드 (전폭, 강조) ───────────────────────────────────┐
│ Week N · 주차 타이틀                          D+x/7        │
│ ──────────────────────────────────────────────────────────│
│ 매출 목표 XX만원   ████░░░░░░  XX%                         │
│ 현재 X만원 / XX만원                                        │
│                                                            │
│ 🎯 이번주 핵심 미션                                        │
│ "(첫 미완료 WBS 태스크 텍스트)"                             │
└────────────────────────────────────────────────────────────┘

┌─ 등록 상품 (가로 슬림) ────────────────────────────────────┐
│ 📦 등록 상품   쿠팡 X │ 네이버 Y │ 총 Z                    │
└────────────────────────────────────────────────────────────┘

┌─ 주문 파이프라인 ───────────[ 오늘 7일 30일 이번달 ]───────┐
│                                                            │
│  쿠팡   [주문] → [배송중] → [배송완료] → [구매확정] → [정산완료] │
│  네이버 [주문] → [배송중] → [배송완료] → [구매확정] → [정산완료] │
│                                                            │
│  각 카드: 카운트 (큰 글씨) + 금액 합계 (작게)               │
└────────────────────────────────────────────────────────────┘

┌─ 12주 누적 매출 추세 ──────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────┐ │
│  │   [SVG 라인차트]                                     │ │
│  │   - 회색 점선: 누적 목표 (50→1000만원)                │ │
│  │   - Accent 실선: 누적 실제 (이번주까지)               │ │
│  └──────────────────────────────────────────────────────┘ │
│   W1   W3   W5   W7   W9   W11  W12                       │
└────────────────────────────────────────────────────────────┘
```

### 색상 시스템

- 파이프라인 stage: 좌→우 회색 → 파랑 → 초록 그라데이션, 정산완료는 accent red 강조
- 채널 식별: 쿠팡 = accent red, 네이버 = 초록 (행 좌측 dot)
- 차트: 목표 = `#a1a1aa` 점선, 실제 = `#be0014` 굵은 실선
- 디자인 토큰 `C` (`@/lib/design-tokens`) 재사용

---

## 데이터 흐름

### API: `GET /api/dashboard/summary`

**요청 파라미터**

| 이름 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `period` | `today \| 7d \| 30d \| month` | `today` | 파이프라인 집계 기간 |

**응답 스키마**

```ts
interface DashboardSummary {
  success: true;
  data: {
    products: {
      coupang: number;   // 등록된 쿠팡 상품 수
      naver: number;     // 등록된 네이버 상품 수
    };
    pipeline: {
      coupang: ChannelPipeline;
      naver: ChannelPipeline;
    };
    revenue12w: {
      weeks: number[];           // [1..12]
      target: number[];          // 누적 목표 (만원)
      actual: (number | null)[]; // 서버는 null[] 반환, 클라이언트가 plan localStorage 기반으로 채움
    };
  };
}

interface ChannelPipeline {
  주문:     { count: number; amount: number };
  배송중:   { count: number; amount: number };
  배송완료: { count: number; amount: number };
  구매확정: { count: number; amount: number };
  정산완료: { count: number; amount: number; available: boolean };
  // available: 정산 API 연동/응답 성공 여부
  lastUpdated: string; // ISO timestamp
}
```

### Stage ↔ 외부 status 매핑

| Stage | 쿠팡 (Wing API) | 네이버 (커머스 API) |
|---|---|---|
| 주문 | `ACCEPT` | `PAYED` |
| 배송중 | `INSTRUCT`, `DEPARTURE`, `DELIVERING` | `DISPATCHED`, `DELIVERING` |
| 배송완료 | `FINAL_DELIVERY` (구매확정 전) | `DELIVERED` |
| 구매확정 | 구매확정 API 결과 (없으면 `FINAL_DELIVERY` + 8일 룰로 추정) | `PURCHASE_DECIDED` |
| 정산완료 | `revenue-history` API (입금 완료된 건) | `settlements` API (지급 완료된 건) |

> **주의**: 네이버 정확한 status enum은 구현 단계에서 네이버 커머스 API 문서 재확인 필요. 위 표는 일반적인 명명 가정.

### 등록 상품 수 출처

- 쿠팡: `getRegisteredProducts` (이미 `/api/listing/coupang/registered/route.ts` 존재) — `total` 필드 활용
- 네이버: 네이버 `getProducts` (페이징 응답의 `totalElements`) — 기존 listing 코드 재사용

### 캐싱

- 서버: in-memory `Map<period, { data, expires }>` 30초 TTL
- 클라이언트: 진입 시 1회 fetch + 우상단 수동 새로고침 버튼

### 클라이언트 측 (플랜 데이터)

- `localStorage`에서 `plan_daily_records`, `plan_wbs_tasks` 읽기
- 현재 주차 / 주차별 매출 누적 계산은 **client에서 수행** (서버에 localStorage 없음)
- 12주 차트의 `actual` 배열은 daily_records 합산 결과를 client에서 채워서 서버 응답과 머지
  - 서버 응답의 `revenue12w.actual`은 `null[]`로 초기화하여 보냄
  - 클라이언트가 plan localStorage 기반으로 채움

---

## 컴포넌트 구조

```
src/components/dashboard/
  DashboardClient.tsx              ← 전면 재작성 (오케스트레이션만)
  PlanProgressCard.tsx             ← NEW: 주차/목표진행률/핵심미션
  ProductCountWidget.tsx           ← NEW: 등록상품 가로 슬림 카드
  OrderPipeline.tsx                ← NEW: 5단계 × 2채널 그리드
  PipelineStageCard.tsx            ← NEW: 단일 stage 카드
  RevenueChart.tsx                 ← NEW: 12주 SVG 라인차트
  PeriodToggle.tsx                 ← NEW: 기간 선택 토글

src/lib/plan/
  week.ts                          ← NEW: getCurrentWeek 등 (PlanClient에서 추출)
  daily-records.ts                 ← NEW: localStorage 읽기, 주차별 누적 합산
  constants.ts                     ← NEW: WEEKLY_TARGETS, PLAN_START, WBS_DATA 추출

src/lib/dashboard/
  pipeline-aggregator.ts           ← NEW: 쿠팡/네이버 status → stage 매핑/집계
  settlement-clients.ts            ← NEW: 쿠팡/네이버 정산 API 호출 래퍼
```

**기존 PlanClient 리팩터링**: `WBS_DATA`, `WEEKLY_TARGETS`, `PLAN_START`, `getCurrentWeek`, `getWeekForDate`, `loadDailyRecords`, `saveDailyRecords`, `loadTaskChecks`, `saveTaskChecks`를 `src/lib/plan/`로 추출. PlanClient는 import만 변경. **기능 변경 없음**.

### 컴포넌트 인터페이스

```ts
// PlanProgressCard.tsx
interface PlanProgressCardProps {
  // 모두 client-side localStorage에서 계산되어 주입됨
  weekNumber: number;          // 1..12
  weekTitle: string;
  weekTargetMan: number;       // 이번주 단독 목표 (만원)
  weekActualMan: number;       // 이번주 단독 실제 (만원)
  daysIntoWeek: number;        // 1..7
  keyMission: string | null;   // 첫 미완료 WBS 태스크
}

// OrderPipeline.tsx
interface OrderPipelineProps {
  coupang: ChannelPipeline;
  naver: ChannelPipeline;
  period: Period;
  onPeriodChange: (p: Period) => void;
}

// RevenueChart.tsx
interface RevenueChartProps {
  weeks: number[];
  target: number[];
  actual: (number | null)[];
  currentWeek: number;
}
```

---

## 엣지 케이스 / 에러 처리

| 상황 | 처리 |
|---|---|
| 플랜 localStorage 비어있음 | 플랜 카드 자리에 "플랜을 시작해주세요" + `/plan` CTA |
| 현재 주차 > 12 | 마지막 주(12) 데이터로 고정, "플랜 종료" 배지 |
| 이번주 핵심 미션 모두 완료 | "이번주 미션 완료! 🎉" 메시지 |
| 정산 API 자격증명 미설정 | 정산 stage만 "API 미연동" 작은 배지, 다른 stage 정상 |
| 채널 주문 0건 | stage 카드 모두 0 표시 (빈 상태 화면 X) |
| 쿠팡/네이버 한쪽만 등록 | 등록상품 0인 채널 행 opacity 0.5 |
| API 전체 실패 | 페이지 상단에 재시도 버튼 + 빈 상태 |
| 한 채널만 실패 | 해당 채널 행만 "데이터 없음" 표시 |

**병렬 처리**: 모든 외부 API 호출은 `Promise.allSettled`로 병렬, 일부 실패가 전체를 막지 않음.

---

## 테스트 전략 (Vitest)

**단위 테스트**
- `src/lib/plan/week.ts` — `getCurrentWeek`, `getWeekForDate` (다양한 날짜 입력)
- `src/lib/plan/daily-records.ts` — 누적 합산, 주차별 그룹핑, 빈 입력
- `src/lib/dashboard/pipeline-aggregator.ts` — 쿠팡/네이버 status → stage 매핑

**통합 테스트**
- `src/app/api/dashboard/summary/route.ts` — 외부 API mock 후 응답 셰이프 검증
- 정산 API 실패 시 `available: false` 반환 검증
- 캐시 동작 (같은 period 30초 내 재호출 시 외부 API 미호출)

**컴포넌트 테스트** (React Testing Library)
- `PlanProgressCard` — 빈 상태, 정상 상태, 전부 완료 상태
- `OrderPipeline` — 한 채널만 데이터 있는 케이스
- `RevenueChart` — 데이터 없음, 일부 주차만 있음

**테스트 안 함 (YAGNI)**
- 차트 픽셀 비교
- 정산 API 자체 동작 (외부 신뢰)
- E2E

---

## 점진적 출시 전략

| Phase | 내용 | 검증 |
|---|---|---|
| 1 | UI 재구성 + 플랜 카드 + 등록상품 + 파이프라인(정산 제외) + 12주 차트 | 정산 stage "—" 표시되어도 다른 데이터 정상 |
| 2 | 쿠팡 `revenue-history` 정산 API 연동 | 쿠팡 정산 stage 실제 데이터 표시 |
| 3 | 네이버 `settlements` 정산 API 연동 | 네이버 정산 stage 실제 데이터 표시 |

각 phase는 독립적으로 배포 가능. Phase 1만으로도 사용자 가치 있음.

---

## 참고 / 영향 범위

**수정**
- `src/components/dashboard/DashboardClient.tsx` (전면 재작성)
- `src/app/api/dashboard/summary/route.ts` (전면 재작성)
- `src/components/plan/PlanClient.tsx` (import만 변경, 동작 변경 없음)

**신규**
- `src/components/dashboard/{PlanProgressCard,ProductCountWidget,OrderPipeline,PipelineStageCard,RevenueChart,PeriodToggle}.tsx`
- `src/lib/plan/{week,daily-records,constants}.ts`
- `src/lib/dashboard/{pipeline-aggregator,settlement-clients}.ts`
- 위 모든 lib 모듈에 대응되는 `__tests__/*.test.ts`

**미변경**
- `/sourcing`, `/editor`, `/listing`, `/orders`, `/plan` 페이지 동작 변경 없음
- 디자인 토큰, 헤더, 네비게이션 그대로
