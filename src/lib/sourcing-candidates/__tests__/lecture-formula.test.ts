import { describe, it, expect } from 'vitest';
import { judgeLecture } from '@/lib/sourcing/lecture-formula';

describe('judgeLecture', () => {
  it('핸들 토시 #3: ¥9.20·14,390원 → 원가율 18.8%, 30% 통과·10% 미달', () => {
    const r = judgeLecture(9.2, 14390)!;
    expect(r.landed).toBeCloseTo(2704.8, 1);
    expect(r.costRatio).toBeCloseTo(0.188, 3);
    expect(r.pass).toBe(true);
    expect(r.best).toBe(false);
    expect(r.profit).toBeCloseTo(14390 * 0.9 - 2704.8, 1);
  });

  it('원가율 10% 이하면 best', () => {
    expect(judgeLecture(2.8, 8900)!.best).toBe(true); // 강의 실측 예시: 830원 착륙 / 8,900원
  });

  it('30% 초과는 탈락', () => {
    expect(judgeLecture(23.5, 10900)!.pass).toBe(false); // 8종 목록 #6 숄 케이프 63.4%
  });

  it('0 이하 입력은 null', () => {
    expect(judgeLecture(0, 10000)).toBeNull();
    expect(judgeLecture(5, 0)).toBeNull();
  });
});
