/**
 * DELETE /api/niche/watchlist/[id] — 관심 키워드 삭제
 *
 * 파라미터: id (UUID)
 * - 존재하지 않으면 404
 */

import { NextRequest } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';

// UUID 형식 정규식
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // UUID 형식 검증
  if (!UUID_REGEX.test(id)) {
    return Response.json(
      { success: false, error: '유효하지 않은 ID 형식입니다.' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();

  try {
    const result = await pool.query(
      `DELETE FROM niche_watchlist WHERE id = $1`,
      [id],
    );

    if ((result.rowCount ?? 0) === 0) {
      return Response.json(
        { success: false, error: '해당 관심 키워드를 찾을 수 없습니다.' },
        { status: 404 },
      );
    }

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error('[niche/watchlist DELETE] 오류:', message);
    return Response.json({ success: false, error: '관심 키워드 삭제 실패' }, { status: 500 });
  }
}
