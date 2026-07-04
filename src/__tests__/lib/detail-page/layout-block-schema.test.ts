import { describe, it, expect } from 'vitest';
import { LayoutBlockSchema, sanitizeProLayout } from '@/lib/detail-page/layout-block-schema';

describe('LayoutBlockSchema', () => {
  it('유효한 option_grid 블록을 통과시킨다', () => {
    const block = { type: 'option_grid', items: [{ label: 'S', sublabel: '40cm' }] };
    expect(LayoutBlockSchema.safeParse(block).success).toBe(true);
  });
  it('items가 누락된 stat_row를 거부한다', () => {
    const block = { type: 'stat_row' };
    expect(LayoutBlockSchema.safeParse(block).success).toBe(false);
  });
});

describe('sanitizeProLayout', () => {
  it('불량 블록만 드롭하고 정상 블록은 유지한다', () => {
    const input = [
      { type: 'claude_layout', title: 'A', blocks: [
        { type: 'heading', text: '제목', size: 'xl' },
        { type: 'stat_row' },
      ] },
    ];
    const out = sanitizeProLayout(input);
    expect(out).toHaveLength(1);
    expect(out[0].blocks).toHaveLength(1);
    expect(out[0].blocks[0]).toMatchObject({ type: 'heading', text: '제목' });
  });
  it('모든 블록이 불량이면 그 섹션을 제거한다', () => {
    const input = [
      { type: 'claude_layout', title: 'X', blocks: [{ type: 'stat_row' }] },
      { type: 'claude_layout', title: 'Y', blocks: [{ type: 'divider' }] },
    ];
    const out = sanitizeProLayout(input);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Y');
  });
  it('배열이 아닌 입력에 throw하지 않고 빈 배열을 반환한다', () => {
    expect(sanitizeProLayout(null as unknown as unknown[])).toEqual([]);
    expect(sanitizeProLayout({} as unknown as unknown[])).toEqual([]);
  });
  it('imageSlots 등 추가 필드를 보존한다', () => {
    const input = [
      { type: 'claude_layout', title: 'A', blocks: [{ type: 'divider' }],
        imageSlots: [{ slotType: 'product_nukki', promptHint: 'x' }] },
    ];
    const out = sanitizeProLayout(input) as Array<Record<string, unknown>>;
    expect(out[0].imageSlots).toEqual([{ slotType: 'product_nukki', promptHint: 'x' }]);
  });
});
