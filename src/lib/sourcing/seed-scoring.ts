export interface SeedScoreInput {
  competitorCount: number;
  searchVolume: number;
  topReviewCount: number;
  marginRate: number;
  compIdx?: '낮음' | '중간' | '높음' | null;
  avgCtr?: number | null; // PC+모바일 평균 CTR (%)
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
  const competitorScore = calcCompetitorScore(input.competitorCount, input.searchVolume, input.compIdx ?? null);
  const searchVolumeScore = calcSearchVolumeScore(input.searchVolume, input.avgCtr ?? null);
  const reviewScore = calcReviewScore(input.topReviewCount);
  const marginScore = calcMarginScore(input.marginRate);
  const total = competitorScore + searchVolumeScore + reviewScore + marginScore;
  return { total, competitorScore, searchVolumeScore, reviewScore, marginScore, grade: getSeedGrade(total) };
}

/**
 * 경쟁 점수 (30점)
 *  - 베이스: 노출가능성 = (검색량 / 경쟁수) × 1000, 0~100 선형 매핑 (0~30점)
 *  - 보정: compIdx '낮음' +5, '중간' 0, '높음' -5
 *  - 최종 0~30 clamp
 */
function calcCompetitorScore(
  competitorCount: number,
  searchVolume: number,
  compIdx: '낮음' | '중간' | '높음' | null,
): number {
  let base: number;
  if (competitorCount <= 0) base = 30;
  else {
    const ratio = (searchVolume / competitorCount) * 1000;
    base = Math.round(30 * Math.min(ratio, 100) / 100);
  }
  const adj = compIdx === '낮음' ? 5 : compIdx === '높음' ? -5 : 0;
  return Math.max(0, Math.min(30, base + adj));
}

/**
 * 검색량 점수 (25점)
 *  - 베이스: 역U형 (3k 12점 - 7.5k 25점 - 15k 12점)
 *    채널 [로켓그로스 소싱 100만원으로 시작 (2025-11-04)] 위너 키워드 분포가 4k~12k 집중 → 7.5k 피크
 *  - 보정: 평균 CTR 1% 미만은 정보검색성 키워드 (구매 의도 약함) → 50% 감점
 *  - CTR 데이터 없으면 (null) 보정 없음
 */
function calcSearchVolumeScore(volume: number, avgCtr: number | null): number {
  const PEAK = 7_500, MIN = 3_000, MAX = 15_000, BASE = 12, PEAK_SCORE = 25;
  let base: number;
  if (volume <= MIN || volume >= MAX) base = BASE;
  else if (volume <= PEAK) base = Math.round(BASE + (PEAK_SCORE - BASE) * (volume - MIN) / (PEAK - MIN));
  else base = Math.round(BASE + (PEAK_SCORE - BASE) * (MAX - volume) / (MAX - PEAK));

  if (avgCtr !== null && avgCtr < 1) return Math.round(base * 0.5);
  return base;
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
