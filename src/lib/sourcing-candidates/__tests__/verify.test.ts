import { describe, it, expect } from 'vitest';
import { checkListingNumbers, checkTiers } from '@/lib/sourcing-candidates/verify';

describe('checkListingNumbers', () => {
  it('정가 15,200 · 판매가 12,200 · 표시 19% → 통과 (계산 20%, ±1%p)', () => {
    expect(checkListingNumbers({ price: 12200, list_price: 15200, discount_pct: 19 })).toBeNull();
  });
  it('표시 50%면 의심', () => {
    expect(checkListingNumbers({ price: 12200, list_price: 15200, discount_pct: 50 })).toMatch(/할인율/);
  });
  it('판매가가 정가보다 크면 의심', () => {
    expect(checkListingNumbers({ price: 16000, list_price: 15200, discount_pct: null })).toMatch(/정가/);
  });
  it('정가가 없으면 검사하지 않는다', () => {
    expect(checkListingNumbers({ price: 3900, list_price: null, discount_pct: null })).toBeNull();
  });
});

describe('checkTiers', () => {
  it('수량이 늘수록 싸지면 통과', () => {
    expect(checkTiers([{ min_qty: 2, cny: 9.2 }, { min_qty: 100, cny: 8.5 }])).toBeNull();
  });
  it('순서가 섞여 들어와도 수량으로 정렬해 본다', () => {
    expect(checkTiers([{ min_qty: 100, cny: 8.5 }, { min_qty: 2, cny: 9.2 }])).toBeNull();
  });
  it('수량이 늘었는데 비싸지면 의심', () => {
    expect(checkTiers([{ min_qty: 2, cny: 8.5 }, { min_qty: 100, cny: 9.2 }])).toMatch(/구간가/);
  });
});
