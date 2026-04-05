/**
 * Render PostgreSQL 커넥션 풀 유틸
 * SOURCING_DATABASE_URL 환경변수로 연결하며, 서버리스 재사용을 위해 풀을 싱글톤으로 관리
 */

import pg from 'pg';

// 모듈 스코프 싱글톤 — cold start 시 새로 생성, 웜 인스턴스에서는 재사용
let pool: pg.Pool | null = null;

export function getSourcingPool(): pg.Pool {
  if (!pool) {
    const connStr = process.env.SOURCING_DATABASE_URL;
    if (!connStr) throw new Error('SOURCING_DATABASE_URL이 설정되지 않았습니다.');

    const url = new URL(connStr);
    // family(IPv4 강제)는 PoolConfig 타입에 없으므로 unknown 경유로 전달
    // Render DB는 IPv4 전용이므로 반드시 필요
    const poolConfig = {
      host: url.hostname,
      port: parseInt(url.port || '5432', 10),
      database: url.pathname.slice(1),
      user: url.username,
      password: decodeURIComponent(url.password),
      ssl: { rejectUnauthorized: false },
      family: 4,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    } as unknown as pg.PoolConfig;

    pool = new pg.Pool(poolConfig);

    // 풀 오류 이벤트 로깅 (프로세스 크래시 방지)
    pool.on('error', (err) => {
      console.error('[sourcing-db] 풀 오류:', err);
    });
  }

  return pool;
}
