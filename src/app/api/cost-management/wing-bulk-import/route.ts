import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCoupangClient } from '@/lib/listing/coupang-client';

// revenue-history는 최대 31일 조회 — 31일 단위로 분할
function splitInto31DayChunks(from: string, to: string): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  const toDate = new Date(to);
  let cursor = new Date(from);
  while (cursor <= toDate) {
    const end = new Date(cursor);
    end.setDate(end.getDate() + 30); // 31일 포함
    if (end > toDate) end.setTime(toDate.getTime());
    chunks.push({
      from: cursor.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    });
    cursor = new Date(end);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const KST = 9 * 60 * 60 * 1000;
  const today = new Date(Date.now() + KST).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() + KST - 86400000).toISOString().slice(0, 10);

  const body = await request.json().catch(() => null);
  const from = body?.from ?? new Date(Date.now() + KST - 90 * 86400000).toISOString().slice(0, 10);
  const rawTo = body?.to ?? today;
  // recognitionDateTo는 어제까지만 허용 — 오늘 이상이면 yesterday로 clamp
  const to = rawTo >= today ? yesterday : rawTo;

  const pool = getSourcingPool();

  // revenue-history는 vendorItemId(옵션ID)를 포함 → 1차 매칭
  // sellerProductId(등록상품ID) 기준 2차 매칭 (레거시 wing junction table 대응)
  const { rows: productRows } = await pool.query(
    `SELECT id, seller_product_id, vendor_item_id FROM product_costs WHERE user_id = $1`,
    [user.userId],
  );
  // 레거시 wing junction table — sellerProductId 기반 fallback
  const { rows: junctionRows } = await pool.query(
    `SELECT product_cost_id AS id, seller_product_id FROM product_wing_seller_ids WHERE user_id = $1`,
    [user.userId],
  );
  // product_cost_channels wing 채널: external_id = 판배 옵션ID → vendorItemId로 1차 매칭
  const { rows: wingChannels } = await pool.query(
    `SELECT product_cost_id, external_id, unit_multiplier
     FROM product_cost_channels
     WHERE user_id = $1 AND channel_type = 'coupang_wing'`,
    [user.userId],
  );

  if (productRows.length === 0 && junctionRows.length === 0 && wingChannels.length === 0) {
    return NextResponse.json({ success: true, data: { imported: 0, skipped: 0, total: 0 } });
  }

  // vendorItemId(옵션ID) → { id: product_cost_id, multiplier: unit_multiplier }
  // RG: product_costs.vendor_item_id
  // Wing: product_cost_channels.external_id (판배 옵션ID)
  const vendorItemMap = new Map<number, { id: string; multiplier: number }>();
  for (const row of productRows) {
    if (row.vendor_item_id) vendorItemMap.set(Number(row.vendor_item_id), { id: row.id, multiplier: 1 });
  }
  for (const ch of wingChannels) {
    vendorItemMap.set(Number(ch.external_id), {
      id: ch.product_cost_id,
      multiplier: ch.unit_multiplier >= 1 ? ch.unit_multiplier : 1,
    });
  }
  // sellerProductId(등록상품ID) → product_cost_id (fallback)
  const sellerProductMap = new Map<number, string>();
  for (const row of productRows) {
    if (row.seller_product_id > 0) sellerProductMap.set(Number(row.seller_product_id), row.id);
  }
  for (const row of junctionRows) {
    sellerProductMap.set(Number(row.seller_product_id), row.id);
  }

  try {
    const client = getCoupangClient();

    // revenue-history 전체 페치 — 31일 chunk 분할
    const records: Array<{
      product_cost_id: string;
      sold_at: string;
      quantity: number;
      selling_price: number;
      coupang_order_item_id: string;
    }> = [];

    for (const chunk of splitInto31DayChunks(from, to)) {
      let token: string | undefined;
      do {
        const result = await client.getRevenueHistory({
          recognitionDateFrom: chunk.from,
          recognitionDateTo: chunk.to,
          maxPerPage: 50,
          token: token ?? '',
        });
        for (const order of result.items) {
          if (order.saleType !== 'SALE') continue;
          for (const item of order.items) {
            // vendorItemId 우선 매칭 (Wing+RG 공통 키), fallback: sellerProductId
            const wingMatch = vendorItemMap.get(item.vendorItemId);
            const fallbackId = sellerProductMap.get(item.sellerProductId);
            if (!wingMatch && !fallbackId) continue;
            if (item.quantity <= 0) continue;
            const soldAt = order.saleDate?.slice(0, 10);
            if (!soldAt) continue;  // saleDate 없으면 스킵
            const productCostId = wingMatch ? wingMatch.id : fallbackId!;
            const multiplier = wingMatch ? wingMatch.multiplier : 1;
            records.push({
              product_cost_id: productCostId,
              sold_at: soldAt,
              quantity: item.quantity * multiplier,
              selling_price: item.salePrice,
              coupang_order_item_id: `wing-${order.orderId}-${item.vendorItemId}`,
            });
          }
        }
        token = result.nextToken ?? undefined;
      } while (token);
    }

    // sale_records에 일괄 bulk INSERT — 중복은 coupang_order_item_id unique constraint로 skip
    let imported = 0;
    if (records.length > 0) {
      // bulk INSERT: VALUES ($1,$2,...), ($7,$8,...) 형태로 구성
      const CHUNK = 200; // 파라미터 수 한계 고려 (6 params × 200 = 1200)
      for (let i = 0; i < records.length; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK);
        const values: unknown[] = [];
        const placeholders = chunk.map((rec, idx) => {
          const base = idx * 6;
          values.push(user.userId, rec.product_cost_id, rec.sold_at, rec.quantity, rec.selling_price, rec.coupang_order_item_id);
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},'coupang',$${base + 6})`;
        });
        const result = await pool.query(
          `INSERT INTO sale_records
             (user_id, product_cost_id, sold_at, quantity, selling_price, channel, coupang_order_item_id)
           VALUES ${placeholders.join(',')}
           ON CONFLICT (coupang_order_item_id) DO NOTHING`,
          values,
        );
        imported += result.rowCount ?? 0;
      }
    }
    const skippedCount = records.length - imported;

    return NextResponse.json({ success: true, data: { imported, skipped: skippedCount, total: records.length } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
