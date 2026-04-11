/**
 * PUT /api/sourcing/costco/market-price
 * 상품의 시장 최저가 수동 입력
 * 입력 후 해당 상품의 소싱 스코어를 즉시 재계산
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';
import { recalculateProductScore } from '@/lib/sourcing/costco-scorer';
import { calculateMargin } from '@/lib/sourcing/costco-margin';

const bodySchema = z.object({
  productCode: z.string().min(1),
  marketPrice: z.number().int().positive(),
  source: z.enum(['manual', 'naver_api', 'coupang_api']).default('manual'),
});

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { productCode, marketPrice, source } = parsed.data;
  const pool = getSourcingPool();

  // 상품 존재 확인
  const productRes = await pool.query(
    `SELECT id, price, target_sell_price FROM public.costco_products WHERE product_code = $1`,
    [productCode],
  );
  if (!productRes.rows[0]) {
    return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
  }

  const { id: productId, price: purchasePrice } = productRes.rows[0];

  try {
    // 1. 상품 마스터의 시장가 업데이트
    await pool.query(
      `UPDATE public.costco_products
       SET market_lowest_price      = $1,
           market_price_source      = $2,
           market_price_updated_at  = now(),
           updated_at               = now()
       WHERE product_code = $3`,
      [marketPrice, source, productCode],
    );

    // 2. 시장가 이력 로그
    await pool.query(
      `INSERT INTO public.costco_market_prices
         (product_id, product_code, market_price, source, logged_at)
       VALUES ($1, $2, $3, $4, CURRENT_DATE)
       ON CONFLICT (product_code, logged_at, source)
       DO UPDATE SET market_price = EXCLUDED.market_price`,
      [productId, productCode, marketPrice, source],
    );

    // 3. 소싱 스코어 즉시 재계산
    await recalculateProductScore(pool, productCode);

    // 4. 업데이트된 스코어와 마진 정보 반환
    const updatedRes = await pool.query(
      `SELECT sourcing_score, demand_score, price_opp_score, urgency_score,
              seasonal_score, margin_score, market_lowest_price, target_sell_price, price
       FROM public.costco_products
       WHERE product_code = $1`,
      [productCode],
    );

    const updated = updatedRes.rows[0];
    const margin = calculateMargin({
      purchasePrice,
      sellPrice: marketPrice,
    });

    return NextResponse.json({
      success: true,
      scores: {
        sourcing_score:  updated.sourcing_score,
        demand_score:    updated.demand_score,
        price_opp_score: updated.price_opp_score,
        urgency_score:   updated.urgency_score,
        seasonal_score:  updated.seasonal_score,
        margin_score:    updated.margin_score,
      },
      margin,
    });
  } catch (err) {
    console.error('[costco/market-price] 오류:', err);
    return NextResponse.json({ error: '시장가 업데이트 실패' }, { status: 500 });
  }
}
