/**
 * POST /api/niche/chinese-query
 * 한국어 키워드 → 중국어 검색어 변형 생성
 *
 * 처리 흐름:
 *   1. body에서 keyword 추출 후 Zod 검증
 *   2. DB 캐시 조회 (niche_chinese_queries)
 *   3. 캐시 히트 → 즉시 반환
 *   4. 캐시 미스 → Claude API 호출 → 중국어 변형 생성
 *   5. DB INSERT (캐시 저장)
 *   6. 결과 반환
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';
import { generateChineseQueries, CHINESE_QUERY_MODEL } from '@/lib/ai/chinese-query';

// ─────────────────────────────────────────────────────────────────────────────
// 요청 바디 스키마
// ─────────────────────────────────────────────────────────────────────────────

const ChineseQueryBodySchema = z.object({
  keyword: z
    .string()
    .trim()
    .min(1, 'keyword는 1자 이상이어야 합니다.')
    .max(100, 'keyword는 100자 이하여야 합니다.'),
  forceRefresh: z.boolean().optional().default(false),
});

// ─────────────────────────────────────────────────────────────────────────────
// POST 핸들러
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── 1. 요청 바디 파싱 및 검증 ───────────────────
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { success: false, error: '요청 바디가 유효한 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  const parseResult = ChineseQueryBodySchema.safeParse(rawBody);
  if (!parseResult.success) {
    return Response.json(
      {
        success: false,
        error: '입력값 검증 실패',
        details: parseResult.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const { keyword, forceRefresh } = parseResult.data;

  try {
    const pool = getSourcingPool();

    // ── 2. DB 캐시 조회 ───────────────────────────
    if (!forceRefresh) {
      try {
        const cacheResult = await pool.query<{ chinese_queries: string[] }>(
          `SELECT chinese_queries FROM niche_chinese_queries WHERE keyword = $1`,
          [keyword],
        );

        if (cacheResult.rows.length > 0) {
          const cached = cacheResult.rows[0].chinese_queries;
          if (Array.isArray(cached) && cached.length > 0) {
            return Response.json({
              success: true,
              data: {
                keyword,
                chineseQueries: cached,
                cached: true,
              },
            });
          }
        }
      } catch (dbErr) {
        // DB 캐시 조회 실패 — Claude API로 폴백 (캐시 없이 진행)
        console.warn('[chinese-query] DB 캐시 조회 실패, Claude로 폴백:', dbErr);
      }
    }

    // ── 3. Claude API 호출 ────────────────────────
    const chineseQueries = await generateChineseQueries(keyword);

    if (chineseQueries.length === 0) {
      return Response.json(
        { success: false, error: '중국어 검색어를 생성하지 못했습니다.' },
        { status: 500 },
      );
    }

    // ── 4. DB 캐시 저장 ──────────────────────────
    try {
      await pool.query(
        `INSERT INTO niche_chinese_queries (keyword, chinese_queries, model_used)
         VALUES ($1, $2, $3)
         ON CONFLICT (keyword) DO UPDATE SET
           chinese_queries = EXCLUDED.chinese_queries,
           model_used      = EXCLUDED.model_used,
           updated_at      = NOW()`,
        [keyword, JSON.stringify(chineseQueries), CHINESE_QUERY_MODEL],
      );
    } catch (dbErr) {
      // DB 저장 실패 — 결과는 정상 반환 (다음 요청 시 재호출됨)
      console.warn('[chinese-query] DB 캐시 저장 실패:', dbErr);
    }

    // ── 5. 결과 반환 ─────────────────────────────
    return Response.json({
      success: true,
      data: {
        keyword,
        chineseQueries,
        cached: false,
      },
    });
  } catch (err) {
    console.error('[POST /api/niche/chinese-query] 서버 오류:', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
