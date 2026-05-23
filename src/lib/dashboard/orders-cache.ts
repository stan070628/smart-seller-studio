import { getSourcingPool } from '@/lib/sourcing/db';

const TTL_MS = 30 * 60 * 1000; // 30분

export async function getOrdersCache<T>(key: string): Promise<T | null> {
  try {
    const pool = getSourcingPool();
    const { rows } = await pool.query<{ actual: T; cached_at: string }>(
      `SELECT actual, cached_at FROM dashboard_revenue_cache WHERE cache_key = $1`,
      [key],
    );
    if (rows.length === 0) return null;
    const age = Date.now() - new Date(rows[0].cached_at).getTime();
    if (age > TTL_MS) return null;
    return rows[0].actual;
  } catch {
    return null;
  }
}

export async function setOrdersCache<T>(key: string, data: T): Promise<void> {
  try {
    const pool = getSourcingPool();
    await pool.query(
      `INSERT INTO dashboard_revenue_cache (cache_key, actual)
       VALUES ($1, $2)
       ON CONFLICT (cache_key) DO UPDATE SET actual = EXCLUDED.actual, cached_at = now()`,
      [key, JSON.stringify(data)],
    );
    // 오래된 캐시 비동기 정리 (7일 초과)
    pool.query(
      `DELETE FROM dashboard_revenue_cache WHERE cached_at < now() - INTERVAL '7 days'`,
    ).catch(() => {});
  } catch {
    // 캐시 저장 실패는 무시 — 데이터 반환에는 영향 없음
  }
}
