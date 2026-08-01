import { describe, it, expect } from 'vitest';
import { evaluateCandidate, parseUnitDeliFee } from '@/lib/sourcing-agent/keyword-pipeline';
import type { DomeggookListItem } from '@/types/sourcing';

/**
 * 배송비 외의 필드는 parseUnitDeliFee가 보지 않으므로 최소값만 채운다.
 * deli는 목록·상세 응답 형태가 달라 unknown 캐스트로 넣는다.
 */
function itemWithDeli(deli: unknown): DomeggookListItem {
  return { no: 1, title: 't', price: 1000, deli } as unknown as DomeggookListItem;
}

describe('evaluateCandidate', () => {
  it('쿠팡 p25가 손익분기가 이상이면 pass다', () => {
    // 실효원가 3,600 · 극소형 → 손익분기 9,471. p25 10,500
    // p25는 최소 판매가 하한(10,000) 이상이어야 손익분기 판정까지 도달한다.
    const r = evaluateCandidate({
      domePrice: 3300,
      unitDeliFee: 300,
      coupangP25: 10500,
      coupangSampleN: 91,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('pass');
    expect(r.effectiveCost).toBe(3600);
    expect(r.breakEvenPrice).toBe(9471); // 2026-07-31 VAT 반영 — Task 1 참조
  });

  it('p25가 손익분기 미달이면 fail이다', () => {
    // 실효원가 7,230 · 극소형 → 손익분기 15,706.
    // p25 12,000은 최소 판매가 하한(10,000)은 넘고 손익분기에는 미달한다.
    // 하한 미만 값을 쓰면 under_min_price로 단락되어 이 분기를 검증하지 못한다.
    const r = evaluateCandidate({
      domePrice: 6930,
      unitDeliFee: 300,
      coupangP25: 12000,
      coupangSampleN: 40,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('fail');
    expect(r.failReason).toBe('below_breakeven');
  });

  it('쿠팡 표본이 3건 미만이면 unknown이다 (fail이 아니다)', () => {
    const r = evaluateCandidate({
      domePrice: 3300,
      unitDeliFee: 300,
      coupangP25: 20000,
      coupangSampleN: 2,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('unknown');
  });

  it('p25를 못 구하면 unknown이다', () => {
    const r = evaluateCandidate({
      domePrice: 3300,
      unitDeliFee: 300,
      coupangP25: null,
      coupangSampleN: 0,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('unknown');
  });

  it('판매가 1만원 미만이면 fail이다 (목표 역산 기준)', () => {
    const r = evaluateCandidate({
      domePrice: 1000,
      unitDeliFee: 100,
      coupangP25: 8000,
      coupangSampleN: 50,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('fail');
    expect(r.failReason).toBe('under_min_price');
  });
});

/**
 * 기대값은 모두 unitDeliveryFee(deli-policy.ts:73)의 식으로 손계산했다.
 *   fixed  → ceil(fee / orderQty)
 *   tiered → ceil(ceil(orderQty / unitQty) * fee / orderQty)
 * 사입 수량 가정치는 30개(DEFAULT_ORDER_QTY, coupang-price.ts)다.
 */
describe('parseUnitDeliFee', () => {
  it('판매자 부담 무료배송(who=S)이면 배송비가 붙지 않는다', () => {
    // 구 구현은 fee/10 을 얹어 손익분기를 올렸다. 이 회귀를 막는 케이스다.
    expect(parseUnitDeliFee(itemWithDeli({ who: 'S', fee: '2500' }))).toBe(0);
  });

  it('신형 응답의 pay=무료도 무료로 본다', () => {
    expect(parseUnitDeliFee(itemWithDeli({ pay: '무료', fee: '3000' }))).toBe(0);
  });

  it('고정 배송비는 사입 수량으로 나눈다', () => {
    // fixed 2,500원 → ceil(2500 / 30) = 84
    expect(parseUnitDeliFee(itemWithDeli({ who: 'P', fee: '2500' }))).toBe(84);
  });

  it('나누어떨어지지 않으면 올림한다 (내림·반올림이 아니다)', () => {
    // fixed 1,234원 → ceil(1234 / 30) = 42. round였다면 41이다.
    expect(parseUnitDeliFee(itemWithDeli({ who: 'P', fee: '1234' }))).toBe(42);
  });

  it('상세(getItemView) 형태의 deli.dome.fee도 읽는다', () => {
    // fixed 3,000원 → ceil(3000 / 30) = 100
    expect(parseUnitDeliFee(itemWithDeli({ who: 'P', dome: { fee: '3000' } }))).toBe(100);
  });

  it('구간 배송비는 구간 요금을 고정 배송비로 취급하지 않는다', () => {
    // "30개당 3,000원" 구간을 30개 주문 → ceil(30/30) = 1구간 → 3,000원
    //   개당 = ceil(3000 / 30) = 100
    expect(parseUnitDeliFee(itemWithDeli({ who: 'P', tbl: '30+3000|30+3000' }))).toBe(100);
  });

  it('사입 수량이 구간을 넘으면 구간 배수만큼 올려 계산한다', () => {
    // "3개당 1,500원" 구간을 30개 주문 → ceil(30/3) = 10구간 → 10 × 1,500 = 15,000원
    //   개당 = ceil(15000 / 30) = 500. 구간을 무시했다면 50원이 나온다.
    expect(parseUnitDeliFee(itemWithDeli({ who: 'P', tbl: '3+1500|3+1500' }))).toBe(500);
  });

  it('deli가 없으면 0이다', () => {
    expect(parseUnitDeliFee(itemWithDeli(undefined))).toBe(0);
  });

  it('금액을 읽을 수 없으면 0이다', () => {
    // parseDeliPolicy는 무료 신호도 fee·tbl도 못 읽으면 FREE로 접는다(deli-policy.ts:57-64).
    // 실제로는 "유료인데 금액 불명"이라 원가가 과소산정되지만, 이 비대칭은 기존 동작이다.
    expect(parseUnitDeliFee(itemWithDeli({ who: 'P', fee: '착불' }))).toBe(0);
  });
});
