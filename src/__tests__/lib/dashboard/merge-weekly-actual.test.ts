// src/__tests__/lib/dashboard/merge-weekly-actual.test.ts
// Wing + RG 주차별 합산 순수 함수 — 핵심 버그 수정 회귀 테스트
// 구버그: wingVal !== null ? wingVal + rgAcc : null  →  Wing API 실패 시 RG 데이터 전량 손실

import { describe, it, expect } from 'vitest';
import { mergeWeeklyActual } from '@/lib/dashboard/merge-weekly-actual';

describe('mergeWeeklyActual', () => {
  it('Wing과 RG를 정상 합산한다', () => {
    const result = mergeWeeklyActual(
      [100, 200, 300],       // wingWeekly
      [50, 50, 50],          // rgWeeklyRaw
      3,                     // currentWeek
    );
    // rgAcc: week1=50, week2=100, week3=150
    expect(result).toEqual([150, 300, 450]);
  });

  it('미래 주차(w > currentWeek)는 null을 반환한다', () => {
    const result = mergeWeeklyActual(
      [100, 200, 300],
      [50, 50, 50],
      2,
    );
    expect(result[0]).toBe(150);   // week 1
    expect(result[1]).toBe(300);   // week 2
    expect(result[2]).toBeNull();  // week 3 (미래)
  });

  it('Wing API 실패(all-null)여도 RG 누적값을 반환한다 — 구버그 핵심', () => {
    // 구버그: wingVal !== null ? ... : null 이면 모두 null 반환
    const result = mergeWeeklyActual(
      [null, null, null],
      [100, 200, 150],
      3,
    );
    // rgAcc: week1=100, week2=300, week3=450
    expect(result).toEqual([100, 300, 450]);
    expect(result.every((v) => v !== null)).toBe(true);
  });

  it('Wing 일부 null이어도 해당 주차 RG만 반영한다', () => {
    const result = mergeWeeklyActual(
      [500, null, 300],
      [100, 200, 150],
      3,
    );
    // rgAcc: 100, 300, 450
    // week1: 500 + 100 = 600
    // week2: 0 + 300 = 300  (Wing null → 0)
    // week3: 300 + 450 = 750
    expect(result).toEqual([600, 300, 750]);
  });

  it('currentWeek이 0이면 모든 주차가 null이다', () => {
    const result = mergeWeeklyActual(
      [100, 200],
      [50, 50],
      0,
    );
    expect(result).toEqual([null, null]);
  });

  it('rgWeeklyRaw 항목이 null이면 0으로 처리한다', () => {
    const result = mergeWeeklyActual(
      [100, 100],
      [null, 50],
      2,
    );
    // rgAcc: week1=0, week2=50
    expect(result[0]).toBe(100); // 100 + 0
    expect(result[1]).toBe(150); // 100 + 50
  });
});
