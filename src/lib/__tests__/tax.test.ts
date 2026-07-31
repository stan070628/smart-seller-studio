// @vitest-environment node
/**
 * tax.test.ts
 * 부가세 처리 — 수수료 실질 부담률 변환
 *
 * 간이과세자는 매입세액 공제를 받지 못해 수수료 VAT가 그대로 비용이 된다.
 * 이 0.86%p 차이가 전 상품 마진에 걸리므로 변환식을 고정해둔다.
 */

import { describe, it, expect } from 'vitest';
import { effectiveFeeRate, VAT_RATE, IS_SIMPLIFIED_TAXPAYER } from '../tax';

describe('effectiveFeeRate', () => {
  it('간이과세자 기준으로 설정되어 있다', () => {
    expect(IS_SIMPLIFIED_TAXPAYER).toBe(true);
  });

  it('VAT율은 10%다', () => {
    expect(VAT_RATE).toBe(0.1);
  });

  it('실측 요율 10.6%를 11.66%로 변환한다', () => {
    expect(effectiveFeeRate(0.106)).toBeCloseTo(0.1166, 6);
  });

  it('기존 장부값 10.8%는 11.88%가 된다', () => {
    expect(effectiveFeeRate(0.108)).toBeCloseTo(0.1188, 6);
  });

  it('0은 0으로 남는다', () => {
    expect(effectiveFeeRate(0)).toBe(0);
  });

  it('부동소수점 오차가 누적되지 않는다', () => {
    // 0.106 * 1.1 = 0.11660000000000001 이 되는 것을 방지
    expect(effectiveFeeRate(0.106).toString()).toBe('0.1166');
  });

  describe('마진 영향', () => {
    it('극세사 타월 판매가 12,828원에서 수수료가 1,496원이 된다', () => {
      const fee = Math.round(12828 * effectiveFeeRate(0.106));
      expect(fee).toBe(1496);
    });

    it('VAT 미반영(10.8%) 대비 개당 111원 더 나간다', () => {
      const withVat = Math.round(12828 * effectiveFeeRate(0.106));
      const legacy = Math.round(12828 * 0.108);
      expect(withVat - legacy).toBe(111);
    });
  });
});
