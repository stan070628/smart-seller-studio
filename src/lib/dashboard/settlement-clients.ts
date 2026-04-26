/**
 * 채널별 정산 데이터 클라이언트.
 * - 쿠팡: Wing revenue-history API
 * - 네이버: 커머스 settlements API
 *
 * 자격증명 미설정 또는 API 호출 실패 시 available: false 반환 → UI에서 "API 미연동" 표시.
 */
import type { SettlementStageMetric, Period } from './types';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';

export interface SettlementParams {
  period: Period;
}

function periodToRange(period: Period): { from: string; to: string } {
  const today = new Date();
  // KST 기준 YYYY-MM-DD
  const toKstDate = (d: Date) => {
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
  };
  const to = toKstDate(today);
  let from = to;
  if (period === '7d') {
    const d = new Date(today); d.setDate(d.getDate() - 6); from = toKstDate(d);
  } else if (period === '30d') {
    const d = new Date(today); d.setDate(d.getDate() - 29); from = toKstDate(d);
  } else if (period === 'month') {
    const d = new Date(today.getFullYear(), today.getMonth(), 1); from = toKstDate(d);
  }
  return { from, to };
}

export async function fetchCoupangSettlement(params: SettlementParams): Promise<SettlementStageMetric> {
  try {
    const client = getCoupangClient();
    const { from, to } = periodToRange(params.period);
    const result = await client.getRevenueHistory({
      recognitionDateFrom: from,
      recognitionDateTo: to,
      maxPerPage: 100,
    });
    const totalAmount = result.items.reduce((sum, r) => sum + (r.saleAmount || 0), 0);
    return { count: result.items.length, amount: totalAmount, available: true };
  } catch (err) {
    console.warn('[dashboard] 쿠팡 정산 조회 실패:', err instanceof Error ? err.message : err);
    return { count: 0, amount: 0, available: false };
  }
}

export async function fetchNaverSettlement(params: SettlementParams): Promise<SettlementStageMetric> {
  try {
    const client = getNaverCommerceClient();
    const { from, to } = periodToRange(params.period);
    const result = await client.getSettlements({ fromDate: from, toDate: to });
    const totalAmount = result.items.reduce((sum, r) => sum + (r.settlementAmount || 0), 0);
    return { count: result.items.length, amount: totalAmount, available: true };
  } catch (err) {
    console.warn('[dashboard] 네이버 정산 조회 실패:', err instanceof Error ? err.message : err);
    return { count: 0, amount: 0, available: false };
  }
}
