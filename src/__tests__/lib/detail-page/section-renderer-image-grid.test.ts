/**
 * renderImageGrid 오버레이 HTML 단위 테스트
 * section-renderer.ts의 renderSection(section, theme)을 통해 간접 테스트한다.
 */
import { describe, it, expect } from 'vitest';
import { renderSection } from '@/lib/detail-page/section-renderer';
import type { DetailSection, ImageGridContent } from '@/types/detail-page';
import { DEFAULT_THEME } from '@/lib/detail-page/palette-config';

function makeSection(content: ImageGridContent, attachedImages: { url: string; order: number; processingMode: 'original' }[] = []): DetailSection {
  return {
    id: 'test-section-1',
    type: 'image_grid',
    content,
    attachedImages,
  } as DetailSection;
}

describe('renderImageGrid — points 오버레이', () => {
  it('points가 있으면 배경 이미지 + 그라디언트 오버레이 HTML 생성', () => {
    const content: ImageGridContent = {
      type: 'image_grid',
      title: '제품 특징',
      items: [],
      points: ['포인트 1', '포인트 2'],
    };
    const section = makeSection(content, [{ url: 'https://cdn.example.com/bg.jpg', order: 0, processingMode: 'original' }]);

    const html = renderSection(section, DEFAULT_THEME);

    expect(html).toContain('position:absolute');
    expect(html).toContain('linear-gradient');
    expect(html).toContain('포인트 1');
    expect(html).toContain('포인트 2');
    expect(html).toContain('제품 특징');
    expect(html).toContain('cdn.example.com/bg.jpg');
    // 기존 그리드 구조(display:flex;flex-wrap:wrap)는 없어야 함
    expect(html).not.toContain('flex-wrap:wrap');
  });

  it('points가 없으면 기존 그리드 HTML 렌더링', () => {
    const content: ImageGridContent = {
      type: 'image_grid',
      title: '색상 선택',
      items: [{ label: '빨강', swatchColor: '#ff0000' }],
    };
    const section = makeSection(content, [{ url: 'https://cdn.example.com/red.jpg', order: 0, processingMode: 'original' }]);

    const html = renderSection(section, DEFAULT_THEME);

    expect(html).toContain('flex-wrap:wrap');
    expect(html).toContain('빨강');
  });

  it('points가 빈 배열이면 기존 그리드 HTML 렌더링', () => {
    const content: ImageGridContent = {
      type: 'image_grid',
      title: '색상 선택',
      items: [{ label: '빨강' }],
      points: [],
    };
    const section = makeSection(content);

    const html = renderSection(section, DEFAULT_THEME);

    expect(html).toContain('flex-wrap:wrap');
  });

  it('XSS 방어: points 텍스트의 < > & 가 이스케이프됨', () => {
    const content: ImageGridContent = {
      type: 'image_grid',
      title: '<script>alert(1)</script>',
      items: [],
      points: ['<b>포인트</b>', 'A & B'],
    };
    const section = makeSection(content);

    const html = renderSection(section, DEFAULT_THEME);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>포인트</b>');
    expect(html).toContain('&lt;b&gt;포인트&lt;/b&gt;');
    expect(html).toContain('A &amp; B');
  });

  it('배경 이미지 URL 없으면 img 태그 없이 오버레이만 렌더링', () => {
    const content: ImageGridContent = {
      type: 'image_grid',
      title: '제품 특징',
      items: [],
      points: ['포인트 1'],
    };
    const section = makeSection(content, []); // attachedImages 없음

    const html = renderSection(section, DEFAULT_THEME);

    expect(html).toContain('포인트 1');
    expect(html).not.toContain('<img');
  });
});
