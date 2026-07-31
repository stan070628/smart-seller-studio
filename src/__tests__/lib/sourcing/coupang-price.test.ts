import { describe, it, expect } from 'vitest';
import { breakEvenPrice, marginOf, LOGISTICS_FEE } from '@/lib/sourcing/coupang-price';

describe('LOGISTICS_FEE', () => {
  it('로켓그로스 요금표와 일치한다', () => {
    expect(LOGISTICS_FEE.xsmall).toBe(1725);
    expect(LOGISTICS_FEE.small).toBe(1900);
    expect(LOGISTICS_FEE.medium).toBe(2740);
  });
});

describe('breakEvenPrice', () => {
  it('극소형 실효원가 2,500원의 손익분기가는 7,638원', () => {
    expect(breakEvenPrice(2500, 'xsmall')).toBe(7638);
  });

  it('극소형 실효원가 3,300원의 손익분기가는 8,535원', () => {
    expect(breakEvenPrice(3300, 'xsmall')).toBe(8535);
  });

  it('극소형 실효원가 4,000원의 손익분기가는 9,671원', () => {
    expect(breakEvenPrice(4000, 'xsmall')).toBe(9671);
  });

  it('소형 실효원가 3,180원의 손익분기가는 8,891원', () => {
    expect(breakEvenPrice(3180, 'small')).toBe(8891);
  });

  it('사이즈가 커지면 손익분기가도 올라간다', () => {
    const cost = 3000;
    expect(breakEvenPrice(cost, 'xsmall')).toBeLessThan(breakEvenPrice(cost, 'small'));
    expect(breakEvenPrice(cost, 'small')).toBeLessThan(breakEvenPrice(cost, 'medium'));
  });
});

describe('marginOf', () => {
  it('메쉬 반장갑 — 실효원가 3,600원을 9,900원에 팔면 마진 3,506원', () => {
    expect(marginOf(9900, 3600, 'xsmall')).toBe(3506);
  });

  it('접이식 쓰레기통 — 실효원가 2,830원을 5,080원에 팔면 적자', () => {
    expect(marginOf(5080, 2830, 'xsmall')).toBeLessThan(0);
  });

  it('손익분기가에서는 마진이 0 이상이다', () => {
    const cost = 3300;
    const be = breakEvenPrice(cost, 'xsmall');
    expect(marginOf(be, cost, 'xsmall')).toBeGreaterThanOrEqual(0);
  });
});
