/**
 * 파이프라인 집계 단위 테스트
 * 쿠팡/네이버 status를 5단계 파이프라인으로 매핑.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateCoupangPipeline,
  aggregateNaverPipeline,
  type CoupangOrderRow,
  type NaverOrderRow,
} from '@/lib/dashboard/pipeline-aggregator';

const cp = (status: string, amount: number): CoupangOrderRow => ({
  orderId: 1, status, totalAmount: amount,
});

const np = (status: string, amount: number): NaverOrderRow => ({
  productOrderId: '1', productOrderStatus: status, totalPaymentAmount: amount,
});

describe('aggregateCoupangPipeline', () => {
  it('각 status를 5단계 파이프라인에 매핑한다', () => {
    const result = aggregateCoupangPipeline([
      cp('ACCEPT',         10000),
      cp('INSTRUCT',       20000),
      cp('DEPARTURE',      30000),
      cp('DELIVERING',     40000),
      cp('FINAL_DELIVERY', 50000),
    ]);
    expect(result.주문).toEqual({ count: 1, amount: 10000 });
    expect(result.배송중).toEqual({ count: 3, amount: 90000 });
    expect(result.배송완료).toEqual({ count: 1, amount: 50000 });
    expect(result.구매확정).toEqual({ count: 0, amount: 0 });
  });

  it('CANCEL_DONE은 어느 단계에도 포함하지 않는다', () => {
    const result = aggregateCoupangPipeline([
      cp('ACCEPT',      10000),
      cp('CANCEL_DONE', 99999),
    ]);
    expect(result.주문.count).toBe(1);
    expect(result.배송중.count).toBe(0);
  });

  it('빈 입력은 모든 단계 0으로 반환한다', () => {
    const result = aggregateCoupangPipeline([]);
    expect(result.주문.count).toBe(0);
    expect(result.배송중.amount).toBe(0);
  });

  it('정산완료는 항상 available: false로 초기화 (Phase 5에서 채움)', () => {
    const result = aggregateCoupangPipeline([cp('ACCEPT', 100)]);
    expect(result.정산완료).toEqual({ count: 0, amount: 0, available: false });
  });

  it('lastUpdated는 ISO 문자열을 반환한다', () => {
    const result = aggregateCoupangPipeline([]);
    expect(result.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('aggregateNaverPipeline', () => {
  it('PAYED는 주문, DELIVERING은 배송중, DELIVERED는 배송완료, PURCHASE_DECIDED는 구매확정', () => {
    const result = aggregateNaverPipeline([
      np('PAYED',            5000),
      np('DELIVERING',       6000),
      np('DELIVERED',        7000),
      np('PURCHASE_DECIDED', 8000),
    ]);
    expect(result.주문).toEqual({ count: 1, amount: 5000 });
    expect(result.배송중).toEqual({ count: 1, amount: 6000 });
    expect(result.배송완료).toEqual({ count: 1, amount: 7000 });
    expect(result.구매확정).toEqual({ count: 1, amount: 8000 });
  });

  it('DISPATCHED도 배송중에 합산한다', () => {
    const result = aggregateNaverPipeline([
      np('DISPATCHED', 3000),
      np('DELIVERING', 4000),
    ]);
    expect(result.배송중).toEqual({ count: 2, amount: 7000 });
  });

  it('CANCELED/RETURNED는 모든 단계에서 제외', () => {
    const result = aggregateNaverPipeline([
      np('PAYED',    1000),
      np('CANCELED', 2000),
      np('RETURNED', 3000),
    ]);
    expect(result.주문.count).toBe(1);
    const totalCount = result.주문.count + result.배송중.count + result.배송완료.count + result.구매확정.count;
    expect(totalCount).toBe(1);
  });
});
