import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getSupabaseServerClient, STORAGE_BUCKET } from '@/lib/supabase/server';
import { extractNaverPage } from '@/lib/sourcing-candidates/extract-naver';
import { mergePages } from '@/lib/sourcing-candidates/merge';
import type { ExtractedNaverPage } from '@/lib/sourcing-candidates/types';

export const maxDuration = 300;

/** 흐릿한 캡처 하나가 비용을 계속 쓰지 않도록 (영수증과 같은 3회) */
const MAX_ATTEMPTS = 3;

/**
 * POST /api/sourcing-candidates/scans/[id]/parse
 * 조각마다 병렬 판독 → 병합 → 저장. 조각 하나라도 실패하면 순위가 어긋날 수 있으므로
 * 부분 저장하지 않고 전체를 실패 처리한다 — 재시도가 전부 다시 판독한다.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const pool = getSourcingPool();

  let rows: { image_paths: string[] }[];
  try {
    ({ rows } = await pool.query(
      `UPDATE sourcing_scans
       SET parse_status = 'parsing', parse_attempts = parse_attempts + 1, parse_started_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2 AND parse_attempts < $3
         AND (parse_status IN ('pending','failed')
              -- 함수가 시간 초과로 죽으면 'parsing'에 묶인다. 10분 지나면 회수한다(영수증과 같은 규칙)
              OR (parse_status = 'parsing' AND parse_started_at < now() - interval '10 minutes'))
       RETURNING image_paths`,
      [id, user.userId, MAX_ATTEMPTS],
    ));
  } catch (err) {
    // id가 uuid 형식이 아니면 이 UPDATE 자체가 던진다
    if ((err as { code?: string }).code === '22P02') {
      return NextResponse.json({ success: false, error: '잘못된 id입니다.' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 });
  }
  if (rows.length === 0) {
    // 소유하지 않았거나 존재하지 않는 것과, 상태 때문에 못 받은 것을 구분해 알려준다
    const { rows: cur } = await pool.query(
      `SELECT parse_status, parse_attempts FROM sourcing_scans WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (cur.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const { parse_status, parse_attempts } = cur[0] as { parse_status: string; parse_attempts: number };
    if (parse_status === 'parsed') {
      return NextResponse.json({ success: false, error: '이미 판독된 스캔입니다.' }, { status: 409 });
    }
    if (parse_status === 'parsing') {
      return NextResponse.json(
        { success: false, error: '판독 중입니다 (최대 10분 뒤 다시 시도할 수 있습니다).' },
        { status: 409 },
      );
    }
    if (parse_attempts >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { success: false, error: '3회 실패했습니다. 캡처를 다시 올려 주세요.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: false, error: '판독할 수 없는 상태입니다.' }, { status: 409 });
  }
  const paths = rows[0].image_paths;

  // 회수된 뒤 뒤늦게 끝난 옛 실행이 더 최신 결과를 덮어쓰지 못하도록 parsing일 때만 반영한다
  const fail = async (msg: string, status: number) => {
    await pool.query(
      `UPDATE sourcing_scans SET parse_status = 'failed', parse_error = $2, updated_at = now() WHERE id = $1 AND parse_status = 'parsing'`,
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
  // 조각 일부만 실패하면 순위가 어긋난 채 저장될 수 있으므로 부분 저장하지 않는다 —
  // 재시도 라우트가 전체를 다시 판독한다(시도 횟수 제한은 그대로 적용).
  if (failedIdx.length > 0) {
    return fail(
      `${failedIdx.join(', ')}번째 조각 판독 실패 — 다시 시도해 주세요 (순위가 어긋나지 않도록 전부 다시 판독합니다)`,
      502,
    );
  }

  // 정렬 바 위 광고 블록처럼 상품이 없는 'other' 조각(빈 여백 등)은 조용히 버린다.
  // 상품이 있는 'other' 조각(1688 등 다른 화면이 섞임)은 오류다.
  const naverPages = pages.filter((p) => p.screen === 'naver_list');
  const badOtherPage = pages.some((p) => p.screen === 'other' && p.products.length > 0);
  if (naverPages.length === 0 || badOtherPage) {
    return fail('네이버 쇼핑 목록이 아닌 캡처가 섞여 있습니다. 1688 캡처는 후보 카드에 올려 주세요.', 422);
  }

  const merged = mergePages(naverPages);

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
    // 회수된 뒤 뒤늦게 끝난 옛 실행이 최신 시도의 결과를 덮어쓰거나 중복 삽입하지 못하도록
    // parsing일 때만 반영한다 — 0행이면 그사이 다른 실행(재시도)이 먼저 끝난 것이다.
    const { rowCount: updated } = await client.query(
      `UPDATE sourcing_scans SET parse_status = 'parsed', category_path = $2, sort_label = $3,
         parse_error = NULL, updated_at = now() WHERE id = $1 AND parse_status = 'parsing'`,
      [id, merged.category_path, merged.sort_label],
    );
    if (!updated) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: '다른 판독이 먼저 끝났습니다. 새로고침해 주세요.' },
        { status: 409 },
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return fail(err instanceof Error ? err.message : '저장 실패', 500);
  } finally {
    client.release();
  }

  return NextResponse.json({
    success: true,
    data: { id, listing_count: merged.listings.length, category_path: merged.category_path, sort_label: merged.sort_label },
  });
}
