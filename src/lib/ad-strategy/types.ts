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
