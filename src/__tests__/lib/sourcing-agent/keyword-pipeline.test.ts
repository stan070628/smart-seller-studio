import { describe, it, expect } from 'vitest';
import { evaluateCandidate } from '@/lib/sourcing-agent/keyword-pipeline';

describe('evaluateCandidate', () => {
  it('쿠팡 p25가 손익분기가 이상이면 pass다', () => {
    // 실효원가 3,600 · 극소형 → 손익분기 9,471. p25 10,500
    // p25는 최소 판매가 하한(10,000) 이상이어야 손익분기 판정까지 도달한다.
    const r = evaluateCandidate({
      domePrice: 3300,
      unitDeliFee: 300,
      coupangP25: 10500,
      coupangSampleN: 91,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('pass');
    expect(r.effectiveCost).toBe(3600);
    expect(r.breakEvenPrice).toBe(9471); // 2026-07-31 VAT 반영 — Task 1 참조
  });

  it('p25가 손익분기 미달이면 fail이다', () => {
    // 실효원가 7,230 · 극소형 → 손익분기 15,706.
    // p25 12,000은 최소 판매가 하한(10,000)은 넘고 손익분기에는 미달한다.
    // 하한 미만 값을 쓰면 under_min_price로 단락되어 이 분기를 검증하지 못한다.
    const r = evaluateCandidate({
      domePrice: 6930,
      unitDeliFee: 300,
      coupangP25: 12000,
      coupangSampleN: 40,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('fail');
    expect(r.failReason).toBe('below_breakeven');
  });

  it('쿠팡 표본이 3건 미만이면 unknown이다 (fail이 아니다)', () => {
    const r = evaluateCandidate({
      domePrice: 3300,
      unitDeliFee: 300,
      coupangP25: 20000,
      coupangSampleN: 2,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('unknown');
  });

  it('p25를 못 구하면 unknown이다', () => {
    const r = evaluateCandidate({
      domePrice: 3300,
      unitDeliFee: 300,
      coupangP25: null,
      coupangSampleN: 0,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('unknown');
  });

  it('판매가 1만원 미만이면 fail이다 (목표 역산 기준)', () => {
    const r = evaluateCandidate({
      domePrice: 1000,
      unitDeliFee: 100,
      coupangP25: 8000,
      coupangSampleN: 50,
      logisticsSize: 'xsmall',
    });
    expect(r.verdict).toBe('fail');
    expect(r.failReason).toBe('under_min_price');
  });
});
