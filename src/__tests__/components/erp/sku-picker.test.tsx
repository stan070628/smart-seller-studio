import { describe, it, expect } from 'vitest';
import { matchSkus } from '@/components/erp/stock/SkuPicker';

const row = (skuId: number, name: string, option: string, key = `k${skuId}`) =>
  ({ skuId, key, name, option, legacyProductCostIds: [], self: 0, rgInbound: 0, rg: 0, value: 0, hasLedger: false, hasSelfLedger: false, lotCost: null, legacyCost: null, costNeedsInput: false, selfValue: 0, lastCountedAt: null });

describe('matchSkus', () => {
  it('상품명·옵션·키를 공백으로 나눈 모든 낱말이 들어간 SKU만, 최대 30건', () => {
    const rows = [row(72, '극세사 타월', '블루'), row(73, '극세사 타월', '옐로우'), row(9, '펫 쿨매트', '핑크 L')];
    expect(matchSkus(rows, '타월 옐로').map((r) => r.skuId)).toEqual([73]);
    expect(matchSkus(rows, '').map((r) => r.skuId)).toEqual([]);
    expect(matchSkus(Array.from({ length: 40 }, (_, i) => row(i + 1, '타월', `${i}`)), '타월')).toHaveLength(30);
  });
});
