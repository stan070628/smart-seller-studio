import { describe, it, expect } from 'vitest';
import {
  getRgShippingFee,
  resolveRgShippingFee,
  rgSizeTypeFromLabel,
  rgSizeLabel,
  RG_SIZE_SPECS,
  RG_SIZE_TYPES,
} from './rg-fees';
import { calcMargin, calcBreakevenRoas } from './calculations';
import { calcMarginPerUnit } from '../ad-strategy/net-profit';
import { effectiveFeeRate } from '../tax';
import { COUPANG_ROCKET_LOGISTICS, type RocketSize } from '../calculator/fees';

describe('getRgShippingFee', () => {
  it('사이즈별 입출고비+배송비 합계를 반환한다 (VAT 별도)', () => {
    // 2026-08-13 예상 정산액 화면 실측. 요금표 최소값(1,725/1,900)의 1.6~1.9배다.
    expect(getRgShippingFee('extra_small')).toBe(2800); // 1,025 + 1,775
    expect(getRgShippingFee('small')).toBe(3625); // 1,350 + 2,275
  });

  it('중형 이상은 실측이 없어 요금표 최소값 × 1.9 추정치를 쓴다', () => {
    expect(getRgShippingFee('medium')).toBe(5206); // (1,240 + 1,500) × 1.9
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
    expect(resolveRgShippingFee(0, 'extra_small')).toBe(3080); // 2,800 × 1.1
    expect(resolveRgShippingFee(undefined, 'small')).toBe(3988); // 3,625 × 1.1
    expect(resolveRgShippingFee(null, 'medium')).toBe(5727); // 5,206 × 1.1
  });

  it('실측값은 이미 실제 차감액이므로 VAT를 다시 곱하지 않는다', () => {
    expect(resolveRgShippingFee(2100, 'small')).toBe(2100);
  });

  it('고지값 자체는 VAT 별도로 유지된다', () => {
    expect(getRgShippingFee('small')).toBe(3625);
    expect(getRgShippingFee('extra_small')).toBe(2800);
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

describe('실측 여부 플래그', () => {
  it('극소형·소형만 실측이며 중형 이상은 추정이다', () => {
    // 전 SKU 스캔(2026-08-13) 결과 로켓그로스 34개 옵션 중 중형 이상이 0건이라
    // 측정 대상 자체가 없었다. UI가 "추정" 배지를 다는 근거다.
    expect(RG_SIZE_SPECS.extra_small.measured).toBe(true);
    expect(RG_SIZE_SPECS.small.measured).toBe(true);
    expect(RG_SIZE_SPECS.medium.measured).toBe(false);
    expect(RG_SIZE_SPECS.extra_large.measured).toBe(false);
  });
});

describe('극세사 타월 — 위키 원장 회귀', () => {
  // 20-wiki/entities/극세사 타월.md 「2026-08-13 실청구 기준」의 확정 마진을 그대로 재현한다.
  // 이 상품은 마진이 2.5개월간 아홉 번 뒤집혔고, 그때마다 원인이 산식의 누락 항목이었다.
  // 값이 어긋나면 산식에서 무언가가 다시 빠졌다는 뜻이다.

  it('블루(극소형)의 개당 마진은 1,236원이다', () => {
    const margin = calcMargin({
      sellingPrice: 12800,
      sellerDiscount: 600, // 즉시할인쿠폰 — 판매자 부담
      costPrice: 5865,
      feeRate: 0.11, // 생활용품 정률 10% × VAT
      deliveryFee: 494, // 입고 물류비 (박스 2,400 + 택배 5,500) ÷ 16
      rgShippingFee: resolveRgShippingFee(null, 'extra_small'), // 3,080
    });
    expect(Math.round(margin)).toBe(1236);
  });

  it('옐로우(소형 오등록)는 개당 541원 적자다', () => {
    const margin = calcMarginPerUnit({
      sellingPrice: 12800,
      sellerDiscount: 680, // SELLER_FREE_EXPOSURE — 쿠팡이 아니라 판매자 부담
      costPrice: 6664,
      feeRate: 0.11,
      shippingFee: resolveRgShippingFee(null, 'small'), // 3,988
    });
    // 입고 물류비 494원은 calcMarginPerUnit이 받지 않으므로 별도로 뺀다.
    expect(margin - 494).toBe(-541);
  });

  it('같은 상품·같은 판매가인데 사이즈 등급 하나로 마진이 뒤집힌다', () => {
    const asExtraSmall = resolveRgShippingFee(null, 'extra_small');
    const asSmall = resolveRgShippingFee(null, 'small');
    // 908원 차이. 옐로우가 809mm로 잘못 등록되어 극소형 기준을 9mm 넘긴 것이 원인이며,
    // 입고 후에는 판매자가 고칠 수 없어 윙 문의로만 정정된다.
    expect(asSmall - asExtraSmall).toBe(908);
  });
});

describe('calcMargin — 로켓그로스 물류비 반영', () => {
  // 실제 사례: 듀오버스터 민트볼 (판매가 6,990 / 원가 4,186 / 수수료 10.8% / 극소형)
  const price = 6990;
  const cost = 4186;
  const feeRate = 0.108;

  it('물류비를 넘기지 않으면 수수료와 매출세액만 차감된다', () => {
    // 6,990 − 4,186 − 754.92 − 105 = 1,944.08
    expect(calcMargin({ sellingPrice: price, costPrice: cost, feeRate })).toBeCloseTo(1944, 0);
  });

  it('실측 물류비를 반영하면 흑자에서 적자로 뒤집힌다', () => {
    const rgFee = resolveRgShippingFee(null, 'extra_small');
    const margin = calcMargin({ sellingPrice: price, costPrice: cost, feeRate, rgShippingFee: rgFee });
    // 1,944 − 3,080 = −1,136. 요금표 최소값(1,898원)을 쓰던 시절에는 46원 흑자였다.
    expect(margin).toBeLessThan(0);
    expect(Math.round(margin)).toBe(-1136);
  });

  it('물류비 미반영 시 손익분기 ROAS가 과소평가된다', () => {
    const without = calcBreakevenRoas(
      price,
      calcMargin({ sellingPrice: price, costPrice: cost, feeRate }),
    );
    const withFee = calcBreakevenRoas(
      price,
      calcMargin({
        sellingPrice: price, costPrice: cost, feeRate,
        rgShippingFee: resolveRgShippingFee(null, 'extra_small'),
      }),
    );
    // 360% 대 Infinity — 광고로 메울 수 없는 상품을 "ROAS 360%면 흑자"로 오판하게 되는 지점이다.
    expect(Math.round(without)).toBe(360);
    expect(withFee).toBe(Infinity);
  });
});

describe('calcMarginPerUnit — 물류비 반영', () => {
  // 실제 사례: weet-bix 위트빅스 (판매가 11,480 / 원가 7,495 / 극소형)
  const sellingPrice = 11480;
  const costPrice = 7495;
  const feeRate = 0.108;

  it('물류비 인자를 생략하면 수수료·매출세액만 빠진다', () => {
    // 11,480 − 7,495 − 1,239.84 − 172 = 2,573.16
    expect(calcMarginPerUnit({ sellingPrice, costPrice, feeRate })).toBe(2573);
  });

  it('실측 물류비를 차감하면 적자가 된다', () => {
    const margin = calcMarginPerUnit({
      sellingPrice, costPrice, feeRate,
      shippingFee: resolveRgShippingFee(null, 'extra_small'),
    });
    expect(margin).toBe(-507);
  });
});

describe('ProductAdTable 원가 계산 — VAT 포함 물류비 사용', () => {
  // ProductAdTable.tsx가 실제로 넘기는 조합을 그대로 재현한다. CostEntry에는 실측
  // 정산액 필드가 없으므로 measuredFee는 항상 null이고, 사이즈 유형 기본값에
  // VAT를 반영한 실질 부담액(resolveRgShippingFee)이 쓰여야 한다.
  it('극소형 기준 VAT 포함 물류비는 VAT 별도 고지값보다 280원 크다', () => {
    const vatExclusive = getRgShippingFee('extra_small');
    const vatInclusive = resolveRgShippingFee(null, 'extra_small');
    expect(vatExclusive).toBe(2800);
    expect(vatInclusive).toBe(3080);
    expect(vatInclusive - vatExclusive).toBe(280);
  });

  it('VAT 별도 물류비로 마진을 계산하면 VAT 포함 대비 280원 과대평가된다', () => {
    const sellingPrice = 11480;
    const costPrice = 7495;
    const feeRate = 0.108;
    const marginWithVatExclusiveFee = calcMarginPerUnit({
      sellingPrice, costPrice, feeRate, shippingFee: getRgShippingFee('extra_small'),
    });
    const marginWithVatInclusiveFee = calcMarginPerUnit({
      sellingPrice, costPrice, feeRate, shippingFee: resolveRgShippingFee(null, 'extra_small'),
    });
    expect(marginWithVatExclusiveFee - marginWithVatInclusiveFee).toBe(280);
  });
});

describe('ProductAdTable 원가 계산 — VAT 포함 수수료율 사용', () => {
  // ProductAdTable.tsx가 실제로 넘기는 조합을 그대로 재현한다. localStorage에는
  // 고지 요율(VAT 별도)이 저장되어 있고, 계산 시점에 effectiveFeeRate로 변환된다.
  const sellingPrice = 20000;
  const costPrice = 12000;
  const listedFeeRate = 0.108;

  it('20,000원 · 극소형 기준, 고지 요율과 실효 요율의 마진 차이는 216원이다', () => {
    // 물류비는 양쪽 다 VAT 포함(3,080)으로 고정해 수수료율 효과만 분리한다.
    const shippingFee = resolveRgShippingFee(null, 'extra_small');
    const marginWithListedRate = calcMarginPerUnit({
      sellingPrice, costPrice, feeRate: listedFeeRate, shippingFee,
    });
    const marginWithEffectiveRate = calcMarginPerUnit({
      sellingPrice, costPrice, feeRate: effectiveFeeRate(listedFeeRate), shippingFee,
    });
    expect(marginWithListedRate - marginWithEffectiveRate).toBe(216);
  });

  it('수수료·물류비 VAT를 모두 반영하지 않으면 건당 496원(216+280) 과대평가된다', () => {
    const marginBeforeFix = calcMarginPerUnit({
      sellingPrice, costPrice, feeRate: listedFeeRate, shippingFee: getRgShippingFee('extra_small'),
    });
    const marginAfterFix = calcMarginPerUnit({
      sellingPrice, costPrice,
      feeRate: effectiveFeeRate(listedFeeRate),
      shippingFee: resolveRgShippingFee(null, 'extra_small'),
    });
    expect(marginBeforeFix - marginAfterFix).toBe(496);
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

describe('계산기 탭이 같은 원장을 쓴다', () => {
  // 직전 판은 calculator/fees.ts가 자체 추정값(극소형 1,800원)을 들고 있어
  // 같은 상품의 물류비가 계산기와 ROI 화면에서 달랐다.
  it('COUPANG_ROCKET_LOGISTICS는 rg-fees의 실효 요율과 일치한다', () => {
    for (const type of RG_SIZE_TYPES) {
      const label = RG_SIZE_SPECS[type].label as RocketSize;
      expect(COUPANG_ROCKET_LOGISTICS[label]).toBe(resolveRgShippingFee(null, type));
    }
  });

  it('RocketSize 라벨 집합이 RG_SIZE_SPECS와 어긋나지 않는다', () => {
    const labels = RG_SIZE_TYPES.map((t) => RG_SIZE_SPECS[t].label);
    expect(Object.keys(COUPANG_ROCKET_LOGISTICS).sort()).toEqual([...labels].sort());
  });
});
