export interface SeedScoreInput {
  competitorCount: number;
  searchVolume: number;
  topReviewCount: number;
  marginRate: number;
}

export interface SeedScoreResult {
  total: number;
  competitorScore: number;
  searchVolumeScore: number;
  reviewScore: number;
  marginScore: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
}

export function calcSeedScore(input: SeedScoreInput): SeedScoreResult {
  const competitorScore = calcCompetitorScore(input.competitorCount, input.searchVolume);
  const searchVolumeScore = calcSearchVolumeScore(input.searchVolume);
  const reviewScore = calcReviewScore(input.topReviewCount);
  const marginScore = calcMarginScore(input.marginRate);
  const total = competitorScore + searchVolumeScore + reviewScore + marginScore;
  return { total, competitorScore, searchVolumeScore, reviewScore, marginScore, grade: getSeedGrade(total) };
}

/**
 * 경쟁 점수: "노출 가능성" = (검색량 / 경쟁수) × 1000 기반
 *  - 네이버 쇼핑은 전체 통합 카탈로그라 절대값 <500 필터가 비현실적 (대부분 수만~수백만)
 *  - 대신 검색량 대비 경쟁수가 적을수록(=ratio 높을수록) 노출 가능성 높다고 판단
 *  - ratio ≥ 100  → 30점 (최고)
 *  - ratio = 0    → 0점
 *  - 0~100 선형
 */
function calcCompetitorScore(competitorCount: number, searchVolume: number): number {
  if (competitorCount <= 0) return 30;
  const ratio = (searchVolume / competitorCount) * 1000;
  return Math.round(30 * Math.min(ratio, 100) / 100);
}

function calcSearchVolumeScore(volume: number): number {
  const PEAK = 15_000, MIN = 3_000, MAX = 30_000, BASE = 12, PEAK_SCORE = 25;
  if (volume <= MIN || volume >= MAX) return BASE;
  if (volume <= PEAK) return Math.round(BASE + (PEAK_SCORE - BASE) * (volume - MIN) / (PEAK - MIN));
  return Math.round(BASE + (PEAK_SCORE - BASE) * (MAX - volume) / (MAX - PEAK));
}

function calcReviewScore(count: number): number {
  if (count <= 0) return 25;
  if (count >= 50) return 0;
  return Math.round(25 * (50 - count) / 50);
}

function calcMarginScore(rate: number): number {
  if (rate <= 30) return 0;
  if (rate >= 60) return 20;
  return Math.round(20 * (rate - 30) / 30);
}

export function getSeedGrade(total: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  if (total >= 85) return 'S';
  if (total >= 70) return 'A';
  if (total >= 55) return 'B';
  if (total >= 40) return 'C';
  return 'D';
}
