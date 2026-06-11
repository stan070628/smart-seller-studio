// src/__tests__/api/generate-scene-image.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
}));

const mockLoadReferenceImages = vi.fn();
vi.mock('@/lib/ai/reference-images', () => ({
  loadReferenceImages: (...args: unknown[]) => mockLoadReferenceImages(...args),
}));

const mockGenerateFrameImage = vi.fn();
vi.mock('@/lib/ai/imagen', () => ({
  generateFrameImage: (...args: unknown[]) => mockGenerateFrameImage(...args),
}));

const mockClaudeCreate = vi.fn();
vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: () => ({ messages: { create: mockClaudeCreate } }),
}));

import { POST } from '@/app/api/ai/generate-scene-image/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/generate-scene-image', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClaudeCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({ prompt: 'a detailed scene prompt' }) }],
  });
  mockGenerateFrameImage.mockResolvedValue({ imageBase64: 'GEN', mimeType: 'image/png' });
});

describe('POST /api/ai/generate-scene-image — 멀티참조', () => {
  it('productImageUrls 3장이 Claude content와 generateFrameImage에 모두 전달된다', async () => {
    mockLoadReferenceImages.mockResolvedValue([
      { base64: 'A', mimeType: 'image/jpeg' },
      { base64: 'B', mimeType: 'image/jpeg' },
      { base64: 'C', mimeType: 'image/jpeg' },
    ]);

    const res = await POST(
      makeRequest({
        sectionType: 'hero',
        productImageUrls: ['https://x/a.jpg', 'https://x/b.jpg', 'https://x/c.jpg'],
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const claudeArgs = mockClaudeCreate.mock.calls[0][0];
    const userContent = claudeArgs.messages[0].content as Array<{ type: string }>;
    expect(userContent.filter((b) => b.type === 'image')).toHaveLength(3);

    expect(mockGenerateFrameImage).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [
          { base64: 'A', mimeType: 'image/jpeg' },
          { base64: 'B', mimeType: 'image/jpeg' },
          { base64: 'C', mimeType: 'image/jpeg' },
        ],
      }),
    );
  });

  it('참조 0장이면 이미지 블록 없이 텍스트만으로 생성한다', async () => {
    mockLoadReferenceImages.mockResolvedValue([]);

    const res = await POST(makeRequest({ sectionType: 'lifestyle' }));
    expect(res.status).toBe(200);

    const userContent = mockClaudeCreate.mock.calls[0][0].messages[0].content as Array<{ type: string }>;
    expect(userContent.filter((b) => b.type === 'image')).toHaveLength(0);
  });

  it('잘못된 sectionType은 400을 반환한다', async () => {
    const res = await POST(makeRequest({ sectionType: 'banner' }));
    expect(res.status).toBe(400);
  });
});
