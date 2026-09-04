import { describe, expect, it } from 'vitest';
import { getIcon, ICON_KEYS } from './icon-library';

describe('icon-library', () => {
  it('35개 이상의 키를 제공한다', () => {
    expect(ICON_KEYS.length).toBeGreaterThanOrEqual(35);
  });
  it('유효한 키는 선형 SVG를 돌려준다', () => {
    const svg = getIcon('pack_sealed', 26, '#7A5C10');
    expect(svg).toContain('<svg');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="#7A5C10"');
  });
  it('무효한 키는 null', () => {
    expect(getIcon('없는키')).toBeNull();
    expect(getIcon('')).toBeNull();
  });
  it('이모지가 섞여 있지 않다', () => {
    for (const k of ICON_KEYS) expect(getIcon(k)!).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
