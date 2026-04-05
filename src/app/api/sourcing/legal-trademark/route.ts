/**
 * GET /api/sourcing/legal-trademark
 *
 * Layer 3: KIPRIS 상표 조회 배치
 * 야간 cron으로 실행 — 메인 수집 흐름을 막지 않는 비동기 처리
 *
 * Authorization: Bearer CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { checkTrademark } from '@/lib/sourcing/legal';
import type { LegalIssue } from '@/lib/sourcing/legal/types';
import { resolveStatus } from '@/lib/sourcing/legal/types';

const CRON_SECRET = process.env.CRON_SECRET || '';
// 배치당 처리 건수 (KIPRIS API 부하 방지)
const BATCH_LIMIT = 50;
// 요청 간 딜레이 (ms)
const REQUEST_DELAY = 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
  // CRON 인증
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!CRON_SECRET || token !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const pool = getSourcingPool();

    // Layer 3 미검사 또는 오래된 상품 (trademark layer가 없는 것 우선)
    const { rows } = await pool.query(
      `SELECT id, item_no, title, legal_issues
       FROM sourcing_items
       WHERE is_tracking = true
         AND (
           legal_checked_at IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(legal_issues) elem
             WHERE elem->>'layer' = 'trademark'
           )
           OR legal_checked_at < now() - INTERVAL '7 days'
         )
       ORDER BY legal_checked_at ASC NULLS FIRST
       LIMIT $1`,
      [BATCH_LIMIT],
    );

    let processedCount = 0;
    let trademarkIssues = 0;

    for (const row of rows) {
      const trademarkResult = await checkTrademark(row.title);

      // 기존 이슈에서 trademark layer 제거 후 새 결과 병합
      const existingIssues: LegalIssue[] = Array.isArray(row.legal_issues)
        ? (row.legal_issues as LegalIssue[]).filter((i) => i.layer !== 'trademark')
        : [];

      const allIssues = trademarkResult
        ? [...existingIssues, trademarkResult]
        : existingIssues;

      const status = resolveStatus(allIssues);

      await pool.query(
        `UPDATE sourcing_items
         SET legal_status = $1,
             legal_issues = $2,
             legal_checked_at = now()
         WHERE id = $3`,
        [status, JSON.stringify(allIssues), row.id],
      );

      processedCount++;
      if (trademarkResult) trademarkIssues++;

      // Rate limit
      if (processedCount < rows.length) {
        await sleep(REQUEST_DELAY);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        processedCount,
        trademarkIssues,
        remaining: Math.max(0, rows.length - processedCount),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
