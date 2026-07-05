import { describe, it, expect } from 'vitest';
import { wingCancelledKeys, naverCancelledKey } from '@/lib/cost-management/cancel-sync';

describe('wingCancelledKeys', () => {
  const vendorItemMap = new Map<number, unknown>([[111, {}]]);
  const sellerProductMap = new Map<number, unknown>([[900, {}]]);

  it('vendorItemId가 매칭되는 취소 주문 아이템의 키를 반환', () => {
    const order = { orderId: 5, items: [{ vendorItemId: 111, sellerProductId: 1 }] };
    expect(wingCancelledKeys(order, vendorItemMap, sellerProductMap)).toEqual(['wing-5-111']);
  });
  it('sellerProductId fallback 매칭도 포함', () => {
    const order = { orderId: 7, items: [{ vendorItemId: 222, sellerProductId: 900 }] };
    expect(wingCancelledKeys(order, vendorItemMap, sellerProductMap)).toEqual(['wing-7-222']);
  });
  it('매칭 안 되는 아이템은 제외', () => {
    const order = { orderId: 8, items: [{ vendorItemId: 999, sellerProductId: 999 }] };
    expect(wingCancelledKeys(order, vendorItemMap, sellerProductMap)).toEqual([]);
  });
  it('여러 아이템 각각 키 생성', () => {
    const order = { orderId: 9, items: [{ vendorItemId: 111, sellerProductId: 1 }, { vendorItemId: 999, sellerProductId: 900 }] };
    expect(wingCancelledKeys(order, vendorItemMap, sellerProductMap)).toEqual(['wing-9-111', 'wing-9-999']);
  });
});

describe('naverCancelledKey', () => {
  const map = new Map<number, string>([[1, 'pc-1']]);
  it('매칭되는 취소 주문의 키 반환', () => {
    expect(naverCancelledKey({ productOrderId: 'PO1', channelProductNo: 1 }, map)).toBe('naver-PO1');
  });
  it('채널상품번호 미매칭이면 null', () => {
    expect(naverCancelledKey({ productOrderId: 'PO2', channelProductNo: 999 }, map)).toBeNull();
  });
  it('channelProductNo 없으면 null', () => {
    expect(naverCancelledKey({ productOrderId: 'PO3', channelProductNo: null }, map)).toBeNull();
  });
});
