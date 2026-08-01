import { describe, it, expect } from 'vitest';
import { judgeSupplier, pickBestSupplier } from '@/lib/sourcing/supplier-verdict';

const DOME = {
  supplier: 'dome' as const,
  unitPriceKrw: 48100,
  shipPerUnitKrw: 300,
  shipEstimated: false,
  effectiveCostKrw: 48400,
  breakEvenPriceKrw: 86542,
};
const CN = {
  supplier: 'cn1688' as const,
  unitPriceKrw: 1934,
  shipPerUnitKrw: 533,
  shipEstimated: true,
  effectiveCostKrw: 2930,
  breakEvenPriceKrw: 8710,
};

describe('judgeSupplier', () => {
  it('실판가가 손익분기 이상이면 통과', () => {
    const r = judgeSupplier(12000, CN, 'xsmall');
    expect(r.verdict).toBe('pass');
    expect(r.marginRatePct).toBeGreaterThan(0);
  });

  it('손익분기 미달이면 부족액을 말한다', () => {
    const r = judgeSupplier(12000, DOME, 'xsmall');
    expect(r.verdict).toBe('fail');
    expect(r.why).toContain('74,542');
  });

  it('1만원 하한이 손익분기보다 먼저다', () => {
    // 9,900원은 1688 손익분기 8,710원을 넘지만 하한 미만이다
    const r = judgeSupplier(9900, CN, 'xsmall');
    expect(r.verdict).toBe('fail');
    expect(r.why).toContain('하한');
    expect(r.why).toContain('공급처와 무관');
  });

  it('실판가가 없으면 판정하지 않는다', () => {
    expect(judgeSupplier(null, CN, 'xsmall').verdict).toBe('unknown');
  });
});

describe('pickBestSupplier', () => {
  it('실효원가가 낮은 쪽을 고른다', () => {
    expect(pickBestSupplier(DOME, CN).supplier).toBe('cn1688');
  });

  it('1688 값이 없으면 도매꾹', () => {
    expect(pickBestSupplier(DOME, null).supplier).toBe('dome');
  });

  it('도매꾹이 더 싸면 도매꾹', () => {
    // 계획 원문은 `breakEvenPrice: 5000`이었으나 SupplierCost의 필드명은
    // breakEvenPriceKrw다. 원문대로 두면 존재하지 않는 필드를 붙이고 손익분기는
    // 48,400원 원가 시절 값(86,542)이 그대로 남아 행이 자기모순이 된다.
    const cheapDome = { ...DOME, effectiveCostKrw: 1000, breakEvenPriceKrw: 5000 };
    expect(pickBestSupplier(cheapDome, CN).supplier).toBe('dome');
  });

  it('동률이면 도매꾹 — 리드타임이 짧고 통관 위험이 없다', () => {
    const tie = { ...CN, effectiveCostKrw: DOME.effectiveCostKrw };
    expect(pickBestSupplier(DOME, tie).supplier).toBe('dome');
  });
});
