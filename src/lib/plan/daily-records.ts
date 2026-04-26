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
