import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getSupabaseServerClient, STORAGE_BUCKET } from '@/lib/supabase/server';
import { extractNaverPage } from '@/lib/sourcing-candidates/extract-naver';
import { mergePages } from '@/lib/sourcing-candidates/merge';
import type { ExtractedNaverPage } from '@/lib/sourcing-candidates/types';

export const maxDuration = 60;

/** 흐릿한 캡처 하나가 비용을 계속 쓰지 않도록 (영수증과 같은 3회) */
const MAX_ATTEMPTS = 3;

/**
 * POST /api/sourcing-candidates/scans/[id]/parse
 * 조각마다 병렬 판독 → 병합 → 저장. 일부 조각만 실패하면 성공분은 저장하고
 * parse_error에 실패한 조각 번호를 남긴다.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const pool = getSourcingPool();

  const { rows } = await pool.query(
    `UPDATE sourcing_scans
     SET parse_status = 'parsing', parse_attempts = parse_attempts + 1, parse_started_at = now(), updated_at = now()
     WHERE id = $1 AND user_id = $2 AND parse_attempts < $3
       AND (parse_status IN ('pending','failed')
            -- 함수가 시간 초과로 죽으면 'parsing'에 묶인다. 10분 지나면 회수한다(영수증과 같은 규칙)
            OR (parse_status = 'parsing' AND parse_started_at < now() - interval '10 minutes'))
     RETURNING image_paths`,
    [id, user.userId, MAX_ATTEMPTS],
  );
  if (rows.length === 0) {
    return NextResponse.json(
      { success: false, error: '판독할 수 없는 상태입니다 (이미 판독됨·진행 중·3회 실패).' },
      { status: 409 },
    );
  }
  const paths = rows[0].image_paths as string[];

  const fail = async (msg: string, status: number) => {
    await pool.query(
      `UPDATE sourcing_scans SET parse_status = 'failed', parse_error = $2, updated_at = now() WHERE id = $1`,
      [id, msg],
    );
    return NextResponse.json({ success: false, error: msg }, { status });
  };

  const supabase = getSupabaseServerClient();
  const settled = await Promise.allSettled(
    paths.map(async (path) => {
      const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
      if (error || !data) throw new Error(`이미지를 읽지 못했습니다: ${path}`);
      return extractNaverPage(Buffer.from(await data.arrayBuffer()));
    }),
  );

  const pages: ExtractedNaverPage[] = [];
  const failedIdx: number[] = [];
  settled.forEach((s, i) => (s.status === 'fulfilled' ? pages.push(s.value) : failedIdx.push(i + 1)));

  if (pages.length === 0) return fail('모든 조각의 판독이 실패했습니다. 다시 시도해 주세요.', 502);
  if (pages.some((p) => p.screen !== 'naver_list')) {
    return fail('네이버 쇼핑 목록이 아닌 캡처가 섞여 있습니다. 1688 캡처는 후보 카드에 올려 주세요.', 422);
  }

  const merged = mergePages(pages);
  const partialError = failedIdx.length ? `${failedIdx.join(', ')}번째 조각 판독 실패 — 그 부분을 다시 캡처해 올려 주세요.` : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const l of merged.listings) {
      await client.query(
        `INSERT INTO sourcing_listings
           (scan_id, user_id, rank, title, seller, price, list_price, discount_pct,
            review_count, rating, badges, dedup_key, number_check)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (scan_id, dedup_key) DO NOTHING`,
        [id, user.userId, l.rank, l.title, l.seller, l.price, l.list_price, l.discount_pct,
          l.review_count, l.rating, l.badges, l.dedup_key, l.number_check],
      );
    }
    await client.query(
      `UPDATE sourcing_scans SET parse_status = 'parsed', category_path = $2, sort_label = $3,
         parse_error = $4, updated_at = now() WHERE id = $1`,
      [id, merged.category_path, merged.sort_label, partialError],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return fail(err instanceof Error ? err.message : '저장 실패', 500);
  } finally {
    client.release();
  }

  return NextResponse.json({
    success: true,
    data: { id, listing_count: merged.listings.length, category_path: merged.category_path, sort_label: merged.sort_label, partial_error: partialError },
  });
}
