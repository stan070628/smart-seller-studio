// src/app/api/cost-management/rg-shipments/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { computeFifoBatchOps } from '@/lib/cost-management/rg-shipment';

interface RgShipmentItem {
  product_cost_id: string;
  quantity: number;
  unit_rg_fee: number;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const rawLimit = parseInt(searchParams.get('limit') ?? '20', 10);
  const limit = Math.min(Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 100);

  const pool = getSourcingPool();
  try {
    const { rows } = await pool.query(
      `SELECT
         e.id,
         e.shipped_at::text,
         e.total_shipping_fee,
         e.created_at,
         COALESCE(
           json_agg(
             json_build_object(
               'product_name', i.product_name,
               'quantity',     i.quantity,
               'unit_rg_fee',  i.unit_rg_fee
             ) ORDER BY i.product_name
           ) FILTER (WHERE i.id IS NOT NULL),
           '[]'
         ) AS items
       FROM rg_shipment_events e
       LEFT JOIN rg_shipment_event_items i ON i.shipment_event_id = e.id
       WHERE e.user_id = $1
       GROUP BY e.id
       ORDER BY e.shipped_at DESC, e.created_at DESC
       LIMIT $2`,
      [user.userId, limit],
    );
    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    console.error('[rg-shipments GET]', err);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { shipped_at, total_shipping_fee, items } = body ?? {};

  // 유효성 검사
  if (!shipped_at || !/^\d{4}-\d{2}-\d{2}$/.test(shipped_at)) {
    return NextResponse.json({ success: false, error: 'shipped_at must be YYYY-MM-DD' }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ success: false, error: 'items must be a non-empty array' }, { status: 400 });
  }
  if (!Number.isInteger(total_shipping_fee) || total_shipping_fee < 0) {
    return NextResponse.json({ success: false, error: 'total_shipping_fee must be a non-negative integer' }, { status: 400 });
  }

  // 중복 product_cost_id 방지
  const seenIds = new Set<string>();
  for (const item of items as RgShipmentItem[]) {
    if (!item.product_cost_id || typeof item.product_cost_id !== 'string') {
      return NextResponse.json({ success: false, error: 'Each item must have product_cost_id' }, { status: 400 });
    }
    if (seenIds.has(item.product_cost_id)) {
      return NextResponse.json({ success: false, error: `Duplicate product_cost_id: ${item.product_cost_id}` }, { status: 400 });
    }
    seenIds.add(item.product_cost_id);
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return NextResponse.json({ success: false, error: 'Each item quantity must be > 0' }, { status: 400 });
    }
    if (!Number.isInteger(item.unit_rg_fee) || item.unit_rg_fee < 0) {
      return NextResponse.json({ success: false, error: 'Each item unit_rg_fee must be >= 0' }, { status: 400 });
    }
  }

  // total_shipping_fee 검증: sum(qty × unit_rg_fee) ≈ total_shipping_fee (±totalShippedQty 허용)
  // 2단계 반올림 알고리즘 특성상 최대 단위당 1원 오차가 발생할 수 있으므로 총 수량 기준으로 허용
  const computedTotal = (items as RgShipmentItem[]).reduce((s, i) => s + i.quantity * i.unit_rg_fee, 0);
  const totalShippedQty = (items as RgShipmentItem[]).reduce((s, i) => s + i.quantity, 0);
  if (Math.abs(computedTotal - total_shipping_fee) > totalShippedQty) {
    return NextResponse.json(
      { success: false, error: `sum(quantity × unit_rg_fee)=${computedTotal}가 total_shipping_fee=${total_shipping_fee}와 일치하지 않습니다.` },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const productNames = new Map<string, string>();
    let affectedEntries = 0;
    let splitEntries = 0;

    for (const item of items as RgShipmentItem[]) {
      const { product_cost_id, quantity: rgQty, unit_rg_fee } = item;

      // 소유권 확인
      const { rows: ownerCheck } = await client.query(
        `SELECT id, product_name FROM product_costs WHERE id = $1 AND user_id = $2`,
        [product_cost_id, user.userId],
      );
      if (ownerCheck.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ success: false, error: `product_cost_id ${product_cost_id} not found` }, { status: 404 });
      }
      productNames.set(product_cost_id, ownerCheck[0].product_name as string);

      // 현재 재고 확인
      const { rows: stockRows } = await client.query(
        `SELECT COALESCE(SUM(quantity), 0)::int AS total_stock FROM cost_entries WHERE product_cost_id = $1`,
        [product_cost_id],
      );
      const totalStock = Number(stockRows[0].total_stock);
      if (rgQty > totalStock) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { success: false, error: `${product_cost_id}: 보낼 수량(${rgQty}) > 재고(${totalStock})` },
          { status: 400 },
        );
      }

      // FIFO 배치 목록 (received_at ASC)
      const { rows: batches } = await client.query(
        `SELECT id, quantity FROM cost_entries
         WHERE product_cost_id = $1
         ORDER BY received_at ASC, created_at ASC`,
        [product_cost_id],
      );

      const ops = computeFifoBatchOps(
        batches.map((b) => ({ id: b.id, quantity: Number(b.quantity) })),
        rgQty,
        unit_rg_fee,
      );

      for (const op of ops) {
        if (op.type === 'update') {
          await client.query(
            `UPDATE cost_entries SET unit_rg_shipping_fee = $1 WHERE id = $2`,
            [op.unitRgFee, op.batchId],
          );
          affectedEntries++;
        } else {
          await client.query(
            `UPDATE cost_entries SET quantity = $1, unit_rg_shipping_fee = $2 WHERE id = $3`,
            [op.take, op.unitRgFee, op.batchId],
          );
          await client.query(
            `INSERT INTO cost_entries
               (user_id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, shipping_group_id, created_at)
             SELECT user_id, product_cost_id, received_at, $1, unit_cost, unit_shipping_fee, 0, shipping_group_id, now()
             FROM cost_entries WHERE id = $2`,
            [op.remainder, op.batchId],
          );
          affectedEntries++;
          splitEntries++;
        }
      }
    }

    // 입고 이벤트 기록
    const { rows: eventRows } = await client.query(
      `INSERT INTO rg_shipment_events (user_id, shipped_at, total_shipping_fee)
       VALUES ($1, $2, $3) RETURNING id`,
      [user.userId, shipped_at, total_shipping_fee],
    );
    const eventId = eventRows[0].id as string;

    for (const item of items as RgShipmentItem[]) {
      const productName = productNames.get(item.product_cost_id);
      if (!productName) {
        throw new Error(`product_name missing for ${item.product_cost_id}`);
      }
      await client.query(
        `INSERT INTO rg_shipment_event_items
           (shipment_event_id, product_cost_id, product_name, quantity, unit_rg_fee)
         VALUES ($1, $2, $3, $4, $5)`,
        [eventId, item.product_cost_id, productName, item.quantity, item.unit_rg_fee],
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ success: true, data: { affected_entries: affectedEntries, split_entries: splitEntries } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[rg-shipments]', err);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  } finally {
    client.release();
  }
}
