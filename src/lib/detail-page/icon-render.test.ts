import { describe, expect, it } from 'vitest';
import { renderSection } from './section-renderer';
import type { DetailSection } from '@/types/detail-page';

function iconGridSection(icon: string): DetailSection {
  return {
    id: 's1', type: 'claude_layout', order: 0, attachedImages: [],
    content: {
      type: 'claude_layout', title: '', blocks: [
        { type: 'icon_grid', cols: 2, items: [{ icon, title: '낱개 밀봉' }, { icon, title: '대용량' }] },
      ],
    },
  } as unknown as DetailSection;
}
const theme = { palette: 'cream_cozy' } as never;

describe('icon_grid 선형 아이콘', () => {
  it('유효한 키면 선형 SVG를 그린다', () => {
    const html = renderSection(iconGridSection('pack_sealed'), theme);
    expect(html).toContain('fill="none"');
    expect(html).toContain('stroke-width="2"');
  });
  it('빈 키면 기존 번호 배지로 폴백한다', () => {
    const html = renderSection(iconGridSection(''), theme);
    expect(html).toContain('>1</div>');
    expect(html).toContain('>2</div>');
  });
});

describe('divider는 선을 긋지 않는다', () => {
  it('hr 대신 여백을 그린다', () => {
    const section = {
      id: 's2', type: 'claude_layout', order: 0, attachedImages: [],
      content: { type: 'claude_layout', title: '', blocks: [{ type: 'divider' }] },
    } as unknown as DetailSection;
    const html = renderSection(section, theme);
    expect(html).not.toContain('<hr');
    expect(html).toContain('height:28px');
  });
});
