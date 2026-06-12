// src/__tests__/lib/imagen.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();
vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: () => ({ models: { generateContent: mockGenerateContent } }),
}));

import { generateFrameImage } from '@/lib/ai/imagen';

type Part = { text?: string; inlineData?: { data: string; mimeType: string } };

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateContent.mockResolvedValue({
    candidates: [{ content: { parts: [{ inlineData: { data: 'GEN', mimeType: 'image/png' } }] } }],
  });
});

function partsOfLastCall(): Part[] {
  return mockGenerateContent.mock.calls[0][0].contents[0].parts as Part[];
}

describe('generateFrameImage — 멀티 참조', () => {
  it('referenceImages 3장이 모두 inlineData parts로 전달된다', async () => {
    await generateFrameImage({
      imagePrompt: 'a beautiful scene prompt here',
      referenceImages: [
        { base64: 'AAA', mimeType: 'image/jpeg' },
        { base64: 'BBB', mimeType: 'image/jpeg' },
        { base64: 'CCC', mimeType: 'image/jpeg' },
      ],
    });
    const inline = partsOfLastCall().filter((p) => p.inlineData);
    expect(inline).toHaveLength(3);
    expect(inline.map((p) => p.inlineData!.data)).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('하위호환: 단일 productImageBase64는 1개 inlineData로 변환된다', async () => {
    await generateFrameImage({
      imagePrompt: 'a beautiful scene prompt here',
      productImageBase64: 'XYZ',
      productImageMimeType: 'image/png',
    });
    const inline = partsOfLastCall().filter((p) => p.inlineData);
    expect(inline).toHaveLength(1);
    expect(inline[0].inlineData!.data).toBe('XYZ');
  });

  it('참조 없이도 텍스트 프롬프트만으로 생성한다', async () => {
    const result = await generateFrameImage({ imagePrompt: 'a beautiful scene prompt here' });
    const inline = partsOfLastCall().filter((p) => p.inlineData);
    expect(inline).toHaveLength(0);
    expect(result.imageBase64).toBe('GEN');
  });
});
