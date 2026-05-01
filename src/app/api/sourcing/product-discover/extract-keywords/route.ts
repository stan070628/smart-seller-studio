/**
 * POST /api/sourcing/product-discover/extract-keywords
 * 상품명 → AI 키워드 5~10개 후보
 * AI 실패 시 빈 배열 + aiFailed=true 반환 (UI에서 사용자 직접 입력 fallback)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { extractKeywordsFromProduct } from '@/lib/sourcing/ai-keyword-extract';

const requestSchema = z.object({
  productTitle: z.string().min(1).max(200),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '상품명이 필요합니다' }, { status: 400 });
  }

  const trimmed = parsed.data.productTitle.trim();
  if (!trimmed) {
    return NextResponse.json({ success: false, error: '상품명이 비어 있습니다' }, { status: 400 });
  }

  console.log(`[extract-keywords] productTitle="${trimmed}"`);
  const keywords = await extractKeywordsFromProduct(trimmed);
  console.log(`[extract-keywords] result=${keywords === null ? 'null(aiFailed)' : `${keywords.length}개`}`);

  if (keywords === null) {
    return NextResponse.json({
      success: true,
      data: { keywords: [], aiFailed: true },
    });
  }

  return NextResponse.json({
    success: true,
    data: { keywords, aiFailed: false },
  });
}
