/**
 * draft-keys.ts
 * 주문/매출 화면의 폼 초안(useDraftPersist)이 쓰는 localStorage 키를 한곳에 모은다.
 * 키 문자열을 여러 파일에 흩어 적으면 오타로 서로 다른 폼이 같은 키를 쓰거나,
 * 배지 체크(hasXxxDraft)가 실제 저장 키와 어긋나는 사고가 나기 쉽다.
 */

import { hasDraft } from '@/hooks/useDraftPersist';

export const costEntryDraftKey = (productId: string) => `orders:draft:costEntry:${productId}`;
export const saleEntryDraftKey = (productId: string) => `orders:draft:saleEntry:${productId}`;
export const couponPolicyDraftKey = (productId: string) => `orders:draft:couponPolicy:${productId}`;
export const expenseDraftKey = (date: string) => `orders:draft:expense:${date}`;
export const channelEditDraftKey = (productId: string) => `orders:draft:channelEdit:${productId}`;
export const SHIPPING_GROUP_DRAFT_KEY = 'orders:draft:shippingGroup';
export const RG_SHIPMENT_DRAFT_KEY = 'orders:draft:rgShipment';
export const ADD_PRODUCT_DRAFT_KEY = 'orders:draft:addProduct';

/** 상품 하나에 매입원가·판매·쿠폰정책 초안 중 하나라도 남아있으면 true.
 *  "입고·판매 관리" 버튼에 "작성 중" 배지를 띄울지 판단하는 데 쓴다. */
export function hasCostManagementDraft(productId: string): boolean {
  return (
    hasDraft(costEntryDraftKey(productId)) ||
    hasDraft(saleEntryDraftKey(productId)) ||
    hasDraft(couponPolicyDraftKey(productId))
  );
}
