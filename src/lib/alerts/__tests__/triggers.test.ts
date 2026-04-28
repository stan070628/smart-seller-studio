import { describe, it, expect } from 'vitest';
import { detectRoasLow, detectStockLow, detectNegativeReview } from '../triggers';

describe('detectRoasLow', () => {
  it('ROAS 150% → 알림 생성 (high)', () => {
    const alert = detectRoasLow({ skuCode: 'A1', roasPct: 150, productName: 'X' });
    expect(alert?.type).toBe('roas_low');
    expect(alert?.severity).toBe('high');
  });
  it('ROAS 250% → null', () => {
    expect(detectRoasLow({ skuCode: 'A1', roasPct: 250, productName: 'X' })).toBeNull();
  });
});

describe('detectStockLow', () => {
  it('재고 5일분 → critical', () => {
    const alert = detectStockLow({
      skuCode: 'A1', productName: 'X', stockDays: 5, currentStock: 10, dailySales: 2,
    });
    expect(alert?.severity).toBe('critical');
  });
  it('재고 25일분 → medium', () => {
    const alert = detectStockLow({
      skuCode: 'A1', productName: 'X', stockDays: 25, currentStock: 50, dailySales: 2,
    });
    expect(alert?.severity).toBe('medium');
  });
  it('재고 35일분 → null', () => {
    expect(detectStockLow({
      skuCode: 'A1', productName: 'X', stockDays: 35, currentStock: 70, dailySales: 2,
    })).toBeNull();
  });
});

describe('detectNegativeReview', () => {
  it('별점 3.0 → critical', () => {
    expect(detectNegativeReview({
      skuCode: 'A1', productName: 'X', stars: 3.0, reviewText: '나쁨',
    })?.severity).toBe('critical');
  });
  it('별점 4.5 → null', () => {
    expect(detectNegativeReview({
      skuCode: 'A1', productName: 'X', stars: 4.5, reviewText: '좋음',
    })).toBeNull();
  });
});
