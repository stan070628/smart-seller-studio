import { describe, it, expect } from 'vitest';
import { generateRecommendation } from '../recommend-batch';

describe('generateRecommendation', () => {
  it('월 30+ 판매 + 사입 마진 4000 + 위탁 1500 → buy', () => {
    const r = generateRecommendation({
      skuCode: 'A1', productName: 'X',
      wholesaleMarginPerUnitKrw: 1500,
      buyMarginPerUnitKrw: 4000,
      monthlySalesQty: 30,
      buyCapitalNeededKrw: 600000,
    });
    expect(r.recommendation).toBe('buy');
  });

  it('월 0건 → insufficient_data', () => {
    const r = generateRecommendation({
      skuCode: 'A1', productName: 'X',
      wholesaleMarginPerUnitKrw: 1000, buyMarginPerUnitKrw: 3000,
      monthlySalesQty: 0, buyCapitalNeededKrw: 500000,
    });
    expect(r.recommendation).toBe('insufficient_data');
  });
});
