/**
 * 플랜 주차 계산 유틸리티 단위 테스트
 *
 * 기대값은 PLAN_START에 일수를 더해 만든다. 절대 날짜를 박으면
 * 플랜을 교체할 때마다 이 파일이 깨진다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCurrentWeek, getWeekForDate, getDaysIntoWeek } from '@/lib/plan/week';
import { PLAN_START } from '@/lib/plan/constants';

const MS_PER_DAY = 86_400_000;

/** PLAN_START + n일의 YYYY-MM-DD 문자열 (KST) */
function dayOffsetStr(n: number): string {
  const d = new Date(PLAN_START.getTime() + n * MS_PER_DAY);
  const kst = new Date(d.getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 10);
}

/** PLAN_START + n일 정오(KST)의 Date */
function dayOffsetNoon(n: number): Date {
  return new Date(PLAN_START.getTime() + n * MS_PER_DAY + 12 * 3_600_000);
}

describe('getWeekForDate', () => {
  it('PLAN_START 당일은 Week 1을 반환한다', () => {
    expect(getWeekForDate(dayOffsetStr(0))).toBe(1);
  });

  it('PLAN_START + 6일은 Week 1을 반환한다', () => {
    expect(getWeekForDate(dayOffsetStr(6))).toBe(1);
  });

  it('PLAN_START + 7일은 Week 2를 반환한다', () => {
    expect(getWeekForDate(dayOffsetStr(7))).toBe(2);
  });

  it('PLAN_START 이전 날짜는 Week 1로 클램프한다', () => {
    expect(getWeekForDate(dayOffsetStr(-26))).toBe(1);
  });

  it('Week 12 이후는 Week 12로 클램프한다', () => {
    expect(getWeekForDate(dayOffsetStr(90))).toBe(12);
  });
});

describe('getCurrentWeek', () => {
  afterEach(() => vi.useRealTimers());

  it('PLAN_START + 4일 → Week 1', () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayOffsetNoon(4));
    expect(getCurrentWeek()).toBe(1);
  });

  it('PLAN_START + 14일 → Week 3', () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayOffsetNoon(14));
    expect(getCurrentWeek()).toBe(3);
  });
});

describe('getDaysIntoWeek', () => {
  afterEach(() => vi.useRealTimers());

  it('PLAN_START 당일은 1을 반환한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayOffsetNoon(0));
    expect(getDaysIntoWeek()).toBe(1);
  });

  it('PLAN_START + 4일은 5를 반환한다 (1-indexed)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayOffsetNoon(4));
    expect(getDaysIntoWeek()).toBe(5);
  });

  it('주의 마지막 날(7일째)은 7을 반환한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayOffsetNoon(6));
    expect(getDaysIntoWeek()).toBe(7);
  });

  it('새 주의 첫날은 다시 1로 돌아온다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayOffsetNoon(7));
    expect(getDaysIntoWeek()).toBe(1);
  });
});
