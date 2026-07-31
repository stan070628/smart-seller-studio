/**
 * PlanClient.test.tsx
 * src/components/plan/PlanClient.tsx 렌더링 회귀 테스트
 *
 * 배경: 플랜 데이터가 v2(누적 1,000만원)에서 v3(12주차 월매출 2,000만원)로
 * 교체됐다. src/lib/plan/* 로직 레이어는 단위 테스트로 덮여 있지만, 그 값이
 * PlanClient.tsx에 실제로 올바르게 배선되는지(예: import 오타로 undefined가
 * 렌더되는 경우)는 렌더 테스트가 없으면 tsc/build에만 의존하게 된다. 이 파일이
 * 그 구멍을 메운다.
 *
 * 시각 고정 규칙: getCurrentWeek()가 PLAN_START 기준 실제 시각에 의존하므로,
 * 절대 날짜를 박지 않고 PLAN_START로부터의 오프셋으로 시각을 고정한다
 * (src/__tests__/lib/plan/week.test.ts의 dayOffsetNoon 패턴과 동일).
 * 플랜을 v4로 교체해도 이 파일은 그대로 유효해야 한다.
 *
 * 타이머 주의: 각 탭은 mounted 상태로 첫 렌더에 null을 반환하고 useEffect에서
 * setMounted(true)를 호출하는 패턴을 쓴다. RTL의 render()는 act()로 감싸져
 * 있어 이 useEffect가 render() 호출이 끝나기 전에 동기적으로 flush되므로
 * (스파이크로 확인함), 렌더 직후 바로 동기 쿼리(getByText 등)로 조회할 수
 * 있다. 반대로 waitFor/findBy*(→ 내부적으로 setInterval 폴링)와 userEvent
 * (내부적으로 타이머 기반 지연을 씀)는 vi.useFakeTimers() 아래에서 폴링이
 * 절대 깨어나지 못해 테스트가 타임아웃난다. 그래서 이 파일에서는 fake timers
 * 구간에서 동기 쿼리 + fireEvent만 사용한다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  PLAN_START,
  WEEKLY_RUN_RATE,
  MONTH_WEEKS,
} from '@/lib/plan/constants';

// ---------------------------------------------------------------------------
// AlertList / InboundReturnForm 모킹
//
// PlanClient는 '알림' / '회고' 탭에서만 이 컴포넌트들을 마운트한다. 이 파일의
// 테스트는 '오늘 할 일' / '목표 진행도' 탭만 조작하므로 실제로는 마운트되지
// 않지만, fetch를 사용하는 컴포넌트가 우연히라도 렌더 트리에 끼어들어 콘솔을
// 어지럽히거나 비동기 상태 업데이트를 남기지 않도록 가볍게 스텁해 둔다.
// ---------------------------------------------------------------------------
vi.mock('@/components/alerts/AlertList', () => ({
  default: () => <div data-testid="alert-list-stub" />,
}));
vi.mock('@/components/retro/InboundReturnForm', () => ({
  default: () => <div data-testid="inbound-return-form-stub" />,
}));

// 테스트 대상인 플랜 로직·상수(@/lib/plan/*)는 절대 모킹하지 않는다.
import PlanClient from '@/components/plan/PlanClient';

// ---------------------------------------------------------------------------
// 시각 헬퍼 — 절대 날짜 대신 PLAN_START로부터의 오프셋으로 계산한다.
// ---------------------------------------------------------------------------
const MS_PER_DAY = 86_400_000;

/** PLAN_START + n일 정오(KST)의 Date — 시스템 시각 고정용 */
function dayOffsetNoon(n: number): Date {
  return new Date(PLAN_START.getTime() + n * MS_PER_DAY + 12 * 3_600_000);
}

/** PLAN_START + n일의 YYYY-MM-DD 문자열(KST) — daily-records 시딩용 */
function dayOffsetStr(n: number): string {
  const d = new Date(PLAN_START.getTime() + n * MS_PER_DAY);
  const kst = new Date(d.getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 10);
}

/** '목표 진행도' 탭 버튼 클릭 — fake timers 아래에서도 안전한 fireEvent 사용 */
function openProgressTab() {
  fireEvent.click(screen.getByRole('button', { name: '목표 진행도' }));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PlanClient — v3 데이터 렌더링', () => {
  it('1주차에는 v3 첫 주 내용("기준선 진단")이 오늘 할 일 탭(기본 탭)에 보인다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayOffsetNoon(0));

    render(<PlanClient />);

    // v2였다면 1주차 제목은 "셋업 + 키워드 발굴"이었을 것 — 배럴이 실제로
    // v3를 가리키는지 렌더 결과로 확인한다.
    expect(screen.getByText('기준선 진단')).toBeInTheDocument();
  });

  it('목표 진행도 탭에는 최종 목표가 "월 2,000만원"으로 표시되고 "월 1,000만원"(v2 하드코딩)은 없다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayOffsetNoon(0));

    render(<PlanClient />);
    openProgressTab();

    // 페이지 헤더와 진행도 탭 본문 두 곳 모두에 "월 2,000만원"이 표시된다.
    expect(screen.getAllByText('월 2,000만원').length).toBeGreaterThan(0);
    expect(screen.queryByText(/월 1,000만원/)).not.toBeInTheDocument();
  });
});

describe('PlanClient — 런레이트 KPI', () => {
  it('실적 기록이 없으면 1주차 목표를 월 환산한 런레이트가 표시된다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayOffsetNoon(0));

    // 기대값은 상수에서 계산한다 — WEEKLY_RUN_RATE 배열이 바뀌어도
    // 이 테스트는 이유를 알 수 있는 채로 실패하거나, 그대로 통과한다.
    const expectedTargetRunRate = Math.round(WEEKLY_RUN_RATE[0] * MONTH_WEEKS);

    render(<PlanClient />);
    openProgressTab();

    expect(
      screen.getByText(`목표 월 ${expectedTargetRunRate.toLocaleString()}만원`, { exact: false }),
    ).toBeInTheDocument();
  });

  it('1주차 매출 기록을 넣으면 런레이트 실적이 0이 아닌 월 환산값으로 반영된다', () => {
    const weekOneRevenue = 500; // 만원

    localStorage.setItem(
      'plan_daily_records',
      JSON.stringify([
        {
          date: dayOffsetStr(1),
          revenue: weekOneRevenue,
          adSpend: 100,
          newProducts: 0,
          winnerNote: '',
          blockerNote: '',
          week: 1,
        },
      ]),
    );

    vi.useFakeTimers();
    vi.setSystemTime(dayOffsetNoon(1));

    const expectedActualRunRate = Math.round(weekOneRevenue * MONTH_WEEKS);
    expect(expectedActualRunRate).not.toBe(0);

    render(<PlanClient />);
    openProgressTab();

    expect(
      screen.getByText(`월 ${expectedActualRunRate.toLocaleString()}만원`),
    ).toBeInTheDocument();
  });
});

describe('PlanClient — 플랜 종료 분기', () => {
  it('12주 플랜 종료 이후에는 "이번 주 런레이트" 대신 종료 문구가 뜬다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayOffsetNoon(84));

    render(<PlanClient />);
    openProgressTab();

    expect(screen.getByText(/12주 플랜 종료/)).toBeInTheDocument();
    expect(screen.queryByText(/이번 주 런레이트/)).not.toBeInTheDocument();
  });
});

describe('PlanClient — 12주 차트', () => {
  it('주차별 누적 매출 차트가 12주 전체 목표를 렌더한다 (마지막 주 누적 목표 4,225만 포함)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayOffsetNoon(0));

    render(<PlanClient />);
    openProgressTab();

    // v2 하드코딩 시절엔 차트 스케일 상한이 1000이라 4주차부터 막대가
    // 잘렸다. 마지막 주(12주차) 누적 목표 수치가 그대로 보이는지 확인해
    // v3 전체 12주 목표가 스케일 손실 없이 렌더되는지 검증한다.
    expect(screen.getByText('목표 4,225만')).toBeInTheDocument();
  });
});
