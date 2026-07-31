import { describe, it, expect } from 'vitest';
import { parseDeliPolicy, unitDeliveryFee } from '@/lib/sourcing/deli-policy';

describe('parseDeliPolicy', () => {
  it('수량별비례 tbl에서 구간 수량과 요금을 뽑는다', () => {
    const deli = {
      pay: '선결제',
      dome: { type: '수량별비례', tbl: '30+3000|30+3000' },
    };
    expect(parseDeliPolicy(deli)).toEqual({
      isFree: false,
      type: 'tiered',
      unitQty: 30,
      fee: 3000,
    });
  });

  it('고정배송비 fee를 뽑는다', () => {
    const deli = {
      pay: '선결제',
      dome: { type: '고정배송비', fee: '3000' },
    };
    expect(parseDeliPolicy(deli)).toEqual({
      isFree: false,
      type: 'fixed',
      unitQty: null,
      fee: 3000,
    });
  });

  it('pay가 무료면 무료배송으로 본다', () => {
    expect(parseDeliPolicy({ pay: '무료' }).isFree).toBe(true);
  });

  it('구형 who=S도 무료배송으로 본다', () => {
    expect(parseDeliPolicy({ who: 'S' }).isFree).toBe(true);
  });

  it('deli가 없으면 무료로 처리한다', () => {
    expect(parseDeliPolicy(undefined).isFree).toBe(true);
    expect(parseDeliPolicy(null).isFree).toBe(true);
  });
});

describe('unitDeliveryFee', () => {
  const tiered = { isFree: false, type: 'tiered' as const, unitQty: 30, fee: 3000 };
  const fixed = { isFree: false, type: 'fixed' as const, unitQty: null, fee: 3000 };

  it('수량별비례 10개 주문이면 개당 300원', () => {
    expect(unitDeliveryFee(tiered, 10)).toBe(300);
  });

  it('수량별비례 30개 주문이면 개당 100원', () => {
    expect(unitDeliveryFee(tiered, 30)).toBe(100);
  });

  it('구간을 넘기면 배수가 붙는다 — 31개면 6000원이라 개당 194원', () => {
    expect(unitDeliveryFee(tiered, 31)).toBe(194);
  });

  it('고정배송비 10개 주문이면 개당 300원', () => {
    expect(unitDeliveryFee(fixed, 10)).toBe(300);
  });

  it('무료배송이면 0원', () => {
    expect(unitDeliveryFee({ isFree: true, type: 'fixed', unitQty: null, fee: 0 }, 10)).toBe(0);
  });

  it('주문수량이 0 이하면 0원', () => {
    expect(unitDeliveryFee(fixed, 0)).toBe(0);
  });
});
