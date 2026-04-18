/**
 * margin-formula-crosscheck.test.ts
 * Phase 4 Task 2: 가격 계산 크로스체크 테스트 — B2 회귀 방지
 *
 * 마진율 공식 2곳이 동일한 결과를 내는지 검증합니다:
 *  1. SQL marginExpr JS 재현: market * (1 - 0.06 - 10/110) - cost - 3500
 *  2. calcNetMarginRate(salePrice, costTotal, 'naver') from channel-policy.ts
 *
 * 허용 오차: 부동소수점 반올림으로 인한 0.01% 이내 차이
 *
 * 배경:
 *  route.ts의 SQL marginExpr에서 코스트코 고정 물류비 3500원을 차감하고,
 *  channel-policy.ts의 calcNetMarginRate는 costTotal에 물류비 포함을 가정합니다.
 *  두 공식이 동일 입력값(cost = 매입가 + 3500)에서 1% 이내 오차인지 확인합니다.
 */

import { describe, it, expect } from 'vitest';
import {
  calcNetMarginRate,
  calcNetProfit,
  CHANNEL_FEE,
  VAT_RATE,
} from '@/lib/sourcing/shared/channel-policy';

// ─────────────────────────────────────────────────────────────────────────────
// SQL marginExpr JavaScript 재현
// 공식 (route.ts 발췌):
//   ((market) * (1.0 - 0.06 - 10.0/110.0) - price - 3500.0) / (market) * 100
//
// 변수 매핑:
//   market = 시장 판매가 (market_lowest_price 또는 환산가)
//   price  = 코스트코 매입가 (DB column: price)
//   3500   = 고정 물류비
// ─────────────────────────────────────────────────────────────────────────────

const LOGISTICS_COST = 3500;
const NAVER_FEE = 0.06;         // CHANNEL_FEE['naver']
const VAT = 10.0 / 110.0;       // VAT_RATE

/**
 * SQL marginExpr 와 동일한 JavaScript 계산
 * @param market  시장 판매가
 * @param cost    코스트코 매입가 (물류비 미포함)
 * @param logistics 물류비 (기본 3500)
 */
function calcSqlMarginRate(market: number, cost: number, logistics: number = LOGISTICS_COST): number {
  return ((market * (1.0 - NAVER_FEE - VAT) - cost - logistics) / market) * 100;
}

/**
 * channel-policy.ts의 calcNetMarginRate 래퍼
 * costTotal = 매입가 + 물류비 (SQL에서는 price + 3500 을 분리해 차감)
 */
function calcPolicyMarginRate(market: number, cost: number, logistics: number = LOGISTICS_COST): number {
  return calcNetMarginRate(market, cost + logistics, 'naver');
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 입력 케이스
// ─────────────────────────────────────────────────────────────────────────────

const CASES = [
  { label: '일반 케이스 (시장가 3만원)', market: 30000, cost: 20000, logistics: 3500 },
  { label: '일반 케이스 (시장가 5만원)', market: 50000, cost: 35000, logistics: 3500 },
  { label: '저가 케이스 (시장가 1.5만원)', market: 15000, cost: 10000, logistics: 3500 },
  { label: '고가 케이스 (시장가 10만원)', market: 100000, cost: 60000, logistics: 3500 },
  { label: '마진 0% 경계값', market: 26000, cost: 22500, logistics: 3500 },
] as const;

// 허용 오차 (절대값, %p 단위)
// channel-policy.ts의 Math.round 처리로 인한 최대 오차
const TOLERANCE_PCT_POINT = 0.02;

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 스위트
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 4 Task 2: 마진율 공식 크로스체크 — B2 회귀 방지', () => {

  // ── 상수 일관성 검증 ───────────────────────────────────────────────────────

  describe('공식 상수 일관성 검증', () => {
    it('CHANNEL_FEE.naver가 0.06과 일치한다', () => {
      expect(CHANNEL_FEE['naver']).toBe(0.06);
    });

    it('VAT_RATE가 10/110과 일치한다', () => {
      expect(VAT_RATE).toBeCloseTo(10 / 110, 10);
    });

    it('SQL 공식의 NAVER_FEE가 channel-policy CHANNEL_FEE.naver와 동일하다', () => {
      expect(NAVER_FEE).toBe(CHANNEL_FEE['naver']);
    });

    it('SQL 공식의 VAT가 channel-policy VAT_RATE와 동일하다', () => {
      expect(VAT).toBeCloseTo(VAT_RATE, 10);
    });
  });

  // ── 두 공식 결과 크로스체크 ────────────────────────────────────────────────

  describe('SQL marginExpr vs calcNetMarginRate 크로스체크', () => {
    CASES.forEach(({ label, market, cost, logistics }) => {
      it(`${label} — 두 공식 오차가 ${TOLERANCE_PCT_POINT}%p 이내다`, () => {
        const sqlRate    = calcSqlMarginRate(market, cost, logistics);
        const policyRate = calcPolicyMarginRate(market, cost, logistics);

        const diff = Math.abs(sqlRate - policyRate);
        expect(diff).toBeLessThan(TOLERANCE_PCT_POINT);
      });
    });
  });

  // ── 각 케이스의 수치 방향성 검증 ─────────────────────────────────────────

  describe('마진율 방향성 검증', () => {
    it('시장가 > 원가+물류비 이면 SQL 마진율이 양수여야 한다', () => {
      // 30000 * (1 - 0.06 - 10/110) - 20000 - 3500 = 양수 예상
      const rate = calcSqlMarginRate(30000, 20000, 3500);
      expect(rate).toBeGreaterThan(0);
    });

    it('원가+물류비가 순매출보다 크면 마진율이 음수여야 한다', () => {
      // 시장가 15000, 원가 12000 + 물류비 3500 = 15500 (손실)
      const rate = calcSqlMarginRate(15000, 12000, 3500);
      expect(rate).toBeLessThan(0);
    });

    it('시장가가 높을수록 동일 원가 대비 마진율이 높아야 한다', () => {
      const rateLow  = calcSqlMarginRate(30000, 20000, 3500);
      const rateHigh = calcSqlMarginRate(50000, 20000, 3500);
      expect(rateHigh).toBeGreaterThan(rateLow);
    });

    it('물류비가 높을수록 마진율이 낮아야 한다', () => {
      const rateNormal = calcSqlMarginRate(30000, 20000, 3500);
      const rateHighLog = calcSqlMarginRate(30000, 20000, 5000);
      expect(rateHighLog).toBeLessThan(rateNormal);
    });
  });

  // ── calcNetProfit 정합성 검증 ─────────────────────────────────────────────

  describe('calcNetProfit 정합성 검증', () => {
    it('순이익 / 판매가 * 100 = calcNetMarginRate 가 성립한다', () => {
      const salePrice = 30000;
      const costTotal = 20000 + 3500;

      const netProfit  = calcNetProfit(salePrice, costTotal, 'naver');
      const marginRate = calcNetMarginRate(salePrice, costTotal, 'naver');

      // 직접 계산한 마진율과 함수 결과 비교
      const expectedRate = Math.round((netProfit / salePrice) * 10000) / 100;
      expect(marginRate).toBeCloseTo(expectedRate, 1);
    });

    it('판매가 0원이면 calcNetMarginRate가 0을 반환한다', () => {
      const rate = calcNetMarginRate(0, 10000, 'naver');
      expect(rate).toBe(0);
    });
  });

  // ── 실제 테이블 케이스 전체 검증 (스냅샷성 확인) ─────────────────────────

  describe('테스트 케이스 전체 수치 확인 (회귀 방지 스냅샷)', () => {
    /**
     * 실제 계산 공식:
     *   (market * (1 - 0.06 - 10/110) - cost - logistics) / market * 100
     *   = (market * 0.8491 - cost - logistics) / market * 100
     *
     * 검증값 (node.js 계산 기준):
     *   30000/20000/3500 → 6.58%
     *   50000/35000/3500 → 7.91%
     *   15000/10000/3500 → -5.09% (손실 구간)
     */

    it('market=30000, cost=20000, logistics=3500 → SQL 마진율이 약 5~8% 범위다', () => {
      const rate = calcSqlMarginRate(30000, 20000, 3500);
      // 30000 * (1 - 0.06 - 10/110) - 20000 - 3500 = 약 1973 → 6.58%
      expect(rate).toBeGreaterThan(5);
      expect(rate).toBeLessThan(8);
    });

    it('market=50000, cost=35000, logistics=3500 → SQL 마진율이 약 6~10% 범위다', () => {
      const rate = calcSqlMarginRate(50000, 35000, 3500);
      // 50000 * 0.8491 - 35000 - 3500 ≈ 3955 → 7.91%
      expect(rate).toBeGreaterThan(6);
      expect(rate).toBeLessThan(10);
    });

    it('market=15000, cost=10000, logistics=3500 → 원가+물류비가 순매출을 초과하므로 마진율이 음수다', () => {
      const rate = calcSqlMarginRate(15000, 10000, 3500);
      // 15000 * 0.8491 - 10000 - 3500 ≈ -764 → -5.09% (손실)
      expect(rate).toBeLessThan(0);
    });
  });
});
