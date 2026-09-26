// src/lib/erp/orders/status.ts
// 채널 상태 문자열 → 표준 상태. 모르는 값은 'unknown' — 수집기는 기존 상태를 유지하고 unknown_status로 센다.
import type { StdStatus } from './types';

const WING: Record<string, StdStatus> = {
  ACCEPT: 'paid', INSTRUCT: 'paid',
  DEPARTURE: 'shipping', DELIVERING: 'shipping', NONE_TRACKING: 'shipping',
  FINAL_DELIVERY: 'delivered',
};

/** 쿠팡 발주서 상태 + 품목 취소. 남은 수량(shippingCount − cancelCount)이 0 이하면 취소 */
export function wingStatus(sheetStatus: string, item: { canceled?: boolean; shippingCount: number; cancelCount?: number }): StdStatus {
  if (item.canceled === true || item.shippingCount - (item.cancelCount ?? 0) <= 0) return 'canceled';
  return WING[sheetStatus] ?? 'unknown';
}

const NAVER: Record<string, StdStatus> = {
  PAYMENT_WAITING: 'unpaid', PAYED: 'paid', DELIVERING: 'shipping', DELIVERED: 'delivered', PURCHASE_DECIDED: 'confirmed',
  EXCHANGED: 'exchange', CANCELED: 'canceled', RETURNED: 'returned', CANCELED_BY_NOPAYMENT: 'canceled',
};
const NAVER_CANCEL_OPEN = new Set(['CANCEL_REQUEST', 'CANCELING']);
const NAVER_RETURN_OPEN = new Set(['RETURN_REQUEST', 'COLLECTING', 'COLLECT_DONE']);
const isReject = (s: string | null) => s !== null && /REJECT/.test(s);

/**
 * 네이버 상품주문 상태 + 진행 중 클레임. 끝난 취소·반품은 상품주문 상태 자체가 CANCELED·RETURNED가 된다.
 * 직권 취소(ADMIN_CANCEL · ADMIN_CANCELING)는 취소 요청과 같게, 교환 클레임은 거부가 아니면 exchange(팔림 — 차감은 그대로)로 표시한다.
 */
export function naverStatus(productOrderStatus: string, claimType: string | null, claimStatus: string | null): StdStatus {
  const base = NAVER[productOrderStatus] ?? 'unknown';
  if (base === 'paid' || base === 'shipping' || base === 'delivered') {
    if (claimType === 'CANCEL' && claimStatus !== null && NAVER_CANCEL_OPEN.has(claimStatus)) return 'cancel_requested';
    if (claimStatus === 'ADMIN_CANCELING' || (claimType === 'ADMIN_CANCEL' && !isReject(claimStatus))) return 'cancel_requested';
    if (claimType === 'RETURN' && claimStatus !== null && NAVER_RETURN_OPEN.has(claimStatus)) return 'return_requested';
    if (claimType === 'EXCHANGE' && claimStatus !== null && !isReject(claimStatus)) return 'exchange';
  }
  return base;
}

// 토스 주문 v2 orderProductStatus 20종(공식 문서 GetOrderHistoriesCursorResponse) + 도착보장의 DELAY_SHIPPING
//   + REVOKED_REQUEST(구매자가 취소·반품 요청을 철회) → 팔림 기본값 paid. 배송 후 철회여도 paid·delivered는 차감이 같다
const TOSS: Record<string, StdStatus> = {
  BEFORE_PAYMENT: 'unpaid',
  PAID: 'paid', PREPARING_PRODUCT: 'paid', DELAY_SHIPPING: 'paid', CLAIM_REJECTED_CANCEL: 'paid', REVOKED_REQUEST: 'paid',
  DELIVERING: 'shipping',
  DELIVERED: 'delivered', CLAIM_REJECTED_RETURN: 'delivered',
  CONFIRMED_ORDER: 'confirmed',
  CLAIM_REQUESTED_CANCEL: 'cancel_requested',
  CANCELED_PAYMENT: 'canceled',
  REQUESTED_RETURN: 'return_requested', ONGOING_RETURN: 'return_requested',
  CLAIM_COLLECTING: 'return_requested', CLAIM_COLLECTED: 'return_requested', CLAIM_DELIVERING: 'return_requested',
  COMPLETED_RETURN: 'returned',
  REQUESTED_EXCHANGE: 'exchange', ONGOING_EXCHANGE: 'exchange', COMPLETED_EXCHANGE: 'exchange', CLAIM_REJECTED_EXCHANGE: 'exchange',
};

export const tossStatus = (s: string): StdStatus => TOSS[s] ?? 'unknown';
