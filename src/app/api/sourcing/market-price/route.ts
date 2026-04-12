/**
 * PUT /api/sourcing/market-price
 * 도매꾹 상품의 시장 최저가를 수동으로 입력/수정
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';

const bodySchema = z.object({
  itemId: z.string().uuid(),
  marketPrice: z.number().int().positive(),
});

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { itemId, marketPrice } = parsed.data;
  const pool = getSourcingPool();

  try {
    await pool.query(
      `UPDATE public.sourcing_items
       SET market_lowest_price     = $1,
           market_price_source     = 'manual',
           market_price_updated_at = now(),
           updated_at              = now()
       WHERE id = $2`,
      [marketPrice, itemId],
    );

    return NextResponse.json({ success: true, marketPrice });
  } catch (err) {
    console.error('[sourcing/market-price] 업데이트 실패:', err);
    return NextResponse.json({ error: '저장 실패' }, { status: 500 });
  }
}
