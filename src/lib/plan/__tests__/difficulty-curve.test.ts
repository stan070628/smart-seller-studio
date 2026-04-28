/**
 * difficulty-curve.test.ts
 * spec 2026-04-28-plan-difficulty-redesign §4 (12주 곡선) + §5 (매주 정렬) 검증
 */

import { describe, it, expect } from 'vitest';
import { WBS_DATA } from '../constants';

const RANGES: Record<number, [number, number]> = {
  1: [1.8, 2.5], 2: [1.8, 2.5], 3: [2.5, 3.5],
  4: [3.3, 4.2], 5: [3.3, 4.2], 6: [2.5, 3.5],
  7: [3.3, 4.2], 8: [2.5, 3.5], 9: [2.5, 3.5],
  10: [4.0, 5.0], 11: [3.3, 4.2], 12: [3.3, 4.2],
};

describe('12주 평균 난이도 곡선 (spec §4)', () => {
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

describe('매주 task 난이도 오름차순 정렬 (spec §5)', () => {
  for (const week of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    it(`Week ${week} task가 difficulty 오름차순`, () => {
      const tasks = WBS_DATA[week].tasks;
      for (let i = 1; i < tasks.length; i++) {
        expect(tasks[i].difficulty).toBeGreaterThanOrEqual(tasks[i - 1].difficulty);
      }
    });
  }
});

describe('모든 task에 difficulty 부여 (spec §11)', () => {
  it('72개 task 모두 difficulty 1~5', () => {
    const allTasks = Object.values(WBS_DATA).flatMap((w) => w.tasks);
    expect(allTasks.length).toBeGreaterThan(0);
    for (const task of allTasks) {
      expect([1, 2, 3, 4, 5]).toContain(task.difficulty);
    }
  });
});
