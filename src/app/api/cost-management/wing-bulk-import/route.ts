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

  // revenue-history는 vendorItemId를 포함 → vendor_item_id 기준 1차 매칭
  // sellerProductId 기준 2차 매칭 (wing-only 상품 대응)
  const { rows: productRows } = await pool.query(
    `SELECT id, seller_product_id, vendor_item_id FROM product_costs
     WHERE user_id = $1 AND (seller_product_id IS NOT NULL OR vendor_item_id IS NOT NULL)`,
    [user.userId],
  );
  const { rows: junctionRows } = await pool.query(
    `SELECT product_cost_id AS id, seller_product_id FROM product_wing_seller_ids WHERE user_id = $1`,
    [user.userId],
  );
  // product_cost_channels에서 coupang_wing 매핑 조회 (새 방식)
  const { rows: wingChannels } = await pool.query(
    `SELECT product_cost_id, external_id AS seller_product_id
     FROM product_cost_channels
     WHERE user_id = $1 AND channel_type = 'coupang_wing'`,
    [user.userId],
  );

  if (productRows.length === 0 && junctionRows.length === 0) {
    return NextResponse.json({ success: true, data: { imported: 0, skipped: 0, total: 0 } });
  }

  // vendorItemId → product_cost_id (우선)
  const vendorItemMap = new Map<number, string>();
  for (const row of productRows) {
    if (row.vendor_item_id) vendorItemMap.set(Number(row.vendor_item_id), row.id);
  }
  // sellerProductId → product_cost_id (junction table 포함, fallback)
  const sellerProductMap = new Map<number, string>();
  for (const row of productRows) {
    if (row.seller_product_id) sellerProductMap.set(Number(row.seller_product_id), row.id);
  }
  for (const row of junctionRows) {
    sellerProductMap.set(Number(row.seller_product_id), row.id);
  }
  // product_cost_channels coupang_wing 항목도 sellerProductMap에 반영 (최우선)
  for (const ch of wingChannels) {
    sellerProductMap.set(Number(ch.seller_product_id), ch.product_cost_id);
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
            const productCostId = vendorItemMap.get(item.vendorItemId) ?? sellerProductMap.get(item.sellerProductId);
            if (!productCostId) continue;
            if (item.quantity <= 0) continue;
            const soldAt = order.saleDate?.slice(0, 10);
            if (!soldAt) continue;  // saleDate 없으면 스킵
            records.push({
              product_cost_id: productCostId,
              sold_at: soldAt,
              quantity: item.quantity,
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
