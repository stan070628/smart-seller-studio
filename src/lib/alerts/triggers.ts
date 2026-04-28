import type { AlertInput } from './types';
import { THRESHOLDS } from './types';

export function detectRoasLow(input: {
  skuCode: string; productName: string; roasPct: number;
}): AlertInput | null {
  if (input.roasPct >= THRESHOLDS.roasLowPct) return null;
  const severity = input.roasPct < 100 ? 'critical' : 'high';
  return {
    type: 'roas_low',
    severity,
    skuCode: input.skuCode,
    message: `광고 ROAS ${input.roasPct.toFixed(0)}%: ${input.productName}`,
    detail: { roasPct: input.roasPct },
  };
}

export function detectStockLow(input: {
  skuCode: string; productName: string;
  stockDays: number; currentStock: number; dailySales: number;
}): AlertInput | null {
  if (input.stockDays >= THRESHOLDS.stockLowDays) return null;
  const severity =
    input.stockDays < 7 ? 'critical' : input.stockDays < 14 ? 'high' : 'medium';
  return {
    type: 'stock_low',
    severity,
    skuCode: input.skuCode,
    message: `재고 ${input.stockDays}일분: ${input.productName}`,
    detail: {
      stockDays: input.stockDays,
      currentStock: input.currentStock,
      dailySales: input.dailySales,
    },
  };
}

export function detectNegativeReview(input: {
  skuCode: string; productName: string; stars: number; reviewText: string;
}): AlertInput | null {
  if (input.stars >= THRESHOLDS.reviewLowStars) return null;
  const severity = input.stars <= 3.0 ? 'critical' : 'high';
  return {
    type: 'negative_review',
    severity,
    skuCode: input.skuCode,
    message: `부정 리뷰 ${input.stars}점: ${input.productName}`,
    detail: { stars: input.stars, reviewText: input.reviewText },
  };
}
