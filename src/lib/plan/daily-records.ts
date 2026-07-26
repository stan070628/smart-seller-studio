/**
 * 플랜의 일별 매출 기록 — localStorage 기반.
 * PlanClient에서 추출. 대시보드의 12주 차트가 누적 매출을 계산할 때 사용.
 */

import { PLAN_START } from './constants';

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

/** PLAN_START의 KST 달력일 (YYYY-MM-DD) */
function planStartDateStr(): string {
  return new Date(PLAN_START.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 저장소 원본을 그대로 읽는다 — 플랜 구간 필터 없음. */
function readRawRecords(): DailyRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const records = JSON.parse(raw) as DailyRecord[];
    if (!Array.isArray(records)) return [];
    return records.filter((r) => typeof r?.date === 'string');
  } catch {
    return [];
  }
}

/**
 * 현재 플랜 구간의 일별 기록을 읽는다.
 *
 * PLAN_START 이전 기록은 제외한다. week 값이 이전 플랜 기준으로 계산돼 있어
 * 그대로 두면 새 플랜의 주차 실적으로 잘못 합산된다.
 */
export function loadDailyRecords(): DailyRecord[] {
  const startStr = planStartDateStr();
  return readRawRecords().filter((r) => r.date >= startStr);
}

/**
 * 일별 기록을 저장한다.
 *
 * 인자에는 loadDailyRecords가 걸러낸 이전 플랜 기록이 들어 있지 않다.
 * 인자만 그대로 쓰면 저장 한 번에 그 기록이 영구 삭제되므로, 원본에서
 * 이전 플랜 구간을 다시 읽어 함께 보존한다. 덕분에 소비자는 이 규칙을
 * 몰라도 되고, 플랜을 되돌리면 과거 실적이 그대로 살아난다.
 */
export function saveDailyRecords(records: DailyRecord[]): void {
  const startStr = planStartDateStr();
  const incomingDates = new Set(records.map((r) => r.date));
  const archived = readRawRecords().filter(
    (r) => r.date < startStr && !incomingDates.has(r.date),
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...archived, ...records]));
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
