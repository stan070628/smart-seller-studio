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

  it('5자리·7자리 hex는 유효하지 않으므로 기본 회색으로 대체한다', () => {
    const html = renderSection(
      makeSection({
        type: 'image_grid',
        content: { type: 'image_grid', title: '', items: [{ label: 'X', swatchColor: '#12345' }] },
      }),
      MOBILE_THEME,
    );
    expect(html).not.toContain('#12345');
    expect(html).toContain('#cccccc');
  });
});

const DESKTOP_THEME: DetailPageTheme = { ...MOBILE_THEME, layoutMode: undefined };

describe('renderSection — mobile layoutMode 분기', () => {
  const heroSection = makeSection({
    type: 'hero',
    content: { type: 'hero', headline: '완전 오픈 · 넉넉한 수납', subheadline: '#한눈에 보여  #쉽게 꺼내  #깔끔하게 정리' },
    eyebrow: 'Keep Till',
  });

  it('mobile hero: 34px 헤드라인 + 필기체 eyebrow를 렌더링한다', () => {
    const html = renderSection(heroSection, MOBILE_THEME);
    expect(html).toContain('font-size:34px');
    expect(html).toContain('Keep Till');
    expect(html).toContain('cursive');
  });

  it('mobile hero: #으로 시작하는 subheadline은 해시태그 행으로 렌더링한다', () => {
    const html = renderSection(heroSection, MOBILE_THEME);
    expect(html).toContain('word-spacing');
    expect(html).toContain('#한눈에 보여');
  });

  it('mobile hero: 일반 subheadline은 문단으로 렌더링한다', () => {
    const html = renderSection(
      makeSection({ type: 'hero', content: { type: 'hero', headline: 'A', subheadline: '일반 설명 문장' } }),
      MOBILE_THEME,
    );
    expect(html).not.toContain('word-spacing');
  });

  it('desktop hero: layoutMode 미지정 시 기존 60px 40px 패딩을 유지한다 (회귀)', () => {
    const html = renderSection(heroSection, DESKTOP_THEME);
    expect(html).toContain('padding:60px 40px');
    expect(html).not.toContain('font-size:34px');
  });

  it('mobile spec_table: 회색 패널(#f4f5f7) 스타일로 렌더링한다', () => {
    const html = renderSection(
      makeSection({ type: 'spec_table', content: { type: 'spec_table', specs: [{ label: '소재', value: '옥스퍼드' }] } }),
      MOBILE_THEME,
    );
    expect(html).toContain('#f4f5f7');
    expect(html).toContain('소재');
  });

  it('desktop spec_table: 기존 테이블 스타일을 유지한다 (회귀)', () => {
    const html = renderSection(
      makeSection({ type: 'spec_table', content: { type: 'spec_table', specs: [{ label: '소재', value: '옥스퍼드' }] } }),
      DESKTOP_THEME,
    );
    expect(html).not.toContain('#f4f5f7');
    expect(html).toContain('padding:60px 40px');
  });

  it('mobile warning/cta: 패딩이 20px 좌우로 축소된다', () => {
    const warningHtml = renderSection(
      makeSection({ type: 'warning', content: { type: 'warning', warnings: ['주의1'] } }),
      MOBILE_THEME,
    );
    const ctaHtml = renderSection(
      makeSection({ type: 'cta', content: { type: 'cta', text: '지금 구매하기' } }),
      MOBILE_THEME,
    );
    expect(warningHtml).toContain('padding:32px 20px');
    expect(ctaHtml).toContain('padding:40px 20px');
  });

  it('desktop warning/cta: layoutMode 미지정 시 기존 패딩·폰트를 유지한다 (회귀)', () => {
    const warningHtml = renderSection(
      makeSection({ type: 'warning', content: { type: 'warning', warnings: ['주의1'] } }),
      DESKTOP_THEME,
    );
    const ctaHtml = renderSection(
      makeSection({ type: 'cta', content: { type: 'cta', text: '지금 구매하기' } }),
      DESKTOP_THEME,
    );
    expect(warningHtml).toContain('padding:32px 40px');
    expect(ctaHtml).toContain('padding:60px 40px');
    expect(ctaHtml).toContain('font-size:36px');
  });
});
