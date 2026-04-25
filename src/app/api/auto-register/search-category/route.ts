/**
 * GET /api/auto-register/search-category?keyword=차량용+선풍기
 *
 * 이미 등록된 판매자 상품 목록에서 keyword와 유사한 상품의 카테고리 코드를 반환합니다.
 * 카테고리 트리 API(IP 제한) 대신 판매자 상품 API를 활용합니다.
 *
 * Response (200):
 *   { "categories": [{ displayCategoryCode, displayCategoryName, fullPath }] }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getCoupangClient } from '@/lib/listing/coupang-client';

// 5분 캐시 (판매자 상품 목록은 자주 바뀌지 않음)
let cache: { items: { sellerProductName: string; displayCategoryCode: number }[]; ts: number } | null = null;

async function getProductIndex() {
  const now = Date.now();
  if (cache && now - cache.ts < 5 * 60 * 1000) return cache.items;

  const client = getCoupangClient();
  const all: { sellerProductName: string; displayCategoryCode: number }[] = [];

  // 최대 3페이지(150개)만 가져와서 카테고리 코드 수집
  let nextToken = '';
  for (let i = 0; i < 3; i++) {
    const res = await client.getSellerProducts('APPROVED', 50, nextToken);
    for (const p of res.items) {
      if (p.displayCategoryCode) {
        all.push({ sellerProductName: p.sellerProductName, displayCategoryCode: p.displayCategoryCode });
      }
    }
    if (!res.nextToken) break;
    nextToken = res.nextToken;
  }

  cache = { items: all, ts: now };
  return all;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return NextResponse.json(
    { error: '인증이 필요합니다.' },
    { status: 401 },
  );

  const keyword = req.nextUrl.searchParams.get('keyword')?.trim() ?? '';
  if (!keyword) {
    return NextResponse.json({ error: 'keyword가 필요합니다.' }, { status: 400 });
  }

  try {
    const items = await getProductIndex();
    const lower = keyword.toLowerCase();

    // 키워드를 포함하는 상품 필터링 → 카테고리 코드별 대표 상품명 수집
    const codeMap = new Map<number, string>();
    for (const item of items) {
      if (item.sellerProductName.toLowerCase().includes(lower)) {
        if (!codeMap.has(item.displayCategoryCode)) {
          codeMap.set(item.displayCategoryCode, item.sellerProductName);
        }
      }
    }

    // 결과가 없으면 카테고리 코드 기준으로 다양성 확보 (전체 상품에서 유니크 코드 8개)
    if (codeMap.size === 0) {
      const seen = new Set<number>();
      for (const item of items) {
        if (!seen.has(item.displayCategoryCode)) {
          seen.add(item.displayCategoryCode);
          codeMap.set(item.displayCategoryCode, item.sellerProductName);
        }
        if (seen.size >= 8) break;
      }
    }

    const categories = Array.from(codeMap.entries())
      .slice(0, 8)
      .map(([displayCategoryCode, exampleName]) => ({
        displayCategoryCode,
        displayCategoryName: `코드 ${displayCategoryCode}`,
        fullPath: exampleName, // 대표 상품명을 fullPath로 표시
      }));

    return NextResponse.json({ categories });
  } catch (err) {
    console.error('[search-category] 실패:', err);
    return NextResponse.json({ categories: [] });
  }
}
