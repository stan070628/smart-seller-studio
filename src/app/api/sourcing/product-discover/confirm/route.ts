/**
 * POST /api/sourcing/product-discover/confirm
 * 통과 키워드 + 상품 정보 → seed_sessions 저장 → draftId 반환
 *
 * 도매꾹 상품(itemNo 있음)은 sourcing_items에도 UPSERT — 도매꾹 탭에서 시드 태그로 표시
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const productInfoSchema = z.object({
  source: z.enum(['manual', 'domeggook']),
  title: z.string().min(1).max(200),
  image: z.string().nullish(),
  price: z.number().nullish(),
  supplyPrice: z.number().nullish(),
  marketPrice: z.number().nullish(),
  itemNo: z.number().int().positive().nullish(),
  url: z.string().nullish(),
});

const keywordSchema = z.object({
  keyword: z.string().min(1),
  searchVolume: z.number().nullish(),
  competitorCount: z.number().nullish(),
  compIdx: z.enum(['낮음', '중간', '높음']).nullish(),
  avgCtr: z.number().nullish(),
  topReviewCount: z.number().nullish(),
  seedScore: z.number().nullish(),
  seedGrade: z.enum(['S', 'A', 'B', 'C', 'D']).nullish(),
});

const requestSchema = z.object({
  sessionId: z.string().uuid().nullish(),
  productInfo: productInfoSchema,
  keywords: z.array(keywordSchema).min(1).max(30),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '잘못된 요청 형식' }, { status: 400 });
  }

  const { sessionId, productInfo, keywords } = parsed.data;
  const pool = getSourcingPool();

  try {
    // 1. seed_sessions INSERT or UPDATE
    const stateJson = JSON.stringify({ productInfo, keywords });
    let draftId: string;

    if (sessionId) {
      await pool.query(
        `UPDATE seed_sessions SET state_json = $1, status = 'confirmed',
                                  confirmed_at = now(), step = 7
         WHERE id = $2 AND user_id = $3`,
        [stateJson, sessionId, userId],
      );
      draftId = sessionId;
    } else {
      const row = await pool.query<{ id: string }>(
        `INSERT INTO seed_sessions
           (user_id, categories, state_json, status, confirmed_at, step, winner_count)
         VALUES ($1, $2::text[], $3, 'confirmed', now(), 7, $4)
         RETURNING id`,
        [userId, [], stateJson, keywords.length],
      );
      draftId = row.rows[0].id;
    }

    // 2. 도매꾹 상품인 경우 sourcing_items UPSERT
    if (productInfo.source === 'domeggook' && productInfo.itemNo) {
      const topKeyword = keywords[0];
      await pool.query(
        `INSERT INTO sourcing_items
           (item_no, title, seed_keyword, seed_score, seed_session_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (item_no) DO UPDATE SET
           seed_keyword    = EXCLUDED.seed_keyword,
           seed_score      = EXCLUDED.seed_score,
           seed_session_id = EXCLUDED.seed_session_id`,
        [
          productInfo.itemNo,
          productInfo.title,
          topKeyword.keyword,
          topKeyword.seedScore ?? 0,
          draftId,
        ],
      );
    }

    return NextResponse.json({ success: true, data: { draftId } });
  } catch (err) {
    console.error('[POST /confirm]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '저장 실패' },
      { status: 500 },
    );
  }
}
