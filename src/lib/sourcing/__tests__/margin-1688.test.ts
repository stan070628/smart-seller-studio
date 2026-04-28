import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EXCHANGE_RATE_KRW_PER_RMB,
  DEFAULT_TARIFF_RATE,
  IMPORT_VAT_RATE,
  calc1688Margin,
  compareWholesaleVsBuy,
} from '../margin-1688';

describe('상수 검증', () => {
  it('환율 기본값 190 ~ 200 범위', () => {
    expect(DEFAULT_EXCHANGE_RATE_KRW_PER_RMB).toBeGreaterThan(180);
    expect(DEFAULT_EXCHANGE_RATE_KRW_PER_RMB).toBeLessThan(210);
  });

  it('관세 기본값 8%', () => {
    expect(DEFAULT_TARIFF_RATE).toBe(0.08);
  });

  it('수입 VAT 10%', () => {
    expect(IMPORT_VAT_RATE).toBe(0.1);
  });
});

describe('calc1688Margin — 1688 사입 실 마진', () => {
  it('가장 단순한 케이스: 위안가 10원, 환율 200, 관세 8%, 수입VAT 10%, 시장가 10000원', () => {
    const r = calc1688Margin({
      buyPriceRmb: 10,
      exchangeRate: 200,
      tariffRate: 0.08,
      shippingPerUnitKrw: 1000,
      packQty: 1,
      channel: 'coupang',
      categoryName: '생활용품',
      sellPrice: 10000,
      groceryRunningCost: 0,
    });

    expect(r.purchaseCostKrw).toBeCloseTo(3376, 0);
    expect(r.netProfit).toBeGreaterThan(0);
    expect(r.marginRatePct).toBeGreaterThan(0);
  });

  it('packQty 입수 단위 적용: 100개 박스 단가는 buyPriceRmb / packQty', () => {
    const r = calc1688Margin({
      buyPriceRmb: 1000,
      exchangeRate: 200,
      tariffRate: 0.08,
      shippingPerUnitKrw: 0,
      packQty: 100,
      channel: 'coupang',
      categoryName: '생활용품',
      sellPrice: 10000,
      groceryRunningCost: 0,
    });

    expect(r.purchaseCostKrw).toBeCloseTo(2376, 0);
  });

  it('그로스 운영비(입고+보관+출고) 가산', () => {
    const r = calc1688Margin({
      buyPriceRmb: 10,
      exchangeRate: 200,
      tariffRate: 0.08,
      shippingPerUnitKrw: 1000,
      packQty: 1,
      channel: 'coupang',
      categoryName: '생활용품',
      sellPrice: 10000,
      groceryRunningCost: 1500,
    });

    expect(r.totalCostKrw).toBeCloseTo(3376 + 1500, 0);
  });

  it('사입원가 > 시장가 → 마이너스 마진, isViable=false', () => {
    const r = calc1688Margin({
      buyPriceRmb: 100,
      exchangeRate: 200,
      tariffRate: 0.08,
      shippingPerUnitKrw: 5000,
      packQty: 1,
      channel: 'coupang',
      categoryName: '생활용품',
      sellPrice: 10000,
      groceryRunningCost: 1500,
    });

    expect(r.netProfit).toBeLessThan(0);
    expect(r.isViable).toBe(false);
  });

  it('네이버 채널은 coupang보다 수수료 낮아 마진 더 큼 (동일 조건)', () => {
    const base = {
      buyPriceRmb: 10,
      exchangeRate: 200,
      tariffRate: 0.08,
      shippingPerUnitKrw: 1000,
      packQty: 1,
      categoryName: '생활용품',
      sellPrice: 10000,
      groceryRunningCost: 0,
    } as const;

    const naver = calc1688Margin({ ...base, channel: 'naver' });
    const coupang = calc1688Margin({ ...base, channel: 'coupang' });
    expect(naver.netProfit).toBeGreaterThan(coupang.netProfit);
  });
});

describe('compareWholesaleVsBuy — 위탁 vs 사입 비교', () => {
  it('사입 마진이 위탁보다 큼 → "buy" 권장', () => {
    const result = compareWholesaleVsBuy({
      wholesaleMarginPerUnitKrw: 1500,
      buyMarginPerUnitKrw: 4000,
      monthlySalesQty: 30,
      buyCapitalNeededKrw: 600000,
    });
    expect(result.recommendation).toBe('buy');
    expect(result.monthlyDiffKrw).toBeCloseTo((4000 - 1500) * 30);
  });

  it('월 마진 차액으로 사입 자본 회수 ≤ 1개월 → 강력 권장 (buy_strong)', () => {
    const result = compareWholesaleVsBuy({
      wholesaleMarginPerUnitKrw: 1000,
      buyMarginPerUnitKrw: 5000,
      monthlySalesQty: 50,
      buyCapitalNeededKrw: 150000,
    });
    expect(result.recommendation).toBe('buy_strong');
    expect(result.paybackMonths).toBeLessThan(1);
  });

  it('사입 마진이 위탁과 비슷 → "hold" (전환 비추천)', () => {
    const result = compareWholesaleVsBuy({
      wholesaleMarginPerUnitKrw: 2000,
      buyMarginPerUnitKrw: 2200,
      monthlySalesQty: 20,
      buyCapitalNeededKrw: 500000,
    });
    expect(result.recommendation).toBe('hold');
  });

  it('사입 마진 < 위탁 마진 → "wholesale_only"', () => {
    const result = compareWholesaleVsBuy({
      wholesaleMarginPerUnitKrw: 3000,
      buyMarginPerUnitKrw: 1500,
      monthlySalesQty: 10,
      buyCapitalNeededKrw: 300000,
    });
    expect(result.recommendation).toBe('wholesale_only');
  });

  it('월 판매량 0 → "insufficient_data"', () => {
    const result = compareWholesaleVsBuy({
      wholesaleMarginPerUnitKrw: 1000,
      buyMarginPerUnitKrw: 3000,
      monthlySalesQty: 0,
      buyCapitalNeededKrw: 500000,
    });
    expect(result.recommendation).toBe('insufficient_data');
  });
});
