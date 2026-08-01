import { describe, it, expect } from 'vitest';
import { calc1688UnitCost } from '@/lib/sourcing/cost-1688';

describe('calc1688UnitCost', () => {
  // 실측 샘플: 실리콘 필통 2개 ₩3,867 (src/__tests__/fixtures/1688/silicone-pencase.txt)
  it('필통 2개 주문 — 개당 1,934원, 국제배송비 322원', () => {
    const r = calc1688UnitCost({
      buyKrwTotal: 3867,
      orderQty: 2,
      intlShipPerUnitKrw: 322,
      itemName: '실리콘 필통',
      logisticsSize: 'xsmall',
    });

    expect(r.unitKrw).toBe(1934);           // round(3867 / 2)
    expect(r.dutiableValueKrw).toBe(2256);  // 1934 + 322
    expect(r.tariffRate).toBe(0.08);        // 관세율표에 없어 기본값
    expect(r.tariffKrw).toBe(180);          // round(2256 × 0.08)
    expect(r.importVatKrw).toBe(244);       // round((2256+180) × 0.1)
    expect(r.effectiveCostKrw).toBe(2680);
    expect(r.breakEvenPriceKrw).toBe(8427);
  });

  it('국제배송비 0이면 경고 플래그를 세운다', () => {
    const r = calc1688UnitCost({
      buyKrwTotal: 3867, orderQty: 2, intlShipPerUnitKrw: 0,
      itemName: '실리콘 필통', logisticsSize: 'xsmall',
    });
    // 0으로 두면 1688이 실제보다 싸 보인다 — 낙관 방향 오류라 표시로 남긴다
    expect(r.shippingMissing).toBe(true);
    expect(r.dutiableValueKrw).toBe(1934);
    expect(r.breakEvenPriceKrw).toBe(7993);  // 배송비를 넣으면 8,427로 오른다
  });

  it('품목명으로 관세율이 갈린다', () => {
    const base = { buyKrwTotal: 3867, orderQty: 2, intlShipPerUnitKrw: 322,
                   logisticsSize: 'xsmall' as const };
    expect(calc1688UnitCost({ ...base, itemName: '방한 장갑' }).tariffRate).toBe(0.08);
    expect(calc1688UnitCost({ ...base, itemName: '겨울 의류' }).tariffRate).toBe(0.13);
    expect(calc1688UnitCost({ ...base, itemName: '립밤 화장품' }).tariffRate).toBe(0.065);
  });

  it('수량이 0이면 계산하지 않는다', () => {
    const r = calc1688UnitCost({
      buyKrwTotal: 3867, orderQty: 0, intlShipPerUnitKrw: 322,
      itemName: '실리콘 필통', logisticsSize: 'xsmall',
    });
    expect(r.unitKrw).toBeNull();
    expect(r.effectiveCostKrw).toBeNull();
  });
});
