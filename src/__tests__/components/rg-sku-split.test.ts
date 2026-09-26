import { describe, it, expect } from 'vitest';
import { buildSkuItems, skusForProduct, type SkuOption } from '@/components/orders/rg-sku-split';

const skus: SkuOption[] = [
  { skuId: 7, key: 'cp:1:단일', name: '매트', option: '', self: 10, hasSelfLedger: true, legacyProductCostIds: ['pc-a'] },
  { skuId: 8, key: 'cp:2:블랙', name: '왜건', option: '블랙', self: 5, hasSelfLedger: true, legacyProductCostIds: ['pc-b'] },
  { skuId: 9, key: 'cp:2:레드', name: '왜건', option: '레드', self: 0, hasSelfLedger: false, legacyProductCostIds: ['pc-b'] },
];

describe('rg-sku-split', () => {
  it('옛 원가 상품에 연결된 SKU', () => {
    expect(skusForProduct('pc-b', skus).map((s) => s.skuId)).toEqual([8, 9]);
    expect(skusForProduct('pc-z', skus)).toEqual([]);
  });

  it('self 원장 없는 SKU도 hasSelfLedger:false 그대로 넘어온다(화면이 "원장 없음" 표시에 쓴다)', () => {
    const linked = skusForProduct('pc-b', skus);
    expect(linked.map((s) => [s.skuId, s.hasSelfLedger])).toEqual([[8, true], [9, false]]);
  });

  it('SKU가 하나면 보낼 수량 전부, 여럿이면 입력값, 연결 없으면 뺀다', () => {
    const r = buildSkuItems([{ id: 'pc-a', qty: 4 }, { id: 'pc-b', qty: 3 }, { id: 'pc-z', qty: 2 }], skus, { 8: '2', 9: '1' });
    expect(r.items).toEqual([{ sku_id: 7, quantity: 4 }, { sku_id: 8, quantity: 2 }, { sku_id: 9, quantity: 1 }]);
    expect(r.mismatched).toEqual([]);
  });

  it('여러 옵션의 합이 보낼 수량과 다르면 알린다', () => {
    const r = buildSkuItems([{ id: 'pc-b', qty: 3 }], skus, { 8: '1' });
    expect(r.items).toEqual([{ sku_id: 8, quantity: 1 }]);
    expect(r.mismatched).toEqual([{ productId: 'pc-b', productQty: 3, skuSum: 1 }]);
  });
});
