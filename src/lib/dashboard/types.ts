/**
 * 대시보드 API/컴포넌트가 공유하는 타입 정의.
 * 스펙: docs/superpowers/specs/2026-04-26-dashboard-redesign-design.md
 */

export type Period = 'today' | '7d' | '30d' | 'month';

export interface StageMetric {
  count: number;
  amount: number;
}

export type SettlementStageMetric = StageMetric & {
  /** 정산 API 호출 성공 여부. false면 UI에서 "API 미연동" 표시 */
  available: boolean;
};

export interface ChannelPipeline {
  주문: StageMetric;
  배송중: StageMetric;
  배송완료: StageMetric;
  구매확정: StageMetric;
  정산완료: SettlementStageMetric;
  /** ISO timestamp — 마지막으로 데이터를 갱신한 시각 */
  lastUpdated: string;
}

export interface DashboardSummaryData {
  products: {
    coupang: number;
    naver: number;
  };
  pipeline: {
    coupang: ChannelPipeline;
    naver: ChannelPipeline;
  };
  revenue12w: {
    weeks: number[];                  // [1..12]
    target: number[];                 // 누적 목표 (만원)
    actual: (number | null)[];        // 서버는 null[] 반환, 클라이언트가 채움
  };
}

export interface DashboardSummaryResponse {
  success: true;
  data: DashboardSummaryData;
}

export interface DashboardErrorResponse {
  success: false;
  error: string;
}

// Phase 1: 카드별 점진 로딩용 분리 타입.
export interface OrdersSummaryData {
  pipeline: {
    coupang: ChannelPipeline;
    naver: ChannelPipeline;
  };
  revenue12w: {
    weeks: number[];
    target: number[];
    actual: (number | null)[];
  };
}

export interface ProductCountData {
  coupang: number;
  naver: number;
  /** Phase 2 DB 캐시에서 채워짐. 직접 API 조회면 'live'. */
  source: 'live' | 'cache';
  refreshedAt: string;
}

export const PERIOD_LABELS: Record<Period, string> = {
  today: '오늘',
  '7d': '7일',
  '30d': '30일',
  month: '이번달',
};

export function isPeriod(value: unknown): value is Period {
  return value === 'today' || value === '7d' || value === '30d' || value === 'month';
}
