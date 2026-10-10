// src/__tests__/lib/erp/sku/coupang-input.test.ts
import { describe, it, expect } from 'vitest';
import { toCoupangProduct, vidsOf } from '@/lib/erp/sku/coupang-input';

describe('toCoupangProduct', () => {
  it('Wing vid는 최상위 → marketplaceItemData 순, RG vid는 rocketGrowthItemData', () => {
    const p = toCoupangProduct({
      sellerProductId: '16404126884',
      sellerProductName: '펜들턴 셔파 담요',
      items: [
        { itemName: '화이트', vendorItemId: 11, rocketGrowthItemData: { vendorItemId: 21 } },
        { itemName: '사바나', marketplaceItemData: { vendorItemId: 12 } },
        { itemName: 'RG만', rocketGrowthItemData: { vendorItemId: 23 } },
      ],
    });
    expect(p.sellerProductId).toBe(16404126884);
    expect(p.productName).toBe('펜들턴 셔파 담요');
    expect(p.items.map((i) => [i.itemName, i.wingVid, i.rgVid])).toEqual([
      ['화이트', 11, 21],
      ['사바나', 12, null],
      ['RG만', null, 23],
    ]);
    expect(vidsOf(p)).toEqual([11, 21, 12, 23]);
  });

  it('값이 빈 속성은 버리고 exposed는 있을 때만 남긴다', () => {
    const p = toCoupangProduct({
      sellerProductId: 1,
      sellerProductName: 'x',
      items: [{
        itemName: '블랙 1개',
        vendorItemId: 5,
        attributes: [
          { attributeTypeName: '색상', attributeValueName: '블랙', exposed: 'EXPOSED' },
          { attributeTypeName: '수량', attributeValueName: ' ' },
          { attributeTypeName: '모델명', attributeValueName: 'A-1' },
        ],
      }],
    });
    expect(p.items[0].attributes).toEqual([
      { attributeTypeName: '색상', attributeValueName: '블랙', exposed: 'EXPOSED' },
      { attributeTypeName: '모델명', attributeValueName: 'A-1' },
    ]);
  });

  it('items·itemName이 없으면 빈 값', () => {
    expect(toCoupangProduct({ sellerProductId: 2, sellerProductName: 'y' }).items).toEqual([]);
    const p = toCoupangProduct({ sellerProductId: 3, sellerProductName: 'z', items: [{ vendorItemId: 7 }] });
    expect(p.items[0]).toEqual({ itemName: '', attributes: [], wingVid: 7, rgVid: null });
    expect(vidsOf(p)).toEqual([7]);
  });
});
