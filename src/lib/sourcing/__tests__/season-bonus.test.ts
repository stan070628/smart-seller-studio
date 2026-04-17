/**
 * season-bonus.test.ts
 * 시즌 가산점 단위 테스트
 */

import { describe, it, expect } from 'vitest';
import { getSeasonBonus } from '../shared/season-bonus';

describe('getSeasonBonus — 크리스마스 (bonus 10, leadDays 45)', () => {
  it('12월 1일: 크리스마스 25일까지 24일 → 활성', () => {
    const result = getSeasonBonus('크리스마스 양말 선물세트', new Date(2026, 11, 1));
    expect(result.bonus).toBe(10);
    expect(result.matchedSeasons).toContain('크리스마스');
    expect(result.activeNow).toBe(true);
  });

  it('11월 10일: 크리스마스까지 45일 → 활성 경계', () => {
    const result = getSeasonBonus('크리스마스 트리 장식', new Date(2026, 10, 10));
    expect(result.bonus).toBe(10);
    expect(result.activeNow).toBe(true);
  });

  it('10월 1일: 크리스마스까지 85일 → 비활성', () => {
    const result = getSeasonBonus('크리스마스 트리 장식', new Date(2026, 9, 1));
    expect(result.bonus).toBe(0);
    expect(result.activeNow).toBe(false);
  });
});

describe('getSeasonBonus — 여름캠핑 (months: 5, 6, 7)', () => {
  it('6월: 캠핑 텐트 → 활성 (bonus 6)', () => {
    const result = getSeasonBonus('여름 캠핑 텐트 4인용', new Date(2026, 5, 15));
    expect(result.bonus).toBe(6);
    expect(result.matchedSeasons).toContain('여름캠핑');
  });

  it('8월: 캠핑 → 비활성 (months에 8월 없음)', () => {
    const result = getSeasonBonus('캠핑 텐트 타프', new Date(2026, 7, 15));
    expect(result.activeNow).toBe(false);
  });
});

describe('getSeasonBonus — 겨울캠핑 (months: 11, 12, 1)', () => {
  it('12월: 난로 → 활성 (bonus 6)', () => {
    const result = getSeasonBonus('캠핑 난로 방한 히터', new Date(2026, 11, 15));
    expect(result.bonus).toBeGreaterThanOrEqual(6);
    expect(result.activeNow).toBe(true);
  });

  it('1월: 핫팩 → 활성', () => {
    const result = getSeasonBonus('핫팩 동계 방한용품', new Date(2026, 0, 10));
    expect(result.activeNow).toBe(true);
  });
});

describe('getSeasonBonus — 최대 1개 시즌만 적용 (bestBonus)', () => {
  it('추석(10) + 겨울캠핑(6) 키워드 모두 포함 시 bonus = max', () => {
    // 추석 시즌 + 겨울 달에 두 시즌 키워드 포함하는 경우
    // 9월 17일: 추석 활성 (leadDays 30 → 9/17 기준 9월 17일 당일)
    const result = getSeasonBonus('추석 선물세트 난로 방한용', new Date(2026, 8, 17));
    // 추석 활성, 겨울캠핑은 9월이 months 목록에 없으므로 비활성
    expect(result.bonus).toBe(10); // 추석만 활성
  });

  it('bonus가 가장 높은 시즌 값을 반환', () => {
    // 추석(10) 활성 + 블랙프라이데이(7) 동시 활성 → 10 반환
    // 9월 17일은 추석 leadDays 범위, 블랙프라이데이는 11월 24일 기준이므로 비활성
    const result = getSeasonBonus('추석 선물세트 블랙프라이데이', new Date(2026, 8, 10));
    expect(result.bonus).toBe(10);
  });
});

describe('getSeasonBonus — 비매칭', () => {
  it('키워드 미매칭: bonus 0, activeNow false', () => {
    const result = getSeasonBonus('스테인리스 텀블러 500ml', new Date(2026, 2, 1));
    expect(result.bonus).toBe(0);
    expect(result.matchedSeasons).toHaveLength(0);
    expect(result.activeNow).toBe(false);
  });

  it('빈 문자열: bonus 0', () => {
    const result = getSeasonBonus('', new Date(2026, 11, 1));
    expect(result.bonus).toBe(0);
  });
});
