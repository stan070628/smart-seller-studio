import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';

const ALLOWED_SALE_CHANNELS = ['manual', 'coupang', 'rocket_growth', 'naver'];

// GET /api/cost-management/products/[id]/sales
// 특정 상품에 대한 판매 내역 목록을 반환한다.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  try {
    // 요청 유저가 소유한 상품인지 확인
    const { rows: check } = await pool.query(
      `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const { rows } = await pool.query(
      `SELECT id, sold_at, quantity, selling_price, coupon_discount, channel, coupang_order_item_id, shipping_fee, created_at
       FROM sale_records
       WHERE product_cost_id = $1 AND voided_at IS NULL
       ORDER BY sold_at DESC, created_at DESC`,
      [id],
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST /api/cost-management/products/[id]/sales
// 특정 상품에 수동 판매 내역을 추가한다.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { sold_at, quantity, selling_price, shipping_fee: rawShipping, coupon_discount, channel } = body ?? {};

  // shipping_fee: 제공된 경우 정수·비음수 검증, 없으면 0
  let shipping_fee = 0;
  if (rawShipping != null) {
    const parsed = Number(rawShipping);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return NextResponse.json(
        { success: false, error: 'shipping_fee must be non-negative integer' },
        { status: 400 },
      );
    }
    shipping_fee = parsed;
  }

  // coupon_discount: 제공된 경우 정수·비음수 검증, 없으면 0
  let couponDiscount = 0;
  if (coupon_discount != null) {
    if (!Number.isInteger(coupon_discount) || coupon_discount < 0) {
      return NextResponse.json(
        { success: false, error: 'coupon_discount must be non-negative integer' },
        { status: 400 },
      );
    }
    couponDiscount = coupon_discount;
  }

  // channel: 제공된 경우 허용셋 검증, 없으면 manual
  let saleChannel = 'manual';
  if (channel != null) {
    if (!ALLOWED_SALE_CHANNELS.includes(channel)) {
      return NextResponse.json({ success: false, error: 'invalid channel' }, { status: 400 });
    }
    saleChannel = channel;
  }

  // 입력값 유효성 검증: sold_at 필수, quantity 양의 정수, selling_price 0 이상 정수
  if (
    !sold_at ||
    quantity == null || !Number.isInteger(quantity) || quantity <= 0 ||
    selling_price == null || !Number.isInteger(selling_price) || selling_price < 0
  ) {
    return NextResponse.json(
      { success: false, error: 'sold_at, quantity(>0), selling_price(>=0) required' },
      { status: 400 },
    );
  }

  // sold_at 날짜 형식 검증: YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sold_at)) {
    return NextResponse.json(
      { success: false, error: 'sold_at must be YYYY-MM-DD' },
      { status: 400 },
    );
  }

  const pool = getSourcingPool();

  try {
    // 요청 유저가 소유한 상품인지 확인
    const { rows: check } = await pool.query(
      `SELECT id FROM product_costs WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (check.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const { rows } = await pool.query(
      `INSERT INTO sale_records (user_id, product_cost_id, sold_at, quantity, selling_price, sale_amount, channel, shipping_fee, coupon_discount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [user.userId, id, sold_at, quantity, selling_price, selling_price * quantity, saleChannel, shipping_fee, couponDiscount],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
