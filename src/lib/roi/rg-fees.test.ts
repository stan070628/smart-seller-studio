import { describe, it, expect } from 'vitest';
import {
  getRgShippingFee,
  resolveRgShippingFee,
  rgSizeTypeFromLabel,
  rgSizeLabel,
  RG_SIZE_SPECS,
} from './rg-fees';
import { calcMargin, calcBreakevenRoas } from './calculations';
import { calcMarginPerUnit } from '../ad-strategy/net-profit';

describe('getRgShippingFee', () => {
  it('사이즈별 입출고비+배송비 합계를 반환한다', () => {
    expect(getRgShippingFee('extra_small')).toBe(1725); // 600 + 1125
    expect(getRgShippingFee('small')).toBe(1900); // 650 + 1250
    expect(getRgShippingFee('medium')).toBe(2740); // 1240 + 1500
  });

  it('사이즈 미지정이면 0을 반환한다', () => {
    expect(getRgShippingFee(null)).toBe(0);
    expect(getRgShippingFee(undefined)).toBe(0);
  });
});

describe('resolveRgShippingFee', () => {
  it('실측 정산액이 있으면 사이즈 기본값보다 우선한다', () => {
    expect(resolveRgShippingFee(2100, 'extra_small')).toBe(2100);
  });

  it('실측값이 없거나 0이면 사이즈 기본값에 VAT를 반영해 폴백한다', () => {
    // 고지값은 VAT 별도(소개서 2025-01, 6p). 간이과세자는 공제받지 못하므로 그대로 비용이다.
    expect(resolveRgShippingFee(0, 'extra_small')).toBe(1898); // 1725 × 1.1
    expect(resolveRgShippingFee(null, 'medium')).toBe(3014); // 2740 × 1.1
    expect(resolveRgShippingFee(undefined, 'small')).toBe(2090); // 1900 × 1.1
  });

  it('실측값은 이미 실제 차감액이므로 VAT를 다시 곱하지 않는다', () => {
    expect(resolveRgShippingFee(2100, 'small')).toBe(2100);
  });

  it('고지값 자체는 VAT 별도로 유지된다', () => {
    expect(getRgShippingFee('small')).toBe(1900);
    expect(getRgShippingFee('extra_small')).toBe(1725);
  });

  it('실측값도 사이즈도 없으면 0이다', () => {
    expect(resolveRgShippingFee(null, null)).toBe(0);
  });
});

describe('사이즈 라벨 변환', () => {
  it('판매자센터 표기와 내부 코드를 왕복 변환한다', () => {
    expect(rgSizeTypeFromLabel('극소형')).toBe('extra_small');
    expect(rgSizeTypeFromLabel('중형')).toBe('medium');
    expect(rgSizeLabel('small')).toBe('소형');
  });

  it('알 수 없는 라벨은 null이다', () => {
    expect(rgSizeTypeFromLabel('초소형')).toBeNull();
    expect(rgSizeTypeFromLabel('')).toBeNull();
  });
});

describe('calcMargin — 로켓그로스 물류비 반영', () => {
  // 실제 사례: 듀오버스터 민트볼 (판매가 6,990 / 원가 4,186 / 수수료 10.8% / 극소형)
  const price = 6990;
  const cost = 4186;
  const feeRate = 0.108;

  it('물류비를 넘기지 않으면 기존 동작과 동일하다 (하위 호환)', () => {
    expect(calcMargin(price, cost, feeRate, 0)).toBeCloseTo(2049, 0);
  });

  it('로켓그로스 물류비를 차감한다', () => {
    const rgFee = getRgShippingFee('extra_small');
    expect(calcMargin(price, cost, feeRate, 0, rgFee)).toBeCloseTo(324, 0);
  });

  it('물류비 미반영 시 손익분기 ROAS가 과소평가된다', () => {
    const without = calcBreakevenRoas(price, calcMargin(price, cost, feeRate, 0));
    const withFee = calcBreakevenRoas(price, calcMargin(price, cost, feeRate, 0, 1725));
    // 341% vs 2,157% — 6배 이상 차이. 적자 광고를 흑자로 오판하게 되는 지점이다.
    expect(Math.round(without)).toBe(341);
    expect(Math.round(withFee)).toBe(2157);
    expect(withFee).toBeGreaterThan(without * 5);
  });
});

describe('calcMarginPerUnit — 물류비 반영', () => {
  // 실제 사례: weet-bix 위트빅스 (판매가 11,480 / 원가 7,495 / 극소형)
  const price = 11480;
  const cost = 7495;
  const feeRate = 0.108;

  it('물류비 인자를 생략하면 기존 동작과 동일하다', () => {
    expect(calcMarginPerUnit(price, cost, feeRate)).toBe(2745);
  });

  it('물류비를 차감하면 마진이 줄어든다', () => {
    expect(calcMarginPerUnit(price, cost, feeRate, 1725)).toBe(1020);
  });
});

describe('RG_SIZE_SPECS 정합성', () => {
  it('사이즈가 커질수록 요율이 낮아지지 않는다', () => {
    const order = ['extra_small', 'small', 'medium'] as const;
    const fees = order.map((t) => getRgShippingFee(t));
    for (let i = 1; i < fees.length; i++) {
      expect(fees[i]).toBeGreaterThanOrEqual(fees[i - 1]);
    }
  });

  it('사이즈 판정 상한이 단조 증가한다', () => {
    const order = ['extra_small', 'small', 'medium', 'large1', 'large2', 'extra_large'] as const;
    for (let i = 1; i < order.length; i++) {
      const prev = RG_SIZE_SPECS[order[i - 1]];
      const cur = RG_SIZE_SPECS[order[i]];
      expect(cur.maxDimensionSum!).toBeGreaterThan(prev.maxDimensionSum!);
      expect(cur.maxWeightKg!).toBeGreaterThan(prev.maxWeightKg!);
    }
  });
});
