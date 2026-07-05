interface WingItem { vendorItemId: number; sellerProductId: number }
interface WingOrder { orderId: number | string; items: WingItem[] }

/**
 * 취소류(비-SALE) wing 주문에서, 우리 상품과 매칭되는 아이템의 sale_records 키를 반환.
 * 키 규칙은 임포트와 동일: `wing-${orderId}-${vendorItemId}`.
 */
export function wingCancelledKeys(
  order: WingOrder,
  vendorItemMap: ReadonlyMap<number, unknown>,
  sellerProductMap: ReadonlyMap<number, unknown>,
): string[] {
  const keys: string[] = [];
  for (const item of order.items) {
    if (vendorItemMap.has(item.vendorItemId) || sellerProductMap.has(item.sellerProductId)) {
      keys.push(`wing-${order.orderId}-${item.vendorItemId}`);
    }
  }
  return keys;
}

interface NaverOrder { productOrderId: string | number; channelProductNo: number | null }

/**
 * 취소 상태 naver 주문에서, 우리 상품과 매칭되면 sale_records 키를 반환(아니면 null).
 * 키 규칙은 임포트와 동일: `naver-${productOrderId}`. channelProductNoMap은 number 키.
 */
export function naverCancelledKey(
  order: NaverOrder,
  channelProductNoMap: ReadonlyMap<number, unknown>,
): string | null {
  if (order.channelProductNo == null) return null;
  if (!channelProductNoMap.has(order.channelProductNo)) return null;
  return `naver-${order.productOrderId}`;
}
