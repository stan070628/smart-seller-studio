// src/lib/roi/calculations.test.ts
import { describe, it, expect } from 'vitest';
import {
  calcMargin,
  calcBreakevenRoas,
  calcAdjustedRoas,
  isWinner,
  calcStockTurnover,
  calcRequiredRevenue,
} from './calculations';

describe('calcMargin', () => {
  it('마진액 = 판매가 - 원가 - 수수료 - 배송비', () => {
    expect(calcMargin(9900, 4200, 0.10, 2500)).toBe(2210);
  });
  it('수수료율 0이면 배송비만 차감', () => {
    expect(calcMargin(10000, 3000, 0, 0)).toBe(7000);
  });
});

describe('calcBreakevenRoas', () => {
  it('간이과세자: (판매가 / 마진액) * 100', () => {
    expect(calcBreakevenRoas(9900, 2210)).toBeCloseTo(448, 0);
  });
  it('마진액 0이면 Infinity 반환', () => {
    expect(calcBreakevenRoas(9900, 0)).toBe(Infinity);
  });
});

describe('calcAdjustedRoas', () => {
  it('보정 ROAS = (attributed_sales - cancelled) / adSpend * 100', () => {
    expect(calcAdjustedRoas(500000, 50000, 100000)).toBe(450);
  });
  it('광고비 0이면 Infinity', () => {
    expect(calcAdjustedRoas(500000, 50000, 0)).toBe(Infinity);
  });
});

describe('isWinner', () => {
  it('4개 모두 충족하면 winner', () => {
    expect(isWinner(150, 2.0, 300, 10)).toBe('winner');
  });
  it('3개 충족하면 watch', () => {
    expect(isWinner(80, 2.0, 300, 10)).toBe('watch');
  });
  it('2개 이하면 normal', () => {
    expect(isWinner(50, 1.0, 200, 3)).toBe('normal');
  });
  it('경계값: 정확히 기준값이면 충족', () => {
    expect(isWinner(100, 1.5, 250, 5)).toBe('winner');
  });
  it('2개 충족하면 normal', () => {
    // clicks❌(50<100), conversionRate❌(1.0<1.5), roas✅(300≥250), salesCount✅(10≥5) → 2개 충족
    expect(isWinner(50, 1.0, 300, 10)).toBe('normal');
  });
});

describe('calcStockTurnover', () => {
  it('7일 미만이면 danger', () => {
    const result = calcStockTurnover(5, 1);
    expect(result).toEqual({ days: 5, status: 'danger' });
  });
  it('7~14일이면 warning', () => {
    const result = calcStockTurnover(10, 1);
    expect(result).toEqual({ days: 10, status: 'warning' });
  });
  it('15일 이상이면 ok', () => {
    const result = calcStockTurnover(30, 1);
    expect(result).toEqual({ days: 30, status: 'ok' });
  });
  it('일평균 0이면 days Infinity, status ok', () => {
    const result = calcStockTurnover(100, 0);
    expect(result.status).toBe('ok');
    expect(result.days).toBe(Infinity);
  });
});

describe('calcRequiredRevenue', () => {
  it('500만원 / 0.3 = 16,666,667', () => {
    expect(Math.round(calcRequiredRevenue(5000000, 0.3))).toBe(16666667);
  });
  it('마진율 0이면 Infinity', () => {
    expect(calcRequiredRevenue(5000000, 0)).toBe(Infinity);
  });
});
