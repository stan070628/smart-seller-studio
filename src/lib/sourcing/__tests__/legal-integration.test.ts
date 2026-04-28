import { describe, it, expect } from 'vitest';
import { runSyncLegalCheck } from '../legal';

describe('runSyncLegalCheck — 6 layer 통합', () => {
  it('정상 상품 → safe', () => {
    const result = runSyncLegalCheck({
      title: '스테인리스 보냉컵 500ml',
      categoryName: '생활용품 > 주방용품',
    });
    expect(result.status).toBe('safe');
    expect(result.issues).toHaveLength(0);
  });

  it('시즌 한정 → blocked (season RED)', () => {
    const result = runSyncLegalCheck({ title: '크리스마스 양말 세트' });
    expect(result.status).toBe('blocked');
    expect(result.issues.some((i) => i.layer === 'season')).toBe(true);
  });

  it('부피 큰 상품 → blocked (oversize RED)', () => {
    const result = runSyncLegalCheck({ title: '3인용 소파 회색' });
    expect(result.status).toBe('blocked');
    expect(result.issues.some((i) => i.layer === 'oversize')).toBe(true);
  });

  it('차단 카테고리 → blocked (category RED)', () => {
    const result = runSyncLegalCheck({
      title: '비타민C 1000mg',
      categoryName: '건강기능식품 > 비타민',
    });
    expect(result.status).toBe('blocked');
    expect(result.issues.some((i) => i.layer === 'category')).toBe(true);
  });

  it('KC 필수 + 카테고리 차단 동시 → blocked + 다중 이슈', () => {
    const result = runSyncLegalCheck({
      title: '아기용 젖병 세트',
      categoryName: '유아용품 > 수유용품',
    });
    expect(result.status).toBe('blocked');
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('safetyCert 있고 일반 상품 → safe', () => {
    const result = runSyncLegalCheck({
      title: '충전기 USB-C',
      safetyCert: 'KC-XXX-2025',
      categoryName: '디지털 > 케이블',
    });
    expect(result.status).toBe('safe');
  });
});
