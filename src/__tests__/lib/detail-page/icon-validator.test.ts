import { describe, it, expect } from 'vitest';
import { validateProLayout, sanitizeProLayout } from '@/lib/detail-page/layout-validator';

/** 유효한 최소 섹션(6개) 생성 헬퍼 — layout-validator.test.ts의 fixture와 동일 */
function validSections(count = 6): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'claude_layout',
    title: `섹션 ${i}`,
    blocks: [{ type: 'heading', text: `제목 ${i}`, size: 'xl' }],
    bgStyle: 'white',
  }));
}

/** icon_grid 블록 하나를 가진 섹션 */
function iconGridSection(items: Array<{ icon: string; title: string }>): unknown {
  return {
    type: 'claude_layout',
    title: '아이콘',
    blocks: [
      { type: 'heading', text: '아이콘', size: 'xl' },
      { type: 'icon_grid', items },
    ],
  };
}

describe('validateProLayout — 무효 아이콘 키', () => {
  it('무효한 icon 키는 icon_key warning', () => {
    const secs = validSections(5);
    secs.push(iconGridSection([{ icon: '없는키', title: 'x' }]));
    const res = validateProLayout(secs);
    const v = res.violations.find((x) => x.code === 'icon_key');
    expect(v).toBeDefined();
    expect(v?.severity).toBe('warning');
    expect(v?.autoFixable).toBe(true);
  });

  it('유효한 icon 키(pack_sealed)는 icon_key warning이 없다', () => {
    const secs = validSections(5);
    secs.push(iconGridSection([{ icon: 'pack_sealed', title: 'x' }]));
    const res = validateProLayout(secs);
    expect(res.violations.some((x) => x.code === 'icon_key')).toBe(false);
  });

  it('icon이 빈 문자열이면 icon_key를 내지 않는다 (번호 배지 폴백이 정상 경로)', () => {
    const secs = validSections(5);
    secs.push(iconGridSection([{ icon: '', title: 'x' }]));
    const res = validateProLayout(secs);
    expect(res.violations.some((x) => x.code === 'icon_key')).toBe(false);
  });
});

describe('sanitizeProLayout — 무효 아이콘 키 autofix', () => {
  it('무효한 icon 키를 빈 문자열로 치환한다', () => {
    const secs = [iconGridSection([{ icon: '없는키', title: 'x' }, { icon: 'pack_sealed', title: 'y' }])];
    const { sections } = sanitizeProLayout(secs);
    const items = (sections[0] as { blocks: Array<{ type: string; items?: Array<{ icon: string }> }> })
      .blocks.find((b) => b.type === 'icon_grid')!.items!;
    expect(items[0]!.icon).toBe('');
    expect(items[1]!.icon).toBe('pack_sealed');
  });
});
