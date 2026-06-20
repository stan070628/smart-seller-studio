/**
 * POST /api/listing/sourcing/check-costco-stock
 * 코스트코 소싱 URL로 단일 상품 재고 상태를 확인하고 product_sourcing 테이블을 업데이트한다.
 *
 * Body: { platform: 'coupang' | 'naver'; productId: string; sourcingUrl: string }
 * Response: { status: 'inStock' | 'outOfStock' | 'lowStock'; checkedAt: string }
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { GET as lookupGet } from '@/app/api/sourcing/costco/lookup/route';
import type { LookupResult } from '@/app/api/sourcing/costco/lookup/route';

export const runtime = 'nodejs';
export const maxDuration = 20;

/**
 * costco.co.kr URL에서 5~10자리 상품코드를 추출한다.
 * 예) https://www.costco.co.kr/p/1234567 → '1234567'
 */
function extractCostcoCode(url: string): string | null {
  const m = url.match(/costco\.co\.kr\/.*?(\d{5,10})/);
  return m ? m[1] : null;
}

export async function POST(request: NextRequest) {
  // 1. 인증 확인
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  // 2. 요청 body 파싱
  const body = await request.json() as {
    platform?: string;
    productId?: string;
    sourcingUrl?: string;
  };

  const { platform, productId, sourcingUrl } = body;

  // 3. 필수 필드 검증
  if (!platform || !productId || !sourcingUrl) {
    return Response.json(
      { error: 'platform, productId, sourcingUrl 필드가 필요합니다.' },
      { status: 400 },
    );
  }

  // 4. 코스트코 URL 여부 확인
  if (!sourcingUrl.includes('costco.co.kr')) {
    return Response.json(
      { error: '코스트코 URL이 아닙니다.' },
      { status: 400 },
    );
  }

  // 5. URL에서 상품코드 추출
  const code = extractCostcoCode(sourcingUrl);
  if (!code) {
    return Response.json(
      { error: '상품코드를 URL에서 추출할 수 없습니다.' },
      { status: 422 },
    );
  }

  // 6. 내부 lookup API 호출
  const lookupReq = new NextRequest(
    `http://localhost/api/sourcing/costco/lookup?code=${code}`,
    { headers: request.headers },
  );
  const lookupRes = await lookupGet(lookupReq);

  if (!lookupRes.ok) {
    if (lookupRes.status === 404) {
      return Response.json(
        { error: '코스트코에서 상품을 찾을 수 없습니다.' },
        { status: 422 },
      );
    }
    return Response.json(
      { error: '코스트코 API 조회 실패' },
      { status: 502 },
    );
  }

  // 7. stockStatus 획득
  const data = await lookupRes.json() as LookupResult;
  const stockStatus = data.stockStatus;
  const checkedAt = new Date().toISOString();

  // 8. product_sourcing 테이블 업데이트
  try {
    const pool = getSourcingPool();
    await pool.query(
      `UPDATE product_sourcing
       SET costco_stock_status = $1, costco_stock_checked_at = $2
       WHERE platform = $3 AND product_id = $4`,
      [stockStatus, checkedAt, platform, productId],
    );
  } catch (err) {
    console.error('[check-costco-stock] DB 업데이트 실패:', err);
    return Response.json({ error: 'DB 업데이트 실패' }, { status: 500 });
  }

  // 9. 결과 반환
  return Response.json({ status: stockStatus, checkedAt });
}
