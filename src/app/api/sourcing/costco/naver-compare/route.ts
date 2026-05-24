/**
 * GET /api/sourcing/costco/naver-compare
 * 코스트코 상품 제목으로 네이버 쇼핑 API를 실시간 검색해 비교 결과를 반환한다.
 *
 * 쿼리 파라미터:
 *  - title: 코스트코 상품명 (필수, 1자 이상)
 *  - code:  코스트코 상품코드 (선택, 있으면 DB에서 unit_price_label 조회)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';
import { normalizeForUnitSearch } from '@/lib/sourcing/naver-shopping';

export const runtime = 'nodejs';
export const maxDuration = 20;

// ─────────────────────────────────────────────────────────────────────────────
// 입력 검증 스키마
// ─────────────────────────────────────────────────────────────────────────────

const querySchema = z.object({
  title: z.string().min(1),
  code: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface NaverCompareItem {
  title: string;
  totalPrice: number;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  link: string;
}

export interface NaverCompareResponse {
  items: NaverCompareItem[];
  source: 'unit' | 'total';
}

// ─────────────────────────────────────────────────────────────────────────────
// 네이버 API 원시 타입
// ─────────────────────────────────────────────────────────────────────────────

interface NaverRawItem {
  title: string;
  lprice: string;
  link: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 유틸
// ─────────────────────────────────────────────────────────────────────────────

/** HTML 태그 제거 */
function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

/** 최저가 문자열을 정수로 파싱 — 빈 값·0·NaN이면 null 반환, HTML 태그 제거 후 파싱 */
function parseLprice(s: string): number | null {
  if (!s || s.trim() === '' || s === '0') return null;
  const n = parseInt(s.replace(/<[^>]*>/g, ''), 10);
  return isNaN(n) || n <= 0 ? null : n;
}

// ─────────────────────────────────────────────────────────────────────────────
// 네이버 쇼핑 API 호출
// ─────────────────────────────────────────────────────────────────────────────

async function fetchNaverItems(query: string): Promise<NaverRawItem[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[naver-compare] NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 미설정');
    return [];
  }

  const url = new URL('https://openapi.naver.com/v1/search/shop.json');
  url.searchParams.set('query', normalizeForUnitSearch(query));
  url.searchParams.set('display', '5');
  url.searchParams.set('sort', 'asc'); // 가격 오름차순

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[naver-compare] API 오류 (${res.status}): query="${query}", body=${body}`);
      return [];
    }

    const data = (await res.json()) as { items?: NaverRawItem[] };
    return data.items ?? [];
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`[naver-compare] 타임아웃: query="${query}"`);
    } else {
      console.error(`[naver-compare] 요청 실패: query="${query}"`, err);
    }
    return [];
  } finally {
    clearTimeout(tid);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 핸들러
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // 입력 검증
  const { searchParams } = req.nextUrl;
  const parsed = querySchema.safeParse({
    title: searchParams.get('title'),
    code: searchParams.get('code') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { title, code } = parsed.data;

  // DB에서 unit_price_label 조회 — 코드가 있을 때만 시도
  let unitPriceLabel: string | null = null;
  if (code) {
    try {
      const pool = getSourcingPool();
      const res = await pool.query<{ unit_price_label: string | null }>(
        `SELECT unit_price_label FROM public.costco_products WHERE product_code = $1 LIMIT 1`,
        [code],
      );
      unitPriceLabel = res.rows[0]?.unit_price_label ?? null;
    } catch (err) {
      // DB 실패 시 label 없이 진행 — 치명적 오류가 아니므로 500 반환하지 않음
      console.error('[naver-compare] unit_price_label DB 조회 실패:', err);
    }
  }

  // 네이버 쇼핑 검색
  const rawItems = await fetchNaverItems(title);

  // 유효한 가격이 있는 상품만 필터링 후 최대 3개 반환
  const items: NaverCompareItem[] = rawItems
    .map((item): NaverCompareItem | null => {
      const totalPrice = parseLprice(item.lprice);
      if (totalPrice === null) return null;
      return {
        title: stripHtml(item.title),
        totalPrice,
        unitPrice: null,       // 단가 계산은 클라이언트 또는 별도 엔드포인트에서 수행
        unitPriceLabel,
        link: item.link,
      };
    })
    .filter((x): x is NaverCompareItem => x !== null)
    .slice(0, 3);

  const response: NaverCompareResponse = { items, source: 'total' };
  return NextResponse.json(response);
}
