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
  // 쿠팡 revenue-history 는 dateTo가 어제 이전이어야 함 → 어제로 clamp.
  // 정산은 본질적으로 D+N 데이터라 today 노출은 의미 없음 — 네이버 settlements도 동일하게 처리.
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const to = toKstDate(yesterday);
  let from = to;
  if (period === '7d') {
    const d = new Date(yesterday); d.setDate(d.getDate() - 6); from = toKstDate(d);
  } else if (period === '30d') {
    const d = new Date(yesterday); d.setDate(d.getDate() - 29); from = toKstDate(d);
  } else if (period === 'month') {
    const d = new Date(today.getFullYear(), today.getMonth(), 1); from = toKstDate(d);
  }
  return { from, to };
}

export async function fetchCoupangSettlement(params: SettlementParams): Promise<SettlementStageMetric> {
  try {
    const client = getCoupangClient();
    const { from, to } = periodToRange(params.period);

    // revenue-history는 ordersheet 단위 페이징. 누락 방지를 위해 nextToken 끝까지 따라감.
    const MAX_PAGES = 30;
    let token = '';
    let totalCount = 0;
    let totalAmount = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await client.getRevenueHistory({
        recognitionDateFrom: from,
        recognitionDateTo: to,
        maxPerPage: 50,  // 쿠팡 API 상한
        token,
      });
      totalCount += result.items.length;
      totalAmount += result.items.reduce((sum, r) => sum + (r.saleAmount || 0), 0);
      if (!result.nextToken) break;
      token = result.nextToken;
    }
    return { count: totalCount, amount: totalAmount, available: true };
  } catch (err) {
    console.warn('[dashboard] 쿠팡 정산 조회 실패:', err instanceof Error ? err.message : err);
    return { count: 0, amount: 0, available: false };
  }
}

export async function fetchNaverSettlement(_params: SettlementParams): Promise<SettlementStageMetric> {
  // 네이버 커머스 정산 endpoint(`/external/v1/settlements`)가 404 반환 — 정확한 경로 미확인.
  // 정확한 spec 확인 후 활성화 예정. 그 전까지 호출 자체 skip하여 미연동 상태 명시.
  // (이전 구현은 매 요청마다 1초+ 무의미한 호출이 발생했음.)
  return { count: 0, amount: 0, available: false };
}
