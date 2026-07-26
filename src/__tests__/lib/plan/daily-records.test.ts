/**
 * 일별 기록 유틸리티 단위 테스트
 *
 * 픽스처 날짜는 PLAN_START 기준 오프셋으로 만든다.
 * 절대 날짜를 박으면 플랜 교체 시 날짜 필터에 걸려 깨진다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadDailyRecords,
  saveDailyRecords,
  sumWeekRevenue,
  computeCumulativeActual,
  type DailyRecord,
} from '@/lib/plan/daily-records';
import { PLAN_START } from '@/lib/plan/constants';

const MS_PER_DAY = 86_400_000;

/** PLAN_START + n일의 YYYY-MM-DD 문자열 (KST) */
function dayOffsetStr(n: number): string {
  const d = new Date(PLAN_START.getTime() + n * MS_PER_DAY + 9 * 3_600_000);
  return d.toISOString().slice(0, 10);
}

function rec(date: string, revenue: number, week: number): DailyRecord {
  return { date, revenue, adSpend: 0, newProducts: 0, winnerNote: '', blockerNote: '', week };
}

beforeEach(() => {
  localStorage.clear();
});

describe('loadDailyRecords / saveDailyRecords', () => {
  it('빈 localStorage에서 빈 배열을 반환한다', () => {
    expect(loadDailyRecords()).toEqual([]);
  });

  it('저장 후 재호출 시 동일한 배열을 반환한다', () => {
    const records = [rec(dayOffsetStr(0), 5, 1)];
    saveDailyRecords(records);
    expect(loadDailyRecords()).toEqual(records);
  });

  it('JSON 파싱 실패 시 빈 배열을 반환한다', () => {
    localStorage.setItem('plan_daily_records', 'not-json{');
    expect(loadDailyRecords()).toEqual([]);
  });

  it('PLAN_START 이전 기록은 제외한다 (이전 플랜 잔여 기록)', () => {
    const stale = rec(dayOffsetStr(-1), 999, 12);
    const fresh = rec(dayOffsetStr(0), 5, 1);
    saveDailyRecords([stale, fresh]);
    expect(loadDailyRecords()).toEqual([fresh]);
  });

  it('PLAN_START 당일 기록은 포함한다', () => {
    const sameDay = rec(dayOffsetStr(0), 7, 1);
    saveDailyRecords([sameDay]);
    expect(loadDailyRecords()).toEqual([sameDay]);
  });

  it('saveDailyRecords가 PLAN_START 이전 기록을 저장소에 보존한다', () => {
    const stale = rec(dayOffsetStr(-3), 999, 12);
    const fresh = rec(dayOffsetStr(0), 5, 1);
    saveDailyRecords([stale, fresh]);

    // 사용자가 새 기록을 추가하고 저장 — 인자에는 stale이 없다
    const added = rec(dayOffsetStr(1), 8, 1);
    saveDailyRecords([added, fresh]);

    const raw = JSON.parse(localStorage.getItem('plan_daily_records') ?? '[]') as DailyRecord[];
    expect(raw.map((r) => r.date)).toContain(stale.date);
    expect(raw).toHaveLength(3);
  });

  it('보존된 이전 기록은 loadDailyRecords 결과에 나타나지 않는다', () => {
    const stale = rec(dayOffsetStr(-3), 999, 12);
    const fresh = rec(dayOffsetStr(0), 5, 1);
    saveDailyRecords([stale, fresh]);
    saveDailyRecords([fresh]);

    expect(loadDailyRecords()).toEqual([fresh]);
  });
});

describe('sumWeekRevenue', () => {
  it('해당 주차의 매출만 합산한다 (만원 단위 그대로)', () => {
    const records = [
      rec(dayOffsetStr(0), 5, 1),
      rec(dayOffsetStr(1), 7, 1),
      rec(dayOffsetStr(7), 10, 2),
    ];
    expect(sumWeekRevenue(records, 1)).toBe(12);
    expect(sumWeekRevenue(records, 2)).toBe(10);
    expect(sumWeekRevenue(records, 3)).toBe(0);
  });
});

describe('computeCumulativeActual', () => {
  it('주차별 누적 매출 12주 배열을 반환한다 (미래 주는 null)', () => {
    const records = [rec(dayOffsetStr(0), 5, 1), rec(dayOffsetStr(7), 10, 2)];
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
