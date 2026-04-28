/**
 * 채널별 주문 데이터를 5단계 파이프라인(주문→배송중→배송완료→구매확정→정산완료)으로 집계.
 * 정산완료는 별도 모듈(settlement-clients)에서 채워 넣음.
 */
import type { ChannelPipeline, StageMetric } from './types';

export interface CoupangOrderRow {
  orderId: number;
  status: string;          // ACCEPT | INSTRUCT | DEPARTURE | DELIVERING | FINAL_DELIVERY | CANCEL_DONE | ...
  totalAmount: number;     // 원
}

export interface NaverOrderRow {
  productOrderId: string;
  productOrderStatus: string;  // PAYED | DISPATCHED | DELIVERING | DELIVERED | PURCHASE_DECIDED | CANCELED | RETURNED
  totalPaymentAmount: number;  // 원
}

// 쿠팡은 결제 직후 ACCEPT → 즉시 INSTRUCT(상품준비중)로 전이되어 ACCEPT 잔류가 거의 없음.
// "주문" 카드는 미출고 신규 주문(쿠팡 Wing 표기)과 동일하게 ACCEPT + INSTRUCT로 매핑.
const COUPANG_NEW_ORDER = new Set(['ACCEPT', 'INSTRUCT']);
const COUPANG_DELIVERING = new Set(['DEPARTURE', 'DELIVERING']);
const NAVER_DELIVERING = new Set(['DISPATCHED', 'DELIVERING']);

function emptyStage(): StageMetric {
  return { count: 0, amount: 0 };
}

function add(stage: StageMetric, amount: number): void {
  stage.count += 1;
  stage.amount += amount;
}

export function aggregateCoupangPipeline(orders: CoupangOrderRow[]): ChannelPipeline {
  const 주문 = emptyStage();
  const 배송중 = emptyStage();
  const 배송완료 = emptyStage();
  const 구매확정 = emptyStage();

  for (const o of orders) {
    if (COUPANG_NEW_ORDER.has(o.status)) add(주문, o.totalAmount);
    else if (COUPANG_DELIVERING.has(o.status)) add(배송중, o.totalAmount);
    else if (o.status === 'FINAL_DELIVERY') add(배송완료, o.totalAmount);
    // 쿠팡 구매확정은 별도 API 필요 — 현 단계에서는 0 유지
    // CANCEL_DONE/CANCEL_REQUEST/RETURN_* 는 모두 제외
  }

  return {
    주문, 배송중, 배송완료, 구매확정,
    정산완료: { count: 0, amount: 0, available: false },
    lastUpdated: new Date().toISOString(),
  };
}

export function aggregateNaverPipeline(orders: NaverOrderRow[]): ChannelPipeline {
  const 주문 = emptyStage();
  const 배송중 = emptyStage();
  const 배송완료 = emptyStage();
  const 구매확정 = emptyStage();

  for (const o of orders) {
    const s = o.productOrderStatus;
    if (s === 'PAYED') add(주문, o.totalPaymentAmount);
    else if (NAVER_DELIVERING.has(s)) add(배송중, o.totalPaymentAmount);
    else if (s === 'DELIVERED') add(배송완료, o.totalPaymentAmount);
    else if (s === 'PURCHASE_DECIDED') add(구매확정, o.totalPaymentAmount);
    // CANCELED/RETURNED/EXCHANGED 제외
  }

  return {
    주문, 배송중, 배송완료, 구매확정,
    정산완료: { count: 0, amount: 0, available: false },
    lastUpdated: new Date().toISOString(),
  };
}
