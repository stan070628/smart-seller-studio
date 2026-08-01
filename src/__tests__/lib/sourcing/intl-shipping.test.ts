import { describe, it, expect } from 'vitest';
import {
  chargeableWeightKg,
  volumetricWeightKg,
  shippingFeeKrw,
  allocateOrderCost,
  estimateIntlShipPerUnitKrw,
  ASSUMED_UNIT_WEIGHT_KG,
  CUSTOMS_BROKER_FEE_KRW,
  type IntlShipEstimate,
} from '@/lib/sourcing/intl-shipping';
import type { LogisticsSize } from '@/types/shortlist';

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

  it('경계값에 딱 떨어지면 한 칸 더 올리지 않는다 — 부동소수점 과다청구 방지', () => {
    // 25 × 1.1 = 27.500000000000004 (IEEE754). 엡실론이 없으면 28kg으로 청구된다
    expect(shippingFeeKrw(25 * 1.1).billedKg).toBe(27.5);
    expect(shippingFeeKrw(50 * 1.1).billedKg).toBe(55);
    expect(shippingFeeKrw(90 * 1.1).billedKg).toBe(99);
    // 경계를 진짜로 넘으면 정상적으로 올라가야 한다
    expect(shippingFeeKrw(27.51).billedKg).toBe(28);
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

/**
 * estimateIntlShipPerUnitKrw는 수량이 0 이하면 null을 반환한다(전용 케이스가 따로 있다).
 * 정상 수량 케이스에서는 null이 아님을 먼저 단언하고 값을 꺼낸다 —
 * `!`만 붙이면 회귀 시 "null의 속성을 읽을 수 없다"로 원인이 흐려진다.
 */
function estimate(size: LogisticsSize, qty: number): IntlShipEstimate {
  const r = estimateIntlShipPerUnitKrw(size, qty);
  expect(r).not.toBeNull();
  return r as IntlShipEstimate;
}

describe('estimateIntlShipPerUnitKrw', () => {
  it('극소형 30개 — 9kg 구간 15,980원을 30으로 나눈다', () => {
    const r = estimate('xsmall', 30);
    expect(r.billedKg).toBe(9);
    expect(r.totalKrw).toBe(15980);
    expect(r.perUnitKrw).toBe(533);
    expect(r.extrapolated).toBe(false);
  });

  it('사입 수량이 늘면 개당이 싸진다 — 요율이 무게에 체감하기 때문', () => {
    const q10 = estimate('xsmall', 10).perUnitKrw;
    const q30 = estimate('xsmall', 30).perUnitKrw;
    const q50 = estimate('xsmall', 50).perUnitKrw;
    expect(q10).toBe(743);
    expect(q30).toBe(533);
    expect(q50).toBe(464);
    expect(q10).toBeGreaterThan(q30);
    expect(q30).toBeGreaterThan(q50);
  });

  it('요율표를 넘어서면 외삽 표시를 세운다', () => {
    // 극소형 100개 = 30kg. 표는 15.5kg까지다
    const r = estimate('xsmall', 100);
    expect(r.extrapolated).toBe(true);
    expect(r.perUnitKrw).toBe(397);
  });

  it('사이즈마다 가정 무게가 다르다', () => {
    expect(ASSUMED_UNIT_WEIGHT_KG.xsmall).toBe(0.3);
    expect(ASSUMED_UNIT_WEIGHT_KG.small).toBe(1.0);
    expect(ASSUMED_UNIT_WEIGHT_KG.medium).toBe(3.0);
    // 같은 수량이면 무거운 사이즈가 비싸다
    const q = 30;
    expect(estimate('medium', q).perUnitKrw).toBeGreaterThan(estimate('xsmall', q).perUnitKrw);
  });

  it('수량이 0 이하면 계산하지 않는다', () => {
    expect(estimateIntlShipPerUnitKrw('xsmall', 0)).toBeNull();
    expect(estimateIntlShipPerUnitKrw('xsmall', -1)).toBeNull();
  });
});
