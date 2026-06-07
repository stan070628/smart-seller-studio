import { describe, it, expect } from 'vitest';
import {
  buildImagePromptsUserPrompt,
  parseImagePromptsResponse,
  buildFinalGeminiPrompt,
} from '@/lib/ai/prompts/detail-image-prompts';
import type { ProductImageAnalysis } from '@/lib/ai/prompts/detail-page';

const mockAnalysis: ProductImageAnalysis = {
  material: '천연 린넨',
  shape: '직사각형 쿠션',
  colors: ['아이보리', '베이지'],
  keyComponents: ['지퍼', '리무버블 커버'],
};

const mockContent = {
  headline: '프리미엄 린넨 쿠션',
  subheadline: '자연스러운 감촉',
  sellingPoints: [
    { icon: '✨', title: '천연 소재', description: '100% 린넨' },
    { icon: '💎', title: '세탁 가능', description: '커버 분리 세탁' },
  ],
  features: [{ title: '견고한 지퍼', description: '내구성 높은 YKK 지퍼' }],
  specs: [],
  usageSteps: [],
  warnings: [],
  ctaText: '구매하기',
};

describe('buildImagePromptsUserPrompt', () => {
  it('productName이 없어도 동작한다', () => {
    const prompt = buildImagePromptsUserPrompt(mockAnalysis, mockContent);
    expect(prompt).toContain('린넨');
    expect(prompt).toContain('프리미엄 린넨 쿠션');
  });

  it('productName이 있으면 포함된다', () => {
    const prompt = buildImagePromptsUserPrompt(mockAnalysis, mockContent, '린넨 쿠션 베이지');
    expect(prompt).toContain('린넨 쿠션 베이지');
  });
});

describe('parseImagePromptsResponse', () => {
  it('유효한 JSON을 파싱한다', () => {
    const raw = JSON.stringify({
      visualIdentity: {
        colorPalette: 'warm ivory, soft beige',
        mood: 'premium minimal',
        lighting: 'soft natural light',
        background: 'off-white linen',
      },
      imagePrompts: [
        { role: 'hero', scene: 'Clean front-facing product shot', referenceImageIndex: 0 },
        { role: 'lifestyle', scene: 'Cozy living room', referenceImageIndex: 0 },
        { role: 'detail', scene: 'Macro linen texture', referenceImageIndex: 0 },
        { role: 'feature', scene: 'Zipper close-up', referenceImageIndex: 0 },
      ],
    });
    const result = parseImagePromptsResponse(raw);
    expect(result.visualIdentity.colorPalette).toBe('warm ivory, soft beige');
    expect(result.imagePrompts).toHaveLength(4);
    expect(result.imagePrompts[0].role).toBe('hero');
  });

  it('JSON이 없으면 에러를 던진다', () => {
    expect(() => parseImagePromptsResponse('no json here')).toThrow();
  });

  it('imagePrompts가 배열이 아니면 에러를 던진다', () => {
    const raw = JSON.stringify({ visualIdentity: {}, imagePrompts: 'wrong' });
    expect(() => parseImagePromptsResponse(raw)).toThrow();
  });

  it('알 수 없는 role 값은 feature로 폴백된다', () => {
    const raw = JSON.stringify({
      visualIdentity: { colorPalette: 'x', mood: 'y', lighting: 'z', background: 'w' },
      imagePrompts: [{ role: 'banner', scene: 'test', referenceImageIndex: 0 }],
    });
    const result = parseImagePromptsResponse(raw);
    expect(result.imagePrompts[0].role).toBe('feature');
  });

  it('visualIdentity가 없으면 기본값을 사용한다', () => {
    const raw = JSON.stringify({
      imagePrompts: [{ role: 'hero', scene: 'test', referenceImageIndex: 0 }],
    });
    const result = parseImagePromptsResponse(raw);
    expect(result.visualIdentity.colorPalette).toBe('neutral tones');
  });
});

describe('buildFinalGeminiPrompt', () => {
  const visualIdentity = {
    colorPalette: 'warm ivory, soft beige',
    mood: 'premium minimal',
    lighting: 'soft natural light',
    background: 'off-white linen',
  };

  it('비주얼 아이덴티티와 장면, 보존 규칙을 모두 포함한다', () => {
    const prompt = buildFinalGeminiPrompt(visualIdentity, 'Clean studio shot of the product');
    expect(prompt).toContain('warm ivory');
    expect(prompt).toContain('premium minimal');
    expect(prompt).toContain('Clean studio shot');
    expect(prompt).toContain('Do NOT render any text');
    expect(prompt).toContain('IDENTICAL to the reference image');
  });

  it('PRODUCT_PRESERVATION_RULES 포함으로 프롬프트가 500자를 초과한다 — route max(2000) 범위 내', () => {
    // 버그 재현: buildFinalGeminiPrompt가 생성하는 프롬프트는 항상 500자 초과.
    // 구버그(max(500) Zod 제한)에서는 이 프롬프트로 만든 모든 Gemini 요청이 400 실패했음.
    const scene = 'Clean front-facing studio product shot on white background with soft shadows';
    const prompt = buildFinalGeminiPrompt(visualIdentity, scene);
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt.length).toBeLessThan(2000);
  });
});
