import { describe, it, expect } from 'vitest';
import { naverDisplayAfterStocks } from '../channels';

describe('naverDisplayAfterStocks — 품절 상품은 스토어에서 조회되지 않게', () => {
  it('재고 합이 0이 되면 전시를 끈다', () => {
    expect(naverDisplayAfterStocks(5, 0, 'ON')).toBe('SUSPENSION');
  });
  it('이미 꺼져 있으면 다시 보내지 않는다', () => {
    expect(naverDisplayAfterStocks(0, 0, 'SUSPENSION')).toBeNull();
  });
  it('0에서 되살아나면 꺼둔 전시를 켠다', () => {
    expect(naverDisplayAfterStocks(0, 7, 'SUSPENSION')).toBe('ON');
  });
  it('재고가 남아 있던 상품의 수동 숨김은 건드리지 않는다 — 옵션 하나만 되살아나도 이전 합이 0이 아니면 그대로', () => {
    expect(naverDisplayAfterStocks(3, 10, 'SUSPENSION')).toBeNull();
  });
  it('재고가 있고 이미 켜져 있으면 변경 없음', () => {
    expect(naverDisplayAfterStocks(2, 5, 'ON')).toBeNull();
  });
  it('전시 필드를 모르면 재고 0에도 SUSPENSION을 보낸다 (ON 가정)', () => {
    expect(naverDisplayAfterStocks(1, 0, undefined)).toBe('SUSPENSION');
  });
});
