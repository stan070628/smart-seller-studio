// src/__tests__/api/generate-thumbnail.test.ts
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

const mockGenerateContent = vi.fn();
vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: () => ({ models: { generateContent: mockGenerateContent } }),
}));

import { POST } from '@/app/api/ai/generate-thumbnail/route';

type Part = { text?: string; inlineData?: { data: string; mimeType: string } };

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/generate-thumbnail', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function partsOfLastCall(): Part[] {
  return mockGenerateContent.mock.calls[0][0].contents[0].parts as Part[];
}

const VALID_DIRECTION = '화이트 스튜디오 배경, 조명 강조';

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadReferenceImages.mockResolvedValue([{ base64: 'X', mimeType: 'image/jpeg' }]);
  mockGenerateContent.mockResolvedValue({
    candidates: [{ content: { parts: [{ inlineData: { data: 'GEN', mimeType: 'image/png' } }] } }],
  });
});

describe('POST /api/ai/generate-thumbnail', () => {
  it('refImageUrls 3장 → loadReferenceImages 호출 + Gemini parts에 inlineData 3개 + 200', async () => {
    mockLoadReferenceImages.mockResolvedValue([
      { base64: 'A', mimeType: 'image/jpeg' },
      { base64: 'B', mimeType: 'image/jpeg' },
      { base64: 'C', mimeType: 'image/jpeg' },
    ]);

    const res = await POST(
      makeRequest({
        refImageUrls: ['https://x/a.jpg', 'https://x/b.jpg', 'https://x/c.jpg'],
        direction: VALID_DIRECTION,
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.imageBase64).toBe('GEN');

    expect(mockLoadReferenceImages).toHaveBeenCalledWith(
      expect.objectContaining({ productImageUrls: ['https://x/a.jpg', 'https://x/b.jpg', 'https://x/c.jpg'] }),
    );
    const inline = partsOfLastCall().filter((p) => p.inlineData);
    expect(inline).toHaveLength(3);
    expect(inline.map((p) => p.inlineData!.data)).toEqual(['A', 'B', 'C']);
  });

  it('하위호환: refImages(base64) → loadReferenceImages에 referenceImages로 매핑 + 200', async () => {
    const res = await POST(
      makeRequest({
        refImages: [{ imageBase64: 'AAA', mimeType: 'image/jpeg' }],
        direction: VALID_DIRECTION,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockLoadReferenceImages).toHaveBeenCalledWith(
      expect.objectContaining({ referenceImages: [{ base64: 'AAA', mimeType: 'image/jpeg' }] }),
    );
  });

  it('refImages·refImageUrls 둘 다 없으면 400', async () => {
    const res = await POST(makeRequest({ direction: VALID_DIRECTION }));
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
  });

  it('direction 5자 미만이면 400', async () => {
    const res = await POST(makeRequest({ refImageUrls: ['https://x/a.jpg'], direction: '짧음' }));
    expect(res.status).toBe(400);
  });

  it('loadReferenceImages 결과가 0장이면 400', async () => {
    mockLoadReferenceImages.mockResolvedValue([]);
    const res = await POST(makeRequest({ refImageUrls: ['https://x/a.jpg'], direction: VALID_DIRECTION }));
    expect(res.status).toBe(400);
  });

  it('Gemini가 허용 mimeType(webp)을 반환하면 그대로 전달한다', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { data: 'GEN', mimeType: 'image/webp' } }] } }],
    });
    const res = await POST(makeRequest({ refImageUrls: ['https://x/a.jpg'], direction: VALID_DIRECTION }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.mimeType).toBe('image/webp');
  });

  it('Gemini가 비허용 mimeType(heic)을 반환하면 image/png로 폴백한다', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { data: 'GEN', mimeType: 'image/heic' } }] } }],
    });
    const res = await POST(makeRequest({ refImageUrls: ['https://x/a.jpg'], direction: VALID_DIRECTION }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.mimeType).toBe('image/png');
    expect(body.data.imageBase64).toBe('GEN');
  });

  it('Gemini가 mimeType을 누락하면 image/png로 폴백한다', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { data: 'GEN' } }] } }],
    });
    const res = await POST(makeRequest({ refImageUrls: ['https://x/a.jpg'], direction: VALID_DIRECTION }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.mimeType).toBe('image/png');
  });

  it('refImages와 refImageUrls를 함께 보내면 둘 다 loadReferenceImages에 전달되고 200', async () => {
    mockLoadReferenceImages.mockResolvedValue([
      { base64: 'A', mimeType: 'image/jpeg' },
      { base64: 'B', mimeType: 'image/jpeg' },
      { base64: 'C', mimeType: 'image/jpeg' },
    ]);

    const res = await POST(
      makeRequest({
        refImages: [{ imageBase64: 'AAA', mimeType: 'image/jpeg' }],
        refImageUrls: ['https://x/a.jpg', 'https://x/b.jpg'],
        direction: VALID_DIRECTION,
      }),
    );

    expect(res.status).toBe(200);
    expect(mockLoadReferenceImages).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [{ base64: 'AAA', mimeType: 'image/jpeg' }],
        productImageUrls: ['https://x/a.jpg', 'https://x/b.jpg'],
      }),
    );
  });
});
