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

/**
 * 12주 플랜 기간이 끝났는지 여부.
 *
 * 주차 계산은 12로 클램프되므로 종료 후에도 getCurrentWeek()는 계속 12를
 * 반환한다. 종료 이후 기록은 전부 12주차로 쌓이므로, "이번 주" 단위 지표를
 * 그대로 보여주면 값이 시간이 갈수록 부풀어 오른다. 그 구간을 가리는 데 쓴다.
 */
export function isPlanEnded(): boolean {
  const diffDays = Math.floor((Date.now() - PLAN_START.getTime()) / MS_PER_DAY);
  return diffDays >= 84; // 12주 = 84일. 마지막 날은 83일째다.
}
