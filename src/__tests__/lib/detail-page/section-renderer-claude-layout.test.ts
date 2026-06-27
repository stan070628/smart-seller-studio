import { describe, it, expect } from 'vitest';
import { renderSection } from '@/lib/detail-page/section-renderer';
import type { DetailSection, DetailPageTheme, ClaudeLayoutContent } from '@/types/detail-page';

const DEFAULT_THEME: DetailPageTheme = {
  palette: 'warm_cream',
  primaryColor: '#e07b54',
  accentColor: '#c45e3a',
  fontStyle: 'sans',
  imageLayout: 'fullbleed',
};

function makeSection(content: ClaudeLayoutContent, imageUrls: string[] = []): DetailSection {
  return {
    id: 'test-1',
    type: 'claude_layout',
    content,
    attachedImages: imageUrls.map((url, i) => ({ url, order: i, processingMode: 'original' as const })),
  };
}

describe('renderSection — claude_layout', () => {
  it('badge + heading 블록 렌더링', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '테스트 섹션',
      blocks: [
        { type: 'badge', text: 'Point 1' },
        { type: 'heading', text: '국내 최초 NMN', size: 'xl', bold: true },
      ],
      bgStyle: 'white',
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('Point 1');
    expect(html).toContain('국내 최초 NMN');
    expect(html).toContain('data-section-type="claude_layout"');
  });

  it('image 블록 — attachedImages URL 삽입', () => {
    const section = makeSection(
      {
        type: 'claude_layout',
        title: '이미지 섹션',
        blocks: [{ type: 'image', attachedIndex: 0, width: '80%', align: 'center' }],
      },
      ['https://example.com/product.jpg'],
    );
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('https://example.com/product.jpg');
  });

  it('stat_row 블록 렌더링', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '통계',
      blocks: [
        { type: 'stat_row', items: [{ label: 'NMN 함유량', value: '250', unit: 'mg' }] },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('250');
    expect(html).toContain('mg');
    expect(html).toContain('NMN 함유량');
  });

  it('XSS 방어 — 텍스트 값 escapeHtml 적용', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '안전 테스트',
      blocks: [{ type: 'heading', text: '<script>alert(1)</script>', size: 'xl' }],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('image 블록 — attachedIndex 범위 초과 시 빈 렌더링', () => {
    const section = makeSection(
      {
        type: 'claude_layout',
        title: '이미지 없음',
        blocks: [{ type: 'image', attachedIndex: 5 }],
      },
      [],
    );
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).not.toContain('<img');
  });

  it('columns 블록 — 2열 렌더링', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '2열 레이아웃',
      blocks: [
        {
          type: 'columns',
          cols: [
            [{ type: 'heading', text: '왼쪽', size: 'md' }],
            [{ type: 'heading', text: '오른쪽', size: 'md' }],
          ],
        },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('왼쪽');
    expect(html).toContain('오른쪽');
  });
});
