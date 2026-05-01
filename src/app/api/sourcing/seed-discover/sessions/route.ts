/**
 * GET /api/sourcing/seed-discover/sessions
 * 사용자의 시드 발굴 세션 목록 반환 (최신순 10개)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const pool = getSourcingPool();
  const rows = await pool.query(
    `SELECT id, categories, status, created_at, winner_count, step
     FROM seed_sessions WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 10`,
    [authResult.userId],
  );

  const data = rows.rows.map((r) => ({
    id: r.id as string,
    categories: r.categories as string[],
    status: r.status as string,
    createdAt: r.created_at as string,
    winnerCount: r.winner_count as number,
    step: r.step as number,
  }));

  return NextResponse.json({ success: true, data });
}
