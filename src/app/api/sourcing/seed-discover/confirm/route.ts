/**
 * POST /api/sourcing/seed-discover/confirm
 * 시드 발굴 30개 확정 → sourcing_items UPSERT + seed_sessions 상태 업데이트
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';

const confirmSchema = z.object({
  sessionId: z.string().uuid(),
  items: z.array(z.object({
    itemNo: z.number().int().positive(),
    keyword: z.string().min(1),
    score: z.number().int().min(0).max(100),
  })).min(1).max(30),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const body = await request.json().catch(() => null);
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '잘못된 요청 형식' }, { status: 400 });
  }

  const { sessionId, items } = parsed.data;
  const pool = getSourcingPool();

  // 세션 소유자 확인
  const sessionRow = await pool.query(
    `SELECT id FROM seed_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  if (sessionRow.rows.length === 0) {
    return NextResponse.json({ success: false, error: '세션을 찾을 수 없습니다' }, { status: 404 });
  }

  try {
    const client = getDomeggookClient();
    let saved = 0;

    for (const item of items) {
      try {
        // 상품 상세 조회 (타이틀, 카테고리 확보)
        const detail = await client.getItemView(item.itemNo).catch(() => null);

        await pool.query(
          `INSERT INTO sourcing_items
             (item_no, title, category_name, seed_keyword, seed_score, seed_session_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (item_no) DO UPDATE SET
             seed_keyword    = EXCLUDED.seed_keyword,
             seed_score      = EXCLUDED.seed_score,
             seed_session_id = EXCLUDED.seed_session_id`,
          [
            item.itemNo,
            detail?.basis?.title ?? `상품 #${item.itemNo}`,
            detail?.category?.current?.name ?? null,
            item.keyword,
            item.score,
            sessionId,
          ],
        );
        saved++;
      } catch (e) {
        console.warn(`[confirm] 상품 ${item.itemNo} 저장 실패:`, e);
      }
    }

    // 세션 confirmed 업데이트
    await pool.query(
      `UPDATE seed_sessions
       SET status = 'confirmed', confirmed_at = now(), step = 7
       WHERE id = $1`,
      [sessionId],
    );

    return NextResponse.json({ success: true, data: { saved, sessionId } });
  } catch (err) {
    console.error('[POST /api/sourcing/seed-discover/confirm]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '알 수 없는 오류' },
      { status: 500 },
    );
  }
}
