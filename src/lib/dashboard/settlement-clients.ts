/**
 * 채널별 정산 데이터 클라이언트.
 * Phase 5: 쿠팡 Wing revenue-history 연동
 * Phase 6: 네이버 커머스 settlements 연동
 *
 * 현재(Phase 1~4)는 스텁 — 항상 available: false 반환.
 */
import type { SettlementStageMetric, Period } from './types';

export interface SettlementParams {
  period: Period;
}

export async function fetchCoupangSettlement(_params: SettlementParams): Promise<SettlementStageMetric> {
  return { count: 0, amount: 0, available: false };
}

export async function fetchNaverSettlement(_params: SettlementParams): Promise<SettlementStageMetric> {
  return { count: 0, amount: 0, available: false };
}
