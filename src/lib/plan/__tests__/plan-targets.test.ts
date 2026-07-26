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
  WBS_DATA,
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

  // 위 검증은 부등식이라 PLAN_GOAL_MONTHLY를 실수로 낮게 잡아도 통과한다.
  // 화면에 표시되는 목표 문구가 조용히 틀리는 걸 막으려면 값 자체를 고정해야 한다.
  it('화면에 표시하는 목표 월매출이 2,000만원이다', () => {
    expect(PLAN_GOAL_MONTHLY).toBe(2000);
  });
});

describe('v3 WBS 구조', () => {
  it('1~12주가 모두 정의돼 있다', () => {
    for (let week = 1; week <= 12; week++) {
      expect(WBS_DATA[week], `Week ${week} 누락`).toBeDefined();
    }
    expect(Object.keys(WBS_DATA)).toHaveLength(12);
  });

  it('각 주에 과제가 6개 이상이다', () => {
    for (let week = 1; week <= 12; week++) {
      expect(WBS_DATA[week].tasks.length, `Week ${week}`).toBeGreaterThanOrEqual(6);
    }
  });

  it('모든 과제 id가 v3- 접두사를 갖고 전체에서 유일하다', () => {
    const ids = Object.values(WBS_DATA).flatMap((w) => w.tasks.map((t) => t.id));
    for (const id of ids) {
      expect(id.startsWith('v3-'), `${id}는 v3- 접두사가 없다`).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  // revenueTarget 문자열은 WEEKLY_RUN_RATE에서 손으로 계산해 넣은 값이다.
  // 배열만 고치고 문구를 안 고치면 화면에 잘못된 목표가 조용히 표시된다.
  it('각 주 revenueTarget 문자열이 WEEKLY_RUN_RATE와 일치한다', () => {
    for (let week = 1; week <= 12; week++) {
      const weekly = WEEKLY_RUN_RATE[week - 1];
      const monthly = Math.round((weekly * MONTH_WEEKS) / 10) * 10;
      // 로케일에 좌우되지 않게 'en-US' 고정 — 원본 문자열이 쉼표 구분이다
      const expected = `주 ${weekly}만 (월 환산 ${monthly.toLocaleString('en-US')}만)`;
      expect(WBS_DATA[week].revenueTarget, `Week ${week}`).toBe(expected);
    }
  });
});
