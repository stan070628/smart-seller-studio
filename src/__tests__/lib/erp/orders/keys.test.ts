import { describe, it, expect } from 'vitest';
import { LEGACY_CHANNEL, SHIPPING_SOURCE, assertExternalId, bareWingKey, legacyKeyOf, saleIdemKey } from '@/lib/erp/orders/keys';
import { CHANNEL_LABEL, locationOf } from '@/lib/erp/orders/types';
import { resolveSaleShippingFee } from '@/lib/cost-management/sale-shipping';
import { assertIdemKey } from '@/lib/erp/ledger/plan';

describe('판매 멱등키', () => {
  it('sale:<channel>:<lineKey>:s<skuId>, 두 번째부터 @n — assertIdemKey를 통과한다', () => {
    const k1 = saleIdemKey('coupang_wing', '6200000001:70000000001', 7, 1);
    expect(k1).toBe('sale:coupang_wing:6200000001:70000000001:s7');
    expect(saleIdemKey('naver', '2026092611111111', 12, 2)).toBe('sale:naver:2026092611111111:s12@2');
    expect(() => assertIdemKey(k1)).not.toThrow();
    expect(() => assertIdemKey(saleIdemKey('toss', '9001', 3, 3))).not.toThrow();
  });

  it('SKU가 다르면 키가 다르고, 한 키가 다른 키의 # 접두가 되지 않는다', () => {
    const a = saleIdemKey('toss', '9001', 7, 1);
    const b = saleIdemKey('toss', '9001', 71, 1);
    expect(a).not.toBe(b);
    expect(b.startsWith(`${a}#`)).toBe(false);
    expect(saleIdemKey('toss', '9001', 7, 2).startsWith(`${a}#`)).toBe(false);
  });

  it('라인 키에 #·@·공백·빈 값은 거부한다', () => {
    expect(() => saleIdemKey('naver', 'a#1', 1, 1)).toThrow(RangeError);
    expect(() => saleIdemKey('naver', 'a@1', 1, 1)).toThrow(RangeError);
    expect(() => saleIdemKey('naver', 'a 1', 1, 1)).toThrow(RangeError);
    expect(() => assertExternalId('', '주문번호')).toThrow(RangeError);
    expect(() => saleIdemKey('naver', '1', 0, 1)).toThrow(RangeError);
    expect(() => saleIdemKey('naver', '1', 1, 0)).toThrow(RangeError);
  });
});

describe('옛 장부 키', () => {
  it('채널별로 옛 불러오기와 같은 키를 쓴다', () => {
    expect(legacyKeyOf({ channel: 'coupang_wing', externalOrderId: '31000000001', externalLineId: '6200000001:70000000001', productId: '70000000001' }))
      .toBe('wing-31000000001-70000000001');
    expect(legacyKeyOf({ channel: 'coupang_rg', externalOrderId: '41000000001', externalLineId: '41000000001:80000000001', productId: '80000000001' }))
      .toBe('rg-41000000001-80000000001');
    expect(legacyKeyOf({ channel: 'naver', externalOrderId: 'o1', externalLineId: '2026092611111111', productId: '1' })).toBe('naver-2026092611111111');
    expect(legacyKeyOf({ channel: 'toss', externalOrderId: '1', externalLineId: '9001', productId: '1' })).toBe('toss-9001');
  });

  it('Wing 키의 무접두 짝(상품별 불러오기가 남긴 키)', () => {
    expect(bareWingKey('wing-31000000001-70000000001')).toBe('31000000001-70000000001');
    expect(bareWingKey('rg-1-2')).toBeNull();
  });
});

describe('(1-C2b ③) 당근', () => {
  it('옛 장부 키 karrot-<줄키> · 채널 karrot · 배송비 0 · 판매 멱등키', () => {
    const id = '3f2b8c1e-8d4a-4b8e-9c1a-2b3c4d5e6f70';
    expect(legacyKeyOf({ channel: 'karrot', externalOrderId: `karrot-${id}`, externalLineId: id, productId: '' })).toBe(`karrot-${id}`);
    expect(LEGACY_CHANNEL.karrot).toBe('karrot');
    expect(SHIPPING_SOURCE.karrot).toBe('karrot');
    expect(resolveSaleShippingFee('karrot')).toBe(0);
    expect(saleIdemKey('karrot', id, 72, 1)).toBe(`sale:karrot:${id}:s72`);
    expect(locationOf('karrot')).toBe('self');
    expect(CHANNEL_LABEL.karrot).toBe('당근');
  });
});
