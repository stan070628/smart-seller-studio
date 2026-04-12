/**
 * POST /api/sourcing/costco/legal-check
 *
 * 코스트코 상품 전체(또는 지정 IDs)에 대해 법적 검토(Layer 1+2) 실행
 * costco_products.blocked_reason, needs_review 업데이트
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { runSyncLegalCheck } from '@/lib/sourcing/legal';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { ids } = body as { ids?: number[] };

    const pool = getSourcingPool();

    let query: string;
    let params: unknown[];

    if (ids && ids.length > 0) {
      query = 'SELECT id, title FROM costco_products WHERE id = ANY($1)';
      params = [ids];
    } else {
      query = 'SELECT id, title FROM costco_products WHERE is_active = true';
      params = [];
    }

    const { rows } = await pool.query(query, params);

    let checkedCount = 0;
    let blockedCount = 0;
    let warningCount = 0;

    for (const row of rows) {
      const { status, issues } = runSyncLegalCheck(row.title);

      const blockedReason =
        status === 'blocked'
          ? (issues[0]?.message ?? '법적 판매 금지')
          : null;
      const needsReview = status === 'warning';

      await pool.query(
        `UPDATE costco_products
         SET blocked_reason = $1,
             needs_review    = $2
         WHERE id = $3`,
        [blockedReason, needsReview, row.id],
      );

      checkedCount++;
      if (status === 'blocked') blockedCount++;
      if (status === 'warning') warningCount++;
    }

    return NextResponse.json({
      success: true,
      data: {
        checkedCount,
        blockedCount,
        warningCount,
        safeCount: checkedCount - blockedCount - warningCount,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
