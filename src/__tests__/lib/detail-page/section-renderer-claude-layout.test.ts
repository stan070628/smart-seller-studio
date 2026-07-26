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

  it('option_grid 블록 — 화살표 없이 옵션 카드 그리드로 렌더링', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '우리 아이 맞춤 사이즈',
      blocks: [
        {
          type: 'option_grid',
          items: [
            { label: 'S', sublabel: '40 x 35cm' },
            { label: 'M', sublabel: '55 x 45cm', highlight: true },
            { label: 'L', sublabel: '65 x 50cm' },
          ],
        },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    // 라벨·서브라벨이 모두 렌더링된다
    expect(html).toContain('55 x 45cm');
    expect(html).toContain('65 x 50cm');
    // 3개 항목은 3열 그리드로 배치된다
    expect(html).toContain('grid-template-columns:repeat(3,1fr)');
    // process_flow와 달리 흐름 화살표가 없어야 한다
    expect(html).not.toContain('↓');
    expect(html).not.toContain('→');
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

  it('option_grid — 카드마다 attachedImages를 이미지로 렌더한다', () => {
    const section = makeSection(
      {
        type: 'claude_layout',
        title: '두 가지 컬러',
        blocks: [{ type: 'option_grid', items: [{ label: '베이지' }, { label: '로즈' }] }],
      },
      ['https://cdn.example.com/beige.jpg', 'https://cdn.example.com/rose.jpg'],
    );
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('beige.jpg');
    expect(html).toContain('rose.jpg');
  });

  it('option_grid — 이미지가 없으면 텍스트 카드만 렌더한다', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '사이즈',
      blocks: [{ type: 'option_grid', items: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).not.toContain('<img');
  });

  it('option_grid — 이미지가 카드 수보다 적으면 카드 이미지를 하나도 렌더하지 않는다', () => {
    // 사이즈 안내 씬 회귀: 이미지 1장 + 카드 4개일 때 0번 카드에만 이미지가 박혀
    // 그리드가 비대칭이 되던 버그. 전부 아니면 전무여야 한다.
    const section = makeSection(
      {
        type: 'claude_layout',
        title: 'M · L · XL · XXL',
        blocks: [
          {
            type: 'option_grid',
            items: [{ label: 'M' }, { label: 'L' }, { label: 'XL' }, { label: 'XXL' }],
          },
        ],
      },
      ['https://cdn.example.com/only-one.jpg'],
    );
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).not.toContain('only-one.jpg');
    expect(html).not.toContain('<img');
  });

  it('option_grid — 카드 텍스트는 어절 단위로 줄바꿈된다(word-break:keep-all)', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '사이즈',
      blocks: [
        {
          type: 'option_grid',
          items: [{ label: 'XXL', sublabel: '평소 35~36인치 또는 넉넉한 착용을 원할 때' }],
        },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    // label(14px)·sublabel(12px) 양쪽 모두에 적용되어야 한다
    expect(html).toContain('line-height:1.3;word-break:keep-all;');
    expect(html).toContain('margin-top:4px;line-height:1.4;word-break:keep-all;');
  });

  it('option_grid — 행이 나뉘어도 카드 높이가 통일된다(grid-auto-rows:1fr)', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '사이즈',
      blocks: [
        {
          type: 'option_grid',
          cols: 2,
          items: [{ label: 'M' }, { label: 'L' }, { label: 'XL' }, { label: 'XXL' }],
        },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('grid-auto-rows:1fr');
  });

  it('heading·subtext의 개행이 줄바꿈으로 렌더된다', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '개행',
      blocks: [
        { type: 'heading', text: '시원하지만 차갑지 않은\n반려동물 쿨매트', size: 'xl' },
        { type: 'subtext', text: '첫 줄\n둘째 줄', align: 'left' },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    // 개행 문자는 그대로 두고 CSS로 렌더한다(에디터가 원본 텍스트를 편집하므로 <br> 치환 불가)
    expect(html.match(/white-space:pre-line/g)).toHaveLength(2);
    expect(html).toContain('시원하지만 차갑지 않은\n반려동물 쿨매트');
  });

  it('개행이 있는 heading은 가장 긴 줄 기준으로 xl을 유지한다', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '개행 헤딩',
      // 전체 23자지만 각 줄은 12자·8자 — 2줄 임팩트 헤드라인 의도다
      blocks: [{ type: 'heading', text: '시원하지만 차갑지 않은\n반려동물 쿨매트', size: 'xl' }],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('font-size:38px');
  });

  it('한 줄이 16자를 넘는 heading은 여전히 lg로 강등된다', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '문장형 헤딩',
      blocks: [{ type: 'heading', text: '한 줄에 너무 긴 문장형 헤드라인이 들어간 경우입니다', size: 'xl' }],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('font-size:26px');
  });

  it('option_grid 카드 텍스트의 개행도 줄바꿈으로 렌더된다', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '사이즈',
      blocks: [
        {
          type: 'option_grid',
          items: [{ label: 'M', sublabel: '허리 34cm · 총장 47cm\n평소 28~30인치' }],
        },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('허리 34cm · 총장 47cm\n평소 28~30인치');
    expect(html.match(/white-space:pre-line/g)).toHaveLength(2); // label + sublabel
  });

  it('heading xl은 38px 크기로 렌더링된다', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '크기 검증',
      blocks: [{ type: 'heading', text: '대형 헤딩', size: 'xl' }],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('font-size:38px');
  });

  it('heading lg는 26px, md는 19px으로 렌더링된다', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '크기 검증',
      blocks: [
        { type: 'heading', text: 'LG 헤딩', size: 'lg' },
        { type: 'heading', text: 'MD 헤딩', size: 'md' },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('font-size:26px');
    expect(html).toContain('font-size:19px');
  });

  it('stat_row value는 44px 크기로 렌더링된다', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '통계 크기 검증',
      blocks: [
        { type: 'stat_row', items: [{ label: '검색 결과', value: '약 247,000', unit: '건' }] },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('font-size:44px');
    expect(html).toContain('약 247,000');
  });

  it('dark bgStyle에서 텍스트 색상이 #ffffff로 강제된다', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '다크 배경',
      blocks: [
        { type: 'heading', text: '밝은 텍스트', size: 'xl', color: 'text' },
        { type: 'subtext', text: '부제목', align: 'left' },
      ],
      bgStyle: 'dark',
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('#ffffff');
    expect(html).toContain('background-color:#1e293b');
  });

  it('primary bgStyle에서도 텍스트 색상이 #ffffff로 강제된다', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '브랜드 배경',
      blocks: [{ type: 'heading', text: '밝은 텍스트', size: 'xl', color: 'text' }],
      bgStyle: 'primary',
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('#ffffff');
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

  it('claude_layout 텍스트에 data-edit-path가 배선된다', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '편집 배선',
      blocks: [
        { type: 'badge', text: 'Point 1' },
        { type: 'heading', text: '핵심 제목', size: 'xl' },
        { type: 'option_grid', items: [{ label: 'S', sublabel: '40cm' }, { label: 'M', sublabel: '55cm', highlight: true }] },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('data-edit-path="content.blocks.0.text"');
    expect(html).toContain('data-edit-path="content.blocks.1.text"');
    expect(html).toContain('data-edit-path="content.blocks.2.items.0.label"');
    expect(html).toContain('data-edit-path="content.blocks.2.items.1.sublabel"');
  });

  it('stat_row 항목의 value/unit/label에 data-edit-path가 배선된다', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '',
      blocks: [
        { type: 'stat_row', items: [{ value: '99', unit: '%', label: '효능' }] },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('data-edit-path="content.blocks.0.items.0.value"');
    expect(html).toContain('data-edit-path="content.blocks.0.items.0.unit"');
    expect(html).toContain('data-edit-path="content.blocks.0.items.0.label"');
  });

  it('columns 재귀가 cols.${c}.${r} 경로를 내부 블록에 전달한다', () => {
    const section = makeSection({
      type: 'claude_layout',
      title: '',
      blocks: [
        {
          type: 'columns',
          cols: [
            [{ type: 'badge', text: '왼' }],
            [{ type: 'subtext', text: '오' }],
          ],
        },
      ],
    });
    const html = renderSection(section, DEFAULT_THEME);
    expect(html).toContain('data-edit-path="content.blocks.0.cols.0.0.text"');
    expect(html).toContain('data-edit-path="content.blocks.0.cols.1.0.text"');
  });
});
