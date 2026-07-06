import { describe, it, expect } from 'vitest';
import { buildSalePayload } from '@/components/orders/sale-payload';

describe('buildSalePayload', () => {
  it('문자열 폼을 숫자 payload로 변환한다', () => {
    expect(buildSalePayload({
      sold_at: '2026-07-01', quantity: '3', selling_price: '19900',
      shipping_fee: '3500', coupon_discount: '1000', channel: 'coupang',
    })).toEqual({
      sold_at: '2026-07-01', quantity: 3, selling_price: 19900,
      shipping_fee: 3500, coupon_discount: 1000, channel: 'coupang',
    });
  });
  it('배송비·쿠폰할인 음수는 0으로 방어', () => {
    const p = buildSalePayload({
      sold_at: '2026-07-01', quantity: '1', selling_price: '100',
      shipping_fee: '-5', coupon_discount: '-9', channel: 'manual',
    });
    expect(p.shipping_fee).toBe(0);
    expect(p.coupon_discount).toBe(0);
  });
  it('빈 쿠폰할인은 0으로 처리', () => {
    const p = buildSalePayload({
      sold_at: '2026-07-01', quantity: '1', selling_price: '100',
      shipping_fee: '0', coupon_discount: '', channel: 'naver',
    });
    expect(p.coupon_discount).toBe(0);
  });
  it('소수 수량·가격은 반올림', () => {
    const p = buildSalePayload({
      sold_at: '2026-07-01', quantity: '2.4', selling_price: '10000.6',
      shipping_fee: '0', coupon_discount: '0', channel: 'manual',
    });
    expect(p.quantity).toBe(2);
    expect(p.selling_price).toBe(10001);
  });
});
