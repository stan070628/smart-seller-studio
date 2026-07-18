import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { computeDailySettlement } from '@/lib/settlement/calculate';
import type { SettlementSale, SettlementEntry, SettlementExpense } from '@/lib/settlement/calculate';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ success: false, error: 'from, to (YYYY-MM-DD) required' }, { status: 400 });
  }

  const pool = getSourcingPool();
  try {
    const [salesRes, entriesRes, expensesRes, adRes] = await Promise.all([
      pool.query(
        `SELECT to_char(sr.sold_at, 'YYYY-MM-DD') AS sold_at,
                sr.sale_amount, sr.selling_price, sr.quantity, sr.coupon_discount,
                pc.platform_fee_rate
           FROM sale_records sr
           JOIN product_costs pc ON pc.id = sr.product_cost_id
          WHERE sr.user_id = $1 AND sr.voided_at IS NULL
            AND sr.channel IN ('coupang','rocket_growth')
            AND sr.sold_at BETWEEN $2 AND $3`,
        [user.userId, from, to],
      ),
      pool.query(
        `SELECT to_char(received_at, 'YYYY-MM-DD') AS received_at,
                quantity, unit_cost, unit_shipping_fee, unit_rg_shipping_fee
           FROM cost_entries
          WHERE user_id = $1 AND received_at BETWEEN $2 AND $3`,
        [user.userId, from, to],
      ),
      pool.query(
        `SELECT to_char(expense_date, 'YYYY-MM-DD') AS expense_date,
                ad_spend, box_cost, parcel_cost
           FROM daily_expenses
          WHERE user_id = $1 AND expense_date BETWEEN $2 AND $3`,
        [user.userId, from, to],
      ),
      pool.query(
        `SELECT to_char(ad_date, 'YYYY-MM-DD') AS ad_date, SUM(ad_spend)::int AS ad_spend
           FROM product_ad_spend_daily
          WHERE user_id = $1 AND ad_date BETWEEN $2 AND $3
          GROUP BY ad_date`,
        [user.userId, from, to],
      ),
    ]);

    const sales: SettlementSale[] = salesRes.rows.map((r) => ({
      sold_at: r.sold_at,
      sale_amount: r.sale_amount == null ? null : Number(r.sale_amount),
      selling_price: Number(r.selling_price),
      quantity: Number(r.quantity),
      coupon_discount: Number(r.coupon_discount ?? 0),
      platform_fee_rate: Number(r.platform_fee_rate),
    }));
    const entries: SettlementEntry[] = entriesRes.rows.map((r) => ({
      received_at: r.received_at,
      quantity: Number(r.quantity),
      unit_cost: Number(r.unit_cost),
      unit_shipping_fee: Number(r.unit_shipping_fee ?? 0),
      unit_rg_shipping_fee: Number(r.unit_rg_shipping_fee ?? 0),
    }));
    const expenses: SettlementExpense[] = expensesRes.rows.map((r) => ({
      expense_date: r.expense_date,
      ad_spend: 0, // 광고비는 product_ad_spend_daily 에서 주입
      box_cost: Number(r.box_cost ?? 0),
      parcel_cost: Number(r.parcel_cost ?? 0),
    }));
    // 상품별 날짜 광고비 합계를 별도 비용 항목으로 추가 (computeDailySettlement이 날짜별 합산)
    for (const r of adRes.rows) {
      expenses.push({
        expense_date: r.ad_date,
        ad_spend: Number(r.ad_spend ?? 0),
        box_cost: 0,
        parcel_cost: 0,
      });
    }

    const result = computeDailySettlement(sales, entries, expenses);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
