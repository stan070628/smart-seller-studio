/**
 * GET /api/sourcing/product-discover/draft/[id]
 * draftId로 ProductInfo + keywords 로드 (상품등록 탭 자동 채움용)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const idSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ success: false, error: 'invalid id' }, { status: 400 });
  }

  const pool = getSourcingPool();
  const row = await pool.query<{ state_json: unknown; status: string }>(
    `SELECT state_json, status FROM seed_sessions WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (row.rows.length === 0) {
    return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: row.rows[0].state_json });
}
