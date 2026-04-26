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
