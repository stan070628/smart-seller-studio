/**
 * POST /api/sourcing/trademark-precheck
 *
 * 1688 발주 사전체크 — 일괄 KIPRIS RED 차단
 * spec v2 §6.2
 *
 * 입력:  { titles: string[] }  (최대 50건)
 * 출력:  { results: Array<{ title, status, canProceed, brandCandidate, issue? }> }
 */

import { NextRequest, NextResponse } from 'next/server';
import { precheckTrademark, type TrademarkPrecheckResult } from '@/lib/sourcing/legal/precheck';
import { getSourcingPool } from '@/lib/sourcing/db';

const MAX_TITLES = 50;
const REQUEST_DELAY_MS = 500; // KIPRIS API 부하 회피

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface PrecheckResultRow {
  title: string;
  status: TrademarkPrecheckResult['status'];
  canProceed: boolean;
  brandCandidate: string | null;
  issue: TrademarkPrecheckResult['issue'];
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const titles = (body?.titles ?? null) as string[] | null;

  if (!Array.isArray(titles) || titles.length === 0) {
    return NextResponse.json(
      { success: false, error: 'titles must be non-empty array' },
      { status: 400 },
    );
  }

  if (titles.length > MAX_TITLES) {
    return NextResponse.json(
      { success: false, error: `titles length must be <= ${MAX_TITLES}` },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  const results: PrecheckResultRow[] = [];

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    const result = await precheckTrademark(title);

    // audit 기록
    await pool
      .query(
        `INSERT INTO trademark_precheck_logs
         (title, brand_candidate, status, issue_code, issue_message, issue_detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          title,
          result.brandCandidate,
          result.status,
          result.issue?.code ?? null,
          result.issue?.message ?? null,
          result.issue?.detail ? JSON.stringify(result.issue.detail) : null,
        ],
      )
      .catch((e) => {
        console.error('[trademark-precheck] audit insert failed', e);
      });

    results.push({
      title,
      status: result.status,
      canProceed: result.canProceed,
      brandCandidate: result.brandCandidate,
      issue: result.issue,
    });

    if (i < titles.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  return NextResponse.json({ success: true, results });
}
