import { describe, it, expect } from 'vitest';
import { determineWinnerStatus } from '@/lib/roi/calculations';

describe('determineWinnerStatus', () => {
  it('판매수량 ≥ 5 이고 광고가 없으면 winner', () => {
    expect(determineWinnerStatus(5, 0, 300)).toBe('winner');
  });
  it('판매수량 ≥ 5 이고 ROAS ≥ 손익분기면 winner', () => {
    expect(determineWinnerStatus(10, 350, 300)).toBe('winner');
  });
  it('판매수량 ≥ 5 이지만 ROAS < 손익분기면 watch', () => {
    expect(determineWinnerStatus(10, 200, 300)).toBe('watch');
  });
  it('판매수량 적어도(1+) 광고 효율이 손익분기 이상이면 watch', () => {
    expect(determineWinnerStatus(2, 350, 300)).toBe('watch');
  });
  it('판매수량 4 이하이고 광고도 없으면 normal', () => {
    expect(determineWinnerStatus(4, 0, 300)).toBe('normal');
  });
  it('판매수량 0이면 normal', () => {
    expect(determineWinnerStatus(0, 500, 300)).toBe('normal');
  });
});
