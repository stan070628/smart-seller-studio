// src/__tests__/api/generate-frame-image.test.ts
// imagePrompt max(500) → max(2000) 버그 수정 회귀 테스트
// 구버그: buildFinalGeminiPrompt가 ~1050자 프롬프트 생성 → Zod max(500) 위반 → 400 → Promise.allSettled 묵음 처리

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/ai/generate-frame-image/route';
import { NextRequest } from 'next/server';

const mockGenerateFrameImage = vi.fn();

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
}));

vi.mock('@/lib/ai/imagen', () => ({
  generateFrameImage: (...args: unknown[]) => mockGenerateFrameImage(...args),
}));

const mockLoadReferenceImages = vi.fn();
vi.mock('@/lib/ai/reference-images', () => ({
  loadReferenceImages: (...args: unknown[]) => mockLoadReferenceImages(...args),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/generate-frame-image', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const MOCK_SUCCESS = { imageBase64: 'abc123', mimeType: 'image/png' };

// buildFinalGeminiPrompt가 실제로 생성하는 수준의 긴 프롬프트 (~1050자)
const LONG_PROMPT =
  'Visual style: warm ivory, soft beige. Mood: premium minimal. Lighting: soft natural light. Background: off-white linen.\n\n' +
  'Clean front-facing studio product shot on white background with soft shadows.\n\n' +
  'CRITICAL RULES — follow exactly:\n' +
  '- Do NOT alter the product shape, size, proportions, or colors.\n' +
  '- Keep all product labels, logos, and printed text IDENTICAL to the reference image.\n' +
  '- Do NOT render any text, letters, words, captions, or typography anywhere in the generated image.\n' +
  '- The product must remain the clear focal point of the image.\n' +
  '- Preserve all material textures and surface finishes exactly as shown.\n' +
  '- Keep all product components visible and in their correct positions.\n' +
  '- Do NOT crop, cut off, or partially hide any part of the product.\n' +
  '- Maintain the same product orientation and angle as the reference image.\n' +
  '- Do NOT add, remove, or modify any product features or accessories.\n' +
  '- The background and environment should complement, not compete with, the product.';

beforeEach(() => {
  mockGenerateFrameImage.mockResolvedValue(MOCK_SUCCESS);
  mockLoadReferenceImages.mockResolvedValue([]);
});

describe('POST /api/ai/generate-frame-image — imagePrompt 길이 제한 회귀', () => {
  it('1050자 프롬프트는 200을 반환한다 (구버그: max(500)이면 400)', async () => {
    // LONG_PROMPT는 500자 초과 — 구버그에서는 Zod 검증 실패로 400 반환
    expect(LONG_PROMPT.length).toBeGreaterThan(500);

    const res = await POST(makeRequest({ frameType: 'hero', imagePrompt: LONG_PROMPT }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.imageBase64).toBe('abc123');
  });

  it('2001자 프롬프트는 400을 반환한다 (현재 max(2000) 제한)', async () => {
    const tooLong = 'A'.repeat(2001);
    const res = await POST(makeRequest({ frameType: 'hero', imagePrompt: tooLong }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('imagePrompt');
  });

  it('9자 이하 프롬프트는 400을 반환한다 (min(10) 제한)', async () => {
    const res = await POST(makeRequest({ frameType: 'hero', imagePrompt: 'short' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('productImageBase64만 있고 mimeType이 없으면 400을 반환한다', async () => {
    const res = await POST(
      makeRequest({ frameType: 'hero', imagePrompt: LONG_PROMPT, productImageBase64: 'abc' }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('productImageUrls를 받으면 로더 결과를 generateFrameImage에 referenceImages로 전달한다', async () => {
    mockLoadReferenceImages.mockResolvedValue([
      { base64: 'R1', mimeType: 'image/jpeg' },
      { base64: 'R2', mimeType: 'image/jpeg' },
    ]);

    const res = await POST(
      makeRequest({
        frameType: 'hero',
        imagePrompt: LONG_PROMPT,
        productImageUrls: ['https://x/a.jpg', 'https://x/b.jpg'],
      }),
    );

    expect(res.status).toBe(200);
    expect(mockGenerateFrameImage).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [
          { base64: 'R1', mimeType: 'image/jpeg' },
          { base64: 'R2', mimeType: 'image/jpeg' },
        ],
      }),
    );
  });

  it('productImageBase64와 mimeType이 함께 있으면 200을 반환한다', async () => {
    const res = await POST(
      makeRequest({
        frameType: 'hero',
        imagePrompt: LONG_PROMPT,
        productImageBase64: 'abc',
        productImageMimeType: 'image/jpeg',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
