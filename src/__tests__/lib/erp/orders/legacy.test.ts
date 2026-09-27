import { describe, it, expect } from 'vitest';
import { pickLegacy, planLegacy, type LegacyIndex, type LegacyLine } from '@/lib/erp/orders/legacy';
import type { Resolution } from '@/lib/erp/orders/resolve';
import type { OrderLine } from '@/lib/erp/orders/types';

const PC_A = '00000000-0000-4000-8000-00000000000a';
const PC_B = '00000000-0000-4000-8000-00000000000b';
const PC_C = '00000000-0000-4000-8000-00000000000c';
const idx = (o: Partial<LegacyIndex> = {}): LegacyIndex => ({
  skuLegacy: new Map([[7, [PC_A, PC_B]], [9, [PC_C]]]),
  pcc: new Map([['coupang_wing:70', [{ productCostId: PC_B, multiplier: 2 }]]]),
  pcByVendorItem: new Map(),
  pcByNaverChannelNo: new Map([['555', PC_C]]),
  ...o,
});
const line = (o: Partial<OrderLine>): OrderLine => ({
  channel: 'coupang_wing', externalOrderId: '1', externalLineId: '1:70', orderedAt: '2026-09-27T01:00:00.000Z', paidAt: '2026-09-27T01:00:00.000Z',
  rawStatus: 'ACCEPT', status: 'paid', productId: '70', optionKey: '', altProductId: null, productLabel: 'x', qty: 2, unitPrice: 1000, amount: 2000, ...o,
});
const mapped = (alloc: { skuId: number; qty: number }[], listingSkus = alloc.map((a) => ({ skuId: a.skuId, multiplier: 1 }))): Resolution =>
  ({ listingId: 1, attribution: 'mapped', reason: null, alloc, listingSkus });
const none: Resolution = { listingId: null, attribution: 'unattributed', reason: 'no_listing', alloc: [], listingSkus: [] };

describe('pickLegacy', () => {
  it('SKU의 옛 상품 중 리스팅과 맞는 것(쿠팡 product_cost_channels)을 고르고 수량은 SKU 수량', () => {
    expect(pickLegacy(line({}), mapped([{ skuId: 7, qty: 4 }]), idx())).toEqual({ productCostId: PC_B, qty: 4 });
  });

  it('리스팅과 맞는 옛 상품(pcc)이면 수량 = 주문 수량 × pcc 배수(옛 불러오기와 같다) — SKU 배수와 달라도', () => {
    // SKU 배수 3(alloc 6) · pcc 배수 2 → 옛 장부 수량 4
    expect(pickLegacy(line({}), mapped([{ skuId: 7, qty: 6 }], [{ skuId: 7, multiplier: 3 }]), idx())).toEqual({ productCostId: PC_B, qty: 4 });
    // pcc 배수 0 이하 → 1
    const zero = idx({ pcc: new Map([['coupang_wing:70', [{ productCostId: PC_B, multiplier: 0 }]]]) });
    expect(pickLegacy(line({}), mapped([{ skuId: 7, qty: 6 }], [{ skuId: 7, multiplier: 3 }]), zero)).toEqual({ productCostId: PC_B, qty: 2 });
  });

  it('네이버 채널상품번호로 맞으면 주문 수량 그대로(SKU 배수를 곱하지 않는다)', () => {
    const r = mapped([{ skuId: 9, qty: 2 }], [{ skuId: 9, multiplier: 2 }]);
    expect(pickLegacy(line({ channel: 'naver', productId: '500', altProductId: '555', qty: 1 }), r, idx())).toEqual({ productCostId: PC_C, qty: 1 });
  });

  it('맞는 것이 없으면 SKU의 첫 옛 상품', () => {
    expect(pickLegacy(line({ productId: '71' }), mapped([{ skuId: 7, qty: 2 }]), idx())).toEqual({ productCostId: PC_A, qty: 2 });
  });

  it('미귀속(any_of)이면 리스팅 SKU들로 고르고 수량 = 주문 수량 × 가장 작은 배수', () => {
    const r: Resolution = { listingId: 3, attribution: 'unattributed', reason: 'any_of', alloc: [], listingSkus: [{ skuId: 9, multiplier: 2 }, { skuId: 7, multiplier: 3 }] };
    expect(pickLegacy(line({ productId: '99' }), r, idx())).toEqual({ productCostId: PC_A, qty: 4 });
  });

  it('SKU가 없으면 옛 불러오기의 직접 매칭(쿠팡 pcc 배수) → RG vendor_item_id → 네이버 채널상품번호', () => {
    expect(pickLegacy(line({}), none, idx())).toEqual({ productCostId: PC_B, qty: 4 });
    expect(pickLegacy(line({ channel: 'coupang_rg', productId: '80' }), none, idx({ pcByVendorItem: new Map([['80', PC_A]]) })))
      .toEqual({ productCostId: PC_A, qty: 2 });
    expect(pickLegacy(line({ channel: 'naver', productId: '500', altProductId: '555', qty: 1 }), none, idx())).toEqual({ productCostId: PC_C, qty: 1 });
  });

  it('아무것도 없으면 null(옛 장부에 쓰지 않는다)', () => {
    expect(pickLegacy(line({ channel: 'toss', productId: '800' }), none, idx())).toBeNull();
  });
});

const L = (o: Partial<LegacyLine>): LegacyLine => ({
  legacyKey: 'wing-1-70', channel: 'coupang_wing', status: 'paid', orderQty: 1, legacyQty: 2, amount: 1000,
  paidAt: '2026-09-26T16:00:00.000Z', orderedAt: '2026-09-26T16:00:00.000Z', productCostId: PC_A, discount: null, ...o,
});

describe('planLegacy', () => {
  it('같은 키(분리배송 박스)는 합산, 판매일 = 결제 KST 날짜, 단가 = 금액 ÷ 주문 수량', () => {
    const p = planLegacy([L({}), L({ orderQty: 2, legacyQty: 4, amount: 2000 })]);
    expect(p).toEqual({
      upsert: [{ key: 'wing-1-70', productCostId: PC_A, channel: 'coupang', soldAt: '2026-09-27', quantity: 6, sellingPrice: 1000, saleAmount: 3000, shippingSource: 'wing', couponDiscount: null }],
      voidKeys: [],
      warnings: [],
    });
  });

  it('(1-C2b ②) 살아 있는 줄이 모두 할인을 알면 합계, 하나라도 모르면 null(기존 값 유지)', () => {
    expect(planLegacy([L({ discount: 840 }), L({ discount: 0 })]).upsert[0].couponDiscount).toBe(840);
    expect(planLegacy([L({ discount: 840 }), L({ discount: null })]).upsert[0].couponDiscount).toBeNull();
    // 취소 줄의 할인은 세지 않는다
    expect(planLegacy([L({ discount: 500 }), L({ status: 'canceled', discount: 300 })]).upsert[0].couponDiscount).toBe(500);
  });

  it('살아 있는 라인이 없고 무효 라인이 있으면 무효화, unknown만 있으면 건드리지 않는다', () => {
    expect(planLegacy([L({ status: 'canceled' })])).toEqual({ upsert: [], voidKeys: ['wing-1-70'], warnings: [] });
    expect(planLegacy([L({ status: 'unknown' })])).toEqual({ upsert: [], voidKeys: [], warnings: [] });
  });

  it('팔림인데 옛 상품을 못 고른 키는 쓰지도 무효화하지도 않고 경고로 돌려준다(기존 행 유지)', () => {
    expect(planLegacy([L({ productCostId: null, legacyQty: null })]))
      .toEqual({ upsert: [], voidKeys: [], warnings: [{ key: 'wing-1-70', reason: 'sold_without_product_cost' }] });
    // 같은 키에 무효 라인이 섞여 있어도 팔림 라인이 남아 있으면 무효화하지 않는다
    expect(planLegacy([L({ productCostId: null, legacyQty: null }), L({ status: 'canceled' })]))
      .toEqual({ upsert: [], voidKeys: [], warnings: [{ key: 'wing-1-70', reason: 'sold_without_product_cost' }] });
  });

  it('토스·RG·네이버 채널 값과 배송비 소스', () => {
    const p = planLegacy([
      L({ legacyKey: 'toss-9', channel: 'toss' }), L({ legacyKey: 'rg-1-80', channel: 'coupang_rg' }), L({ legacyKey: 'naver-2', channel: 'naver' }),
    ]);
    expect(p.upsert.map((u) => [u.key, u.channel, u.shippingSource])).toEqual([
      ['toss-9', 'toss', 'toss'], ['rg-1-80', 'rocket_growth', 'rg'], ['naver-2', 'naver', 'naver'],
    ]);
  });
});
