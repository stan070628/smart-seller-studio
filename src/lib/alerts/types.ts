export type AlertType =
  | 'roas_low' | 'stock_low' | 'negative_review'
  | 'winner_lost' | 'sourcing_recommendation' | 'review_milestone'
  | 'inbound_return_warning' | 'channel_distribution';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AlertInput {
  type: AlertType;
  severity: AlertSeverity;
  skuCode?: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface Alert extends AlertInput {
  id: number;
  createdAt: Date;
  readAt: Date | null;
  emailedAt: Date | null;
}

export const THRESHOLDS = {
  roasLowPct: 200,
  stockLowDays: 30,
  reviewLowStars: 4.0,
} as const;
