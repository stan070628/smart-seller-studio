import { describe, it, expect } from 'vitest';
import { renderSection } from '@/lib/detail-page/section-renderer';
import type { DetailSection, DetailPageTheme, ClaudeLayoutContent } from '@/types/detail-page';

const THEME: DetailPageTheme = {
  palette: 'warm_cream',
  primaryColor: '#e07b54',
  accentColor: '#c45e3a',
  fontStyle: 'sans',
  imageLayout: 'fullbleed',
};

function makeSection(blocks: ClaudeLayoutContent['blocks']): DetailSection {
  return {
    id: 'test',
    type: 'claude_layout',
    content: { type: 'claude_layout', title: '테스트', blocks },
    attachedImages: [],
  };
}

describe('renderLayoutBlock — 신규 4개 블록', () => {
  it('progress_bar — 두 항목 렌더링, 퍼센트 너비 반영', () => {
    const html = renderSection(makeSection([{
      type: 'progress_bar',
      items: [
        { label: '나이아신', value: 100, displayValue: '100%', highlight: true },
        { label: '기준치', value: 80 },
      ],
    }]), THEME);
    expect(html).toContain('나이아신');
    expect(html).toContain('width:100%');
    expect(html).toContain('기준치');
    expect(html).toContain('width:80%');
  });

  it('process_flow — 화살표와 함께 항목 렌더링', () => {
    const html = renderSection(makeSection([{
      type: 'process_flow',
      items: [
        { label: '원재료' },
        { label: '발효', highlight: true },
        { label: '농축' },
      ],
    }]), THEME);
    expect(html).toContain('원재료');
    expect(html).toContain('발효');
    expect(html).toContain('농축');
    expect(html).toContain('→');
  });

  it('icon_grid — 3열 기본값, 아이콘과 제목 렌더링', () => {
    const html = renderSection(makeSection([{
      type: 'icon_grid',
      items: [
        { icon: '🧬', title: 'NMN 함유' },
        { icon: '✅', title: 'HACCP 인증' },
        { icon: '🔬', title: '핵심 포뮬러' },
      ],
    }]), THEME);
    expect(html).toContain('🧬');
    expect(html).toContain('NMN 함유');
    expect(html).toContain('HACCP 인증');
  });

  it('layout_bar_chart — SVG img 태그 + 데이터 포함', () => {
    const html = renderSection(makeSection([{
      type: 'layout_bar_chart',
      title: 'NAD+ 수치 변화',
      groups: ['Placebo', 'NMN'],
      groupColors: ['#d1d5db', '#c45e3a'],
      items: [
        { label: '4주', values: [5, 15] },
        { label: '8주', values: [6, 40] },
      ],
      unit: 'nmol/L',
    }]), THEME);
    expect(html).toContain('<img');
    expect(html).toContain('data:image/svg+xml;base64,');
    expect(html).toContain('NAD+ 수치 변화');
  });

  it('XSS 방어 — process_flow 레이블 escape', () => {
    const html = renderSection(makeSection([{
      type: 'process_flow',
      items: [{ label: '<script>alert(1)</script>' }],
    }]), THEME);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
