import { describe, it, expect } from 'vitest';
import { renderSection } from '@/lib/detail-page/section-renderer';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';

const MOBILE_THEME: DetailPageTheme = {
  palette: 'warm_cream',
  primaryColor: '#F5F0E8',
  accentColor: '#7A5C10',
  fontStyle: 'sans',
  imageLayout: 'fullbleed',
  layoutMode: 'mobile',
};

function makeSection(partial: Partial<DetailSection> & Pick<DetailSection, 'type' | 'content'>): DetailSection {
  return { id: 'test-id', order: 0, attachedImages: [], ...partial };
}

describe('renderSection — brand_header', () => {
  it('브랜드명과 우측 라벨을 렌더링한다', () => {
    const html = renderSection(
      makeSection({ type: 'brand_header', content: { type: 'brand_header', brandName: '킵틸 KeepTill', rightLabel: 'pencil pouch' } }),
      MOBILE_THEME,
    );
    expect(html).toContain('킵틸 KeepTill');
    expect(html).toContain('pencil pouch');
    expect(html).toContain('data-section-type="brand_header"');
  });

  it('HTML 특수문자를 이스케이프한다', () => {
    const html = renderSection(
      makeSection({ type: 'brand_header', content: { type: 'brand_header', brandName: '<script>x</script>', rightLabel: '' } }),
      MOBILE_THEME,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderSection — point', () => {
  const content = { type: 'point' as const, pointLabel: 'Point 1', headline: "펼치면 바로 '보이는' 필통", subheadline: '180도 완전 오픈형 구조' };

  it('라벨·헤드라인·서브헤드라인을 렌더링한다', () => {
    const html = renderSection(makeSection({ type: 'point', content }), MOBILE_THEME);
    expect(html).toContain('Point 1');
    expect(html).toContain('보이는');
    expect(html).toContain('180도 완전 오픈형 구조');
  });

  it('pointLabel이 빈 문자열이면 라벨 줄을 렌더링하지 않는다', () => {
    const html = renderSection(
      makeSection({ type: 'point', content: { ...content, pointLabel: '' } }),
      MOBILE_THEME,
    );
    expect(html).not.toContain('font-style:italic');
  });

  it('attachedImages를 전체폭(width:100%)으로 렌더링한다', () => {
    const html = renderSection(
      makeSection({
        type: 'point',
        content,
        attachedImages: [{ url: 'https://example.com/a.jpg', order: 0, processingMode: 'original' }],
      }),
      MOBILE_THEME,
    );
    expect(html).toContain('https://example.com/a.jpg');
    expect(html).toContain('width:100%');
  });

  it('http(s)가 아닌 이미지 URL은 렌더링하지 않는다', () => {
    const html = renderSection(
      makeSection({
        type: 'point',
        content,
        attachedImages: [{ url: 'javascript:alert(1)', order: 0, processingMode: 'original' }],
      }),
      MOBILE_THEME,
    );
    expect(html).not.toContain('javascript:');
  });
});

describe('renderSection — image_grid', () => {
  const content = {
    type: 'image_grid' as const,
    title: 'Product Info.',
    items: [
      { label: '레드', swatchColor: '#D9442C' },
      { label: '하늘', swatchColor: '#AEDCF0' },
    ],
  };

  it('타이틀·라벨·스와치를 렌더링한다', () => {
    const html = renderSection(
      makeSection({
        type: 'image_grid',
        content,
        attachedImages: [
          { url: 'https://example.com/red.jpg', order: 0, processingMode: 'original' },
          { url: 'https://example.com/sky.jpg', order: 1, processingMode: 'original' },
        ],
      }),
      MOBILE_THEME,
    );
    expect(html).toContain('Product Info.');
    expect(html).toContain('레드');
    expect(html).toContain('#D9442C');
    expect(html).toContain('https://example.com/red.jpg');
    expect(html).toContain('width:50%');
  });

  it('title이 빈 문자열이면 타이틀을 렌더링하지 않는다', () => {
    const html = renderSection(makeSection({ type: 'image_grid', content: { ...content, title: '' } }), MOBILE_THEME);
    expect(html).not.toContain('<h2');
  });

  it('유효하지 않은 swatchColor는 기본 회색으로 대체한다', () => {
    const html = renderSection(
      makeSection({
        type: 'image_grid',
        content: { type: 'image_grid', title: '', items: [{ label: 'X', swatchColor: 'red;background:url(x)' }] },
      }),
      MOBILE_THEME,
    );
    expect(html).not.toContain('url(x)');
    expect(html).toContain('#cccccc');
  });
});
