import type { RgSizeType } from '@/lib/roi/rg-fees';

export type UrgentActionType =
  | 'IMAGE_FIX'
  | 'BUDGET_INCREASE'
  | 'CAMPAIGN_EXTEND'
  | 'RESTOCK'
  | 'CAMPAIGN_CREATE';

export interface UrgentAction {
  type: UrgentActionType;
  product: string;
  reason: string;
  action: string;
  deepLink?: string;
}

export type AdGrade = 'A' | 'B' | 'C' | 'HOLD';

export interface ProductAdGrade {
  name: string;
  grade: AdGrade;
  isItemWinner: boolean;
  monthlySales: number;
  stock: number;
  currentPrice: number;
  reason: string;
  suggestedDailyBudget?: number;
  // ── 순이익 관련 (스크래핑 + 사용자 입력으로 채워짐) ──
  adSpend?: number;          // 월 광고비 (원)
  adRoas?: number;           // 광고 ROAS (%)
}

export interface SourcingAlert {
  product: string;
  issue: 'LOW_STOCK' | 'NO_WINNER' | 'CAMPAIGN_ENDING' | 'ZERO_SALES_30D';
  detail: string;
  action: string;
}

export interface CampaignSummary {
  totalBudget: number;
  totalRoas: number;
  activeCampaigns: number;
  blockedProducts: number;
}

export interface AdStrategyReport {
  collectedAt: string;
  urgentActions: UrgentAction[];
  productAdRanking: ProductAdGrade[];
  sourcingAlerts: SourcingAlert[];
  campaignSummary: CampaignSummary;
  summary: string;
}

export interface RawProduct {
  name: string;
  sellerProductId: string;
  isItemWinner: boolean;
  stock: number;
  salePrice: number;
  monthlySales: number;
  imageViolation: boolean;
  // ── 광고 성과 (광고센터 상품별 보고서에서 추가) ──
  adSpend?: number;    // 30일 광고비 합계 (원)
  adRoas?: number;     // 30일 ROAS (%)
  adOrders?: number;   // 30일 광고 전환 주문수
}

export interface RawCampaign {
  campaignId: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'ENDED';
  dailyBudget: number;
  roas: number;
  ctr: number;
  endDate?: string;
}

export interface CollectedData {
  products: RawProduct[];
  campaigns: RawCampaign[];
  collectedAt: string;
}

// ── 원가 스토어 (localStorage) ──
export interface CostEntry {
  productName: string;
  costPrice: number;   // 원가 (VAT 포함, 원)
  feeRate: number;     // 쿠팡 수수료율 (0~1, 기본 0.108)
  /**
   * 로켓그로스 사이즈 유형. 지정하면 사이즈별 물류비(입출고비+배송비)가
   * 마진 계산에서 자동으로 차감된다. 미지정이면 0으로 계산되어 마진이 과대평가된다.
   * → src/lib/roi/rg-fees.ts
   */
  rgSizeType?: RgSizeType | null;
}
