/**
 * GET /api/cron/refresh-dashboard-metrics
 *
 * 일 1회(03:00 KST) 실행. 쿠팡/네이버 등록 상품 수를 외부 API로 카운트하고
 * dashboard_metrics_cache 에 저장. /api/dashboard/product-count 가 즉시 읽도록.
 *
 * 인증: Authorization: Bearer ${CRON_SECRET}
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { countCoupangProducts, countNaverProducts } from '@/lib/dashboard/product-count';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

// 단일 사용자 환경 — 쿠팡/네이버 자격증명도 env 단위라 user_id별 fan-out 불필요.
// AGENTS.md/메모리: 사용자 이메일 stan@aibox.it.kr → 시스템 single-tenant.
const SYSTEM_USER_ID = process.env.DASHBOARD_OWNER_USER_ID ?? '';

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!CRON_SECRET || auth.replace('Bearer ', '') !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (!SYSTEM_USER_ID) {
    return NextResponse.json(
      { success: false, error: 'DASHBOARD_OWNER_USER_ID 환경변수가 필요합니다.' },
      { status: 500 },
    );
  }

  const t0 = Date.now();
  const [coupangResult, naverResult] = await Promise.allSettled([
    countCoupangProducts(SYSTEM_USER_ID),
    countNaverProducts(),
  ]);
  const coupang = coupangResult.status === 'fulfilled' ? coupangResult.value : 0;
  const naver = naverResult.status === 'fulfilled' ? naverResult.value : 0;

  const pool = getSourcingPool();
  await pool.query(
    `INSERT INTO dashboard_metrics_cache (user_id, coupang_product_count, naver_product_count, refreshed_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE
     SET coupang_product_count = EXCLUDED.coupang_product_count,
         naver_product_count = EXCLUDED.naver_product_count,
         refreshed_at = EXCLUDED.refreshed_at`,
    [SYSTEM_USER_ID, coupang, naver],
  );

  return NextResponse.json({
    success: true,
    coupang,
    naver,
    coupangError: coupangResult.status === 'rejected' ? String(coupangResult.reason) : null,
    naverError: naverResult.status === 'rejected' ? String(naverResult.reason) : null,
    elapsedMs: Date.now() - t0,
  });
}
