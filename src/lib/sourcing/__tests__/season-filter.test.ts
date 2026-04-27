import { describe, it, expect } from 'vitest';
import { checkSeasonLimited } from '../legal/season-filter';

describe('checkSeasonLimited — 시즌 한정 키워드 RED 차단', () => {
  it('"크리스마스 트리" → RED 차단', () => {
    const issue = checkSeasonLimited('크리스마스 트리 장식 세트');
    expect(issue?.severity).toBe('RED');
    expect(issue?.layer).toBe('season');
    expect(issue?.code).toBe('SEASON_LIMITED');
  });

  it('"설날 한복" → RED 차단', () => {
    const issue = checkSeasonLimited('설날 한복 아동용');
    expect(issue?.severity).toBe('RED');
  });

  it('"추석 송편" → RED 차단', () => {
    const issue = checkSeasonLimited('추석 송편 선물세트');
    expect(issue?.severity).toBe('RED');
  });

  it('"할로윈 코스튬" → RED 차단', () => {
    const issue = checkSeasonLimited('할로윈 코스튬 의상');
    expect(issue?.severity).toBe('RED');
  });

  it('일반 상품명 → null (차단 없음)', () => {
    expect(checkSeasonLimited('스테인리스 텀블러 500ml')).toBeNull();
  });

  it('대소문자/영문 키워드 매칭', () => {
    expect(checkSeasonLimited('Christmas ornament')?.severity).toBe('RED');
    expect(checkSeasonLimited('HALLOWEEN mask')?.severity).toBe('RED');
  });
});
