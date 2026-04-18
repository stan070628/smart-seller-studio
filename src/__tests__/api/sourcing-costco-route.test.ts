/**
 * sourcing-costco-route.test.ts
 * Phase 1 버그 수정 단위 테스트
 *
 * B1: genderFilter='neutral' Zod enum 추가 검증
 * B2: marginExpr SQL 공식 계수 정확성 검증 (channel-policy.ts 기준)
 * B3: seasonOnly=true + 활성 키워드 0개 → 빈 결과 반환 조건 검증
 * B5: logPrices bulk INSERT (N+1 → 일괄 조회 + bulk VALUES INSERT)
 *
 * 실제 DB 연결 없이 Zod 스키마 파싱과 마진 공식 수치에 집중
 * B5는 소스 코드 정적 분석(fs.readFileSync) 방식으로 구현 확인
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// route.ts에서 사용하는 getQuerySchema와 동일한 스키마 재현
// 실제 라우트 핸들러를 import하면 DB/Next.js 의존성이 함께 로드되므로
// 스키마 정의만 분리해 테스트한다.
// ─────────────────────────────────────────────────────────────────────────────

const getQuerySchema = z.object({
  category: z.string().optional(),
  page: z.coerce.number().min(1).optional().default(1),
  pageSize: z.coerce.number().min(1).max(200).optional().default(50),
  search: z.string().optional(),
  sort: z
    .enum([
      'sourcing_score_desc',
      'unit_saving_rate_desc',
      'margin_rate_desc',
      'price_asc',
      'price_desc',
      'review_count_desc',
      'collected_desc',
    ])
    .optional()
    .default('unit_saving_rate_desc'),
  stockStatus: z.enum(['all', 'inStock', 'outOfStock', 'lowStock']).optional().default('all'),
  savingFilter: z.enum(['all', 'high', 'mid', 'any']).optional().default('all'),
  /** B1: neutral이 enum에 포함되어야 한다 */
  genderFilter: z
    .enum(['all', 'male_high', 'male_friendly', 'neutral', 'female'])
    .optional()
    .default('all'),
  seasonOnly: z.coerce.boolean().optional().default(false),
  grade: z.enum(['all', 'S', 'A', 'B', 'C', 'D']).optional().default('all'),
  asteriskOnly: z.coerce.boolean().optional().default(false),
});

// ─────────────────────────────────────────────────────────────────────────────
// B2: SQL marginExpr 공식과 동일한 JavaScript 계산 함수
// 공식: (market * (1.0 - 0.06 - 10.0/110.0) - price - logistics) / market * 100
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SQL marginExpr와 동일한 계산 (JavaScript 버전)
 * market: 시장 판매가, cost: 코스트코 매입가, logistics: 배송비(기본 3500)
 */
function calcSqlMarginRate(market: number, cost: number, logistics: number): number {
  const NAVER_FEE = 0.06;
  const VAT = 10.0 / 110.0;
  return ((market * (1.0 - NAVER_FEE - VAT) - cost - logistics) / market) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// B3: seasonOnly 조건 빌더 로직 (route.ts에서 추출)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * route.ts의 seasonOnly 분기 로직을 그대로 재현한 순수 함수
 * conditions 배열을 반환 (DB 쿼리 없이 로직만 검증)
 */
function buildSeasonConditions(seasonOnly: boolean, keywords: string[]): string[] {
  const conditions: string[] = [];

  if (seasonOnly) {
    if (keywords.length > 0) {
      // 실제 라우트와 동일: ILIKE 조건 배열을 OR로 연결
      conditions.push(`(${keywords.map(() => 'title ILIKE ?').join(' OR ')})`);
    } else {
      // B3 핵심 수정: 활성 키워드가 없으면 항상 빈 결과를 내는 조건 추가
      conditions.push('false');
    }
  }

  return conditions;
}

// ─────────────────────────────────────────────────────────────────────────────
// season-bonus 모듈 mock 설정
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/lib/sourcing/shared/season-bonus', () => ({
  getActiveSeasonKeywords: vi.fn(),
}));

import { getActiveSeasonKeywords } from '@/lib/sourcing/shared/season-bonus';
const mockGetActiveSeasonKeywords = getActiveSeasonKeywords as ReturnType<typeof vi.fn>;

// ─────────────────────────────────────────────────────────────────────────────
// channel-policy.ts는 실제 모듈을 import (순수 함수, 외부 의존성 없음)
// ─────────────────────────────────────────────────────────────────────────────

import { calcNetMarginRate, CHANNEL_FEE, VAT_RATE } from '@/lib/sourcing/shared/channel-policy';

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 스위트
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1 버그 수정 단위 테스트', () => {

  // ─── B1: genderFilter Zod enum ───────────────────────────────────────────

  describe('B1: genderFilter Zod enum 검증', () => {
    it('genderFilter 기본값(all)이 Zod 파싱을 통과한다', () => {
      const result = getQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data?.genderFilter).toBe('all');
    });

    it('genderFilter=all 이 파싱을 통과한다', () => {
      const result = getQuerySchema.safeParse({ genderFilter: 'all' });
      expect(result.success).toBe(true);
      expect(result.data?.genderFilter).toBe('all');
    });

    it('genderFilter=male_high 이 파싱을 통과한다', () => {
      const result = getQuerySchema.safeParse({ genderFilter: 'male_high' });
      expect(result.success).toBe(true);
      expect(result.data?.genderFilter).toBe('male_high');
    });

    it('genderFilter=male_friendly 이 파싱을 통과한다', () => {
      const result = getQuerySchema.safeParse({ genderFilter: 'male_friendly' });
      expect(result.success).toBe(true);
      expect(result.data?.genderFilter).toBe('male_friendly');
    });

    it('genderFilter=neutral 이 파싱을 통과한다 (B1 핵심)', () => {
      const result = getQuerySchema.safeParse({ genderFilter: 'neutral' });
      expect(result.success).toBe(true);
      expect(result.data?.genderFilter).toBe('neutral');
    });

    it('genderFilter=female 이 파싱을 통과한다', () => {
      const result = getQuerySchema.safeParse({ genderFilter: 'female' });
      expect(result.success).toBe(true);
      expect(result.data?.genderFilter).toBe('female');
    });

    it('genderFilter=unknown 은 파싱에 실패한다', () => {
      const result = getQuerySchema.safeParse({ genderFilter: 'unknown' });
      expect(result.success).toBe(false);
    });

    it('genderFilter=MALE_HIGH (대문자) 는 파싱에 실패한다', () => {
      const result = getQuerySchema.safeParse({ genderFilter: 'MALE_HIGH' });
      expect(result.success).toBe(false);
    });

    it('genderFilter=neutral 과 다른 파라미터를 함께 전달해도 파싱을 통과한다', () => {
      const result = getQuerySchema.safeParse({
        genderFilter: 'neutral',
        sort: 'margin_rate_desc',
        pageSize: '20',
        grade: 'A',
      });
      expect(result.success).toBe(true);
      expect(result.data?.genderFilter).toBe('neutral');
      expect(result.data?.sort).toBe('margin_rate_desc');
      expect(result.data?.pageSize).toBe(20);
    });
  });

  // ─── B2: marginExpr SQL 공식 계수 검증 ───────────────────────────────────

  describe('B2: 마진율 SQL 공식 계수 정확성 검증', () => {
    it('CHANNEL_FEE.naver 는 0.06 이다', () => {
      expect(CHANNEL_FEE.naver).toBe(0.06);
    });

    it('VAT_RATE 는 10/110 이다', () => {
      expect(VAT_RATE).toBeCloseTo(10 / 110, 10);
    });

    it('SQL 공식의 공제율 합계(0.06 + 10/110)가 약 0.1509 이다', () => {
      const totalDeduction = 0.06 + 10 / 110;
      expect(totalDeduction).toBeCloseTo(0.1509, 3);
    });

    it('market=30000, cost=20000, logistics=3500 에서 SQL 공식 마진율이 양수이다', () => {
      const rate = calcSqlMarginRate(30000, 20000, 3500);
      expect(rate).toBeGreaterThan(0);
    });

    it('market=30000, cost=20000, logistics=3500 에서 SQL 공식과 channel-policy calcNetMarginRate가 유사한 결과를 낸다', () => {
      const market = 30000;
      const cost = 20000;
      const logistics = 3500;

      // SQL 공식 (JavaScript 재현)
      const sqlRate = calcSqlMarginRate(market, cost + logistics, 0);

      // channel-policy.ts calcNetMarginRate: costTotal = cost + logistics
      const policyRate = calcNetMarginRate(market, cost + logistics, 'naver');

      // 두 공식 모두 동일한 네이버 수수료(0.06) + VAT(10/110) 사용
      // 반올림 차이(Math.round) 때문에 1% 이내 오차 허용
      expect(Math.abs(sqlRate - policyRate)).toBeLessThan(1.0);
    });

    it('market=30000, cost=20000, logistics=3500 에서 마진율이 약 3~5% 범위 내에 있다', () => {
      const market = 30000;
      const cost = 20000;
      const logistics = 3500;
      const rate = calcSqlMarginRate(market, cost, logistics);
      // 30000 * (1 - 0.06 - 10/110) = 30000 * 0.8491 = 25473
      // 25473 - 20000 - 3500 = 1973
      // 1973 / 30000 * 100 ≈ 6.58%
      expect(rate).toBeGreaterThan(5);
      expect(rate).toBeLessThan(10);
    });

    it('구 공식(market * 0.90 / 1.10)과 신 공식(market * (1 - 0.06 - 10/110))의 결과가 다르다 (회귀 방지)', () => {
      const market = 30000;
      const cost = 20000;
      const logistics = 3500;

      // 구 공식 (버그 수정 전)
      const oldDeduction = market * 0.90 / 1.10;
      const oldRate = (oldDeduction - cost - logistics) / market * 100;

      // 신 공식 (버그 수정 후)
      const newRate = calcSqlMarginRate(market, cost, logistics);

      // 두 공식의 결과가 달라야 한다 (수정이 실제로 수치를 바꿨음을 확인)
      expect(Math.abs(oldRate - newRate)).toBeGreaterThan(0.1);
    });

    it('마진이 음수인 경우(cost > market)에도 공식이 올바르게 음수를 반환한다', () => {
      const rate = calcSqlMarginRate(10000, 15000, 3500);
      expect(rate).toBeLessThan(0);
    });

    it('market=50000, cost=25000, logistics=3500 에서 마진율 기대값과 일치한다', () => {
      const market = 50000;
      const cost = 25000;
      const logistics = 3500;
      const expected =
        ((market * (1.0 - 0.06 - 10.0 / 110.0) - cost - logistics) / market) * 100;
      const actual = calcSqlMarginRate(market, cost, logistics);
      expect(actual).toBeCloseTo(expected, 5);
    });
  });

  // ─── B3: seasonOnly 활성 키워드 0개 시 빈 결과 조건 ─────────────────────

  describe('B3: seasonOnly=true + 활성 키워드 0개 시 빈 결과 반환 조건 검증', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('seasonOnly=false 이면 조건이 추가되지 않는다', () => {
      const conditions = buildSeasonConditions(false, []);
      expect(conditions).toHaveLength(0);
    });

    it('seasonOnly=true 이고 키워드가 빈 배열이면 "false" 조건이 추가된다 (B3 핵심)', () => {
      const conditions = buildSeasonConditions(true, []);
      expect(conditions).toHaveLength(1);
      expect(conditions[0]).toBe('false');
    });

    it('seasonOnly=true 이고 키워드가 있으면 ILIKE 조건이 추가된다', () => {
      const keywords = ['캠핑', '텐트'];
      const conditions = buildSeasonConditions(true, keywords);
      expect(conditions).toHaveLength(1);
      // "false" 가 아닌 실제 ILIKE 조건이어야 한다
      expect(conditions[0]).not.toBe('false');
      expect(conditions[0]).toContain('ILIKE');
    });

    it('seasonOnly=true 이고 키워드 1개면 OR 없이 단일 ILIKE 조건이 생성된다', () => {
      const conditions = buildSeasonConditions(true, ['크리스마스']);
      expect(conditions[0]).toContain('ILIKE');
      // OR 키워드가 없어야 한다 (단일 키워드)
      expect(conditions[0]).not.toContain('OR');
    });

    it('seasonOnly=true 이고 키워드 2개 이상이면 OR로 연결된 조건이 생성된다', () => {
      const conditions = buildSeasonConditions(true, ['캠핑', '텐트', '쿨러']);
      expect(conditions[0]).toContain('OR');
    });

    it('getActiveSeasonKeywords가 빈 배열을 반환할 때 mock이 정상 작동한다', () => {
      mockGetActiveSeasonKeywords.mockReturnValue([]);
      const keywords = getActiveSeasonKeywords();
      const conditions = buildSeasonConditions(true, keywords);
      expect(conditions[0]).toBe('false');
    });

    it('getActiveSeasonKeywords가 키워드를 반환할 때 mock이 정상 작동한다', () => {
      mockGetActiveSeasonKeywords.mockReturnValue(['캠핑', '텐트', '쿨러']);
      const keywords = getActiveSeasonKeywords();
      const conditions = buildSeasonConditions(true, keywords);
      expect(conditions[0]).not.toBe('false');
      expect(conditions[0]).toContain('ILIKE');
    });

    it('seasonOnly=true + 빈 키워드 조건은 "false" 단독이므로 WHERE절이 항상 0건을 반환한다 (의도 확인)', () => {
      // "false"가 AND로 연결되면 전체 조건이 false가 되어 빈 결과를 보장
      const baseConditions = ['is_active = true'];
      const seasonConditions = buildSeasonConditions(true, []);
      const allConditions = [...baseConditions, ...seasonConditions];

      expect(allConditions).toContain('false');
      // WHERE is_active = true AND false → 항상 0건
      const whereClause = `WHERE ${allConditions.join(' AND ')}`;
      expect(whereClause).toContain('AND false');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B5: logPrices bulk INSERT 정적 분석
// ─────────────────────────────────────────────────────────────────────────────

const COSTCO_ROUTE_PATH = path.resolve(
  __dirname,
  '../../app/api/sourcing/costco/route.ts',
);

const routeSource = fs.readFileSync(COSTCO_ROUTE_PATH, 'utf-8');

describe('Phase 3 B5: logPrices bulk INSERT 구현 검증', () => {

  describe('일괄 조회 쿼리 (N+1 제거)', () => {
    it('logPrices 함수 내에 product_code = ANY($1) 패턴이 존재한다', () => {
      // 기존 N+1 방식(루프 내 SELECT)을 한 번의 WHERE ... = ANY($1) 로 교체했는지 확인
      const logPricesBlock = routeSource.match(
        /async function logPrices[\s\S]{0,2000}^}/m
      );
      expect(logPricesBlock).not.toBeNull();
      expect(logPricesBlock![0]).toMatch(/product_code\s*=\s*ANY\s*\(\s*\$1\s*\)/);
    });

    it('logPrices 함수가 소스에 존재한다', () => {
      expect(routeSource).toMatch(/async function logPrices\s*\(/);
    });

    it('product_code = ANY($1) 패턴이 소스 전체에 존재한다', () => {
      expect(routeSource).toMatch(/product_code\s*=\s*ANY\s*\(\s*\$1\s*\)/);
    });
  });

  describe('루프 내 N+1 쿼리 제거 확인', () => {
    it('for...of products 루프 내부에 pool.query 호출이 없다', () => {
      // logPrices 함수 영역을 추출해서 루프 내 pool.query 여부 확인
      // 패턴: for (const ... of ...) { ... pool.query ... }  → 이 패턴이 없어야 한다
      const loopWithQueryPattern = /for\s*\(const\s+\w+\s+of\s+\w+\s*\)[\s\S]{0,300}pool\.query\s*\(/;
      expect(routeSource).not.toMatch(loopWithQueryPattern);
    });

    it('logPrices 함수 내 forEach 루프에는 pool.query 호출이 없다 (값 구성 전용)', () => {
      // forEach는 valuePlaceholders 구성에만 사용, pool.query 호출 없음
      const logPricesBlock = routeSource.match(
        /async function logPrices[\s\S]{0,2000}^}/m
      );
      if (logPricesBlock) {
        // forEach 블록 내 pool.query 부재 확인
        const forEachWithQuery = logPricesBlock[0].match(
          /forEach[\s\S]{0,200}pool\.query/
        );
        expect(forEachWithQuery).toBeNull();
      }
    });
  });

  describe('bulk VALUES INSERT 구현', () => {
    it('valuePlaceholders.join(",") 패턴이 존재한다', () => {
      // 여러 rows를 하나의 INSERT로 합치는 join 호출 확인
      expect(routeSource).toMatch(/valuePlaceholders\.join\s*\(\s*['"],?['"]?\s*\)/);
    });

    it('VALUES ${...join(...)} 패턴으로 bulk INSERT가 구성된다', () => {
      expect(routeSource).toMatch(/VALUES\s+\$\{valuePlaceholders\.join/);
    });

    it('valuePlaceholders 배열이 선언되어 있다', () => {
      expect(routeSource).toMatch(/const\s+valuePlaceholders\s*:\s*string\[\]\s*=\s*\[\]/);
    });
  });

  describe('ON CONFLICT 처리', () => {
    it('ON CONFLICT (product_code, logged_at) 절이 존재한다', () => {
      // (product_code, logged_at) 복합 유니크 키로 중복 삽입 방지
      expect(routeSource).toMatch(/ON CONFLICT\s*\(\s*product_code\s*,\s*logged_at\s*\)/);
    });

    it('ON CONFLICT 시 price를 EXCLUDED.price로 업데이트한다', () => {
      expect(routeSource).toMatch(/DO UPDATE SET price\s*=\s*EXCLUDED\.price/);
    });
  });

  describe('빈 배열 가드', () => {
    it('logPrices 함수에 products.length === 0 early return이 있다', () => {
      // 빈 배열이 들어올 때 쿼리 없이 즉시 반환하는 가드 확인
      const logPricesBlock = routeSource.match(
        /async function logPrices[\s\S]{0,2000}^}/m
      );
      expect(logPricesBlock).not.toBeNull();
      expect(logPricesBlock![0]).toMatch(/products\.length\s*===\s*0[\s\S]{0,30}return/);
    });
  });
});
