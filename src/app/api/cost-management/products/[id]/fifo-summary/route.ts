import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { calculateFifo } from '@/lib/cost-management/fifo';
import type { PurchaseBatch, SaleRow } from '@/lib/cost-management/fifo';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const pool = getSourcingPool();

    const { rows: check } = await pool.query(
      `SELECT id, platform_fee_rate FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const feeRate = Number(check[0].platform_fee_rate);

    const [{ rows: entryRows }, { rows: saleRows }] = await Promise.all([
      pool.query(
        `SELECT id, received_at, quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee FROM cost_entries WHERE product_cost_id = $1`,
        [id],
      ),
      pool.query(
        `SELECT id, sold_at, quantity, selling_price FROM sale_records WHERE product_cost_id = $1`,
        [id],
      ),
    ]);

    const batches: PurchaseBatch[] = entryRows.map((e) => ({
      id: e.id,
      received_at: e.received_at instanceof Date ? e.received_at.toISOString().slice(0, 10) : String(e.received_at).slice(0, 10),
      quantity: Number(e.quantity),
      unit_cost: Number(e.unit_cost),
      unit_shipping_fee: Number(e.unit_shipping_fee),
      unit_rg_shipping_fee: Number(e.unit_rg_shipping_fee),
    }));

    const sales: SaleRow[] = saleRows.map((s) => ({
      id: s.id,
      sold_at: s.sold_at instanceof Date ? s.sold_at.toISOString().slice(0, 10) : String(s.sold_at).slice(0, 10),
      quantity: Number(s.quantity),
      selling_price: Number(s.selling_price),
    }));

    const result = calculateFifo(batches, sales, feeRate);

    return NextResponse.json({
      success: true,
      data: {
        current_stock: result.current_stock,
        stock_value: result.stock_value,
        total_realized_profit: result.total_realized_profit,
      },
    });
  } catch (err) {
    if (err instanceof RangeError) {
      console.error('[fifo-summary] FIFO 계산 오류:', err.message);
      return NextResponse.json({ success: false, error: '재고 데이터를 확인해 주세요.' }, { status: 422 });
    }
    console.error('[fifo-summary]', err);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}
