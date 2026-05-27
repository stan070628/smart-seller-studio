/**
 * dashboard/summary 라우트 인메모리 캐시 모듈.
 * Next.js 16 Route 파일은 HTTP 핸들러와 Route Segment Config만 export할 수 있으므로
 * 테스트에서 접근해야 하는 캐시 리셋 함수를 이 파일에서 export한다.
 */

import type { DashboardSummaryData } from '@/lib/dashboard/types';

export const CACHE_TTL_MS = 30_000;
export const cache = new Map<string, { data: DashboardSummaryData; expiresAt: number }>();

// 테스트 전용 — 케이스 간 캐시 초기화
export function _resetDashboardCacheForTests(): void {
  cache.clear();
}
