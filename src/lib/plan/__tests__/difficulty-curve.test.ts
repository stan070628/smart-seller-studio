/**
 * difficulty-curve.test.ts
 * spec 2026-07-26-plan-v3-scale-2000-design §5.2 (난이도 곡선) 검증
 *
 * v3는 월 1,000만원을 이미 운영 중인 상태에서 시작하므로
 * v2(신규 셀러 온보딩)보다 대역이 높다.
 */

import { describe, it, expect } from 'vitest';
import { WBS_DATA } from '../constants';

const RANGES: Record<number, [number, number]> = {
  1: [2.5, 3.5], 2: [2.8, 3.8], 3: [3.0, 4.0],
  4: [3.0, 4.0], 5: [3.0, 4.0], 6: [3.0, 4.0],
  7: [3.3, 4.3], 8: [2.8, 3.8], 9: [3.0, 4.0],
  10: [3.3, 4.3], 11: [3.0, 4.0], 12: [2.8, 3.8],
};

describe('12주 평균 난이도 곡선 (spec §5.2)', () => {
  for (const week of Object.keys(RANGES).map(Number)) {
    it(`Week ${week} 평균 난이도 ${RANGES[week][0]}~${RANGES[week][1]} 범위 내`, () => {
      const data = WBS_DATA[week];
      const avg = data.tasks.reduce((s, t) => s + t.difficulty, 0) / data.tasks.length;
      const [lo, hi] = RANGES[week];
      expect(avg).toBeGreaterThanOrEqual(lo);
      expect(avg).toBeLessThanOrEqual(hi);
    });
  }
});

describe('매주 task 난이도 오름차순 정렬', () => {
  for (const week of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    it(`Week ${week} task가 difficulty 오름차순`, () => {
      const tasks = WBS_DATA[week].tasks;
      for (let i = 1; i < tasks.length; i++) {
        expect(tasks[i].difficulty).toBeGreaterThanOrEqual(tasks[i - 1].difficulty);
      }
    });
  }
});

describe('모든 task에 difficulty 부여', () => {
  it('전체 task가 difficulty 1~5를 갖는다', () => {
    const allTasks = Object.values(WBS_DATA).flatMap((w) => w.tasks);
    expect(allTasks.length).toBeGreaterThan(0);
    for (const task of allTasks) {
      expect([1, 2, 3, 4, 5]).toContain(task.difficulty);
    }
  });
});
