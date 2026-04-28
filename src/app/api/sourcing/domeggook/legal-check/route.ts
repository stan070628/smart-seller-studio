/**
 * POST /api/sourcing/domeggook/legal-check
 *
 * sourcing_items 전체(또는 지정 IDs)에 대해 법적 검토(Layer 1+2) 실행
 * - legal_status, legal_issues, legal_checked_at 업데이트
 * - blocked_reason, needs_review 업데이트
 *
 * Body: { ids?: string[] }  — 미지정 시 전체 active 항목 대상
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { runSyncLegalCheck } from '@/lib/sourcing/legal';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { ids } = body as { ids?: string[] };

    const pool = getSourcingPool();

    let query: string;
    let params: unknown[];

    if (ids && ids.length > 0) {
      query = `
        SELECT id, title, safety_cert, category_name
        FROM sourcing_items
        WHERE id = ANY($1)
      `;
      params = [ids];
    } else {
      query = `
        SELECT id, title, safety_cert, category_name
        FROM sourcing_items
        WHERE is_active = true
      `;
      params = [];
    }

    const { rows } = await pool.query(query, params);

    let checkedCount = 0;
    let blockedCount = 0;
    let warningCount = 0;
    let safeCount = 0;

    for (const row of rows) {
      const { status, issues } = runSyncLegalCheck({
        title: row.title ?? '',
        safetyCert: row.safety_cert ?? null,
        categoryName: row.category_name ?? null,
      });

      const blockedReason =
        status === 'blocked' ? (issues[0]?.message ?? '법적 판매 금지') : null;
      const needsReview = status === 'warning';

      await pool.query(
        `UPDATE sourcing_items
         SET
           legal_status     = $1,
           legal_issues     = $2,
           legal_checked_at = NOW(),
           blocked_reason   = $3,
           needs_review     = $4
         WHERE id = $5`,
        [status, JSON.stringify(issues), blockedReason, needsReview, row.id],
      );

      checkedCount++;
      if (status === 'blocked') blockedCount++;
      else if (status === 'warning') warningCount++;
      else safeCount++;
    }

    return NextResponse.json({
      success: true,
      data: {
        checkedCount,
        blockedCount,
        warningCount,
        safeCount,
      },
    });
  } catch (err) {
    console.error('[POST /api/sourcing/domeggook/legal-check] 오류:', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
