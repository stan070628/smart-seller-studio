/**
 * v3 플랜 목표 배열 검증
 * spec 2026-07-26-plan-v3-scale-2000-design §4.2, §7
 *
 * 배럴(constants.ts)이 아니라 v3 파일을 직접 import한다.
 * 배럴 전환(Task 8) 전후 모두 이 파일이 v3를 검증하도록 하기 위해서다.
 */
import { describe, it, expect } from 'vitest';
import {
  WEEKLY_RUN_RATE,
  WEEKLY_TARGETS,
  PLAN_MAX_TARGET,
  PLAN_GOAL_MONTHLY,
  MONTH_WEEKS,
} from '../plans/v3-scale-2000';

describe('v3 목표 배열', () => {
  it('두 배열 모두 12주치다', () => {
    expect(WEEKLY_RUN_RATE).toHaveLength(12);
    expect(WEEKLY_TARGETS).toHaveLength(12);
  });

  it('WEEKLY_TARGETS는 WEEKLY_RUN_RATE의 누적합이다', () => {
    let acc = 0;
    const expected = WEEKLY_RUN_RATE.map((w) => (acc += w));
    expect([...WEEKLY_TARGETS]).toEqual(expected);
  });

  it('주간 런레이트가 단조 증가한다', () => {
    for (let i = 1; i < WEEKLY_RUN_RATE.length; i++) {
      expect(WEEKLY_RUN_RATE[i]).toBeGreaterThan(WEEKLY_RUN_RATE[i - 1]);
    }
  });

  it('PLAN_MAX_TARGET이 최종 누적 목표와 일치한다', () => {
    expect(PLAN_MAX_TARGET).toBe(WEEKLY_TARGETS[11]);
  });

  it('12주차 런레이트의 월 환산이 목표 월매출 이상이다', () => {
    expect(WEEKLY_RUN_RATE[11] * MONTH_WEEKS).toBeGreaterThanOrEqual(PLAN_GOAL_MONTHLY);
  });
});
