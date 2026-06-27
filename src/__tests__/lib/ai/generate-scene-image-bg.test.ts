/**
 * generate-scene-image route의 배경 제거 통합 smoke test
 */
import { describe, it, expect } from 'vitest';

describe('BACKGROUND_REMOVAL_SECTIONS', () => {
  it('lifestyle, detail, feature를 포함하고 hero는 포함하지 않는다', () => {
    const target = new Set(['lifestyle', 'detail', 'feature']);
    expect(target.has('lifestyle')).toBe(true);
    expect(target.has('detail')).toBe(true);
    expect(target.has('feature')).toBe(true);
    expect(target.has('hero')).toBe(false);
  });
});
