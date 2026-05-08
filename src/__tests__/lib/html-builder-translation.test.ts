// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { buildDetailPageHtml } from '@/lib/detail-page/html-builder';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';

const baseContent: DetailPageContent = {
  headline: 'h',
  subheadline: 's',
  sellingPoints: [
    { icon: '✨', title: 'a', description: 'a' },
    { icon: '💎', title: 'b', description: 'b' },
    { icon: '🌟', title: 'c', description: 'c' },
  ],
  features: [
    { title: 'f1', description: 'fd1' },
    { title: 'f2', description: 'fd2' },
  ],
  specs: [{ label: 'l', value: 'v' }],
  usageSteps: ['step1'],
  warnings: ['w1'],
  ctaText: 'cta',
};

describe('buildDetailPageHtml — translatedUrl 우선', () => {
  it('translatedUrl이 있으면 src에 사용하고 data-original-src에 원본을 저장한다', () => {
    const html = buildDetailPageHtml(baseContent, [
      {
        imageBase64: '',
        mimeType: 'image/jpeg',
        publicUrl: 'https://orig/x.jpg',
        translatedUrl: 'https://cdn/translated.jpg',
      },
    ]);
    expect(html).toContain('src="https://cdn/translated.jpg"');
    expect(html).toContain('data-original-src="https://orig/x.jpg"');
  });

  it('translatedUrl이 없으면 publicUrl을 그대로 사용하고 data-original-src는 없다', () => {
    const html = buildDetailPageHtml(baseContent, [
      {
        imageBase64: '',
        mimeType: 'image/jpeg',
        publicUrl: 'https://orig/y.jpg',
      },
    ]);
    expect(html).toContain('src="https://orig/y.jpg"');
    expect(html).not.toContain('data-original-src');
  });

  it('translatedUrl이 null이면 publicUrl 사용', () => {
    const html = buildDetailPageHtml(baseContent, [
      {
        imageBase64: '',
        mimeType: 'image/jpeg',
        publicUrl: 'https://orig/z.jpg',
        translatedUrl: null,
      },
    ]);
    expect(html).toContain('src="https://orig/z.jpg"');
    expect(html).not.toContain('data-original-src');
  });
});
