/**
 * 위너 관리 공통 타입
 * spec 2026-04-28-strategy-v2-extension §2.B
 */

export type WinnerChannel = 'coupang' | 'naver';

export interface WinnerSnapshot {
  skuCode: string;
  productName: string;
  channel: WinnerChannel;
  occupancyPct: number;
  isWinner: boolean;
  searchRank: number | null;
  snapshotAt: Date;
}

export interface WinnerLostEvent {
  skuCode: string;
  productName: string;
  channel: WinnerChannel;
  previousOccupancyPct: number;
  currentOccupancyPct: number;
  detectedAt: Date;
  recommendedActions: string[];
}

export interface KeywordSuggestion {
  skuCode: string;
  currentTitle: string;
  suggestedTitle: string;
  reasoning: string;
  currentRank: number | null;
}
