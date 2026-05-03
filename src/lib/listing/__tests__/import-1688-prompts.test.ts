// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  parseClassifyResponse,
  parseGenerateContent,
} from '@/lib/ai/prompts/import-1688';

describe('parseClassifyResponse', () => {
  it('유효한 JSON 배열을 파싱한다', () => {
    const raw = '[{"index":0,"type":"main_product"},{"index":1,"type":"lifestyle"}]';
    const urls = ['https://a.com/1.jpg', 'https://a.com/2.jpg'];
    const result = parseClassifyResponse(raw, urls);
    expect(result).toEqual([
      { url: 'https://a.com/1.jpg', type: 'main_product' },
      { url: 'https://a.com/2.jpg', type: 'lifestyle' },
    ]);
  });

  it('JSON 배열이 URLs보다 짧으면 나머지는 lifestyle로 fallback', () => {
    const raw = '[{"index":0,"type":"main_product"}]';
    const urls = ['https://a.com/1.jpg', 'https://a.com/2.jpg'];
    const result = parseClassifyResponse(raw, urls);
    expect(result[1].type).toBe('lifestyle');
  });

  it('파싱 실패 시 모두 lifestyle로 fallback', () => {
    const raw = 'invalid json';
    const urls = ['https://a.com/1.jpg'];
    const result = parseClassifyResponse(raw, urls);
    expect(result[0].type).toBe('lifestyle');
  });
});

describe('parseGenerateContent', () => {
  it('유효한 DetailPageContent JSON을 파싱한다', () => {
    const raw = JSON.stringify({
      headline: '테스트 상품',
      subheadline: '부제목',
      sellingPoints: [
        { icon: '✅', title: '포인트1', description: '설명1' },
        { icon: '✅', title: '포인트2', description: '설명2' },
        { icon: '✅', title: '포인트3', description: '설명3' },
      ],
      features: [
        { title: '특징1', description: '설명1' },
        { title: '특징2', description: '설명2' },
        { title: '특징3', description: '설명3' },
      ],
      specs: [
        { label: '소재', value: '면100%' },
        { label: '크기', value: '30cm' },
      ],
      usageSteps: ['단계1', '단계2'],
      warnings: ['주의1', '주의2'],
      ctaText: '지금 구매',
    });
    const result = parseGenerateContent(raw);
    expect(result.headline).toBe('테스트 상품');
    expect(result.sellingPoints).toHaveLength(3);
  });

  it('headline이 없으면 Error를 throw한다', () => {
    const raw = JSON.stringify({ subheadline: '부제목' });
    expect(() => parseGenerateContent(raw)).toThrow();
  });
});
