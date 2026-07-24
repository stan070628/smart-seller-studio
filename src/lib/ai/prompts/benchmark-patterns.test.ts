import { describe, it, expect } from 'vitest';
import { BENCHMARK_PATTERNS } from './benchmark-patterns';

describe('BENCHMARK_PATTERNS 다이제스트', () => {
  it('비어있지 않은 문자열이다', () => {
    expect(typeof BENCHMARK_PATTERNS).toBe('string');
    expect(BENCHMARK_PATTERNS.length).toBeGreaterThan(50);
  });

  it('강제 규칙이 아닌 참고용으로 프레이밍한다', () => {
    expect(BENCHMARK_PATTERNS).toMatch(/Reference only|NOT mandates|강제/i);
  });

  it('카테고리 태그로 타 카테고리 오염을 막는다', () => {
    expect(BENCHMARK_PATTERNS).toContain('[침구/홈리빙]');
  });

  it('금지된 카피 클리셰를 몰래 넣지 않는다', () => {
    for (const banned of ['특별한 일상', '지금 만나보세요', '당신의 모든 순간']) {
      expect(BENCHMARK_PATTERNS).not.toContain(banned);
    }
  });
});
