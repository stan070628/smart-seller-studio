import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getSourcingPool } from '@/lib/sourcing/db';

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const client = getCoupangClient();
    const items: Array<{ sellerProductId: number; sellerProductName: string }> = [];
    let nextToken = '';

    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await client.getSellerProducts('APPROVED', PAGE_SIZE, nextToken);
      for (const p of result.items) {
        items.push({ sellerProductId: p.sellerProductId, sellerProductName: p.sellerProductName });
      }
      if (!result.nextToken) break;
      nextToken = result.nextToken;
    }

    return NextResponse.json({ success: true, data: items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// junction table에 Wing ID 매핑 저장 (1:N 지원)
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const mappings: Array<{ product_cost_id: string; seller_product_id: number }> = body?.mappings ?? [];

  if (!Array.isArray(mappings) || mappings.length === 0) {
    return NextResponse.json({ success: false, error: '매핑 데이터가 없습니다.' }, { status: 400 });
  }

  const pool = getSourcingPool();

  let saved = 0;
  for (const m of mappings) {
    if (!m.product_cost_id || !m.seller_product_id) continue;
    await pool.query(
      `INSERT INTO product_wing_seller_ids (user_id, product_cost_id, seller_product_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, seller_product_id)
       DO UPDATE SET product_cost_id = EXCLUDED.product_cost_id`,
      [user.userId, m.product_cost_id, m.seller_product_id],
    );
    // product_costs.seller_product_id도 첫 번째 값으로 동기화 (하위 호환)
    await pool.query(
      `UPDATE product_costs SET seller_product_id = $1
       WHERE id = $2 AND user_id = $3 AND seller_product_id IS NULL`,
      [m.seller_product_id, m.product_cost_id, user.userId],
    );
    saved++;
  }

  return NextResponse.json({ success: true, data: { saved } });
}
