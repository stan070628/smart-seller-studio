import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { createCostEntry, CostEntryError } from '@/lib/cost-management/create-entry';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  try {
    // subdivision 필드를 포함하여 product 조회
    const { rows: check } = await pool.query(
      `SELECT id, subdivision_unit, subdivision_carryover, subdivision_carryover_unit_cost
       FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const product = check[0];

    const { rows } = await pool.query(
      `SELECT ce.id, ce.received_at, ce.quantity, ce.unit_cost, ce.unit_shipping_fee,
              ce.unit_rg_shipping_fee,
              ce.shipping_group_id, sg.name as shipping_group_name, ce.created_at,
              ce.purchase_quantity, ce.subdivision_unit
       FROM cost_entries ce
       LEFT JOIN shipping_groups sg ON sg.id = ce.shipping_group_id
       WHERE ce.product_cost_id = $1
       ORDER BY ce.received_at DESC, ce.created_at DESC`,
      [id],
    );

    return NextResponse.json({
      success: true,
      data: rows,
      meta: {
        subdivision_unit: product.subdivision_unit ? Number(product.subdivision_unit) : null,
        subdivision_carryover: Number(product.subdivision_carryover ?? 0),
        subdivision_carryover_unit_cost: Number(product.subdivision_carryover_unit_cost ?? 0),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const {
    received_at,
    quantity,
    unit_cost,
    unit_shipping_fee,
    unit_rg_shipping_fee,
    shipping_group_id,
    channel,
    purchase_quantity,
    subdivision_unit: bodySubdivisionUnit,
    variant_name,
  } = body ?? {};

  // 소분 모드 여부 판별: purchase_quantity가 양수로 전달된 경우
  const isSubdivisionMode =
    purchase_quantity != null &&
    typeof purchase_quantity === 'number' &&
    purchase_quantity > 0;

  // 소분/일반 모드별 유효성 검사
  if (!isSubdivisionMode) {
    if (
      !received_at ||
      quantity == null || typeof quantity !== 'number' || quantity <= 0 ||
      unit_cost == null || !Number.isInteger(unit_cost) || unit_cost < 0
    ) {
      return NextResponse.json(
        { success: false, error: 'received_at, quantity(>0), unit_cost(>=0) required' },
        { status: 400 },
      );
    }
  } else {
    if (!received_at || unit_cost == null || typeof unit_cost !== 'number' || unit_cost < 0) {
      return NextResponse.json(
        { success: false, error: 'received_at, unit_cost(총 구매가) required for subdivision mode' },
        { status: 400 },
      );
    }
  }

  const pool = getSourcingPool();

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { entry, carryoverOut, isSubdivisionMode: subMode } = await createCostEntry({
        client,
        userId: user.userId,
        productCostId: id,
        receivedAt: received_at,
        unitCost: unit_cost,
        quantity,
        purchaseQuantity: purchase_quantity,
        subdivisionUnit: bodySubdivisionUnit,
        unitShippingFee: unit_shipping_fee,
        unitRgShippingFee: unit_rg_shipping_fee,
        channel,
        variantName: variant_name,
      });

      await client.query('COMMIT');

      return NextResponse.json(
        {
          success: true,
          data: entry,
          ...(subMode && { carryover_out: carryoverOut }),
        },
        { status: 201 },
      );
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    // 서비스가 실어 보낸 상태를 그대로 쓴다 — 추출 전의 400/404 응답을 보존한다
    if (err instanceof CostEntryError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
