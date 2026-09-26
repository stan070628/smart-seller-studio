import { describe, it, expect } from 'vitest';
import { naverStatus, tossStatus, wingStatus } from '@/lib/erp/orders/status';
import { SOLD, VOID } from '@/lib/erp/orders/types';

describe('표준 상태', () => {
  it('쿠팡 판매자배송: 발주서 상태 → 표준, 품목 취소·남은 수량 0은 canceled, 모르는 값은 unknown', () => {
    expect(wingStatus('ACCEPT', { shippingCount: 1 })).toBe('paid');
    expect(wingStatus('INSTRUCT', { shippingCount: 1 })).toBe('paid');
    expect(wingStatus('DEPARTURE', { shippingCount: 1 })).toBe('shipping');
    expect(wingStatus('NONE_TRACKING', { shippingCount: 1 })).toBe('shipping');
    expect(wingStatus('FINAL_DELIVERY', { shippingCount: 1 })).toBe('delivered');
    expect(wingStatus('ACCEPT', { shippingCount: 2, canceled: true })).toBe('canceled');
    expect(wingStatus('INSTRUCT', { shippingCount: 2, cancelCount: 2 })).toBe('canceled');
    expect(wingStatus('INSTRUCT', { shippingCount: 2, cancelCount: 1 })).toBe('paid');
    expect(wingStatus('SOMETHING_NEW', { shippingCount: 1 })).toBe('unknown');
  });

  it('네이버: 상품주문 상태 + 진행 중 취소·반품 요청', () => {
    expect(naverStatus('PAYMENT_WAITING', null, null)).toBe('unpaid');
    expect(naverStatus('PAYED', null, null)).toBe('paid');
    expect(naverStatus('DELIVERING', null, null)).toBe('shipping');
    expect(naverStatus('PURCHASE_DECIDED', null, null)).toBe('confirmed');
    expect(naverStatus('PAYED', 'CANCEL', 'CANCEL_REQUEST')).toBe('cancel_requested');
    expect(naverStatus('PAYED', 'CANCEL', 'CANCEL_REJECT')).toBe('paid');
    expect(naverStatus('DELIVERED', 'RETURN', 'COLLECTING')).toBe('return_requested');
    expect(naverStatus('CANCELED', 'CANCEL', 'CANCEL_DONE')).toBe('canceled');
    expect(naverStatus('RETURNED', 'RETURN', 'RETURN_DONE')).toBe('returned');
    expect(naverStatus('CANCELED_BY_NOPAYMENT', null, null)).toBe('canceled');
    expect(naverStatus('WHAT', null, null)).toBe('unknown');
  });

  it('네이버: 직권 취소 진행 중은 cancel_requested, 교환 진행 중은 exchange(거부는 원 상태)', () => {
    expect(naverStatus('PAYED', 'ADMIN_CANCEL', 'ADMIN_CANCELING')).toBe('cancel_requested');
    expect(naverStatus('DELIVERING', 'ADMIN_CANCEL', null)).toBe('cancel_requested');
    expect(naverStatus('PAYED', null, 'ADMIN_CANCELING')).toBe('cancel_requested');
    expect(naverStatus('DELIVERED', 'EXCHANGE', 'EXCHANGE_REQUEST')).toBe('exchange');
    expect(naverStatus('DELIVERED', 'EXCHANGE', 'COLLECTING')).toBe('exchange');
    expect(naverStatus('DELIVERED', 'EXCHANGE', 'EXCHANGE_REDELIVERING')).toBe('exchange');
    expect(naverStatus('DELIVERED', 'EXCHANGE', 'EXCHANGE_REJECT')).toBe('delivered');
  });

  it('토스: 주문상품 상태 20종', () => {
    expect(tossStatus('BEFORE_PAYMENT')).toBe('unpaid');
    expect(tossStatus('PAID')).toBe('paid');
    expect(tossStatus('PREPARING_PRODUCT')).toBe('paid');
    expect(tossStatus('DELAY_SHIPPING')).toBe('paid');
    expect(tossStatus('DELIVERING')).toBe('shipping');
    expect(tossStatus('CONFIRMED_ORDER')).toBe('confirmed');
    expect(tossStatus('CLAIM_REQUESTED_CANCEL')).toBe('cancel_requested');
    expect(tossStatus('CLAIM_REJECTED_CANCEL')).toBe('paid');
    expect(tossStatus('CANCELED_PAYMENT')).toBe('canceled');
    expect(tossStatus('ONGOING_RETURN')).toBe('return_requested');
    expect(tossStatus('CLAIM_COLLECTED')).toBe('return_requested');
    expect(tossStatus('COMPLETED_RETURN')).toBe('returned');
    expect(tossStatus('CLAIM_REJECTED_RETURN')).toBe('delivered');
    expect(tossStatus('COMPLETED_EXCHANGE')).toBe('exchange');
    expect(tossStatus('REVOKED_REQUEST')).toBe('paid');
    expect(tossStatus('NEW_ONE')).toBe('unknown');
  });

  it('팔림·무효 집합은 겹치지 않고 unknown은 어디에도 없다', () => {
    for (const s of SOLD) expect(VOID.has(s)).toBe(false);
    expect(SOLD.has('unknown')).toBe(false);
    expect(VOID.has('unknown')).toBe(false);
    expect([...SOLD].sort()).toEqual(['cancel_requested', 'confirmed', 'delivered', 'exchange', 'paid', 'return_requested', 'shipping']);
    expect([...VOID].sort()).toEqual(['canceled', 'returned', 'unpaid']);
  });
});
