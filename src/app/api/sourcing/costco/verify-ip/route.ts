/**
 * POST /api/sourcing/costco/verify-ip
 * KIPRIS 상표/특허/디자인 검색으로 코스트코 상품 IP 리스크 등급 산출
 *
 * Body: { keyword: string, productCode: string, types?: ('trademark' | 'patent' | 'design')[] }
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     trademark: { totalCount, riskLevel, items: [...top 5] },
 *     patent:    { totalCount, riskLevel, items: [...top 5] },
 *     design:    { totalCount, riskLevel, items: [...top 5] },
 *     overallRisk: 'low' | 'medium' | 'high'
 *   }
 * }
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getKiprisClient } from '@/lib/sourcing/kipris-client';
import { getSourcingPool } from '@/lib/sourcing/db';
import type { KiprisItem, KiprisSearchResult } from '@/lib/sourcing/kipris-client';

// ─────────────────────────────────────────────────────────────────────────────
// 요청 스키마 검증
// ─────────────────────────────────────────────────────────────────────────────

const IP_TYPES = ['trademark', 'patent', 'design'] as const;
type IpType = (typeof IP_TYPES)[number];

const BodySchema = z.object({
  keyword: z.string().min(1).max(100),
  productCode: z.string().min(1),
  types: z.array(z.enum(IP_TYPES)).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// 리스크 레벨 산출
// ─────────────────────────────────────────────────────────────────────────────

type RiskLevel = 'low' | 'medium' | 'high';

/**
 * 개별 검색 결과에서 리스크 레벨 판단
 *   - high   : '등록' 상태 항목이 1건 이상 존재
 *   - medium : 결과 존재하지만 등록 건 없음
 *   - low    : 결과 없음
 */
function calcRiskLevel(result: KiprisSearchResult): RiskLevel {
  if (result.totalCount === 0) return 'low';
  const hasRegistered = result.items.some(
    (item) => item.registerStatus === '등록',
  );
  return hasRegistered ? 'high' : 'medium';
}

/**
 * trademark / patent / design 세 개의 리스크 레벨 중 가장 높은 값 반환
 * 우선순위: high > medium > low
 */
function calcOverallRisk(levels: RiskLevel[]): RiskLevel {
  if (levels.includes('high')) return 'high';
  if (levels.includes('medium')) return 'medium';
  return 'low';
}

// ─────────────────────────────────────────────────────────────────────────────
// 검색 결과 요약 생성 (상위 5개 항목만 포함)
// ─────────────────────────────────────────────────────────────────────────────

interface IpTypeResult {
  totalCount: number;
  riskLevel: RiskLevel;
  items: KiprisItem[];
}

function summarizeResult(result: KiprisSearchResult): IpTypeResult {
  return {
    totalCount: result.totalCount,
    riskLevel: calcRiskLevel(result),
    items: result.items.slice(0, 5),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// costco_score_legal 점수 환산
//   high   → 0점  (IP 리스크 높음)
//   medium → 7점  (부분 리스크)
//   low    → 15점 (클린)
// ─────────────────────────────────────────────────────────────────────────────

function riskToLegalScore(risk: RiskLevel): number {
  if (risk === 'low')    return 15;
  if (risk === 'medium') return 7;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB 저장 (costco_products 테이블)
// ─────────────────────────────────────────────────────────────────────────────

async function saveCostcoIpResult(
  productCode: string,
  overallRisk: RiskLevel,
  details: Record<string, IpTypeResult>,
): Promise<void> {
  const pool = getSourcingPool();
  const legalScore = riskToLegalScore(overallRisk);
  await pool.query(
    `UPDATE costco_products
     SET
       costco_score_legal = $1,
       updated_at         = NOW()
     WHERE product_code = $2`,
    [legalScore, productCode],
  );
  // ip_details, ip_checked_at 컬럼이 있으면 추가 저장 (없으면 무시)
  try {
    await pool.query(
      `UPDATE costco_products
       SET
         ip_risk_level = $1,
         ip_checked_at = NOW(),
         ip_details    = $2
       WHERE product_code = $3`,
      [overallRisk, JSON.stringify(details), productCode],
    );
  } catch {
    // ip_* 컬럼이 없는 경우 무시 — costco_score_legal 업데이트로 충분
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST 핸들러
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { success: false, error: '요청 body가 올바른 JSON이 아닙니다.' },
        { status: 400 },
      );
    }

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { success: false, error: '입력값 오류', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { keyword, productCode, types } = parsed.data;
    const targetTypes: IpType[] = types && types.length > 0 ? types : [...IP_TYPES];

    const client = getKiprisClient();
    const emptyResult: KiprisSearchResult = { totalCount: 0, items: [] };

    const [trademarkResult, patentResult, designResult] = await Promise.all([
      targetTypes.includes('trademark')
        ? client.searchTrademark(keyword).catch((err) => {
            console.error('[costco/verify-ip] 상표 검색 오류:', err);
            return emptyResult;
          })
        : Promise.resolve(emptyResult),
      targetTypes.includes('patent')
        ? client.searchPatent(keyword).catch((err) => {
            console.error('[costco/verify-ip] 특허 검색 오류:', err);
            return emptyResult;
          })
        : Promise.resolve(emptyResult),
      targetTypes.includes('design')
        ? client.searchDesign(keyword).catch((err) => {
            console.error('[costco/verify-ip] 디자인 검색 오류:', err);
            return emptyResult;
          })
        : Promise.resolve(emptyResult),
    ]);

    const trademark = summarizeResult(trademarkResult);
    const patent    = summarizeResult(patentResult);
    const design    = summarizeResult(designResult);

    const overallRisk = calcOverallRisk([
      trademark.riskLevel,
      patent.riskLevel,
      design.riskLevel,
    ]);

    const details = { trademark, patent, design };

    try {
      await saveCostcoIpResult(productCode, overallRisk, details);
    } catch (dbErr) {
      console.error('[costco/verify-ip] DB 저장 오류:', dbErr);
    }

    return Response.json({
      success: true,
      data: {
        ...details,
        overallRisk,
        legalScore: riskToLegalScore(overallRisk),
      },
    });
  } catch (err) {
    console.error('[POST /api/sourcing/costco/verify-ip] 서버 오류:', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
