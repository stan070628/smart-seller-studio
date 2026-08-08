import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

/**
 * POST /api/receipts/[id]/retry — 판독 실패 초안을 다시 큐에 올린다
 *
 * cron은 `failed`를 절대 다시 집지 않는다(3편). 흐릿한 사진 하나가
 * 영원히 돈을 태우는 것을 막는 장치이므로, 되돌리는 것은 사람만 할 수 있다.
 * `parse_attempts`를 0으로 되돌려 다시 3회의 기회를 준다.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  try {
    const pool = getSourcingPool();
    const { rowCount } = await pool.query(
      `UPDATE receipt_drafts SET
         ocr_status = 'pending', parse_attempts = 0, parse_started_at = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $2 AND status = 'draft' AND ocr_status = 'failed'`,
      [id, user.userId],
    );
    if (rowCount === 0) {
      return NextResponse.json(
        { success: false, error: '재판독할 수 있는 상태가 아닙니다.' }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
