import { describe, it, expect } from 'vitest';
import { splitSum, toSkuSplits, type LineSkuOptions } from '@/components/receipt/sku-split';

const c = (skuId: number, option: string) => ({ skuId, key: `k${skuId}`, name: '라운드티', option });

describe('toSkuSplits', () => {
  const options: Record<number, LineSkuOptions> = {
    1: { source: 'learned', candidates: [c(11, '블랙')], expectedQty: { qty: 2, approx: false } },
    2: { source: 'product', candidates: [c(21, 'S'), c(22, 'L')], expectedQty: { qty: 3, approx: false } },
    3: { source: 'none', candidates: [], expectedQty: { qty: 1, approx: false } },
    4: { source: 'none', candidates: [], expectedQty: null },
  };

  it('후보 1개는 생략(서버 자동) · 여럿은 옵션별 수량 · 고른 SKU 1개는 전부(null) · 고르지 않았으면 생략', () => {
    expect(toSkuSplits(options, {
      2: { picked: [], qty: { 21: '2', 22: '1' } },
      3: { picked: [c(31, '')], qty: {} },
    })).toEqual({
      2: [{ sku_id: 21, qty: 2 }, { sku_id: 22, qty: 1 }],
      3: [{ sku_id: 31, qty: null }],
    });
  });

  it('고른 SKU가 여럿이면 옵션별 수량', () => {
    expect(toSkuSplits({ 3: options[3] }, { 3: { picked: [c(31, 'S'), c(32, 'L')], qty: { 31: '1' } } }))
      .toEqual({ 3: [{ sku_id: 31, qty: 1 }, { sku_id: 32, qty: 0 }] });
  });

  it('나눈 합', () => {
    expect(splitSum([c(21, 'S'), c(22, 'L')], { picked: [], qty: { 21: '2', 22: 'x' } })).toBe(2);
  });
});
