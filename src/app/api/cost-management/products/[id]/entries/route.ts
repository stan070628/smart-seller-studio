import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { ENTRY_CHANNEL } from '@/lib/cost-management/fifo';
import { calculateSubdivision } from '@/lib/cost-management/subdivision';

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
    // subdivision 필드를 포함하여 product 조회
    const { rows: check } = await pool.query(
      `SELECT id, subdivision_unit, subdivision_carryover, subdivision_carryover_unit_cost
       FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const product = check[0];

    // 소분/일반 분기 처리
    let finalQuantity: number;
    let finalUnitCost: number;
    let finalPurchaseQuantity: number | null = null;
    let finalSubdivisionUnit: number | null = null;
    let carryoverOut: number | null = null;
    let newCarryoverUnitCost: number | null = null;

    if (isSubdivisionMode) {
      const subdivisionUnit =
        bodySubdivisionUnit ??
        (product.subdivision_unit ? Number(product.subdivision_unit) : null);

      if (!subdivisionUnit || subdivisionUnit < 2) {
        return NextResponse.json(
          { success: false, error: 'subdivision_unit required (product default or body)' },
          { status: 400 },
        );
      }

      const calc = calculateSubdivision({
        purchaseQuantity: purchase_quantity,
        totalPurchaseCost: unit_cost,
        subdivisionUnit,
        carryoverQuantity: Number(product.subdivision_carryover ?? 0),
        carryoverUnitCost: Number(product.subdivision_carryover_unit_cost ?? 0),
      });

      if (calc.sellablePacks === 0) {
        return NextResponse.json(
          {
            success: false,
            error: `팩을 완성하기에 수량이 부족합니다. 현재 이월 포함 총 ${calc.totalAvailable}개, 소분 단위 ${subdivisionUnit}개`,
          },
          { status: 400 },
        );
      }

      finalQuantity = calc.sellablePacks;
      finalUnitCost = calc.packUnitCost;
      finalPurchaseQuantity = purchase_quantity;
      finalSubdivisionUnit = subdivisionUnit;
      carryoverOut = calc.newCarryoverQuantity;
      newCarryoverUnitCost = calc.newCarryoverUnitCost;
    } else {
      finalQuantity = quantity;
      finalUnitCost = unit_cost;
    }

    const client = await pool.connect();
    let rows: Record<string, unknown>[];
    try {
      await client.query('BEGIN');

      ({ rows } = await client.query(
        `INSERT INTO cost_entries
           (user_id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee, channel, purchase_quantity, subdivision_unit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          user.userId,
          id,
          received_at,
          finalQuantity,
          finalUnitCost,
          unit_shipping_fee ?? 0,
          unit_rg_shipping_fee ?? 0,
          (channel === ENTRY_CHANNEL.RG || channel === ENTRY_CHANNEL.WING) ? channel : ENTRY_CHANNEL.WING,
          finalPurchaseQuantity,
          finalSubdivisionUnit,
        ],
      ));

      // 소분 모드인 경우 product_costs의 이월 수량/단가 갱신 (같은 트랜잭션)
      if (isSubdivisionMode && carryoverOut !== null) {
        await client.query(
          `UPDATE product_costs SET subdivision_carryover = $1, subdivision_carryover_unit_cost = $2 WHERE id = $3`,
          [carryoverOut, newCarryoverUnitCost, id],
        );
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    return NextResponse.json(
      {
        success: true,
        data: rows[0],
        ...(isSubdivisionMode && { carryover_out: carryoverOut }),
      },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
