/**
 * POST /api/sourcing/verify-ip
 * KIPRIS 상표/특허/디자인 검색으로 IP 리스크 등급 산출
 *
 * Body: { keyword: string, types?: ('trademark' | 'patent' | 'design')[], itemId?: string }
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
 *
 * riskLevel 판단 기준:
 *   - high   : 등록(registerStatus === '등록') 건 존재
 *   - medium : 조회 결과 존재 (totalCount > 0)
 *   - low    : 조회 결과 없음 (totalCount === 0)
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
  types: z.array(z.enum(IP_TYPES)).optional(),
  /** DB에 결과 저장할 sourcing_items.id (선택) */
  itemId: z.string().uuid().optional(),
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
// DB 저장 (itemId 제공 시)
// ─────────────────────────────────────────────────────────────────────────────

async function saveIpResult(
  itemId: string,
  overallRisk: RiskLevel,
  details: Record<string, IpTypeResult>,
): Promise<void> {
  const pool = getSourcingPool();
  await pool.query(
    `UPDATE sourcing_items
     SET
       ip_risk_level  = $1,
       ip_checked_at  = NOW(),
       ip_details     = $2
     WHERE id = $3`,
    [overallRisk, JSON.stringify(details), itemId],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POST 핸들러
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // 요청 파싱 및 Zod 검증
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ success: false, error: '요청 body가 올바른 JSON이 아닙니다.' }, { status: 400 });
    }

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { success: false, error: '입력값 오류', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { keyword, types, itemId } = parsed.data;
    // types 미지정 시 전체 검색
    const targetTypes: IpType[] = types && types.length > 0 ? types : [...IP_TYPES];

    const client = getKiprisClient();

    // 선택된 타입만 병렬 호출 (미선택 타입은 빈 결과로 채움)
    const emptyResult: KiprisSearchResult = { totalCount: 0, items: [] };

    const [trademarkResult, patentResult, designResult] = await Promise.all([
      targetTypes.includes('trademark')
        ? client.searchTrademark(keyword).catch((err) => {
            console.error('[verify-ip] 상표 검색 오류:', err);
            return emptyResult;
          })
        : Promise.resolve(emptyResult),
      targetTypes.includes('patent')
        ? client.searchPatent(keyword).catch((err) => {
            console.error('[verify-ip] 특허 검색 오류:', err);
            return emptyResult;
          })
        : Promise.resolve(emptyResult),
      targetTypes.includes('design')
        ? client.searchDesign(keyword).catch((err) => {
            console.error('[verify-ip] 디자인 검색 오류:', err);
            return emptyResult;
          })
        : Promise.resolve(emptyResult),
    ]);

    const trademark = summarizeResult(trademarkResult);
    const patent = summarizeResult(patentResult);
    const design = summarizeResult(designResult);

    const overallRisk = calcOverallRisk([
      trademark.riskLevel,
      patent.riskLevel,
      design.riskLevel,
    ]);

    const details = { trademark, patent, design };

    // itemId가 제공된 경우 DB에 결과 저장
    if (itemId) {
      try {
        await saveIpResult(itemId, overallRisk, details);
      } catch (dbErr) {
        // DB 저장 실패는 응답 차단 없이 경고 로그만 출력
        console.error('[verify-ip] DB 저장 오류:', dbErr);
      }
    }

    return Response.json({
      success: true,
      data: {
        ...details,
        overallRisk,
      },
    });
  } catch (err) {
    console.error('[POST /api/sourcing/verify-ip] 서버 오류:', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
