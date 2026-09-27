import type { Pool } from 'pg';
import { getSupabaseServerClient, STORAGE_BUCKET } from '@/lib/supabase/server';
import { extract1688 } from '@/lib/sourcing-candidates/extract-1688';
import { checkTiers } from '@/lib/sourcing-candidates/verify';

const MAX_ATTEMPTS = 3;

/**
 * 1688 업체 한 곳을 판독해 저장한다. 업로드 직후와 재시도 라우트가 함께 쓴다.
 * 반환: 오류 문장 또는 null.
 */
export async function parseOffer(pool: Pool, offerId: string, userId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `UPDATE sourcing_offers o
     SET parse_status = 'parsing', parse_attempts = o.parse_attempts + 1, updated_at = now()
     FROM sourcing_listings l
     WHERE o.id = $1 AND o.user_id = $2 AND l.id = o.listing_id
       AND o.parse_status IN ('pending','failed') AND o.parse_attempts < $3
     RETURNING o.image_paths, l.title, COALESCE(l.price_override, l.price) AS price`,
    [offerId, userId, MAX_ATTEMPTS],
  );
  if (rows.length === 0) return '판독할 수 없는 상태입니다 (이미 판독됨·진행 중·3회 실패).';
  const { image_paths, title, price } = rows[0] as { image_paths: string[]; title: string; price: number };

  const fail = async (msg: string) => {
    await pool.query(
      `UPDATE sourcing_offers SET parse_status = 'failed', parse_error = $2, updated_at = now() WHERE id = $1`,
      [offerId, msg],
    );
    return msg;
  };

  try {
    const supabase = getSupabaseServerClient();
    const images = await Promise.all(
      image_paths.map(async (p) => {
        const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(p);
        if (error || !data) throw new Error(`이미지를 읽지 못했습니다: ${p}`);
        return Buffer.from(await data.arrayBuffer());
      }),
    );
    const r = await extract1688(images, { title, price });
    if (r.screen !== '1688') return fail('1688 상품 페이지 캡처가 아닙니다.');

    await pool.query(
      `UPDATE sourcing_offers SET parse_status = 'parsed', parse_error = NULL, title_cn = $2, tiers = $3,
         options = $4, sold_count = $5, sale_unit = $6, tier_check = $7, match_verdict = $8,
         match_reason = $9, updated_at = now()
       WHERE id = $1`,
      [offerId, r.title_cn, JSON.stringify(r.tiers), JSON.stringify(r.options), r.sold_count,
        r.sale_unit, checkTiers(r.tiers), r.match_verdict, r.match_reason],
    );
    return null;
  } catch (err) {
    return fail(err instanceof Error ? err.message : '판독 실패');
  }
}
