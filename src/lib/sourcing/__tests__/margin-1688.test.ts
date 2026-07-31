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
      dutiableFreightKrw: 1000,
      nonDutiableFreightKrw: 0,
      packQty: 1,
      channel: 'coupang',
      categoryName: '생활용품',
      sellPrice: 10000,
      groceryRunningCost: 0,
    });

    // 2026-07-31 과세운임 반영: 과세가격 3,000(=2,000+1,000) → 관세 240, 부가세 324 → 3,564.
    // 옛 값 3,376은 관세를 상품가 2,000에만 물려 188원 과소 계상한 결과다.
    expect(r.purchaseCostKrw).toBeCloseTo(3564, 0);
    expect(r.netProfit).toBeGreaterThan(0);
    expect(r.marginRatePct).toBeGreaterThan(0);
  });

  it('packQty 입수 단위 적용: 100개 박스 단가는 buyPriceRmb / packQty', () => {
    const r = calc1688Margin({
      buyPriceRmb: 1000,
      exchangeRate: 200,
      tariffRate: 0.08,
      dutiableFreightKrw: 0,
      nonDutiableFreightKrw: 0,
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
      dutiableFreightKrw: 1000,
      nonDutiableFreightKrw: 0,
      packQty: 1,
      channel: 'coupang',
      categoryName: '생활용품',
      sellPrice: 10000,
      groceryRunningCost: 1500,
    });

    expect(r.totalCostKrw).toBeCloseTo(3564 + 1500, 0); // 2026-07-31 과세운임 반영
  });

  it('사입원가 > 시장가 → 마이너스 마진, isViable=false', () => {
    const r = calc1688Margin({
      buyPriceRmb: 100,
      exchangeRate: 200,
      tariffRate: 0.08,
      dutiableFreightKrw: 5000,
      nonDutiableFreightKrw: 0,
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
      dutiableFreightKrw: 1000,
      nonDutiableFreightKrw: 0,
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

describe('과세운임 반영 (2026-07-31)', () => {
  const base = {
    buyPriceRmb: 512.82,   // 10개입 박스, 개당 51.282위안
    packQty: 10,
    exchangeRate: 195,     // 개당 10,000원
    dutiableFreightKrw: 322,     // 배송비 몫 — 과세 대상
    nonDutiableFreightKrw: 0,    // 관세사 수임료 등 — 과세 대상 아님
    channel: 'coupang' as const,
    categoryName: null,
    sellPrice: 20000,
    groceryRunningCost: 0,
  };

  it('과세가격은 상품가 + 운임이다', () => {
    const r = calc1688Margin({ ...base, tariffRate: 0.08 });
    expect(r.landedKrw).toBe(10000);
    expect(r.dutiableValueKrw).toBe(10322);
  });

  it('관세는 과세가격 기준으로 계산된다 (상품가 기준이 아님)', () => {
    const r = calc1688Margin({ ...base, tariffRate: 0.08 });
    expect(r.tariffKrw).toBe(826);     // 10322 × 0.08, 기존 버그면 800
    expect(r.importVatKrw).toBe(1115); // (10322+826) × 0.1, 기존 버그면 1080
  });

  it('매입원가에 운임이 이중 계상되지 않는다', () => {
    const r = calc1688Margin({ ...base, tariffRate: 0.08 });
    // 과세가격 10,322 + 관세 826 + 부가세 1,115 = 12,263
    expect(r.purchaseCostKrw).toBe(12263);
  });

  it('의류 13%가 장갑 8%보다 비싸다', () => {
    const glove = calc1688Margin({ ...base, tariffRate: 0.08 });
    const cloth = calc1688Margin({ ...base, tariffRate: 0.13 });
    expect(cloth.purchaseCostKrw).toBe(12830);
    expect(cloth.purchaseCostKrw - glove.purchaseCostKrw).toBe(567);
  });

  it('비과세 부대비는 원가에는 들어가되 과세는 되지 않는다', () => {
    // 관세사 수임료 22,000원을 10개에 배분 → 개당 2,200원
    const r = calc1688Margin({ ...base, tariffRate: 0.08, nonDutiableFreightKrw: 2200 });

    // 과세 쪽은 부대비가 0일 때와 완전히 동일해야 한다
    expect(r.dutiableValueKrw).toBe(10322);
    expect(r.tariffKrw).toBe(826);
    expect(r.importVatKrw).toBe(1115);

    // 원가에는 더해진다 — 12,263 + 2,200
    expect(r.purchaseCostKrw).toBe(14463);
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
