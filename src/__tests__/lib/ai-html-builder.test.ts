import { describe, it, expect } from 'vitest';
import { buildAiDetailPageHtml, buildAiDetailPageSnippet } from '@/lib/detail-page/ai-html-builder';
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';

const mockContent: DetailPageContent = {
  headline: '프리미엄 린넨 쿠션',
  subheadline: '자연스러운 감촉',
  sellingPoints: [
    { icon: '✨', title: '천연 소재', description: '100% 린넨' },
    { icon: '💎', title: '세탁 가능', description: '커버 분리 세탁' },
  ],
  features: [{ title: '견고한 지퍼', description: '내구성 높은 YKK 지퍼' }],
  specs: [{ label: '소재', value: '린넨 100%' }],
  usageSteps: ['커버를 분리하세요', '세탁기에 넣으세요'],
  warnings: ['직사광선 피하기'],
  ctaText: '구매하기',
};

const mockSlots: AiImageSlot[] = [
  { role: 'hero', url: 'https://cdn.example.com/hero.jpg', prompt: '...', isReplaced: false },
  { role: 'lifestyle', url: 'https://cdn.example.com/life.jpg', prompt: '...', isReplaced: false },
  { role: 'detail', url: 'https://cdn.example.com/detail.jpg', prompt: '...', isReplaced: false },
  { role: 'feature', url: 'https://cdn.example.com/feat.jpg', prompt: '...', isReplaced: false },
];

describe('buildAiDetailPageSnippet', () => {
  it('hero 이미지가 포함된다', () => {
    const html = buildAiDetailPageSnippet(mockContent, mockSlots);
    expect(html).toContain('https://cdn.example.com/hero.jpg');
  });

  it('lifestyle 이미지가 포함된다', () => {
    const html = buildAiDetailPageSnippet(mockContent, mockSlots);
    expect(html).toContain('https://cdn.example.com/life.jpg');
  });

  it('헤드라인이 포함된다', () => {
    const html = buildAiDetailPageSnippet(mockContent, mockSlots);
    expect(html).toContain('프리미엄 린넨 쿠션');
  });

  it('셀링포인트가 포함된다', () => {
    const html = buildAiDetailPageSnippet(mockContent, mockSlots);
    expect(html).toContain('천연 소재');
  });

  it('기본 maxWidth는 780px이다', () => {
    const html = buildAiDetailPageSnippet(mockContent, mockSlots);
    expect(html).toContain('max-width:780px');
  });

  it('maxWidth를 860으로 지정하면 860px이다', () => {
    const html = buildAiDetailPageSnippet(mockContent, mockSlots, undefined, 860);
    expect(html).toContain('max-width:860px');
  });

  it('슬롯이 비어있어도 에러가 나지 않는다', () => {
    expect(() => buildAiDetailPageSnippet(mockContent, [])).not.toThrow();
  });
});

describe('buildAiDetailPageHtml', () => {
  it('완전한 HTML 문서 구조를 반환한다', () => {
    const html = buildAiDetailPageHtml(mockContent, mockSlots);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain('</html>');
  });
});
