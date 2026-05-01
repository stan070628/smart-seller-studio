import { describe, it, expect } from 'vitest';
import { calcSeedScore, getSeedGrade } from '@/lib/sourcing/seed-scoring';

describe('calcSeedScore', () => {
  it('경쟁 100개 미만 → 30점', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 0, marginRate: 60 });
    expect(r.competitorScore).toBe(30);
  });

  it('경쟁 500개 이상 → 0점', () => {
    const r = calcSeedScore({ competitorCount: 500, searchVolume: 15000, topReviewCount: 0, marginRate: 60 });
    expect(r.competitorScore).toBe(0);
  });

  it('경쟁 300개 → 선형 중간값', () => {
    const r = calcSeedScore({ competitorCount: 300, searchVolume: 15000, topReviewCount: 0, marginRate: 60 });
    expect(r.competitorScore).toBe(15);
  });

  it('검색량 15000 → 25점 (역U형 피크)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 0, marginRate: 60 });
    expect(r.searchVolumeScore).toBe(25);
  });

  it('검색량 3000 → 12점 (하한)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 3000, topReviewCount: 0, marginRate: 60 });
    expect(r.searchVolumeScore).toBe(12);
  });

  it('검색량 30000 → 12점 (상한)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 30000, topReviewCount: 0, marginRate: 60 });
    expect(r.searchVolumeScore).toBe(12);
  });

  it('리뷰 0개 → 25점', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 0, marginRate: 60 });
    expect(r.reviewScore).toBe(25);
  });

  it('리뷰 50개 이상 → 0점', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 50, marginRate: 60 });
    expect(r.reviewScore).toBe(0);
  });

  it('리뷰 25개 → 12~13점 (중간값)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 25, marginRate: 60 });
    expect(r.reviewScore).toBeGreaterThanOrEqual(12);
    expect(r.reviewScore).toBeLessThanOrEqual(13);
  });

  it('마진 30% → 0점 (기준선)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 0, marginRate: 30 });
    expect(r.marginScore).toBe(0);
  });

  it('마진 60% → 20점', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 0, marginRate: 60 });
    expect(r.marginScore).toBe(20);
  });

  it('마진 45% → 10점 (중간값)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 0, marginRate: 45 });
    expect(r.marginScore).toBe(10);
  });

  it('최고 점수 조건 → S등급 (100점)', () => {
    const r = calcSeedScore({ competitorCount: 50, searchVolume: 15000, topReviewCount: 0, marginRate: 60 });
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
