import { describe, it, expect } from 'vitest';
import { ListingIndex, normalizeOption, resolveLine, type ListingEntry } from '@/lib/erp/orders/resolve';
import type { OrderLine } from '@/lib/erp/orders/types';

const line = (o: Partial<OrderLine>): OrderLine => ({
  channel: 'coupang_wing', externalOrderId: '1', externalLineId: '1:70', orderedAt: '2026-09-27T01:00:00.000Z', paidAt: '2026-09-27T01:00:00.000Z',
  rawStatus: 'ACCEPT', status: 'paid', productId: '70', optionKey: '', altProductId: null, productLabel: 'x', qty: 2, unitPrice: 1000, amount: 2000, ...o,
});
const L = (o: Partial<ListingEntry>): ListingEntry => ({ listingId: 1, channel: 'coupang_wing', productId: '70', optionKey: '', linkMode: 'single', skus: [{ skuId: 7, multiplier: 1 }], ...o });

describe('resolveLine', () => {
  it('single: 수량 × 배수로 SKU 하나', () => {
    const idx = new ListingIndex([L({ skus: [{ skuId: 7, multiplier: 3 }] })]);
    expect(resolveLine(line({}), idx)).toEqual({
      listingId: 1, attribution: 'mapped', reason: null, alloc: [{ skuId: 7, qty: 6 }], listingSkus: [{ skuId: 7, multiplier: 3 }],
    });
  });

  it('bundle: 구성 SKU마다(SKU 오름차순) 수량 × 각 배수', () => {
    const idx = new ListingIndex([L({ linkMode: 'bundle', skus: [{ skuId: 9, multiplier: 2 }, { skuId: 4, multiplier: 1 }] })]);
    expect(resolveLine(line({ qty: 3 }), idx).alloc).toEqual([{ skuId: 4, qty: 3 }, { skuId: 9, qty: 6 }]);
  });

  it('any_of(또는 SKU 여럿인 single)는 미귀속 any_of — 판매 SKU를 가를 수 없다', () => {
    const two = [{ skuId: 4, multiplier: 1 }, { skuId: 9, multiplier: 1 }];
    expect(resolveLine(line({}), new ListingIndex([L({ linkMode: 'any_of', skus: two })]))).toMatchObject({ attribution: 'unattributed', reason: 'any_of', alloc: [], listingId: 1 });
    expect(resolveLine(line({}), new ListingIndex([L({ linkMode: 'single', skus: two })])).reason).toBe('any_of');
  });

  it('리스팅이 없으면 no_listing, SKU 연결이 없으면 no_sku_link', () => {
    expect(resolveLine(line({ productId: '99' }), new ListingIndex([L({})])).reason).toBe('no_listing');
    expect(resolveLine(line({ productId: '' }), new ListingIndex([L({})])).reason).toBe('no_listing');
    expect(resolveLine(line({}), new ListingIndex([L({ skus: [] })])).reason).toBe('no_sku_link');
  });

  it('채널이 다르면 같은 상품 키라도 찾지 않는다(Wing vid ≠ RG vid)', () => {
    expect(resolveLine(line({ channel: 'coupang_rg' }), new ListingIndex([L({})])).reason).toBe('no_listing');
  });

  it('네이버: (원상품번호, itemNo) → 없으면 그 상품의 옵션 없는(\'\') 리스팅 → 아니면 option_unmatched', () => {
    const idx = new ListingIndex([
      L({ listingId: 10, channel: 'naver', productId: '500', optionKey: '111', skus: [{ skuId: 1, multiplier: 1 }] }),
      L({ listingId: 11, channel: 'naver', productId: '500', optionKey: '112', skus: [{ skuId: 2, multiplier: 1 }] }),
      L({ listingId: 12, channel: 'naver', productId: '600', optionKey: '', skus: [{ skuId: 3, multiplier: 2 }] }),
    ]);
    const nv = (productId: string, optionKey: string) => line({ channel: 'naver', productId, optionKey, qty: 1 });
    expect(resolveLine(nv('500', '112'), idx)).toMatchObject({ listingId: 11, alloc: [{ skuId: 2, qty: 1 }] });
    expect(resolveLine(nv('600', ''), idx)).toMatchObject({ listingId: 12, alloc: [{ skuId: 3, qty: 2 }] });
    expect(resolveLine(nv('600', '999'), idx)).toMatchObject({ listingId: 12 });
    expect(resolveLine(nv('500', '999'), idx).reason).toBe('option_unmatched');
  });

  it('토스: 정확 일치 → 옵션명 정규화 일치 → option_unmatched', () => {
    const idx = new ListingIndex([
      L({ listingId: 20, channel: 'toss', productId: '800', optionKey: '블랙 / L', skus: [{ skuId: 5, multiplier: 1 }] }),
      L({ listingId: 21, channel: 'toss', productId: '800', optionKey: '화이트 / L', skus: [{ skuId: 6, multiplier: 1 }] }),
    ]);
    const tv = (optionKey: string) => line({ channel: 'toss', productId: '800', optionKey, qty: 1 });
    expect(resolveLine(tv('블랙 / L'), idx).listingId).toBe(20);
    expect(resolveLine(tv('색상: 화이트 / 사이즈: L'), idx).listingId).toBe(21);
    expect(resolveLine(tv('화이트/L'), idx).listingId).toBe(21);
    expect(resolveLine(tv('그레이 / L'), idx).reason).toBe('option_unmatched');
  });

  it('옵션 키가 다른 유일한 리스팅은 고르지 않는다(모르는 옵션은 미귀속) — 네이버·토스', () => {
    const nIdx = new ListingIndex([L({ listingId: 30, channel: 'naver', productId: '700', optionKey: '111', skus: [{ skuId: 1, multiplier: 1 }] })]);
    expect(resolveLine(line({ channel: 'naver', productId: '700', optionKey: '222' }), nIdx))
      .toMatchObject({ attribution: 'unattributed', reason: 'option_unmatched', alloc: [], listingId: null });
    const tIdx = new ListingIndex([L({ listingId: 31, channel: 'toss', productId: '900', optionKey: '블랙 / L', skus: [{ skuId: 2, multiplier: 1 }] })]);
    expect(resolveLine(line({ channel: 'toss', productId: '900', optionKey: '화이트 / M' }), tIdx))
      .toMatchObject({ attribution: 'unattributed', reason: 'option_unmatched', alloc: [], listingId: null });
  });

  it('주문 옵션 키가 비었으면 그 상품의 유일한 리스팅을 쓴다(둘 이상이면 option_unmatched)', () => {
    const one = new ListingIndex([L({ listingId: 32, channel: 'toss', productId: '901', optionKey: '단일', skus: [{ skuId: 3, multiplier: 1 }] })]);
    expect(resolveLine(line({ channel: 'toss', productId: '901', optionKey: '' }), one)).toMatchObject({ listingId: 32, attribution: 'mapped' });
    const two = new ListingIndex([
      L({ listingId: 33, channel: 'naver', productId: '702', optionKey: '1', skus: [{ skuId: 4, multiplier: 1 }] }),
      L({ listingId: 34, channel: 'naver', productId: '702', optionKey: '2', skus: [{ skuId: 5, multiplier: 1 }] }),
    ]);
    expect(resolveLine(line({ channel: 'naver', productId: '702', optionKey: '' }), two).reason).toBe('option_unmatched');
  });

  it('옵션이 안 맞아도 그 상품에 옵션 없는(\'\') 리스팅이 있으면 그것(단일상품)', () => {
    const idx = new ListingIndex([
      L({ listingId: 35, channel: 'naver', productId: '703', optionKey: '', skus: [{ skuId: 6, multiplier: 1 }] }),
      L({ listingId: 36, channel: 'naver', productId: '703', optionKey: '9', skus: [{ skuId: 8, multiplier: 1 }] }),
    ]);
    expect(resolveLine(line({ channel: 'naver', productId: '703', optionKey: '5' }), idx).listingId).toBe(35);
  });

  it('옵션명 정규화: 칸마다 「이름:」 접두와 공백을 뗀다', () => {
    expect(normalizeOption('색상: 블랙 / 사이즈: 105(L)')).toBe('블랙/105(L)');
    expect(normalizeOption('블랙 / 105(L)')).toBe('블랙/105(L)');
    expect(normalizeOption('')).toBe('');
  });
});
