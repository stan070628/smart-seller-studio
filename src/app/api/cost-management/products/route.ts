import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { calculateProductMetrics } from '@/lib/cost-management/calculations';
import type { CostEntryRow } from '@/lib/cost-management/calculations';

// ─────────────────────────────────────────
// GET /api/cost-management/products
// 현재 유저의 상품 목록과 각 상품의 수익성 지표를 반환한다.
// ─────────────────────────────────────────
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getSourcingPool();

  // 상품 기본 정보 조회
  const { rows: products } = await pool.query(
    `SELECT id, product_name, seller_product_id, platform, platform_fee_rate, current_stock, created_at
     FROM product_costs
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [user.userId],
  );

  // 해당 유저의 전체 원가 입력 항목 조회
  const { rows: entries } = await pool.query(
    `SELECT id, product_cost_id, received_at, quantity, unit_cost, unit_shipping_fee, selling_price, shipping_group_id
     FROM cost_entries
     WHERE user_id = $1`,
    [user.userId],
  );

  // product_cost_id 기준으로 항목을 분류하고 숫자 컬럼을 Number()로 변환
  // (pg 드라이버는 NUMERIC/DECIMAL 컬럼을 문자열로 반환)
  const entriesByProduct = new Map<string, CostEntryRow[]>();
  for (const e of entries) {
    const list = entriesByProduct.get(e.product_cost_id) ?? [];
    list.push({
      id: e.id,
      product_cost_id: e.product_cost_id,
      received_at: e.received_at,
      quantity: Number(e.quantity),
      unit_cost: Number(e.unit_cost),
      unit_shipping_fee: Number(e.unit_shipping_fee),
      selling_price: Number(e.selling_price),
      shipping_group_id: e.shipping_group_id,
    });
    entriesByProduct.set(e.product_cost_id, list);
  }

  // 각 상품에 대해 수익성 지표를 계산하여 병합
  const data = products.map((p) => {
    const pEntries = entriesByProduct.get(p.id) ?? [];
    const metrics = calculateProductMetrics(pEntries, Number(p.platform_fee_rate));
    return {
      id: p.id,
      product_name: p.product_name,
      seller_product_id: p.seller_product_id,
      platform: p.platform,
      platform_fee_rate: Number(p.platform_fee_rate),
      current_stock: Number(p.current_stock),
      entry_count: pEntries.length,
      ...metrics,
    };
  });

  return NextResponse.json({ success: true, data });
}

// ─────────────────────────────────────────
// POST /api/cost-management/products
// 신규 상품을 product_costs 테이블에 등록한다.
// ─────────────────────────────────────────
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // JSON 파싱 실패 시 null을 반환하여 아래 검증 단계에서 처리
  const body = await request.json().catch(() => null);
  const { product_name, seller_product_id, platform_fee_rate } = body ?? {};

  // product_name 필수 검증
  if (!product_name || typeof product_name !== 'string' || product_name.trim() === '') {
    return NextResponse.json({ success: false, error: 'product_name required' }, { status: 400 });
  }

  const pool = getSourcingPool();
  const { rows } = await pool.query(
    `INSERT INTO product_costs (user_id, product_name, seller_product_id, platform_fee_rate)
     VALUES ($1, $2, $3, $4)
     RETURNING id, product_name, seller_product_id, platform, platform_fee_rate, current_stock, created_at`,
    [
      user.userId,
      product_name.trim(),
      seller_product_id ?? null,
      // platform_fee_rate 미전달 시 쿠팡 기본 수수료율 10.8% 적용
      platform_fee_rate ?? 0.108,
    ],
  );

  return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
}
