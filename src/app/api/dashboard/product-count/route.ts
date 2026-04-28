/**
 * GET /api/dashboard/product-count
 *
 * 우선순위:
 *   1) dashboard_metrics_cache 에 24시간 이내 데이터가 있으면 즉시 반환 (source: 'cache')
 *   2) 없거나 stale 이면 외부 API 직접 조회 (source: 'live') — 느림 (수십 초 가능)
 *
 * 일 1회 cron(/api/cron/refresh-dashboard-metrics) 으로 캐시 갱신.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import type { ProductCountData } from '@/lib/dashboard/types';
import { countCoupangProducts, countNaverProducts } from '@/lib/dashboard/product-count';
import { getSourcingPool } from '@/lib/sourcing/db';

export const dynamic = 'force-dynamic';

const MEMORY_TTL_MS = 5 * 60_000;
const CACHE_FRESH_MS = 26 * 60 * 60 * 1000;  // 일 1회 cron이라 여유 1시간 더해 26시간 fresh
const memCache = new Map<string, { data: ProductCountData; expiresAt: number }>();

export function _resetProductCountCacheForTests(): void {
  memCache.clear();
}

interface DbCacheRow {
  coupang_product_count: number;
  naver_product_count: number;
  refreshed_at: string;
}

async function readDbCache(userId: string): Promise<ProductCountData | null> {
  try {
    const pool = getSourcingPool();
    const { rows } = await pool.query<DbCacheRow>(
      `SELECT coupang_product_count, naver_product_count, refreshed_at
       FROM dashboard_metrics_cache
       WHERE user_id = $1`,
      [userId],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    const ageMs = Date.now() - new Date(row.refreshed_at).getTime();
    if (ageMs > CACHE_FRESH_MS) return null;
    return {
      coupang: row.coupang_product_count,
      naver: row.naver_product_count,
      source: 'cache',
      refreshedAt: row.refreshed_at,
    };
  } catch (err) {
    console.warn('[product-count] DB 캐시 조회 실패 — live 조회로 fallback:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const memHit = memCache.get(userId);
  if (memHit && memHit.expiresAt > Date.now()) {
    return Response.json({ success: true, data: memHit.data });
  }

  // 1순위: DB 캐시 (cron이 일 1회 채움)
  const fromDb = await readDbCache(userId);
  if (fromDb) {
    memCache.set(userId, { data: fromDb, expiresAt: Date.now() + MEMORY_TTL_MS });
    return Response.json({ success: true, data: fromDb });
  }

  // 2순위: 외부 API 직접 조회 (느림 — 콜드 스타트 또는 cron 미실행 시에만)
  try {
    const [coupang, naver] = await Promise.all([
      countCoupangProducts(userId).catch(() => 0),
      countNaverProducts().catch(() => 0),
    ]);
    const data: ProductCountData = {
      coupang,
      naver,
      source: 'live',
      refreshedAt: new Date().toISOString(),
    };
    memCache.set(userId, { data, expiresAt: Date.now() + MEMORY_TTL_MS });
    return Response.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    console.error('[GET /api/dashboard/product-count]', err);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
