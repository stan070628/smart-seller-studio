// src/lib/roi/types.ts

export interface SkuRoiData {
  productId: string;
  productName: string;
  sellingPrice: number;
  costPrice: number;
  feeRate: number;
  deliveryFee: number;
  marginAmount: number;
  marginRate: number;
  adSpend: number;
  attributedSales: number;
  cancelledSales: number;
  couponDiscount: number;
  clicks: number;
  conversionRate: number;
  salesCount: number;
  stockQty: number;
  avgDailySales: number;
  breakEvenRoas: number;
  adjustedRoas: number;
  winnerStatus: 'winner' | 'watch' | 'normal';
  stockTurnover: { days: number; status: 'danger' | 'warning' | 'ok' };
  netProfit: number;
}

export interface RoiGoalState {
  targetProfit: number;
  marginRate: number;
}
