import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getSupabaseServerClient, STORAGE_BUCKET } from '@/lib/supabase/server';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

export const maxDuration = 60;

/** 보관 기간. 공개 버킷이라 오래 둘수록 URL 노출 창이 길어진다 */
const RETAIN_MONTHS = 3;
/** 한 회차 상한. 매일 돌므로 밀릴 일이 없고, 밀려도 다음 회차가 이어받는다 */
const MAX_PER_RUN = 50;

/**
 * GET /api/cron/purge-receipt-images — 오래된 영수증 이미지 삭제
 *
 * 영수증 이미지에는 회원번호와 카드번호 뒷자리가 찍혀 있다. 기존 공개 버킷을
 * 재사용하기로 한 결정(스펙 §7) 때문에 URL이 새면 그 값이 노출되므로,
 * 필요 없어진 이미지는 오래 두지 않는다.
 *
 * **판독 결과는 지우지 않는다.** `raw_ocr`와 줄 데이터가 남으므로
 * 입고의 근거는 유지되고, `cost_entries.source_receipt_line_id`도 끊기지 않는다.
 *
 * 판독 전(`pending`·`parsing`) 초안은 건드리지 않는다 — 이미지를 지우면
 * 판독 자체가 불가능해지고, 3개월이 지나도록 판독되지 않았다면 그 자체가
 * 별도로 들여다볼 문제다.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!CRON_SECRET || auth.replace('Bearer ', '') !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getSourcingPool();

  const { rows: targets } = await pool.query(
    `SELECT id, image_paths
     FROM receipt_drafts
     WHERE images_purged_at IS NULL
       AND ocr_status IN ('parsed', 'failed')
       AND created_at < now() - ($1 || ' months')::interval
     ORDER BY created_at
     LIMIT $2`,
    [String(RETAIN_MONTHS), MAX_PER_RUN],
  );

  if (targets.length === 0) {
    return NextResponse.json({ success: true, data: { purged: 0, files: 0 } });
  }

  const supabase = getSupabaseServerClient();
  let purged = 0;
  let files = 0;
  const failures: { id: string; error: string }[] = [];

  for (const t of targets) {
    const paths = (t.image_paths ?? []) as string[];
    try {
      if (paths.length > 0) {
        const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
        // 이미 없는 파일은 오류가 아니다 — 목표는 "남아 있지 않은 상태"다
        if (error && !/not found/i.test(error.message)) throw new Error(error.message);
        files += paths.length;
      }

      await pool.query(
        `UPDATE receipt_drafts SET image_paths = '{}', images_purged_at = now(), updated_at = now()
         WHERE id = $1`,
        [t.id],
      );
      purged++;
    } catch (err) {
      // 표시를 남기지 않는다. 다음 회차가 다시 시도한다
      failures.push({ id: t.id, error: err instanceof Error ? err.message : '삭제 실패' });
    }
  }

  return NextResponse.json({
    success: true,
    data: { purged, files, retain_months: RETAIN_MONTHS, failures },
  });
}
