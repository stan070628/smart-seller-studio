import { describe, it, expect } from 'vitest';
import {
  chargeableWeightKg,
  volumetricWeightKg,
  shippingFeeKrw,
  allocateOrderCost,
  CUSTOMS_BROKER_FEE_KRW,
} from '@/lib/sourcing/intl-shipping';

describe('volumetricWeightKg', () => {
  it('가로×세로×높이 ÷ 6000이다', () => {
    expect(volumetricWeightKg({ w: 25, d: 20, h: 12 })).toBeCloseTo(1.0, 4);
    expect(volumetricWeightKg({ w: 18, d: 12, h: 6 })).toBeCloseTo(0.216, 4);
  });
});

describe('chargeableWeightKg', () => {
  it('실무게와 부피무게 중 큰 값을 쓴다', () => {
    // 모자: 실무게 0.1kg, 부피무게 1.0kg → 1.0kg
    expect(chargeableWeightKg(0.1, { w: 25, d: 20, h: 12 })).toBeCloseTo(1.0, 4);
    // 치수를 모르면 실무게
    expect(chargeableWeightKg(0.5, null)).toBe(0.5);
  });
});

describe('shippingFeeKrw', () => {
  it('요율표 값을 그대로 쓴다', () => {
    expect(shippingFeeKrw(1.0).fee).toBe(4580);
    expect(shippingFeeKrw(10.0).fee).toBe(17390);
    expect(shippingFeeKrw(15.0).fee).toBe(23190);
  });

  it('0.5kg 단위로 절상한다', () => {
    expect(shippingFeeKrw(8.3).fee).toBe(15280); // 8.5kg 구간
    expect(shippingFeeKrw(0.1).fee).toBe(4180);  // 최소 0.5kg
  });

  it('선형 근사식과 다르다 — 11kg부터 증분이 꺾인다', () => {
    // 근사식 4580 + (15-1)*1423 = 24,502원이지만 실제는 23,190원
    expect(shippingFeeKrw(15.0).fee).toBe(23190);
    expect(shippingFeeKrw(15.0).estimated).toBe(false);
  });

  it('표 범위를 넘으면 외삽하고 estimated 플래그를 세운다', () => {
    const r = shippingFeeKrw(20.0);
    expect(r.estimated).toBe(true);
    // 15.5kg 23,740에서 0.5kg당 550원 외삽 → 23,740 + 9*550 = 28,690
    expect(r.fee).toBe(28690);
  });
});

describe('allocateOrderCost', () => {
  it('과금무게 비례로 배송비와 고정비를 함께 배분한다', () => {
    const r = allocateOrderCost({
      actualShippingKrw: 15280,
      fixedCostKrw: CUSTOMS_BROKER_FEE_KRW,
      items: [
        { key: 'glove', qty: 52, unitWeightKg: 0.1 },
        { key: 'neck', qty: 20, unitWeightKg: 0.08 },
        { key: 'pouch', qty: 10, unitWeightKg: 0.15 },
      ],
    });

    expect(r.totalWeightKg).toBeCloseTo(8.3, 4);
    expect(r.totalCostKrw).toBe(37280);

    const glove = r.items.find((i) => i.key === 'glove')!;
    expect(glove.allocatedKrw).toBe(23356);
    expect(glove.perUnitKrw).toBe(449);

    // 배분 합계가 총액과 일치한다 (반올림 잔차를 최대 항목에 흡수)
    const sum = r.items.reduce((a, i) => a + i.allocatedKrw, 0);
    expect(sum).toBe(37280);
  });

  it('과세운임은 배송비 몫만이다 (고정비 제외)', () => {
    const r = allocateOrderCost({
      actualShippingKrw: 15280,
      fixedCostKrw: CUSTOMS_BROKER_FEE_KRW,
      items: [{ key: 'a', qty: 10, unitWeightKg: 1.0 }],
    });
    expect(r.items[0].dutiableFreightPerUnitKrw).toBe(1528);
    expect(r.items[0].perUnitKrw).toBe(3728);
  });
});
