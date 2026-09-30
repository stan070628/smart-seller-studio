import { describe, it, expect } from 'vitest';
import { effectiveCostOf, sourcingFloorPrice, judgeReal, REAL_FX_KRW_PER_CNY } from '@/lib/sourcing-candidates/judge';

describe('judge', () => {
  it('환율은 1688 실결제 역산값 217', () => {
    expect(REAL_FX_KRW_PER_CNY).toBe(217);
  });

  it('¥5·소형 실효원가 2,861원 → 하한선 12,097원', () => {
    expect(effectiveCostOf(5, 'small', null)).toBe(2861);
    expect(sourcingFloorPrice('small')).toBe(12097);
  });

  it('핸들 토시 #3 실측: 실효원가 3,944원, 마진 4,533원, 불통과', () => {
    const r = judgeReal(9.2, 14390, 'small', '가죽 핸들 토시')!;
    expect(r.effectiveCost).toBe(3944);
    expect(r.margin).toBe(4533);
    expect(r.passRate).toBe(true);
    expect(r.passAmount).toBe(false);
    expect(r.pass).toBe(false);
  });

  it('0 이하 입력은 null', () => {
    expect(judgeReal(0, 14390, 'small', null)).toBeNull();
  });
});
