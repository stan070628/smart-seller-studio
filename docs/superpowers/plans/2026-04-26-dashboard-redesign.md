# 대시보드 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소싱 데이터를 제거하고 운영 중심(주문 파이프라인 5단계 × 채널) + 플랜 통합(주차/목표/미션/12주 차트)으로 대시보드를 재구성한다.

**Architecture:** PlanClient의 plan 데이터 헬퍼를 `src/lib/plan/`로 추출 → 신규 `src/lib/dashboard/` 모듈로 파이프라인 집계/정산 클라이언트 작성 → `/api/dashboard/summary` 전면 재작성 → 신규 컴포넌트 6개 + DashboardClient 재작성. 정산 API는 점진적 도입(Phase 5/6).

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · Vitest + RTL · Coupang Wing API · 네이버 커머스 API · 인라인 SVG 차트 (라이브러리 X)

**스펙:** [`docs/superpowers/specs/2026-04-26-dashboard-redesign-design.md`](../specs/2026-04-26-dashboard-redesign-design.md)

---

## 파일 구조 (작성/수정 대상)

**신규 파일**
```
src/lib/plan/
  constants.ts                     - WBS_DATA, WEEKLY_TARGETS, PLAN_START
  week.ts                          - getCurrentWeek, getWeekForDate, getDaysIntoWeek
  daily-records.ts                 - DailyRecord 타입, load/save, 주차별 누적 합산

src/lib/dashboard/
  types.ts                         - DashboardSummary, ChannelPipeline, Period 등
  pipeline-aggregator.ts           - 쿠팡/네이버 status → 5단계 집계
  settlement-clients.ts            - 정산 데이터 fetch (Phase 5/6에서 실제 구현)

src/components/dashboard/
  PeriodToggle.tsx                 - 기간 선택 토글
  ProductCountWidget.tsx           - 등록 상품 수 가로 슬림 카드
  PlanProgressCard.tsx             - 주차/목표진행률/핵심미션
  PipelineStageCard.tsx            - 단일 stage 카드
  OrderPipeline.tsx                - 5단계 × 2채널 그리드
  RevenueChart.tsx                 - 12주 누적 매출 SVG 라인차트

src/__tests__/
  lib/plan/week.test.ts
  lib/plan/daily-records.test.ts
  lib/dashboard/pipeline-aggregator.test.ts
  api/dashboard-summary.test.ts
  components/dashboard/plan-progress-card.test.tsx
  components/dashboard/order-pipeline.test.tsx
  components/dashboard/revenue-chart.test.tsx
```

**수정 파일**
```
src/components/dashboard/DashboardClient.tsx     - 전면 재작성
src/app/api/dashboard/summary/route.ts           - 전면 재작성
src/components/plan/PlanClient.tsx                - import만 변경 (동작 변경 X)
src/lib/listing/coupang-client.ts                 - getRevenueHistory 추가 (Phase 5)
src/lib/listing/naver-commerce-client.ts          - getSettlements 추가 (Phase 6)
```

---

## Phase 1: 플랜 유틸리티 추출

### Task 1: 플랜 상수 추출

**Files:**
- Create: `src/lib/plan/constants.ts`

- [ ] **Step 1: 상수 모듈 생성**

`src/lib/plan/constants.ts`:
```ts
/**
 * 플랜 관련 공유 상수.
 * PlanClient.tsx에서 추출 — 대시보드와 플랜 페이지 양쪽에서 사용.
 */

export interface WbsTask {
  id: string;
  text: string;
}

export interface WeekData {
  title: string;
  goal: string;
  revenueTarget: string;
  tasks: WbsTask[];
}

/** 주차별 WBS — 1~12주 */
export const WBS_DATA: Record<number, WeekData> = {
  1: {
    title: '기반 세팅',
    goal: '100개 상품 등록, 첫 판매 발생',
    revenueTarget: '50만원',
    tasks: [
      { id: 'w1-1', text: '아이템스카우트(itemscout.io) 가입 및 사용법 숙지' },
      { id: 'w1-2', text: '틈새 키워드 발굴 — 월 검색량 1,000 이상 / 경쟁상품수 검색량의 5배 미만 / 상위 리뷰 100개 미만' },
      { id: 'w1-3', text: '발굴 키워드 30개 목록 작성' },
      { id: 'w1-4', text: '도매꾹 위 키워드 매칭 상품 100개 선별 (마진 30% 이상 / 위탁 가능 / 배송 3일 이내)' },
      { id: 'w1-5', text: '코스트코 주말 방문: 온라인 미출시 상품 10개 스캔 (경쟁 셀러 3개 미만)' },
      { id: 'w1-6', text: 'Smart Seller Studio 도매꾹 대량 등록 기능 완성 (타이틀/카테고리/이미지/가격 자동 입력)' },
      { id: 'w1-7', text: '스마트스토어 소개/로고/배너 정비' },
      { id: 'w1-8', text: 'CS 자동 응답 메시지 설정' },
    ],
  },
  2: {
    title: '첫 판매 달성',
    goal: '100개 등록, 광고 시작',
    revenueTarget: '100만원',
    tasks: [
      { id: 'w2-1', text: 'Smart Seller Studio로 스마트스토어에 50개 등록' },
      { id: 'w2-2', text: '나머지 50개 추가 등록 (총 100개)' },
      { id: 'w2-3', text: '각 상품 AI 상세페이지 생성 (Step3 활용)' },
      { id: 'w2-4', text: '상품 타이틀 키워드 최적화 (메인+세부키워드)' },
      { id: 'w2-5', text: '네이버 검색광고 계정 세팅' },
      { id: 'w2-6', text: '쇼핑 키워드 광고 캠페인 생성 (일 3만원, 키워드 10개)' },
      { id: 'w2-7', text: '쿠팡 스폰서드 프로덕트 5개 (일 1만원)' },
      { id: 'w2-8', text: '첫 2주 가격: 경쟁자 최저가보다 5~10% 저렴하게' },
      { id: 'w2-9', text: '지인/가족 5명 구매 부탁 → 첫 리뷰 5개 확보' },
    ],
  },
  3: {
    title: '위너 발굴 1',
    goal: '팔리는 상품 TOP 5 발굴',
    revenueTarget: '200만원',
    tasks: [
      { id: 'w3-1', text: '상품별 CTR 확인 → 1% 미만 상품 타이틀/이미지 교체' },
      { id: 'w3-2', text: '전환율 확인 → 클릭 있는데 구매 없는 상품 가격/상세페이지 수정' },
      { id: 'w3-3', text: '광고 ROAS 계산 (목표 300% 이상)' },
      { id: 'w3-4', text: '성과 하위 30개 상품 새 키워드 상품으로 교체' },
      { id: 'w3-5', text: '추가 50개 등록 (총 150개)' },
      { id: 'w3-6', text: '새 카테고리 1개 탐색' },
      { id: 'w3-7', text: '구매자 리뷰 요청 메시지 발송' },
      { id: 'w3-8', text: '상품별 리뷰 5개 이상 확보 목표' },
    ],
  },
  4: {
    title: '위너 발굴 2',
    goal: '위너 상품 5개 확정, 사입 준비',
    revenueTarget: '300만원',
    tasks: [
      { id: 'w4-1', text: '2주 누적 데이터로 판매량 TOP 5 상품 선정' },
      { id: 'w4-2', text: 'TOP 5 기준: 2주 내 3건 이상 / ROAS 300% 이상 / 리뷰 3개 이상' },
      { id: 'w4-3', text: 'TOP 5 광고 예산 2배 확대' },
      { id: 'w4-4', text: 'TOP 5 상세페이지 전면 리뉴얼' },
      { id: 'w4-5', text: 'TOP 5 쿠팡에도 등록' },
      { id: 'w4-6', text: '사입 시 마진 30% 이상 상품 파악' },
      { id: 'w4-7', text: '소량 테스트 사입 결정 (10~20개)' },
    ],
  },
  5: {
    title: '사입 실행',
    goal: '사입 시작, 마진 개선',
    revenueTarget: '400만원',
    tasks: [
      { id: 'w5-1', text: 'TOP 3 상품 사입 발주 (예산 100만원)' },
      { id: 'w5-2', text: '사입 상품 스마트스토어 재등록 (직접 배송 강조)' },
      { id: 'w5-3', text: '사입 상품 쿠팡 로켓그로스 등록 시도' },
      { id: 'w5-4', text: '스마트스토어 광고 일 예산 5만원으로 증액' },
      { id: 'w5-5', text: '쿠팡 광고 사입 상품 중심 일 3만원' },
      { id: 'w5-6', text: '스마트스토어 플러스 스토어 지원 조건 확인' },
      { id: 'w5-7', text: '리뷰 20개 이상 확보' },
    ],
  },
  6: {
    title: '사입 스케일',
    goal: '월 300만원 페이스',
    revenueTarget: '500만원',
    tasks: [
      { id: 'w6-1', text: '사입 상품 vs 위탁 마진 비교 분석' },
      { id: 'w6-2', text: '실패 사입 상품 즉시 가격 인하 or 재판매' },
      { id: 'w6-3', text: '위탁 중 꾸준한 상품 추가 사입 검토' },
      { id: 'w6-4', text: '번들 구성 (TOP 상품 + 관련 상품 세트)' },
      { id: 'w6-5', text: '번들로 객단가 20~30% 상승 목표' },
    ],
  },
  7: {
    title: '채널 다변화',
    goal: '월 500만원 달성',
    revenueTarget: '600만원',
    tasks: [
      { id: 'w7-1', text: '도매토피아 / 오너클랜 / 1688.com 탐색' },
      { id: 'w7-2', text: '코스트코 주말 2회 방문 → 추가 틈새 상품 발굴' },
      { id: 'w7-3', text: '계절 상품 / 특정 취미 상품 조사' },
      { id: 'w7-4', text: '위탁 상품 총 200개 이상 등록 유지' },
    ],
  },
  8: {
    title: '광고 최적화',
    goal: '월 500~600만원',
    revenueTarget: '700만원',
    tasks: [
      { id: 'w8-1', text: '광고 ROAS 300% 이상 확인 후 예산 확대' },
      { id: 'w8-2', text: '사입 상품 재고 회전 확인 (재발주 타이밍)' },
      { id: 'w8-3', text: '실패 상품 정리 → 예산 위너에 집중' },
    ],
  },
  9: {
    title: '공격적 확장',
    goal: '월 700만원',
    revenueTarget: '800만원',
    tasks: [
      { id: 'w9-1', text: '광고비 일 10만원으로 확대 (ROAS 300% 이상 확인 후)' },
      { id: 'w9-2', text: '카카오쇼핑 채널 등록' },
      { id: 'w9-3', text: '인스타그램 쇼핑 연동' },
      { id: 'w9-4', text: '11번가 / 위메프 추가 등록' },
      { id: 'w9-5', text: '검증 위너 추가 사입 (예산 50만원)' },
      { id: 'w9-6', text: '5~6월 시즌 상품 소싱' },
    ],
  },
  10: {
    title: '스케일업 중',
    goal: '월 800만원',
    revenueTarget: '900만원',
    tasks: [
      { id: 'w10-1', text: '일 매출 25만원 이상 안정적 발생 확인' },
      { id: 'w10-2', text: '리뷰 50개 이상 확보' },
      { id: 'w10-3', text: '스마트스토어 기획전 참여 신청' },
    ],
  },
  11: {
    title: '최종 스케일',
    goal: '월 900만원',
    revenueTarget: '950만원',
    tasks: [
      { id: 'w11-1', text: '광고 ROAS 기반 예산 최대 투입' },
      { id: 'w11-2', text: '쿠팡 로켓그로스 추가 상품 입고' },
      { id: 'w11-3', text: 'Smart Seller Studio 상품 등록 완전 자동화 완성' },
    ],
  },
  12: {
    title: '목표 달성',
    goal: '월 1,000만원',
    revenueTarget: '1,000만원',
    tasks: [
      { id: 'w12-1', text: '반품/교환 처리 프로세스 문서화' },
      { id: 'w12-2', text: '재고 회전 관리 시스템 구축' },
      { id: 'w12-3', text: '다음 달 소싱 계획 수립' },
      { id: 'w12-4', text: '월 매출 1,000만원 달성 확인' },
    ],
  },
};

/** 주차별 누적 매출 목표 (만원) — index 0 = Week 1 */
export const WEEKLY_TARGETS: readonly number[] =
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000];

/** 플랜 시작일 (KST 자정) */
export const PLAN_START = new Date('2026-04-22T00:00:00+09:00');
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/plan/constants.ts
git commit -m "feat(plan): WBS/주간목표/시작일 상수 모듈 추출"
```

---

### Task 2: 주차 계산 유틸리티

**Files:**
- Create: `src/lib/plan/week.ts`
- Test: `src/__tests__/lib/plan/week.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/plan/week.test.ts`:
```ts
/**
 * 플랜 주차 계산 유틸리티 단위 테스트
 * PLAN_START = 2026-04-22 (수요일, KST)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCurrentWeek, getWeekForDate, getDaysIntoWeek } from '@/lib/plan/week';

describe('getWeekForDate', () => {
  it('PLAN_START 당일은 Week 1을 반환한다', () => {
    expect(getWeekForDate('2026-04-22')).toBe(1);
  });

  it('PLAN_START + 6일은 Week 1을 반환한다', () => {
    expect(getWeekForDate('2026-04-28')).toBe(1);
  });

  it('PLAN_START + 7일은 Week 2를 반환한다', () => {
    expect(getWeekForDate('2026-04-29')).toBe(2);
  });

  it('PLAN_START 이전 날짜는 Week 1로 클램프한다', () => {
    expect(getWeekForDate('2026-04-01')).toBe(1);
  });

  it('Week 12 이후는 Week 12로 클램프한다', () => {
    // PLAN_START + 100일 ≈ Week 15
    expect(getWeekForDate('2026-07-31')).toBe(12);
  });
});

describe('getCurrentWeek', () => {
  afterEach(() => vi.useRealTimers());

  it('현재 시점 기준 주차를 반환한다 (PLAN_START + 4일 → Week 1)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T10:00:00+09:00'));
    expect(getCurrentWeek()).toBe(1);
  });

  it('PLAN_START + 14일 → Week 3', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T10:00:00+09:00'));
    expect(getCurrentWeek()).toBe(3);
  });
});

describe('getDaysIntoWeek', () => {
  afterEach(() => vi.useRealTimers());

  it('PLAN_START 당일은 1을 반환한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T10:00:00+09:00'));
    expect(getDaysIntoWeek()).toBe(1);
  });

  it('PLAN_START + 4일은 5를 반환한다 (1-indexed)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T10:00:00+09:00'));
    expect(getDaysIntoWeek()).toBe(5);
  });

  it('주의 마지막 날(7일째)은 7을 반환한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-28T10:00:00+09:00'));
    expect(getDaysIntoWeek()).toBe(7);
  });

  it('새 주의 첫날은 다시 1로 돌아온다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T10:00:00+09:00'));
    expect(getDaysIntoWeek()).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test src/__tests__/lib/plan/week.test.ts -- --run`
Expected: FAIL — `Cannot find module '@/lib/plan/week'`

- [ ] **Step 3: 구현**

`src/lib/plan/week.ts`:
```ts
/**
 * 플랜 주차 계산 유틸리티.
 * PLAN_START 기준 7일 단위로 주차를 산출한다. 1~12 범위로 클램프.
 */
import { PLAN_START } from './constants';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function clampWeek(week: number): number {
  return Math.min(Math.max(week, 1), 12);
}

/** YYYY-MM-DD 형식의 날짜 문자열을 주차로 변환 (KST 기준). */
export function getWeekForDate(dateStr: string): number {
  const date = new Date(dateStr + 'T00:00:00+09:00');
  const diffDays = Math.floor((date.getTime() - PLAN_START.getTime()) / MS_PER_DAY);
  return clampWeek(Math.floor(diffDays / 7) + 1);
}

/** 현재 주차를 반환한다. */
export function getCurrentWeek(): number {
  const diffDays = Math.floor((Date.now() - PLAN_START.getTime()) / MS_PER_DAY);
  return clampWeek(Math.floor(diffDays / 7) + 1);
}

/** 현재 주차 내에서 며칠째인지 반환 (1-indexed, 1~7). */
export function getDaysIntoWeek(): number {
  const diffDays = Math.floor((Date.now() - PLAN_START.getTime()) / MS_PER_DAY);
  if (diffDays < 0) return 1;
  return (diffDays % 7) + 1;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test src/__tests__/lib/plan/week.test.ts -- --run`
Expected: PASS — 9 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan/week.ts src/__tests__/lib/plan/week.test.ts
git commit -m "feat(plan): 주차 계산 유틸리티 추출 + 단위 테스트"
```

---

### Task 3: 일별 기록 유틸리티

**Files:**
- Create: `src/lib/plan/daily-records.ts`
- Test: `src/__tests__/lib/plan/daily-records.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/plan/daily-records.test.ts`:
```ts
/**
 * 일별 기록 유틸리티 단위 테스트
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadDailyRecords,
  saveDailyRecords,
  sumWeekRevenue,
  computeCumulativeActual,
  type DailyRecord,
} from '@/lib/plan/daily-records';

beforeEach(() => {
  localStorage.clear();
});

describe('loadDailyRecords / saveDailyRecords', () => {
  it('빈 localStorage에서 빈 배열을 반환한다', () => {
    expect(loadDailyRecords()).toEqual([]);
  });

  it('저장 후 재호출 시 동일한 배열을 반환한다', () => {
    const records: DailyRecord[] = [
      { date: '2026-04-22', revenue: 5, adSpend: 1, newProducts: 10, winnerNote: '', blockerNote: '', week: 1 },
    ];
    saveDailyRecords(records);
    expect(loadDailyRecords()).toEqual(records);
  });

  it('JSON 파싱 실패 시 빈 배열을 반환한다', () => {
    localStorage.setItem('plan_daily_records', 'not-json{');
    expect(loadDailyRecords()).toEqual([]);
  });
});

describe('sumWeekRevenue', () => {
  it('해당 주차의 매출만 합산한다 (만원 단위 그대로)', () => {
    const records: DailyRecord[] = [
      { date: '2026-04-22', revenue: 5, adSpend: 0, newProducts: 0, winnerNote: '', blockerNote: '', week: 1 },
      { date: '2026-04-23', revenue: 7, adSpend: 0, newProducts: 0, winnerNote: '', blockerNote: '', week: 1 },
      { date: '2026-04-29', revenue: 10, adSpend: 0, newProducts: 0, winnerNote: '', blockerNote: '', week: 2 },
    ];
    expect(sumWeekRevenue(records, 1)).toBe(12);
    expect(sumWeekRevenue(records, 2)).toBe(10);
    expect(sumWeekRevenue(records, 3)).toBe(0);
  });
});

describe('computeCumulativeActual', () => {
  it('주차별 누적 매출 12주 배열을 반환한다 (미래 주는 null)', () => {
    const records: DailyRecord[] = [
      { date: '2026-04-22', revenue: 5,  adSpend: 0, newProducts: 0, winnerNote: '', blockerNote: '', week: 1 },
      { date: '2026-04-29', revenue: 10, adSpend: 0, newProducts: 0, winnerNote: '', blockerNote: '', week: 2 },
    ];
    // 현재 Week 2까지만 채워야 함
    const result = computeCumulativeActual(records, 2);
    expect(result).toEqual([5, 15, null, null, null, null, null, null, null, null, null, null]);
  });

  it('빈 records + currentWeek=1 → [0, null x 11]', () => {
    expect(computeCumulativeActual([], 1)).toEqual([
      0, null, null, null, null, null, null, null, null, null, null, null,
    ]);
  });

  it('currentWeek > 12는 12로 클램프', () => {
    const result = computeCumulativeActual([], 99);
    expect(result.length).toBe(12);
    expect(result.every((v) => v === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test src/__tests__/lib/plan/daily-records.test.ts -- --run`
Expected: FAIL — Cannot find module

- [ ] **Step 3: 구현**

`src/lib/plan/daily-records.ts`:
```ts
/**
 * 플랜의 일별 매출 기록 — localStorage 기반.
 * PlanClient에서 추출. 대시보드의 12주 차트가 누적 매출을 계산할 때 사용.
 */

export interface DailyRecord {
  date: string;       // YYYY-MM-DD
  revenue: number;    // 만원
  adSpend: number;    // 만원
  newProducts: number;
  winnerNote: string;
  blockerNote: string;
  week: number;       // 1..12
}

const STORAGE_KEY = 'plan_daily_records';

export function loadDailyRecords(): DailyRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DailyRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveDailyRecords(records: DailyRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

/** 특정 주차의 매출 합계 (만원) */
export function sumWeekRevenue(records: DailyRecord[], week: number): number {
  return records
    .filter((r) => r.week === week)
    .reduce((sum, r) => sum + (r.revenue || 0), 0);
}

/**
 * 12주 누적 매출 배열을 반환한다 (만원).
 * - currentWeek 이하는 누적값, 초과는 null
 * - currentWeek > 12 인 경우 12로 클램프
 */
export function computeCumulativeActual(
  records: DailyRecord[],
  currentWeek: number,
): (number | null)[] {
  const clampedCurrent = Math.min(Math.max(currentWeek, 1), 12);
  const result: (number | null)[] = new Array(12).fill(null);
  let cumulative = 0;
  for (let week = 1; week <= clampedCurrent; week++) {
    cumulative += sumWeekRevenue(records, week);
    result[week - 1] = cumulative;
  }
  return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test src/__tests__/lib/plan/daily-records.test.ts -- --run`
Expected: PASS — 7 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan/daily-records.ts src/__tests__/lib/plan/daily-records.test.ts
git commit -m "feat(plan): 일별 기록 + 주차별 누적 매출 유틸리티"
```

---

### Task 4: PlanClient 리팩터링 (동작 변경 X)

**Files:**
- Modify: `src/components/plan/PlanClient.tsx`

- [ ] **Step 1: 기존 PlanClient 확인**

Run: `grep -nE "WBS_DATA|WEEKLY_TARGETS|PLAN_START|getCurrentWeek|getWeekForDate|loadDailyRecords|saveDailyRecords|interface DailyRecord|interface WbsTask|interface WeekData" src/components/plan/PlanClient.tsx`

Expected: 정의/사용 위치들이 표시됨 (라인 번호 포함)

- [ ] **Step 2: PlanClient.tsx 상단에 import 추가하고 중복 정의 제거**

다음 변경을 적용:

1. 파일 상단 import 영역에 추가:
```ts
import {
  WBS_DATA,
  WEEKLY_TARGETS,
  PLAN_START,
  type WbsTask,
  type WeekData,
} from '@/lib/plan/constants';
import {
  getCurrentWeek,
  getWeekForDate,
} from '@/lib/plan/week';
import {
  loadDailyRecords,
  saveDailyRecords,
  type DailyRecord,
} from '@/lib/plan/daily-records';
```

2. 기존 중복 정의 제거:
   - `interface WbsTask { ... }` 블록
   - `interface WeekData { ... }` 블록
   - `interface DailyRecord { ... }` 블록
   - `const WBS_DATA: Record<number, WeekData> = { ... }` 블록 (1~12주 전체)
   - `const WEEKLY_TARGETS = [...]`
   - `const PLAN_START = new Date(...)`
   - `function getCurrentWeek(): number { ... }`
   - `function getWeekForDate(dateStr: string): number { ... }`
   - `function loadDailyRecords(): DailyRecord[] { ... }`
   - `function saveDailyRecords(records: DailyRecord[]): void { ... }`

> **주의**: `loadTaskChecks`, `saveTaskChecks`, `getTodayStr` 등 다른 헬퍼는 PlanClient에만 쓰이므로 유지.

- [ ] **Step 3: 빌드 통과 확인**

Run: `pnpm build` (또는 `pnpm tsc --noEmit`)
Expected: 컴파일 에러 없음. 미사용 import 경고 없음.

- [ ] **Step 4: PlanClient 동작 검증 (수동)**

Run: `pnpm dev` 후 브라우저에서 `/plan` 진입.
- "오늘 할 일" 탭 정상 렌더링
- 주차 표시(예: Week 1)와 매출 목표 정상
- 일별 기록 입력/저장 정상

검증 후 dev server 종료.

- [ ] **Step 5: Commit**

```bash
git add src/components/plan/PlanClient.tsx
git commit -m "refactor(plan): 공유 유틸리티 사용으로 PlanClient 정리"
```

---

## Phase 2: 대시보드 API 재작성

### Task 5: 대시보드 타입 정의

**Files:**
- Create: `src/lib/dashboard/types.ts`

- [ ] **Step 1: 타입 모듈 작성**

`src/lib/dashboard/types.ts`:
```ts
/**
 * 대시보드 API/컴포넌트가 공유하는 타입 정의.
 * 스펙: docs/superpowers/specs/2026-04-26-dashboard-redesign-design.md
 */

export type Period = 'today' | '7d' | '30d' | 'month';

export interface StageMetric {
  count: number;
  amount: number;
}

export type SettlementStageMetric = StageMetric & {
  /** 정산 API 호출 성공 여부. false면 UI에서 "API 미연동" 표시 */
  available: boolean;
};

export interface ChannelPipeline {
  주문: StageMetric;
  배송중: StageMetric;
  배송완료: StageMetric;
  구매확정: StageMetric;
  정산완료: SettlementStageMetric;
  /** ISO timestamp — 마지막으로 데이터를 갱신한 시각 */
  lastUpdated: string;
}

export interface DashboardSummaryData {
  products: {
    coupang: number;
    naver: number;
  };
  pipeline: {
    coupang: ChannelPipeline;
    naver: ChannelPipeline;
  };
  revenue12w: {
    weeks: number[];                  // [1..12]
    target: number[];                 // 누적 목표 (만원)
    actual: (number | null)[];        // 서버는 null[] 반환, 클라이언트가 채움
  };
}

export interface DashboardSummaryResponse {
  success: true;
  data: DashboardSummaryData;
}

export interface DashboardErrorResponse {
  success: false;
  error: string;
}

export const PERIOD_LABELS: Record<Period, string> = {
  today: '오늘',
  '7d': '7일',
  '30d': '30일',
  month: '이번달',
};

export function isPeriod(value: unknown): value is Period {
  return value === 'today' || value === '7d' || value === '30d' || value === 'month';
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/dashboard/types.ts
git commit -m "feat(dashboard): API/컴포넌트 공유 타입 정의"
```

---

### Task 6: 파이프라인 집계 로직

**Files:**
- Create: `src/lib/dashboard/pipeline-aggregator.ts`
- Test: `src/__tests__/lib/dashboard/pipeline-aggregator.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/dashboard/pipeline-aggregator.test.ts`:
```ts
/**
 * 파이프라인 집계 단위 테스트
 * 쿠팡/네이버 status를 5단계 파이프라인으로 매핑.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateCoupangPipeline,
  aggregateNaverPipeline,
  type CoupangOrderRow,
  type NaverOrderRow,
} from '@/lib/dashboard/pipeline-aggregator';

const cp = (status: string, amount: number): CoupangOrderRow => ({
  orderId: 1, status, totalAmount: amount,
});

const np = (status: string, amount: number): NaverOrderRow => ({
  productOrderId: '1', productOrderStatus: status, totalPaymentAmount: amount,
});

describe('aggregateCoupangPipeline', () => {
  it('각 status를 5단계 파이프라인에 매핑한다', () => {
    const result = aggregateCoupangPipeline([
      cp('ACCEPT',         10000),
      cp('INSTRUCT',       20000),
      cp('DEPARTURE',      30000),
      cp('DELIVERING',     40000),
      cp('FINAL_DELIVERY', 50000),
    ]);
    expect(result.주문).toEqual({ count: 1, amount: 10000 });
    expect(result.배송중).toEqual({ count: 3, amount: 90000 });
    expect(result.배송완료).toEqual({ count: 1, amount: 50000 });
    expect(result.구매확정).toEqual({ count: 0, amount: 0 });
  });

  it('CANCEL_DONE은 어느 단계에도 포함하지 않는다', () => {
    const result = aggregateCoupangPipeline([
      cp('ACCEPT',      10000),
      cp('CANCEL_DONE', 99999),
    ]);
    expect(result.주문.count).toBe(1);
    expect(result.배송중.count).toBe(0);
  });

  it('빈 입력은 모든 단계 0으로 반환한다', () => {
    const result = aggregateCoupangPipeline([]);
    expect(result.주문.count).toBe(0);
    expect(result.배송중.amount).toBe(0);
  });

  it('정산완료는 항상 available: false로 초기화 (Phase 5에서 채움)', () => {
    const result = aggregateCoupangPipeline([cp('ACCEPT', 100)]);
    expect(result.정산완료).toEqual({ count: 0, amount: 0, available: false });
  });

  it('lastUpdated는 ISO 문자열을 반환한다', () => {
    const result = aggregateCoupangPipeline([]);
    expect(result.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('aggregateNaverPipeline', () => {
  it('PAYED는 주문, DELIVERING은 배송중, DELIVERED는 배송완료, PURCHASE_DECIDED는 구매확정', () => {
    const result = aggregateNaverPipeline([
      np('PAYED',            5000),
      np('DELIVERING',       6000),
      np('DELIVERED',        7000),
      np('PURCHASE_DECIDED', 8000),
    ]);
    expect(result.주문).toEqual({ count: 1, amount: 5000 });
    expect(result.배송중).toEqual({ count: 1, amount: 6000 });
    expect(result.배송완료).toEqual({ count: 1, amount: 7000 });
    expect(result.구매확정).toEqual({ count: 1, amount: 8000 });
  });

  it('DISPATCHED도 배송중에 합산한다', () => {
    const result = aggregateNaverPipeline([
      np('DISPATCHED', 3000),
      np('DELIVERING', 4000),
    ]);
    expect(result.배송중).toEqual({ count: 2, amount: 7000 });
  });

  it('CANCELED/RETURNED는 모든 단계에서 제외', () => {
    const result = aggregateNaverPipeline([
      np('PAYED',    1000),
      np('CANCELED', 2000),
      np('RETURNED', 3000),
    ]);
    expect(result.주문.count).toBe(1);
    const totalCount = result.주문.count + result.배송중.count + result.배송완료.count + result.구매확정.count;
    expect(totalCount).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test src/__tests__/lib/dashboard/pipeline-aggregator.test.ts -- --run`
Expected: FAIL — Cannot find module

- [ ] **Step 3: 구현**

`src/lib/dashboard/pipeline-aggregator.ts`:
```ts
/**
 * 채널별 주문 데이터를 5단계 파이프라인(주문→배송중→배송완료→구매확정→정산완료)으로 집계.
 * 정산완료는 별도 모듈(settlement-clients)에서 채워 넣음.
 */
import type { ChannelPipeline, StageMetric } from './types';

export interface CoupangOrderRow {
  orderId: number;
  status: string;          // ACCEPT | INSTRUCT | DEPARTURE | DELIVERING | FINAL_DELIVERY | CANCEL_DONE | ...
  totalAmount: number;     // 원
}

export interface NaverOrderRow {
  productOrderId: string;
  productOrderStatus: string;  // PAYED | DISPATCHED | DELIVERING | DELIVERED | PURCHASE_DECIDED | CANCELED | RETURNED
  totalPaymentAmount: number;  // 원
}

const COUPANG_DELIVERING = new Set(['INSTRUCT', 'DEPARTURE', 'DELIVERING']);
const NAVER_DELIVERING = new Set(['DISPATCHED', 'DELIVERING']);

function emptyStage(): StageMetric {
  return { count: 0, amount: 0 };
}

function add(stage: StageMetric, amount: number): void {
  stage.count += 1;
  stage.amount += amount;
}

export function aggregateCoupangPipeline(orders: CoupangOrderRow[]): ChannelPipeline {
  const 주문 = emptyStage();
  const 배송중 = emptyStage();
  const 배송완료 = emptyStage();
  const 구매확정 = emptyStage();

  for (const o of orders) {
    if (o.status === 'ACCEPT') add(주문, o.totalAmount);
    else if (COUPANG_DELIVERING.has(o.status)) add(배송중, o.totalAmount);
    else if (o.status === 'FINAL_DELIVERY') add(배송완료, o.totalAmount);
    // 쿠팡 구매확정은 별도 API 필요 — 현 단계에서는 0 유지
    // CANCEL_DONE/CANCEL_REQUEST/RETURN_* 는 모두 제외
  }

  return {
    주문, 배송중, 배송완료, 구매확정,
    정산완료: { count: 0, amount: 0, available: false },
    lastUpdated: new Date().toISOString(),
  };
}

export function aggregateNaverPipeline(orders: NaverOrderRow[]): ChannelPipeline {
  const 주문 = emptyStage();
  const 배송중 = emptyStage();
  const 배송완료 = emptyStage();
  const 구매확정 = emptyStage();

  for (const o of orders) {
    const s = o.productOrderStatus;
    if (s === 'PAYED') add(주문, o.totalPaymentAmount);
    else if (NAVER_DELIVERING.has(s)) add(배송중, o.totalPaymentAmount);
    else if (s === 'DELIVERED') add(배송완료, o.totalPaymentAmount);
    else if (s === 'PURCHASE_DECIDED') add(구매확정, o.totalPaymentAmount);
    // CANCELED/RETURNED/EXCHANGED 제외
  }

  return {
    주문, 배송중, 배송완료, 구매확정,
    정산완료: { count: 0, amount: 0, available: false },
    lastUpdated: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test src/__tests__/lib/dashboard/pipeline-aggregator.test.ts -- --run`
Expected: PASS — 8 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/pipeline-aggregator.ts src/__tests__/lib/dashboard/pipeline-aggregator.test.ts
git commit -m "feat(dashboard): 쿠팡/네이버 주문 → 5단계 파이프라인 집계"
```

---

### Task 7: 정산 클라이언트 스텁

**Files:**
- Create: `src/lib/dashboard/settlement-clients.ts`

- [ ] **Step 1: 스텁 모듈 작성**

> **주의**: Phase 5/6에서 실제 API 연동으로 교체. 현 단계에서는 `available: false` 반환.

`src/lib/dashboard/settlement-clients.ts`:
```ts
/**
 * 채널별 정산 데이터 클라이언트.
 * Phase 5: 쿠팡 Wing revenue-history 연동
 * Phase 6: 네이버 커머스 settlements 연동
 *
 * 현재(Phase 1~4)는 스텁 — 항상 available: false 반환.
 */
import type { SettlementStageMetric, Period } from './types';

export interface SettlementParams {
  period: Period;
}

export async function fetchCoupangSettlement(_params: SettlementParams): Promise<SettlementStageMetric> {
  return { count: 0, amount: 0, available: false };
}

export async function fetchNaverSettlement(_params: SettlementParams): Promise<SettlementStageMetric> {
  return { count: 0, amount: 0, available: false };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/dashboard/settlement-clients.ts
git commit -m "feat(dashboard): 정산 클라이언트 스텁 (Phase 5/6에서 실제 연동)"
```

---

### Task 8: 등록 상품 수 집계 헬퍼

**Files:**
- Create: `src/lib/dashboard/product-count.ts`

- [ ] **Step 1: 헬퍼 모듈 작성**

`src/lib/dashboard/product-count.ts`:
```ts
/**
 * 등록 상품 수 집계.
 * - 쿠팡: coupang_registered_products 테이블 (deleted_at IS NULL)
 * - 네이버: naver-commerce-client.searchProducts 첫 페이지의 totalElements
 */
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';

export async function countCoupangProducts(userId: string): Promise<number> {
  const supabase = getSupabaseServerClient();
  const { count, error } = await supabase
    .from('coupang_registered_products')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (error) {
    console.warn('[dashboard] 쿠팡 상품 수 조회 실패:', error.message);
    return 0;
  }
  return count ?? 0;
}

export async function countNaverProducts(): Promise<number> {
  try {
    const client = getNaverCommerceClient();
    const result = await client.searchProducts(1, 1);
    // searchProducts 응답 형태: { contents: [], totalElements: number, ... }
    const total = (result as { totalElements?: number }).totalElements;
    return typeof total === 'number' ? total : 0;
  } catch (err) {
    console.warn('[dashboard] 네이버 상품 수 조회 실패:', err instanceof Error ? err.message : err);
    return 0;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/dashboard/product-count.ts
git commit -m "feat(dashboard): 쿠팡/네이버 등록 상품 수 집계 헬퍼"
```

---

### Task 9: 신규 `/api/dashboard/summary` 작성 + 통합 테스트

**Files:**
- Modify: `src/app/api/dashboard/summary/route.ts` (전면 재작성)
- Test: `src/__tests__/api/dashboard-summary.test.ts`

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`src/__tests__/api/dashboard-summary.test.ts`:
```ts
/**
 * GET /api/dashboard/summary 통합 테스트
 * 외부 API/Supabase는 모두 mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/dashboard/product-count', () => ({
  countCoupangProducts: vi.fn(),
  countNaverProducts: vi.fn(),
}));
vi.mock('@/lib/listing/coupang-client', () => ({
  getCoupangClient: vi.fn(),
}));
vi.mock('@/lib/listing/naver-commerce-client', () => ({
  getNaverCommerceClient: vi.fn(),
}));
vi.mock('@/lib/dashboard/settlement-clients', () => ({
  fetchCoupangSettlement: vi.fn(),
  fetchNaverSettlement: vi.fn(),
}));

import { requireAuth } from '@/lib/supabase/auth';
import { countCoupangProducts, countNaverProducts } from '@/lib/dashboard/product-count';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import { fetchCoupangSettlement, fetchNaverSettlement } from '@/lib/dashboard/settlement-clients';

const mockAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockCountCoupang = countCoupangProducts as ReturnType<typeof vi.fn>;
const mockCountNaver = countNaverProducts as ReturnType<typeof vi.fn>;
const mockCoupangClient = getCoupangClient as ReturnType<typeof vi.fn>;
const mockNaverClient = getNaverCommerceClient as ReturnType<typeof vi.fn>;
const mockSettleCoupang = fetchCoupangSettlement as ReturnType<typeof vi.fn>;
const mockSettleNaver = fetchNaverSettlement as ReturnType<typeof vi.fn>;

const { GET } = await import('@/app/api/dashboard/summary/route');

function makeRequest(period?: string): NextRequest {
  const url = period
    ? `http://localhost/api/dashboard/summary?period=${period}`
    : 'http://localhost/api/dashboard/summary';
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/dashboard/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: 'test-user' });
    mockCountCoupang.mockResolvedValue(312);
    mockCountNaver.mockResolvedValue(198);
    mockSettleCoupang.mockResolvedValue({ count: 0, amount: 0, available: false });
    mockSettleNaver.mockResolvedValue({ count: 0, amount: 0, available: false });
    mockCoupangClient.mockReturnValue({
      getOrders: vi.fn().mockResolvedValue({
        items: [{ orderId: 1, status: 'ACCEPT', totalPrice: 10000 }],
        nextToken: null,
      }),
    });
    mockNaverClient.mockReturnValue({
      getOrders: vi.fn().mockResolvedValue({
        contents: [{ productOrderId: 'p1', productOrderStatus: 'PAYED', totalPaymentAmount: 5000 }],
      }),
    });
  });

  it('인증 실패 시 401을 반환한다', async () => {
    mockAuth.mockResolvedValue(new Response(null, { status: 401 }));
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('잘못된 period는 400을 반환한다', async () => {
    const res = await GET(makeRequest('forever'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('기본 period=today로 응답 셰이프를 충족한다', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.products).toEqual({ coupang: 312, naver: 198 });
    expect(body.data.pipeline.coupang.주문.count).toBeGreaterThanOrEqual(0);
    expect(body.data.pipeline.naver.주문.count).toBeGreaterThanOrEqual(0);
    expect(body.data.revenue12w.weeks).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);
    expect(body.data.revenue12w.target).toEqual([50,100,200,300,400,500,600,700,800,900,950,1000]);
    expect(body.data.revenue12w.actual).toEqual(new Array(12).fill(null));
  });

  it('정산 실패 시 정산완료만 available:false로 떨어지고 다른 stage는 정상', async () => {
    mockSettleCoupang.mockRejectedValue(new Error('credentials missing'));
    const res = await GET(makeRequest('30d'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.pipeline.coupang.정산완료.available).toBe(false);
    expect(body.data.pipeline.coupang.주문).toBeDefined();
  });

  it('한 채널 주문 API 실패해도 다른 채널은 정상', async () => {
    mockCoupangClient.mockReturnValue({
      getOrders: vi.fn().mockRejectedValue(new Error('Coupang API down')),
    });
    const res = await GET(makeRequest('today'));
    expect(res.status).toBe(200);
    const body = await res.json();
    // 쿠팡 stage는 0
    expect(body.data.pipeline.coupang.주문.count).toBe(0);
    // 네이버 stage는 정상
    expect(body.data.pipeline.naver.주문.count).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test src/__tests__/api/dashboard-summary.test.ts -- --run`
Expected: FAIL — 기존 route는 새 응답 셰이프를 만족하지 않음

- [ ] **Step 3: 신규 route 구현 (전면 재작성)**

`src/app/api/dashboard/summary/route.ts` (기존 파일 전체 교체):
```ts
/**
 * GET /api/dashboard/summary?period=today|7d|30d|month
 *
 * 운영 대시보드용 요약 — 채널별 주문 파이프라인 + 등록 상품 수 + 12주 매출 추세 (target만).
 * 12주 actual은 클라이언트에서 plan localStorage 기반으로 채움.
 *
 * 스펙: docs/superpowers/specs/2026-04-26-dashboard-redesign-design.md
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { isPeriod, type Period, type DashboardSummaryData, type ChannelPipeline } from '@/lib/dashboard/types';
import { WEEKLY_TARGETS } from '@/lib/plan/constants';
import { countCoupangProducts, countNaverProducts } from '@/lib/dashboard/product-count';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import {
  aggregateCoupangPipeline,
  aggregateNaverPipeline,
  type CoupangOrderRow,
  type NaverOrderRow,
} from '@/lib/dashboard/pipeline-aggregator';
import { fetchCoupangSettlement, fetchNaverSettlement } from '@/lib/dashboard/settlement-clients';

export const dynamic = 'force-dynamic';

// ─── 캐시 (period별 30초 TTL) ────────────────────────────────────
const CACHE_TTL_MS = 30_000;
const cache = new Map<Period, { data: DashboardSummaryData; expiresAt: number }>();

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** period → from/to 날짜 범위 (YYYY-MM-DD, KST 기준) */
function periodRange(period: Period): { from: string; to: string } {
  const today = new Date();
  const to = toDateStr(today);
  let from = to;

  if (period === 'today') {
    from = to;
  } else if (period === '7d') {
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    from = toDateStr(d);
  } else if (period === '30d') {
    const d = new Date(today);
    d.setDate(d.getDate() - 29);
    from = toDateStr(d);
  } else if (period === 'month') {
    const d = new Date(today.getFullYear(), today.getMonth(), 1);
    from = toDateStr(d);
  }

  return { from, to };
}

const COUPANG_PIPELINE_STATUSES = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY'];

/** 쿠팡 주문 — 모든 파이프라인 status를 병렬 조회해서 합침 */
async function fetchCoupangOrders(from: string, to: string): Promise<CoupangOrderRow[]> {
  try {
    const client = getCoupangClient();
    const results = await Promise.allSettled(
      COUPANG_PIPELINE_STATUSES.map((s) =>
        client.getOrders({ createdAtFrom: from, createdAtTo: to, status: s, maxPerPage: 50 })
      )
    );
    const items: CoupangOrderRow[] = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const o of r.value.items as Array<Record<string, unknown>>) {
        items.push({
          orderId: Number(o.orderId ?? 0),
          status: String(o.status ?? ''),
          totalAmount: Number((o as { totalPrice?: number }).totalPrice ?? 0),
        });
      }
    }
    return items;
  } catch (err) {
    console.warn('[dashboard] 쿠팡 주문 조회 실패:', err instanceof Error ? err.message : err);
    return [];
  }
}

async function fetchNaverOrders(from: string, to: string): Promise<NaverOrderRow[]> {
  try {
    const client = getNaverCommerceClient();
    const result = await client.getOrders({ fromDate: from, toDate: to });
    return (result.contents ?? []).map((o) => ({
      productOrderId: o.productOrderId,
      productOrderStatus: o.productOrderStatus,
      totalPaymentAmount: o.totalPaymentAmount,
    }));
  } catch (err) {
    console.warn('[dashboard] 네이버 주문 조회 실패:', err instanceof Error ? err.message : err);
    return [];
  }
}

async function buildSummary(period: Period, userId: string): Promise<DashboardSummaryData> {
  const { from, to } = periodRange(period);

  const [
    coupangCount,
    naverCount,
    coupangOrders,
    naverOrders,
    coupangSettle,
    naverSettle,
  ] = await Promise.all([
    countCoupangProducts(userId).catch(() => 0),
    countNaverProducts().catch(() => 0),
    fetchCoupangOrders(from, to),
    fetchNaverOrders(from, to),
    fetchCoupangSettlement({ period }).catch(() => ({ count: 0, amount: 0, available: false })),
    fetchNaverSettlement({ period }).catch(() => ({ count: 0, amount: 0, available: false })),
  ]);

  const coupangPipeline: ChannelPipeline = aggregateCoupangPipeline(coupangOrders);
  coupangPipeline.정산완료 = coupangSettle;

  const naverPipeline: ChannelPipeline = aggregateNaverPipeline(naverOrders);
  naverPipeline.정산완료 = naverSettle;

  return {
    products: { coupang: coupangCount, naver: naverCount },
    pipeline: { coupang: coupangPipeline, naver: naverPipeline },
    revenue12w: {
      weeks: Array.from({ length: 12 }, (_, i) => i + 1),
      target: [...WEEKLY_TARGETS],
      actual: new Array(12).fill(null), // 클라이언트에서 채움
    },
  };
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const periodParam = request.nextUrl.searchParams.get('period') ?? 'today';
  if (!isPeriod(periodParam)) {
    return Response.json(
      { success: false, error: `유효하지 않은 period: ${periodParam}` },
      { status: 400 },
    );
  }
  const period: Period = periodParam;

  // 캐시 확인
  const cached = cache.get(period);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ success: true, data: cached.data });
  }

  try {
    const data = await buildSummary(period, userId);
    cache.set(period, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return Response.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error('[GET /api/dashboard/summary]', err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test src/__tests__/api/dashboard-summary.test.ts -- --run`
Expected: PASS — 5 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/app/api/dashboard/summary/route.ts src/__tests__/api/dashboard-summary.test.ts
git commit -m "feat(dashboard): /api/dashboard/summary 신규 응답 셰이프 + 통합 테스트"
```

---

## Phase 3: 신규 컴포넌트

### Task 10: PeriodToggle 컴포넌트

**Files:**
- Create: `src/components/dashboard/PeriodToggle.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`src/components/dashboard/PeriodToggle.tsx`:
```tsx
'use client';

import React from 'react';
import { C } from '@/lib/design-tokens';
import { type Period, PERIOD_LABELS } from '@/lib/dashboard/types';

const ORDER: Period[] = ['today', '7d', '30d', 'month'];

interface PeriodToggleProps {
  value: Period;
  onChange: (period: Period) => void;
}

export default function PeriodToggle({ value, onChange }: PeriodToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="기간 선택"
      style={{
        display: 'inline-flex',
        gap: 0,
        padding: 3,
        borderRadius: 8,
        backgroundColor: '#f0f0f0',
      }}
    >
      {ORDER.map((p) => {
        const active = p === value;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: active ? C.card : 'transparent',
              color: active ? C.text : '#71717a',
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              transition: 'background-color 0.15s',
            }}
          >
            {PERIOD_LABELS[p]}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/PeriodToggle.tsx
git commit -m "feat(dashboard): PeriodToggle 컴포넌트"
```

---

### Task 11: ProductCountWidget 컴포넌트

**Files:**
- Create: `src/components/dashboard/ProductCountWidget.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`src/components/dashboard/ProductCountWidget.tsx`:
```tsx
'use client';

import React from 'react';
import { Package } from 'lucide-react';
import { C } from '@/lib/design-tokens';

interface ProductCountWidgetProps {
  coupang: number;
  naver: number;
}

export default function ProductCountWidget({ coupang, naver }: ProductCountWidgetProps) {
  const total = coupang + naver;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 18px',
        borderRadius: 12,
        border: `1px solid ${C.border}`,
        backgroundColor: C.card,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: 8,
          backgroundColor: '#f5f5f5',
          color: '#71717a',
          flexShrink: 0,
        }}
      >
        <Package size={16} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>등록 상품</div>
      <div
        aria-label="채널별 등록 상품 수"
        style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}
      >
        <ChannelDot color={C.accent} label="쿠팡" value={coupang} />
        <Divider />
        <ChannelDot color="#16a34a" label="네이버" value={naver} />
        <Divider />
        <span style={{ fontSize: 13, color: '#71717a' }}>
          총 <strong style={{ color: C.text }}>{total.toLocaleString()}</strong>
        </span>
      </div>
    </div>
  );
}

function ChannelDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <span
        aria-hidden
        style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, display: 'inline-block' }}
      />
      <span style={{ color: '#71717a' }}>{label}</span>
      <strong style={{ color: C.text }}>{value.toLocaleString()}</strong>
    </span>
  );
}

function Divider() {
  return <span aria-hidden style={{ width: 1, height: 14, backgroundColor: C.border }} />;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/ProductCountWidget.tsx
git commit -m "feat(dashboard): ProductCountWidget 컴포넌트"
```

---

### Task 12: PlanProgressCard 컴포넌트 + 테스트

**Files:**
- Create: `src/components/dashboard/PlanProgressCard.tsx`
- Test: `src/__tests__/components/dashboard/plan-progress-card.test.tsx`

- [ ] **Step 1: 실패하는 컴포넌트 테스트 작성**

`src/__tests__/components/dashboard/plan-progress-card.test.tsx`:
```tsx
/**
 * PlanProgressCard 컴포넌트 테스트
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanProgressCard from '@/components/dashboard/PlanProgressCard';

describe('PlanProgressCard', () => {
  it('주차/주간목표/실제/진행률을 표시한다', () => {
    render(
      <PlanProgressCard
        weekNumber={1}
        weekTitle="기반 세팅"
        weekTargetMan={50}
        weekActualMan={12}
        daysIntoWeek={5}
        keyMission="도매꾹 위 키워드 매칭 100개 선별"
      />
    );
    expect(screen.getByText(/Week 1/)).toBeInTheDocument();
    expect(screen.getByText('기반 세팅')).toBeInTheDocument();
    expect(screen.getByText(/50만원/)).toBeInTheDocument();
    expect(screen.getByText(/12만원/)).toBeInTheDocument();
    expect(screen.getByText(/24%/)).toBeInTheDocument();
    expect(screen.getByText('도매꾹 위 키워드 매칭 100개 선별')).toBeInTheDocument();
    expect(screen.getByText(/D\+5\/7/)).toBeInTheDocument();
  });

  it('keyMission이 null이면 "이번주 미션 완료" 메시지 표시', () => {
    render(
      <PlanProgressCard
        weekNumber={1}
        weekTitle="기반 세팅"
        weekTargetMan={50}
        weekActualMan={50}
        daysIntoWeek={7}
        keyMission={null}
      />
    );
    expect(screen.getByText(/이번주 미션 완료/)).toBeInTheDocument();
  });

  it('weekTargetMan=0인 경우 진행률을 0%로 표시한다', () => {
    render(
      <PlanProgressCard
        weekNumber={1}
        weekTitle="기반 세팅"
        weekTargetMan={0}
        weekActualMan={0}
        daysIntoWeek={1}
        keyMission="첫 미션"
      />
    );
    expect(screen.getByText(/0%/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test src/__tests__/components/dashboard/plan-progress-card.test.tsx -- --run`
Expected: FAIL — Cannot find module

- [ ] **Step 3: 컴포넌트 구현**

`src/components/dashboard/PlanProgressCard.tsx`:
```tsx
'use client';

import React from 'react';
import { C } from '@/lib/design-tokens';

export interface PlanProgressCardProps {
  weekNumber: number;
  weekTitle: string;
  weekTargetMan: number;   // 만원
  weekActualMan: number;   // 만원
  daysIntoWeek: number;    // 1..7
  keyMission: string | null;
}

export default function PlanProgressCard({
  weekNumber,
  weekTitle,
  weekTargetMan,
  weekActualMan,
  daysIntoWeek,
  keyMission,
}: PlanProgressCardProps) {
  const progressPct =
    weekTargetMan > 0 ? Math.min(Math.round((weekActualMan / weekTargetMan) * 100), 999) : 0;

  return (
    <section
      aria-label="플랜 진행 카드"
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: '20px 24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 100,
              backgroundColor: 'rgba(190,0,20,0.08)',
              color: C.accent,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            Week {weekNumber}
          </span>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>
            {weekTitle}
          </h2>
        </div>
        <span style={{ fontSize: 11, color: '#a1a1aa', fontWeight: 500 }}>
          D+{daysIntoWeek}/7
        </span>
      </div>

      {/* 매출 진행 */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 6,
            fontSize: 12,
          }}
        >
          <span style={{ color: '#71717a' }}>
            매출 목표 <strong style={{ color: C.text }}>{weekTargetMan}만원</strong>
          </span>
          <span style={{ color: progressPct >= 100 ? '#16a34a' : C.accent, fontWeight: 600 }}>
            {progressPct}%
          </span>
        </div>
        <div
          style={{
            height: 10,
            borderRadius: 5,
            backgroundColor: '#f0f0f0',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.min(progressPct, 100)}%`,
              backgroundColor: progressPct >= 100 ? '#16a34a' : C.accent,
              transition: 'width 0.5s ease',
            }}
          />
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: '#a1a1aa' }}>
          현재 {weekActualMan}만원 / {weekTargetMan}만원
        </div>
      </div>

      {/* 핵심 미션 */}
      <div
        style={{
          padding: '12px 14px',
          borderRadius: 10,
          backgroundColor: '#fafafa',
          border: `1px solid ${C.border}`,
        }}
      >
        {keyMission ? (
          <>
            <div style={{ fontSize: 11, color: '#71717a', marginBottom: 4, fontWeight: 600 }}>
              🎯 이번주 핵심 미션
            </div>
            <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{keyMission}</div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>
            🎉 이번주 미션 완료
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test src/__tests__/components/dashboard/plan-progress-card.test.tsx -- --run`
Expected: PASS — 3 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/PlanProgressCard.tsx src/__tests__/components/dashboard/plan-progress-card.test.tsx
git commit -m "feat(dashboard): PlanProgressCard 컴포넌트 + 테스트"
```

---

### Task 13: PipelineStageCard 컴포넌트

**Files:**
- Create: `src/components/dashboard/PipelineStageCard.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`src/components/dashboard/PipelineStageCard.tsx`:
```tsx
'use client';

import React from 'react';
import { C } from '@/lib/design-tokens';

interface PipelineStageCardProps {
  label: string;
  count: number;
  amount: number;
  /** 정산완료 stage에서만 사용. false면 "API 미연동" 배지 표시 */
  available?: boolean;
  /** stage 강조색 (좌→우 그라데이션) */
  color: string;
}

export default function PipelineStageCard({
  label, count, amount, available = true, color,
}: PipelineStageCardProps) {
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 92,
        padding: '12px 10px',
        borderRadius: 10,
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderTop: `3px solid ${color}`,
        textAlign: 'center',
        position: 'relative',
      }}
    >
      <div style={{ fontSize: 11, color: '#71717a', marginBottom: 4, fontWeight: 500 }}>
        {label}
      </div>
      {available ? (
        <>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text, lineHeight: 1.1 }}>
            {count.toLocaleString()}
          </div>
          <div style={{ fontSize: 10, color: '#a1a1aa', marginTop: 2 }}>
            {amount > 0 ? `${Math.round(amount / 10000).toLocaleString()}만원` : '—'}
          </div>
        </>
      ) : (
        <div
          style={{
            fontSize: 10,
            color: '#a1a1aa',
            padding: '8px 0',
            fontStyle: 'italic',
          }}
        >
          API 미연동
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/PipelineStageCard.tsx
git commit -m "feat(dashboard): PipelineStageCard 컴포넌트"
```

---

### Task 14: OrderPipeline 컴포넌트 + 테스트

**Files:**
- Create: `src/components/dashboard/OrderPipeline.tsx`
- Test: `src/__tests__/components/dashboard/order-pipeline.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/components/dashboard/order-pipeline.test.tsx`:
```tsx
/**
 * OrderPipeline 컴포넌트 테스트
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrderPipeline from '@/components/dashboard/OrderPipeline';
import type { ChannelPipeline } from '@/lib/dashboard/types';

const emptyChannel: ChannelPipeline = {
  주문:     { count: 0, amount: 0 },
  배송중:   { count: 0, amount: 0 },
  배송완료: { count: 0, amount: 0 },
  구매확정: { count: 0, amount: 0 },
  정산완료: { count: 0, amount: 0, available: false },
  lastUpdated: '2026-04-26T00:00:00.000Z',
};

const sampleCoupang: ChannelPipeline = {
  ...emptyChannel,
  주문:     { count: 12, amount: 120_000 },
  배송중:   { count: 8,  amount: 80_000 },
  배송완료: { count: 25, amount: 250_000 },
  구매확정: { count: 18, amount: 180_000 },
  정산완료: { count: 15, amount: 150_000, available: true },
};

describe('OrderPipeline', () => {
  it('두 채널의 5단계를 모두 렌더링한다', () => {
    render(
      <OrderPipeline
        coupang={sampleCoupang}
        naver={emptyChannel}
        period="7d"
        onPeriodChange={vi.fn()}
      />
    );
    // 채널 라벨
    expect(screen.getByText('쿠팡')).toBeInTheDocument();
    expect(screen.getByText('네이버')).toBeInTheDocument();
    // 5단계 라벨이 채널당 하나씩, 총 2번씩
    expect(screen.getAllByText('주문').length).toBe(2);
    expect(screen.getAllByText('배송중').length).toBe(2);
    expect(screen.getAllByText('배송완료').length).toBe(2);
    expect(screen.getAllByText('구매확정').length).toBe(2);
    expect(screen.getAllByText('정산완료').length).toBe(2);
  });

  it('정산 미연동(available=false) stage는 "API 미연동"으로 표시', () => {
    render(
      <OrderPipeline
        coupang={emptyChannel}
        naver={emptyChannel}
        period="today"
        onPeriodChange={vi.fn()}
      />
    );
    // 쿠팡/네이버 모두 정산 미연동 → 2개
    expect(screen.getAllByText('API 미연동').length).toBe(2);
  });

  it('PeriodToggle 클릭 시 onPeriodChange 호출', async () => {
    const onChange = vi.fn();
    render(
      <OrderPipeline
        coupang={emptyChannel}
        naver={emptyChannel}
        period="today"
        onPeriodChange={onChange}
      />
    );
    await userEvent.click(screen.getByRole('tab', { name: '30일' }));
    expect(onChange).toHaveBeenCalledWith('30d');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test src/__tests__/components/dashboard/order-pipeline.test.tsx -- --run`
Expected: FAIL — Cannot find module

- [ ] **Step 3: 컴포넌트 구현**

`src/components/dashboard/OrderPipeline.tsx`:
```tsx
'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { C } from '@/lib/design-tokens';
import PeriodToggle from './PeriodToggle';
import PipelineStageCard from './PipelineStageCard';
import type { ChannelPipeline, Period } from '@/lib/dashboard/types';

const STAGE_ORDER: Array<keyof Pick<ChannelPipeline, '주문' | '배송중' | '배송완료' | '구매확정' | '정산완료'>> =
  ['주문', '배송중', '배송완료', '구매확정', '정산완료'];

const STAGE_COLORS: Record<string, string> = {
  주문:     '#a1a1aa',
  배송중:   '#2563eb',
  배송완료: '#7c3aed',
  구매확정: '#16a34a',
  정산완료: '#be0014',
};

interface OrderPipelineProps {
  coupang: ChannelPipeline;
  naver: ChannelPipeline;
  period: Period;
  onPeriodChange: (p: Period) => void;
  /** true이면 해당 채널 행을 opacity 0.5로 흐리게 표시 (예: 등록 상품 0개) */
  coupangDimmed?: boolean;
  naverDimmed?: boolean;
}

export default function OrderPipeline({
  coupang, naver, period, onPeriodChange, coupangDimmed = false, naverDimmed = false,
}: OrderPipelineProps) {
  return (
    <section
      aria-label="주문 파이프라인"
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 20,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>
          주문 파이프라인
        </h2>
        <PeriodToggle value={period} onChange={onPeriodChange} />
      </header>

      <ChannelRow label="쿠팡" color={C.accent} pipeline={coupang} dimmed={coupangDimmed} />
      <div style={{ height: 12 }} />
      <ChannelRow label="네이버" color="#16a34a" pipeline={naver} dimmed={naverDimmed} />
    </section>
  );
}

function ChannelRow({
  label, color, pipeline, dimmed,
}: {
  label: string; color: string; pipeline: ChannelPipeline; dimmed: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: dimmed ? 0.5 : 1 }}>
      <div
        style={{
          minWidth: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          fontWeight: 600,
          color: C.text,
        }}
      >
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, display: 'inline-block' }}
        />
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
        {STAGE_ORDER.map((stage, idx) => {
          const metric = pipeline[stage];
          const isSettlement = stage === '정산완료';
          const available = isSettlement ? (metric as { available: boolean }).available : true;
          return (
            <React.Fragment key={stage}>
              <PipelineStageCard
                label={stage}
                count={metric.count}
                amount={metric.amount}
                available={available}
                color={STAGE_COLORS[stage]}
              />
              {idx < STAGE_ORDER.length - 1 && (
                <ChevronRight size={14} aria-hidden style={{ color: '#d4d4d8', flexShrink: 0 }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test src/__tests__/components/dashboard/order-pipeline.test.tsx -- --run`
Expected: PASS — 3 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/OrderPipeline.tsx src/__tests__/components/dashboard/order-pipeline.test.tsx
git commit -m "feat(dashboard): OrderPipeline 컴포넌트 + 테스트"
```

---

### Task 15: RevenueChart 컴포넌트 + 테스트

**Files:**
- Create: `src/components/dashboard/RevenueChart.tsx`
- Test: `src/__tests__/components/dashboard/revenue-chart.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/components/dashboard/revenue-chart.test.tsx`:
```tsx
/**
 * RevenueChart SVG 라인차트 테스트
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RevenueChart from '@/components/dashboard/RevenueChart';

const TARGETS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000];

describe('RevenueChart', () => {
  it('타이틀과 SVG 차트를 렌더한다', () => {
    render(
      <RevenueChart
        weeks={[1,2,3,4,5,6,7,8,9,10,11,12]}
        target={TARGETS}
        actual={[10, null, null, null, null, null, null, null, null, null, null, null]}
        currentWeek={1}
      />
    );
    expect(screen.getByText(/12주 누적 매출/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /매출 추세 차트/ })).toBeInTheDocument();
  });

  it('actual이 모두 null이어도 충돌 없이 렌더한다', () => {
    render(
      <RevenueChart
        weeks={[1,2,3,4,5,6,7,8,9,10,11,12]}
        target={TARGETS}
        actual={new Array(12).fill(null)}
        currentWeek={1}
      />
    );
    expect(screen.getByRole('img', { name: /매출 추세 차트/ })).toBeInTheDocument();
  });

  it('Y축 최대값 라벨에 1000만원이 표시된다', () => {
    render(
      <RevenueChart
        weeks={[1,2,3,4,5,6,7,8,9,10,11,12]}
        target={TARGETS}
        actual={new Array(12).fill(null)}
        currentWeek={1}
      />
    );
    expect(screen.getByText('1000')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test src/__tests__/components/dashboard/revenue-chart.test.tsx -- --run`
Expected: FAIL — Cannot find module

- [ ] **Step 3: 컴포넌트 구현**

`src/components/dashboard/RevenueChart.tsx`:
```tsx
'use client';

import React from 'react';
import { C } from '@/lib/design-tokens';

interface RevenueChartProps {
  weeks: number[];
  target: number[];                  // 누적 목표 (만원)
  actual: (number | null)[];         // 누적 실제 (만원, null = 미래)
  currentWeek: number;               // 1..12
}

const W = 720;       // 뷰박스 폭
const H = 240;       // 뷰박스 높이
const PAD_L = 36;    // 좌측 여백 (Y축 라벨)
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 28;    // 하단 여백 (X축 라벨)

export default function RevenueChart({ weeks, target, actual, currentWeek }: RevenueChartProps) {
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const yMax = 1000; // 만원 — 12주 최종 목표
  const x = (idx: number) => PAD_L + (innerW * idx) / (weeks.length - 1);
  const y = (val: number) => PAD_T + innerH - (innerH * val) / yMax;

  // path 생성 — null 값은 path에서 끊김
  const targetPath = target.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');

  let actualPath = '';
  let started = false;
  for (let i = 0; i < actual.length; i++) {
    const v = actual[i];
    if (v == null) continue;
    actualPath += `${started ? ' L' : 'M'} ${x(i)} ${y(v)}`;
    started = true;
  }

  // 현재 주차 표시 점
  const currentIdx = Math.min(Math.max(currentWeek - 1, 0), weeks.length - 1);
  const currentVal = actual[currentIdx];

  return (
    <section
      aria-label="12주 매출 차트"
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 20,
      }}
    >
      <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: C.text }}>
        12주 누적 매출 추세
      </h2>

      <svg
        role="img"
        aria-label="매출 추세 차트"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        style={{ display: 'block' }}
      >
        {/* Y축 grid + 라벨 */}
        {[0, 250, 500, 750, 1000].map((v) => (
          <g key={v}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(v)}
              y2={y(v)}
              stroke="#f0f0f0"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 6}
              y={y(v) + 4}
              fontSize={10}
              fill="#a1a1aa"
              textAnchor="end"
            >
              {v}
            </text>
          </g>
        ))}

        {/* 목표 라인 (점선) */}
        <path d={targetPath} fill="none" stroke="#a1a1aa" strokeWidth={1.5} strokeDasharray="4 4" />

        {/* 실제 라인 (실선, accent) */}
        {actualPath && (
          <path d={actualPath} fill="none" stroke={C.accent} strokeWidth={2.5} strokeLinejoin="round" />
        )}

        {/* 현재 주차 점 */}
        {currentVal != null && (
          <circle cx={x(currentIdx)} cy={y(currentVal)} r={4} fill={C.accent} />
        )}

        {/* X축 라벨 */}
        {weeks.map((w, i) => (
          <text
            key={w}
            x={x(i)}
            y={H - 8}
            fontSize={10}
            fill="#a1a1aa"
            textAnchor="middle"
          >
            W{w}
          </text>
        ))}
      </svg>

      {/* 범례 */}
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: '#71717a' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ width: 14, height: 0, borderTop: '1.5px dashed #a1a1aa' }} /> 목표
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ width: 14, height: 0, borderTop: `2.5px solid ${C.accent}` }} /> 실제
        </span>
        <span style={{ marginLeft: 'auto', color: '#a1a1aa' }}>단위: 만원</span>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test src/__tests__/components/dashboard/revenue-chart.test.tsx -- --run`
Expected: PASS — 3 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/RevenueChart.tsx src/__tests__/components/dashboard/revenue-chart.test.tsx
git commit -m "feat(dashboard): RevenueChart SVG 라인차트 + 테스트"
```

---

## Phase 4: DashboardClient 통합

### Task 16: DashboardClient 전면 재작성

**Files:**
- Modify: `src/components/dashboard/DashboardClient.tsx` (전면 교체)

- [ ] **Step 1: 신규 DashboardClient 작성**

`src/components/dashboard/DashboardClient.tsx` (기존 파일 전체 교체):
```tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { LayoutDashboard, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { C } from '@/lib/design-tokens';
import PlanProgressCard from './PlanProgressCard';
import ProductCountWidget from './ProductCountWidget';
import OrderPipeline from './OrderPipeline';
import RevenueChart from './RevenueChart';
import {
  type Period,
  type DashboardSummaryData,
} from '@/lib/dashboard/types';
import { WBS_DATA, WEEKLY_TARGETS } from '@/lib/plan/constants';
import { getCurrentWeek, getDaysIntoWeek } from '@/lib/plan/week';
import { loadDailyRecords, sumWeekRevenue, computeCumulativeActual } from '@/lib/plan/daily-records';

const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드', active: true },
  { href: '/sourcing', label: '소싱' },
  { href: '/editor', label: '에디터' },
  { href: '/listing', label: '상품등록' },
  { href: '/orders', label: '주문/매출' },
  { href: '/plan', label: '플랜' },
];

interface PlanLocalData {
  weekNumber: number;
  weekTitle: string;
  weekTargetMan: number;
  weekActualMan: number;
  daysIntoWeek: number;
  keyMission: string | null;
  cumulativeActual: (number | null)[];
}

function readPlanLocalData(): PlanLocalData | null {
  if (typeof window === 'undefined') return null;
  const records = loadDailyRecords();
  const week = getCurrentWeek();
  const weekData = WBS_DATA[week];
  if (!weekData) return null;

  const weekTargetMan =
    week === 1 ? WEEKLY_TARGETS[0] : WEEKLY_TARGETS[week - 1] - WEEKLY_TARGETS[week - 2];
  const weekActualMan = sumWeekRevenue(records, week);

  // 핵심 미션: 첫 미완료 WBS task
  const checks = (() => {
    try {
      const raw = localStorage.getItem('plan_wbs_tasks');
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {} as Record<string, boolean>;
    }
  })();
  const firstIncomplete = weekData.tasks.find((t) => !checks[t.id]);

  return {
    weekNumber: week,
    weekTitle: weekData.title,
    weekTargetMan,
    weekActualMan,
    daysIntoWeek: getDaysIntoWeek(),
    keyMission: firstIncomplete?.text ?? null,
    cumulativeActual: computeCumulativeActual(records, week),
  };
}

export default function DashboardClient() {
  const [period, setPeriod] = useState<Period>('today');
  const [data, setData] = useState<DashboardSummaryData | null>(null);
  const [planData, setPlanData] = useState<PlanLocalData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 플랜 데이터는 client side localStorage에서만
  useEffect(() => {
    setPlanData(readPlanLocalData());
  }, []);

  const fetchSummary = async (p: Period) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/summary?period=${p}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '요청 실패');
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary(period);
  }, [period]);

  const chartActual = useMemo(() => {
    return planData?.cumulativeActual ?? new Array(12).fill(null);
  }, [planData]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#f5f5f7' }}>
      {/* ── 헤더 (기존 유지) ─────────────────── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          height: 52,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: `1px solid ${C.border}`,
          backgroundColor: C.card,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.3px', color: C.text }}>
              Smart<span style={{ color: C.accent }}>Seller</span>Studio
            </span>
            <span
              style={{
                backgroundColor: 'rgba(190,0,20,0.08)',
                color: C.accent,
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 9px',
                borderRadius: 100,
                border: '1px solid rgba(190,0,20,0.2)',
              }}
            >
              Beta
            </span>
          </Link>
          <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: item.active ? 600 : 500,
                  color: item.active ? C.accent : '#71717a',
                  textDecoration: 'none',
                  backgroundColor: item.active ? 'rgba(190,0,20,0.07)' : 'transparent',
                  border: item.active ? '1px solid rgba(190,0,20,0.15)' : '1px solid transparent',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <button
          onClick={() => fetchSummary(period)}
          aria-label="새로고침"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 6,
            border: `1px solid ${C.border}`,
            backgroundColor: C.card,
            cursor: 'pointer',
            fontSize: 12,
            color: C.text,
          }}
        >
          <RefreshCw size={12} /> 새로고침
        </button>
      </header>

      {/* ── 메인 ─────────────────── */}
      <main style={{ flex: 1, maxWidth: 1200, width: '100%', margin: '0 auto', padding: '28px 24px' }}>
        {/* 타이틀 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: 'rgba(190,0,20,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LayoutDashboard size={18} color={C.accent} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>운영 대시보드</h1>
            <p style={{ fontSize: 12, color: '#71717a', margin: 0 }}>
              플랜 진행 · 등록 상품 · 주문 파이프라인 한눈에
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 플랜 카드 (또는 비어있음 안내) */}
          {planData ? (
            <PlanProgressCard
              weekNumber={planData.weekNumber}
              weekTitle={planData.weekTitle}
              weekTargetMan={planData.weekTargetMan}
              weekActualMan={planData.weekActualMan}
              daysIntoWeek={planData.daysIntoWeek}
              keyMission={planData.keyMission}
            />
          ) : (
            <PlanEmptyCard />
          )}

          {/* 등록 상품 위젯 */}
          {data && (
            <ProductCountWidget coupang={data.products.coupang} naver={data.products.naver} />
          )}

          {/* 로딩 / 에러 / 정상 분기 */}
          {isLoading && !data ? (
            <LoadingCard />
          ) : error && !data ? (
            <ErrorCard error={error} onRetry={() => fetchSummary(period)} />
          ) : data ? (
            <>
              <OrderPipeline
                coupang={data.pipeline.coupang}
                naver={data.pipeline.naver}
                period={period}
                onPeriodChange={setPeriod}
                coupangDimmed={data.products.coupang === 0}
                naverDimmed={data.products.naver === 0}
              />
              <RevenueChart
                weeks={data.revenue12w.weeks}
                target={data.revenue12w.target}
                actual={chartActual}
                currentWeek={planData?.weekNumber ?? 1}
              />
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function LoadingCard() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 64,
        backgroundColor: C.card,
        borderRadius: 14,
        border: `1px solid ${C.border}`,
      }}
    >
      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: '#a1a1aa' }} />
    </div>
  );
}

function ErrorCard({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 32,
        backgroundColor: C.card,
        borderRadius: 14,
        border: `1px solid ${C.border}`,
      }}
    >
      <AlertTriangle size={24} color="#d97706" />
      <p style={{ fontSize: 13, color: '#71717a', margin: 0 }}>데이터를 불러오지 못했습니다: {error}</p>
      <button
        onClick={onRetry}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 16px',
          borderRadius: 8,
          cursor: 'pointer',
          border: `1px solid ${C.border}`,
          backgroundColor: '#fafafa',
          fontSize: 12,
          fontWeight: 500,
          color: C.text,
        }}
      >
        <RefreshCw size={13} /> 다시 시도
      </button>
    </div>
  );
}

function PlanEmptyCard() {
  return (
    <div
      style={{
        backgroundColor: C.card,
        border: `1px dashed ${C.border}`,
        borderRadius: 14,
        padding: '24px 28px',
        textAlign: 'center',
      }}
    >
      <p style={{ fontSize: 13, color: '#71717a', margin: '0 0 12px' }}>
        아직 진행 중인 플랜이 없습니다.
      </p>
      <Link
        href="/plan"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 18px',
          borderRadius: 8,
          backgroundColor: C.accent,
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        플랜 시작하기
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: 빌드/타입체크 통과 확인**

Run: `pnpm tsc --noEmit`
Expected: 컴파일 에러 없음

- [ ] **Step 3: 단위/통합 테스트 전체 실행**

Run: `pnpm test -- --run`
Expected: 모든 신규 테스트 통과 (기존 테스트 회귀 없음)

- [ ] **Step 4: dev 서버에서 수동 검증**

Run: `pnpm dev`

브라우저 `http://localhost:3000/dashboard` 진입 후 확인:
1. 헤더와 네비게이션이 기존과 동일하게 보임
2. 플랜 카드: Week 1 / "기반 세팅" / 매출 목표 50만원 / 핵심 미션 표시 (또는 플랜 시작 CTA)
3. 등록 상품 위젯: 쿠팡/네이버/총합 표시
4. 주문 파이프라인: 쿠팡/네이버 각 5단계 카드 — 정산완료는 "API 미연동"
5. 기간 토글 클릭 시 데이터 재요청
6. 12주 차트: 회색 점선 목표 + 빨간 실선 실제(이번주까지)
7. 새로고침 버튼 동작
8. 콘솔 에러 없음

검증 후 dev 종료.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/DashboardClient.tsx
git commit -m "feat(dashboard): 운영 중심 + 플랜 통합으로 DashboardClient 재작성"
```

---

## Phase 5: 쿠팡 정산 API 연동 (선택, Phase 1~4 배포 후)

### Task 17: CoupangClient에 getRevenueHistory 메서드 추가

**Files:**
- Modify: `src/lib/listing/coupang-client.ts`

- [ ] **Step 1: 메서드 추가**

`src/lib/listing/coupang-client.ts`에 `getOrderDetail` 다음 (클래스 내부) 메서드 추가:
```ts
  // ─── 매출 내역 (정산) 조회 ─────────────────────────────────

  /**
   * Wing revenue-history API.
   * https://developers.coupangcorp.com/hc/ko/articles/360036042193
   * 입금 완료된 매출 내역만 반환됨.
   */
  async getRevenueHistory(params: {
    recognitionDateFrom: string;  // YYYY-MM-DD
    recognitionDateTo: string;    // YYYY-MM-DD
    maxPerPage?: number;
    token?: string;
  }): Promise<{ items: Array<{ orderId: string; saleAmount: number; recognitionDate: string }>; nextToken: string | null }> {
    const parts: string[] = [
      `recognitionDateFrom=${params.recognitionDateFrom}`,
      `recognitionDateTo=${params.recognitionDateTo}`,
    ];
    if (params.maxPerPage) parts.push(`maxPerPage=${params.maxPerPage}`);
    if (params.token) parts.push(`token=${params.token}`);

    const url = `/v2/providers/openapi/apis/api/v1/revenue-history?${parts.join('&')}`;
    await sleep(API_DELAY);
    const res = await this.request<Array<Record<string, unknown>>>('GET', url);
    const rawItems = res.data ?? [];
    return {
      items: rawItems.map((r) => ({
        orderId: String(r.orderId ?? ''),
        saleAmount: Number(r.saleAmount ?? 0),
        recognitionDate: String(r.recognitionDate ?? ''),
      })),
      nextToken: res.nextToken ?? null,
    };
  }
```

> **주의**: 실제 응답 필드명은 쿠팡 Wing API 문서 재확인 필요. 본 스펙은 일반적인 명명 가정. 실제 검증 시 환경변수 + 별도 스크립트로 확인 후 필드 조정.

- [ ] **Step 2: Commit**

```bash
git add src/lib/listing/coupang-client.ts
git commit -m "feat(coupang): getRevenueHistory 메서드 추가 (Wing 정산 내역)"
```

---

### Task 18: settlement-clients에 쿠팡 정산 연동

**Files:**
- Modify: `src/lib/dashboard/settlement-clients.ts`

- [ ] **Step 1: fetchCoupangSettlement 실제 구현**

`src/lib/dashboard/settlement-clients.ts` 파일에서 `fetchCoupangSettlement` 함수를 다음으로 교체:
```ts
import { getCoupangClient } from '@/lib/listing/coupang-client';

function periodToRange(period: Period): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  let from = to;
  if (period === '7d') {
    const d = new Date(today); d.setDate(d.getDate() - 6); from = d.toISOString().slice(0, 10);
  } else if (period === '30d') {
    const d = new Date(today); d.setDate(d.getDate() - 29); from = d.toISOString().slice(0, 10);
  } else if (period === 'month') {
    const d = new Date(today.getFullYear(), today.getMonth(), 1); from = d.toISOString().slice(0, 10);
  }
  return { from, to };
}

export async function fetchCoupangSettlement(params: SettlementParams): Promise<SettlementStageMetric> {
  try {
    const client = getCoupangClient();
    const { from, to } = periodToRange(params.period);
    const result = await client.getRevenueHistory({
      recognitionDateFrom: from,
      recognitionDateTo: to,
      maxPerPage: 100,
    });
    const totalAmount = result.items.reduce((sum, r) => sum + r.saleAmount, 0);
    return { count: result.items.length, amount: totalAmount, available: true };
  } catch (err) {
    console.warn('[dashboard] 쿠팡 정산 조회 실패:', err instanceof Error ? err.message : err);
    return { count: 0, amount: 0, available: false };
  }
}
```

- [ ] **Step 2: 통합 테스트 보강**

`src/__tests__/api/dashboard-summary.test.ts`의 기존 mock에서 `fetchCoupangSettlement` mock 값을 다음 케이스로 추가:
```ts
it('쿠팡 정산이 성공하면 available:true + 금액 반환', async () => {
  mockSettleCoupang.mockResolvedValue({ count: 5, amount: 500_000, available: true });
  const res = await GET(makeRequest('30d'));
  const body = await res.json();
  expect(body.data.pipeline.coupang.정산완료).toEqual({
    count: 5,
    amount: 500_000,
    available: true,
  });
});
```

Run: `pnpm test src/__tests__/api/dashboard-summary.test.ts -- --run`
Expected: PASS — 새 테스트 포함 모두 통과

- [ ] **Step 3: Commit**

```bash
git add src/lib/dashboard/settlement-clients.ts src/__tests__/api/dashboard-summary.test.ts
git commit -m "feat(dashboard): 쿠팡 정산(revenue-history) 실제 연동"
```

---

## Phase 6: 네이버 정산 API 연동 (선택, Phase 5 후)

### Task 19: NaverCommerceClient에 getSettlements 메서드 추가

**Files:**
- Modify: `src/lib/listing/naver-commerce-client.ts`

- [ ] **Step 1: 메서드 추가**

`src/lib/listing/naver-commerce-client.ts`의 `getOrders` 다음(클래스 내부)에 추가:
```ts
  // ─── 정산 조회 ────────────────────────────────────────────

  /**
   * 네이버 커머스 settlements API — 지급 완료된 정산 내역.
   * 엔드포인트는 실제 호출 시 검증 필요.
   */
  async getSettlements(params: {
    fromDate: string;  // YYYY-MM-DD
    toDate: string;
  }): Promise<{ items: Array<{ productOrderId: string; settlementAmount: number; paymentDate: string }> }> {
    const query = new URLSearchParams({
      paymentDateFrom: `${params.fromDate}T00:00:00.000+09:00`,
      paymentDateTo:   `${params.toDate}T23:59:59.000+09:00`,
    });
    const res = await this.request<{ data?: Array<Record<string, unknown>> }>(
      'GET',
      `/external/v1/settlements?${query.toString()}`,
    );
    const rawItems = res.data ?? [];
    return {
      items: rawItems.map((r) => ({
        productOrderId: String(r.productOrderId ?? ''),
        settlementAmount: Number(r.settlementAmount ?? 0),
        paymentDate: String(r.paymentDate ?? ''),
      })),
    };
  }
```

> **주의**: 정확한 엔드포인트 경로/파라미터 키는 네이버 커머스 API 문서 재확인 필요.

- [ ] **Step 2: Commit**

```bash
git add src/lib/listing/naver-commerce-client.ts
git commit -m "feat(naver): getSettlements 메서드 추가 (커머스 정산 API)"
```

---

### Task 20: settlement-clients에 네이버 정산 연동

**Files:**
- Modify: `src/lib/dashboard/settlement-clients.ts`

- [ ] **Step 1: fetchNaverSettlement 실제 구현**

`src/lib/dashboard/settlement-clients.ts`의 `fetchNaverSettlement` 함수를 다음으로 교체:
```ts
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';

export async function fetchNaverSettlement(params: SettlementParams): Promise<SettlementStageMetric> {
  try {
    const client = getNaverCommerceClient();
    const { from, to } = periodToRange(params.period);
    const result = await client.getSettlements({ fromDate: from, toDate: to });
    const totalAmount = result.items.reduce((sum, r) => sum + r.settlementAmount, 0);
    return { count: result.items.length, amount: totalAmount, available: true };
  } catch (err) {
    console.warn('[dashboard] 네이버 정산 조회 실패:', err instanceof Error ? err.message : err);
    return { count: 0, amount: 0, available: false };
  }
}
```

- [ ] **Step 2: dev 서버 수동 검증**

Run: `pnpm dev`

`/dashboard` 진입 → 정산완료 stage 두 채널 모두 실제 데이터 표시(또는 자격증명 미설정 시 "API 미연동").

- [ ] **Step 3: Commit**

```bash
git add src/lib/dashboard/settlement-clients.ts
git commit -m "feat(dashboard): 네이버 정산(settlements) 실제 연동"
```

---

## 완료 기준

**Phase 1~4 완료 시점:**
- 모든 Vitest 테스트 통과 (`pnpm test -- --run`)
- TypeScript 컴파일 에러 없음 (`pnpm tsc --noEmit`)
- `/dashboard` 진입 시 소싱 데이터 자취 없음, 신규 4개 섹션(플랜/등록상품/파이프라인/차트) 모두 렌더
- `/plan` 페이지 동작 회귀 없음
- 정산완료 stage는 "API 미연동" 표시

**Phase 5 완료 시점:**
- 쿠팡 정산 stage가 실제 정산 금액/건수 표시 (자격증명 있을 때)

**Phase 6 완료 시점:**
- 네이버 정산 stage도 실제 데이터 표시
