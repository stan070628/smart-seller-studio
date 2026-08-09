/**
 * POST /api/cost-management/ad-spend/bulk
 *
 * 쿠팡 광고관리 표에서 뽑은 (상품 ID, 집행 광고비) 목록을 하루치로 저장한다.
 * 상품 ID는 광고 화면에 보이는 옵션 ID이고, product_cost_channels.external_id 와
 * 같은 값이다. 채널 매핑이 없는 예전 상품을 위해 product_costs.vendor_item_id 도
 * 폴백으로 본다.
 *
 * dry_run: true 면 매칭 결과만 돌려주고 저장하지 않는다 — 모달 미리보기가 쓴다.
 *
 * 한 상품이 로켓그로스·윙 두 채널로 각각 광고되면 external_id가 둘인데 같은
 * product_id로 모인다. 그래서 저장 전에 product_id 단위로 합산한다 (합산하지
 * 않으면 ON CONFLICT DO UPDATE 가 같은 행을 두 번 건드려 실패한다).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 1000;

interface InputItem {
  external_id: string;
  ad_spend: number;
  impressions: number | null;
  clicks: number | null;
  ad_orders: number | null;
  ad_revenue: number | null;
}

/** 미수집(null)은 null로 남긴다 — 0("광고를 돌렸는데 노출 0")과 뜻이 다르다 */
function optionalCount(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/** 합산할 때 "미수집"을 0으로 뭉개지 않는다 */
function addNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try { body = await request.json(); } catch { body = null; }
  const { ad_date, items, dry_run } = body ?? {};

  if (!ad_date || !DATE_RE.test(ad_date)) {
    return NextResponse.json(
      { success: false, error: 'ad_date must be in YYYY-MM-DD format' },
      { status: 400 },
    );
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ success: false, error: 'items must be a non-empty array' }, { status: 400 });
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json({ success: false, error: `items must be ${MAX_ITEMS} or fewer` }, { status: 400 });
  }

  const parsed: InputItem[] = [];
  for (const it of items as unknown[]) {
    const row = it as { external_id?: unknown; ad_spend?: unknown };
    const id = String(row.external_id ?? '');
    const spend = Number(row.ad_spend);
    if (!/^\d{1,19}$/.test(id)) {
      return NextResponse.json({ success: false, error: `invalid external_id: ${id}` }, { status: 400 });
    }
    if (!Number.isFinite(spend) || spend < 0) {
      return NextResponse.json({ success: false, error: `invalid ad_spend for ${id}` }, { status: 400 });
    }
    const m = it as Record<string, unknown>;
    parsed.push({
      external_id: id,
      ad_spend: Math.round(spend),
      impressions: optionalCount(m.impressions),
      clicks: optionalCount(m.clicks),
      ad_orders: optionalCount(m.ad_orders),
      ad_revenue: optionalCount(m.ad_revenue),
    });
  }

  const pool = getSourcingPool();
  const ids = parsed.map((p) => p.external_id);

  // 1) 상품 매칭 — 채널 매핑 우선, 없으면 vendor_item_id
  const { rows: resolvedRows } = await pool.query(
    `SELECT i.external_id::text AS external_id,
            COALESCE(ch.product_cost_id, pv.id) AS product_id,
            COALESCE(chp.product_name, pv.product_name) AS product_name
       FROM unnest($2::bigint[]) AS i(external_id)
       LEFT JOIN LATERAL (
         SELECT c.product_cost_id
           FROM product_cost_channels c
          WHERE c.user_id = $1 AND c.external_id = i.external_id
          ORDER BY c.created_at
          LIMIT 1
       ) ch ON TRUE
       LEFT JOIN product_costs chp ON chp.id = ch.product_cost_id
       LEFT JOIN LATERAL (
         SELECT p.id, p.product_name
           FROM product_costs p
          WHERE p.user_id = $1 AND p.vendor_item_id = i.external_id
          LIMIT 1
       ) pv ON TRUE`,
    [user.userId, ids],
  );

  const productByExternal = new Map<string, { id: string; name: string }>();
  for (const r of resolvedRows) {
    if (r.product_id) productByExternal.set(r.external_id, { id: r.product_id, name: r.product_name });
  }

  const matched: { external_id: string; product_id: string; product_name: string; ad_spend: number }[] = [];
  const unmatched: { external_id: string; ad_spend: number }[] = [];
  // product_id 단위 합산 — 한 상품이 두 채널로 광고된 경우를 합친다
  const aggByProduct = new Map<string, Omit<InputItem, 'external_id'>>();

  for (const p of parsed) {
    const hit = productByExternal.get(p.external_id);
    if (!hit) {
      unmatched.push({ external_id: p.external_id, ad_spend: p.ad_spend });
      continue;
    }
    matched.push({ external_id: p.external_id, product_id: hit.id, product_name: hit.name, ad_spend: p.ad_spend });
    const cur = aggByProduct.get(hit.id);
    aggByProduct.set(hit.id, cur ? {
      ad_spend: cur.ad_spend + p.ad_spend,
      impressions: addNullable(cur.impressions, p.impressions),
      clicks: addNullable(cur.clicks, p.clicks),
      ad_orders: addNullable(cur.ad_orders, p.ad_orders),
      ad_revenue: addNullable(cur.ad_revenue, p.ad_revenue),
    } : { ...p });
  }

  let savedProducts = 0;
  if (!dry_run && aggByProduct.size > 0) {
    const productIds = Array.from(aggByProduct.keys());
    const col = <K extends keyof Omit<InputItem, 'external_id'>>(k: K) =>
      productIds.map((id) => aggByProduct.get(id)![k]);
    const { rows } = await pool.query(
      `INSERT INTO product_ad_spend_daily
              (user_id, product_id, ad_date, ad_spend, impressions, clicks, ad_orders, ad_revenue, updated_at)
       SELECT $1, t.product_id, $8::date, t.ad_spend, t.impressions, t.clicks, t.ad_orders, t.ad_revenue, now()
         FROM unnest($2::uuid[], $3::numeric[], $4::int[], $5::int[], $6::int[], $7::numeric[])
              AS t(product_id, ad_spend, impressions, clicks, ad_orders, ad_revenue)
        WHERE EXISTS (SELECT 1 FROM product_costs p WHERE p.id = t.product_id AND p.user_id = $1)
       ON CONFLICT (user_id, product_id, ad_date)
       DO UPDATE SET ad_spend    = EXCLUDED.ad_spend,
                     impressions = EXCLUDED.impressions,
                     clicks      = EXCLUDED.clicks,
                     ad_orders   = EXCLUDED.ad_orders,
                     ad_revenue  = EXCLUDED.ad_revenue,
                     updated_at  = now()
       RETURNING product_id`,
      [user.userId, productIds, col('ad_spend'), col('impressions'), col('clicks'), col('ad_orders'), col('ad_revenue'), ad_date],
    );
    savedProducts = rows.length;
  }

  return NextResponse.json({
    success: true,
    data: {
      ad_date,
      dry_run: !!dry_run,
      matched,
      unmatched,
      saved_products: savedProducts,
      matched_total: matched.reduce((s, m) => s + m.ad_spend, 0),
      unmatched_total: unmatched.reduce((s, m) => s + m.ad_spend, 0),
    },
  });
}
