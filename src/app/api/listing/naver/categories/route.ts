/**
 * GET /api/listing/naver/categories
 * ?keyword=고데기  → 키워드로 리프 카테고리 검색
 */

import { NextRequest } from 'next/server';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';
import type { NaverCategory } from '@/lib/listing/naver-commerce-client';

// 메모리 캐시 (1시간)
let _cache: NaverCategory[] | null = null;
let _cachedAt = 0;
const CACHE_TTL = 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get('keyword');

  try {
    const client = getNaverCommerceClient();

    // 캐시된 카테고리 사용
    if (!_cache || Date.now() - _cachedAt > CACHE_TTL) {
      _cache = await client.getCategories();
      _cachedAt = Date.now();
    }

    let results: { id: string; name: string; path: string }[];

    if (keyword && keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      results = _cache
        .filter((c) => c.last && c.wholeCategoryName.toLowerCase().includes(kw))
        .slice(0, 30)
        .map((c) => ({
          id: c.id,
          name: c.name,
          path: c.wholeCategoryName,
        }));
    } else {
      // 키워드 없으면 최상위 카테고리 반환
      const seen = new Set<string>();
      results = _cache
        .filter((c) => {
          const top = c.wholeCategoryName.split('>')[0].trim();
          if (seen.has(top)) return false;
          seen.add(top);
          return true;
        })
        .slice(0, 50)
        .map((c) => ({
          id: c.id,
          name: c.wholeCategoryName.split('>')[0].trim(),
          path: c.wholeCategoryName,
        }));
    }

    return Response.json({ success: true, data: results });
  } catch (err) {
    console.error('[GET /api/listing/naver/categories]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
