// src/__tests__/lib/detail-page/ai-html-builder-overlay.test.ts
import { describe, it, expect } from 'vitest';
import { buildAiDetailPageHtml } from '@/lib/detail-page/ai-html-builder';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';

const mockContent: DetailPageContent = {
  headline: '프리미엄 텀블러',
  subheadline: '보온 24시간 보장',
  sellingPoints: ['스테인리스 소재로 위생적', '슬림한 디자인으로 휴대 편리'] as unknown as DetailPageContent['sellingPoints'],
  features: ['이중 진공 구조', '300ml 용량', 'BPA 프리'] as unknown as DetailPageContent['features'],
  specs: [{ label: '용량', value: '300ml' }],
  usageSteps: ['뚜껑을 열고 음료를 붓는다', '뚜껑을 닫는다'],
  warnings: ['전자레인지 사용 금지'],
  ctaText: '구매하기',
};

const heroSlot: AiImageSlot = {
  role: 'hero',
  url: 'https://storage.example.com/hero.jpg',
  prompt: 'dramatic studio background',
  isReplaced: false,
};

const featureSlot: AiImageSlot = {
  role: 'feature',
  url: 'https://storage.example.com/feature.jpg',
  prompt: 'abstract background',
  isReplaced: false,
};

describe('buildAiDetailPageHtml — CSS 텍스트 오버레이', () => {
  it('hero 섹션에 이미지가 있을 때 headline이 오버레이로 포함된다', () => {
    const html = buildAiDetailPageHtml(mockContent, [heroSlot]);
    expect(html).toContain('프리미엄 텀블러');
    expect(html).toContain(heroSlot.url);
    expect(html).toContain('position:absolute');
  });

  it('feature 섹션에 이미지가 있을 때 features 목록이 오버레이로 포함된다', () => {
    const html = buildAiDetailPageHtml(mockContent, [featureSlot]);
    expect(html).toContain('이중 진공 구조');
    expect(html).toContain(featureSlot.url);
    expect(html).toContain('position:absolute');
  });

  it('슬롯 없이도 텍스트 콘텐츠는 fallback으로 표시된다', () => {
    const html = buildAiDetailPageHtml(mockContent, []);
    expect(html).toContain('프리미엄 텀블러');
    expect(html).toContain('스테인리스 소재로 위생적');
  });

  it('lifestyle 섹션에 이미지가 있을 때 왼쪽 패널 오버레이가 sellingPoints[0]을 포함한다', () => {
    const slot: AiImageSlot = {
      role: 'lifestyle',
      url: 'https://storage.example.com/lifestyle.jpg',
      prompt: 'lifestyle background',
      isReplaced: false,
    };
    const html = buildAiDetailPageHtml(mockContent, [slot]);
    expect(html).toContain('스테인리스 소재로 위생적');
    expect(html).toContain(slot.url);
    expect(html).toContain('left:0');
    expect(html).toContain('position:absolute');
  });

  it('detail 섹션에 이미지가 있을 때 오른쪽 패널 오버레이가 sellingPoints[1]을 포함한다', () => {
    const slot: AiImageSlot = {
      role: 'detail',
      url: 'https://storage.example.com/detail.jpg',
      prompt: 'detail background',
      isReplaced: false,
    };
    const html = buildAiDetailPageHtml(mockContent, [slot]);
    expect(html).toContain('슬림한 디자인으로 휴대 편리');
    expect(html).toContain(slot.url);
    expect(html).toContain('right:0');
    expect(html).toContain('position:absolute');
  });
});
