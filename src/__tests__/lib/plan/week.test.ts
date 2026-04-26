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
