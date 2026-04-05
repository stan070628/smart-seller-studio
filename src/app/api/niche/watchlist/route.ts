/**
 * GET  /api/niche/watchlist — 관심 키워드 목록 조회
 * POST /api/niche/watchlist — 관심 키워드 등록
 *
 * 인증: Authorization: Bearer <Supabase JWT> 검증 없이 DB 직접 접근
 *       (내부 서비스 전용 — 필요 시 RLS 레벨에서 처리)
 *
 * GET 응답: niche_watchlist LEFT JOIN niche_keywords ON keyword → 최신 점수/등급 포함
 * POST body: { keyword: string, memo?: string }
 *   - niche_keywords에서 최신 점수 조회하여 latest_score/latest_grade 채움
 *   - 이미 존재하면 409
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';
import type { NicheWatchlistItem } from '@/types/niche';

// ─────────────────────────────────────────
// 입력 검증 스키마
// ─────────────────────────────────────────

const PostBodySchema = z.object({
  keyword: z.string().min(1, '키워드는 1자 이상이어야 합니다.').max(100, '키워드는 100자를 초과할 수 없습니다.').trim(),
  memo: z.string().max(500, '메모는 500자를 초과할 수 없습니다.').optional(),
});

// ─────────────────────────────────────────
// GET 핸들러
// ─────────────────────────────────────────

export async function GET() {
  const pool = getSourcingPool();

  try {
    const result = await pool.query<{
      id: string;
      keyword: string;
      memo: string | null;
      latest_score: number | null;
      latest_grade: string | null;
      created_at: string;
    }>(
      `SELECT
         w.id,
         w.keyword,
         w.memo,
         nk.total_score   AS latest_score,
         nk.grade         AS latest_grade,
         w.created_at
       FROM niche_watchlist w
       LEFT JOIN niche_keywords nk ON nk.keyword = w.keyword
       ORDER BY w.created_at DESC`,
    );

    const data: NicheWatchlistItem[] = result.rows.map((row) => ({
      id: row.id,
      keyword: row.keyword,
      memo: row.memo,
      latestScore: row.latest_score,
      latestGrade: row.latest_grade,
      createdAt: row.created_at,
    }));

    return Response.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error('[niche/watchlist GET] 오류:', message);
    return Response.json({ success: false, error: '목록 조회 실패' }, { status: 500 });
  }
}

// ─────────────────────────────────────────
// POST 핸들러
// ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 요청 body 파싱 및 검증
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: '유효하지 않은 JSON 형식입니다.' }, { status: 400 });
  }

  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { success: false, error: parsed.error.issues?.[0]?.message ?? '입력값 검증 실패' },
      { status: 400 },
    );
  }

  const { keyword, memo } = parsed.data;
  const pool = getSourcingPool();

  try {
    // 중복 확인
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM niche_watchlist WHERE keyword = $1`,
      [keyword],
    );

    if ((existing.rowCount ?? 0) > 0) {
      return Response.json(
        { success: false, error: '이미 관심 키워드로 등록되어 있습니다.' },
        { status: 409 },
      );
    }

    // niche_keywords에서 최신 점수/등급 조회
    const scoreRow = await pool.query<{ total_score: number | null; grade: string | null }>(
      `SELECT total_score, grade FROM niche_keywords WHERE keyword = $1`,
      [keyword],
    );
    const latestScore = scoreRow.rows[0]?.total_score ?? null;
    const latestGrade = scoreRow.rows[0]?.grade ?? null;

    // niche_watchlist INSERT
    const insertResult = await pool.query<{
      id: string;
      keyword: string;
      memo: string | null;
      latest_score: number | null;
      latest_grade: string | null;
      created_at: string;
    }>(
      `INSERT INTO niche_watchlist (keyword, memo, latest_score, latest_grade)
       VALUES ($1, $2, $3, $4)
       RETURNING id, keyword, memo, latest_score, latest_grade, created_at`,
      [keyword, memo ?? null, latestScore, latestGrade],
    );

    const row = insertResult.rows[0];
    if (!row) throw new Error('INSERT 결과 없음');

    const data: NicheWatchlistItem = {
      id: row.id,
      keyword: row.keyword,
      memo: row.memo,
      latestScore: row.latest_score,
      latestGrade: row.latest_grade,
      createdAt: row.created_at,
    };

    return Response.json({ success: true, data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error('[niche/watchlist POST] 오류:', message);
    return Response.json({ success: false, error: '관심 키워드 등록 실패' }, { status: 500 });
  }
}
