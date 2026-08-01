import { describe, it, expect } from 'vitest';
import { supplierCostsOf } from '@/lib/sourcing/shortlist-supplier-costs';
import { pickBestSupplier } from '@/lib/sourcing/supplier-verdict';
import type { ShortlistItem } from '@/types/shortlist';

/**
 * 브라우저에서 실제로 관측된 행이다 — 표에는 미달·마진율 −331%로 뜨는데
 * 펼치면 1688이 통과였다. 이 모듈이 두 화면에 같은 원가를 주는지 확인한다.
 */
const BASE: ShortlistItem = {
  itemNo: 55788793,
  title: '테스트 상품',
  memo: null,
  addedAt: '2026-07-31T00:00:00Z',

  domeStatus: '판매중',
  domePrice: 48100,
  domeInventory: 100,
  domeMoq: 1,

  deliIsFree: false,
  deliType: 'tiered',
  deliUnitQty: 30,
  deliFee: 9000,

  coupangP25: 12000,
  coupangSampleN: null,

  orderQty: 30,
  unitDeliFee: 300,
  effectiveCost: 48400,
  logisticsSize: 'xsmall',
  breakEvenPrice: 86542,
  margin: null,
  marginRate: -331,
  verdict: 'fail',
  verifiedAt: '2026-07-31T00:00:00Z',

  // 1688에서 샘플 2개를 3,867원에 샀다
  buyKrwTotal: 3867,
  buyCnyTotal: 17.5,
  orderQty1688: 2,
  exchangeRate1688: 220.97,
  intlShipPerUnit: null,
  pastedAt1688: '2026-07-31T00:00:00Z',

  isArchived: false,
};

describe('supplierCostsOf', () => {
  it('도매꾹은 저장된 값을 그대로 옮긴다', () => {
    const { dome } = supplierCostsOf(BASE);
    expect(dome).toEqual({
      supplier: 'dome',
      unitPriceKrw: 48100,
      shipPerUnitKrw: 300,
      shipEstimated: false,
      effectiveCostKrw: 48400,
      breakEvenPriceKrw: 86542,
    });
  });

  it('재검증이 원가를 못 세웠으면 도매꾹은 null이다', () => {
    const { dome } = supplierCostsOf({ ...BASE, effectiveCost: null, breakEvenPrice: null });
    expect(dome).toBeNull();
  });

  it('붙여넣기 값이 없으면 1688은 null이다', () => {
    const { cn1688, cn1688Detail } = supplierCostsOf({ ...BASE, buyKrwTotal: null, orderQty1688: null });
    expect(cn1688).toBeNull();
    expect(cn1688Detail).toBeNull();
  });

  it('개당 평균가는 1688 주문 수량으로, 국제배송비는 사입 수량으로 나눈다', () => {
    const { cn1688 } = supplierCostsOf(BASE);
    // 3,867원 ÷ 2개(샘플 주문) = 1,934원
    expect(cn1688!.unitPriceKrw).toBe(1934);
    // 극소형 0.3kg × 사입 30개 = 9kg → 15,980원 ÷ 30개 = 533원
    expect(cn1688!.shipPerUnitKrw).toBe(533);
    expect(cn1688!.shipEstimated).toBe(true);
  });

  it('사람이 넣은 국제배송비가 추정을 이긴다', () => {
    const { cn1688 } = supplierCostsOf({ ...BASE, intlShipPerUnit: 322 });
    expect(cn1688!.shipPerUnitKrw).toBe(322);
    expect(cn1688!.shipEstimated).toBe(false);
  });

  it('표가 보여줄 이긴 쪽은 1688이다 — 이 행이 미달로만 보이던 것이 버그였다', () => {
    const { dome, cn1688 } = supplierCostsOf(BASE);
    const best = pickBestSupplier(dome!, cn1688);
    expect(best.supplier).toBe('cn1688');
    expect(best.effectiveCostKrw).toBeLessThan(dome!.effectiveCostKrw);
    // 실판가 12,000원이 1688 손익분기를 넘는다 — 표에 통과로 떠야 한다
    expect(best.breakEvenPriceKrw).toBeLessThanOrEqual(12000);
  });
});
