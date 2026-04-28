/**
 * POST /api/sourcing/legal-check
 *
 * 수동 트리거: 전체 또는 특정 상품에 대해 Layer 1+2 법적 검토 실행
 * DB의 legal_status, legal_issues, legal_checked_at 업데이트
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { runSyncLegalCheck } from '@/lib/sourcing/legal';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { itemNos } = body as { itemNos?: number[] };

    const pool = getSourcingPool();

    // 대상 상품 조회
    let query: string;
    let params: unknown[];

    if (itemNos && itemNos.length > 0) {
      query = 'SELECT id, item_no, title, safety_cert, category_name FROM sourcing_items WHERE item_no = ANY($1)';
      params = [itemNos];
    } else {
      query = 'SELECT id, item_no, title, safety_cert, category_name FROM sourcing_items WHERE is_tracking = true';
      params = [];
    }

    const { rows } = await pool.query(query, params);

    let checkedCount = 0;
    let blockedCount = 0;
    let warningCount = 0;

    for (const row of rows) {
      const { status, issues } = runSyncLegalCheck({
        title: row.title ?? '',
        safetyCert: row.safety_cert ?? null,
        categoryName: row.category_name ?? null,
      });

      await pool.query(
        `UPDATE sourcing_items
         SET legal_status = $1,
             legal_issues = $2,
             legal_checked_at = now()
         WHERE id = $3`,
        [status, JSON.stringify(issues), row.id],
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
