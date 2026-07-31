import { describe, it, expect } from 'vitest';
import { breakEvenPrice, marginOf, LOGISTICS_FEE, COMMISSION_RATE } from '@/lib/sourcing/coupang-price';
import type { LogisticsSize } from '@/types/shortlist';

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

describe('breakEvenPrice 보장', () => {
  // 손익분기가로 팔면 두 조건을 모두 만족해야 한다. 이게 이 함수의 존재 이유다.
  // 값 하나하나를 박는 대신 성질을 검증해, 공식을 잘못 고치면 여기서 걸리게 한다.
  const CASES: [number, LogisticsSize][] = [
    [2000, 'xsmall'], [2500, 'xsmall'], [3300, 'xsmall'], [4000, 'xsmall'], [8000, 'xsmall'],
    [3180, 'small'], [5000, 'small'],
    [3000, 'medium'], [7000, 'medium'],
  ];

  it.each(CASES)('실효원가 %i원 %s — 마진율 30%% 이상', (cost, size) => {
    const be = breakEvenPrice(cost, size);
    const margin = be * (1 - COMMISSION_RATE) - LOGISTICS_FEE[size] - cost;
    expect(margin / be).toBeGreaterThanOrEqual(0.3);
  });

  it.each(CASES)('실효원가 %i원 %s — 개당 마진이 물류비의 1.5배 이상', (cost, size) => {
    const be = breakEvenPrice(cost, size);
    const margin = be * (1 - COMMISSION_RATE) - LOGISTICS_FEE[size] - cost;
    expect(margin).toBeGreaterThanOrEqual(LOGISTICS_FEE[size] * 1.5);
  });
});
