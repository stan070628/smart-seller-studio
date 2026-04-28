/**
 * POST /api/winners/keyword-suggest
 * spec 2026-04-28 §6.2
 */

import { NextRequest, NextResponse } from 'next/server';
import { suggestKeywordOptimization } from '@/lib/winner/keyword-suggester';
import { getSourcingPool } from '@/lib/sourcing/db';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const skuCode = body?.skuCode as string | undefined;
  const currentTitle = body?.currentTitle as string | undefined;
  const mainKeywords = (body?.mainKeywords as string[] | undefined) ?? [];
  const categoryName = (body?.categoryName as string | undefined) ?? null;
  const currentRank = (body?.currentRank as number | undefined) ?? null;

  if (!skuCode || !currentTitle) {
    return NextResponse.json(
      { success: false, error: 'skuCode and currentTitle are required' },
      { status: 400 },
    );
  }

  try {
    const result = await suggestKeywordOptimization({
      currentTitle,
      mainKeywords,
      categoryName,
    });

    const pool = getSourcingPool();
    await pool.query(
      `INSERT INTO keyword_optimizations
         (sku_code, current_title, suggested_title, reasoning, current_rank)
       VALUES ($1, $2, $3, $4, $5)`,
      [skuCode, currentTitle, result.suggestedTitle, result.reasoning, currentRank],
    ).catch((e) => {
      console.error('[keyword-suggest] audit insert failed', e);
    });

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
