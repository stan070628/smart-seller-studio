import { describe, it, expect } from 'vitest';
import { calcSeedScore, getSeedGrade } from '@/lib/sourcing/seed-scoring';

describe('calcSeedScore', () => {
  it('노출가능성 ratio≥100 (검색량/경쟁수 ×1000) → 30점', () => {
    // searchVolume=10000, competitorCount=50 → ratio = 200 → 30점 (cap)
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 10000, topReviewCount: 0, marginRate: 60 });
    expect(r.competitorScore).toBe(30);
  });

  it('노출가능성 ratio≈0 (경쟁수가 검색량의 1000배 이상) → 0점', () => {
    // searchVolume=1000, competitorCount=10000000 → ratio = 0.1 → 0점
    const r = calcSeedScore({ competitorCount: 10_000_000, searchVolume: 1000, topReviewCount: 0, marginRate: 60 });
    expect(r.competitorScore).toBe(0);
  });

  it('노출가능성 ratio=50 → 15점 (선형 중간)', () => {
    // searchVolume=5000, competitorCount=100000 → ratio = 50 → 15점
    const r = calcSeedScore({ competitorCount: 100_000, searchVolume: 5000, topReviewCount: 0, marginRate: 60 });
    expect(r.competitorScore).toBe(15);
  });

  it('실제 사례: 펜트리수납함 (vol=6650, comp=102404, ratio≈64.9) → ~19점', () => {
    const r = calcSeedScore({ competitorCount: 102_404, searchVolume: 6650, topReviewCount: 0, marginRate: 60 });
    expect(r.competitorScore).toBeGreaterThanOrEqual(18);
    expect(r.competitorScore).toBeLessThanOrEqual(20);
  });

  it('compIdx 낮음 보정 → 경쟁점수 +5 (최대 30 cap)', () => {
    // ratio=50 → base=15, 낮음 +5 → 20
    const r = calcSeedScore({ competitorCount: 100_000, searchVolume: 5000, topReviewCount: 0, marginRate: 60, compIdx: '낮음' });
    expect(r.competitorScore).toBe(20);
  });

  it('compIdx 높음 보정 → 경쟁점수 -5 (최소 0 cap)', () => {
    // ratio=50 → base=15, 높음 -5 → 10
    const r = calcSeedScore({ competitorCount: 100_000, searchVolume: 5000, topReviewCount: 0, marginRate: 60, compIdx: '높음' });
    expect(r.competitorScore).toBe(10);
  });

  it('compIdx 낮음이라도 30점 cap', () => {
    // ratio=300 → base=30, 낮음 +5 → cap 30
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 7500, topReviewCount: 0, marginRate: 60, compIdx: '낮음' });
    expect(r.competitorScore).toBe(30);
  });

  it('avgCtr ≥1% → 검색량 점수 그대로', () => {
    // 검색량 15000 = 25점, CTR 2% → 그대로
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 7500, topReviewCount: 0, marginRate: 60, avgCtr: 2.0 });
    expect(r.searchVolumeScore).toBe(25);
  });

  it('avgCtr <1% → 검색량 점수 50% 감점', () => {
    // 검색량 15000 = 25점, CTR 0.5% → 12 (round)
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 7500, topReviewCount: 0, marginRate: 60, avgCtr: 0.5 });
    expect(r.searchVolumeScore).toBe(13); // round(25 * 0.5) = 13
  });

  it('avgCtr null → 보정 없음', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 7500, topReviewCount: 0, marginRate: 60, avgCtr: null });
    expect(r.searchVolumeScore).toBe(25);
  });

  it('검색량 7500 → 25점 (역U형 피크)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 7500, topReviewCount: 0, marginRate: 60 });
    expect(r.searchVolumeScore).toBe(25);
  });

  it('검색량 3000 → 12점 (하한)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 3000, topReviewCount: 0, marginRate: 60 });
    expect(r.searchVolumeScore).toBe(12);
  });

  it('검색량 15000 → 12점 (상한)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 0, marginRate: 60 });
    expect(r.searchVolumeScore).toBe(12);
  });

  it('리뷰 0개 → 25점', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 7500, topReviewCount: 0, marginRate: 60 });
    expect(r.reviewScore).toBe(25);
  });

  it('리뷰 50개 이상 → 0점', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 7500, topReviewCount: 50, marginRate: 60 });
    expect(r.reviewScore).toBe(0);
  });

  it('리뷰 25개 → 12~13점 (중간값)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 7500, topReviewCount: 25, marginRate: 60 });
    expect(r.reviewScore).toBeGreaterThanOrEqual(12);
    expect(r.reviewScore).toBeLessThanOrEqual(13);
  });

  it('마진 30% → 0점 (기준선)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 7500, topReviewCount: 0, marginRate: 30 });
    expect(r.marginScore).toBe(0);
  });

  it('마진 60% → 20점', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 7500, topReviewCount: 0, marginRate: 60 });
    expect(r.marginScore).toBe(20);
  });

  it('마진 45% → 10점 (중간값)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 7500, topReviewCount: 0, marginRate: 45 });
    expect(r.marginScore).toBe(10);
  });

  it('최고 점수 조건 → S등급 (100점)', () => {
    // ratio = 15000/50*1000 = 300_000 → cap 30점
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 7500, topReviewCount: 0, marginRate: 60 });
    expect(r.total).toBe(100);
    expect(r.grade).toBe('S');
  });
});

describe('getSeedGrade', () => {
  it.each([
    [85, 'S'], [84, 'A'], [70, 'A'], [69, 'B'],
    [55, 'B'], [54, 'C'], [40, 'C'], [39, 'D'],
  ] as [number, string][])('점수 %i → %s등급', (score, grade) => {
    expect(getSeedGrade(score)).toBe(grade);
  });
});
