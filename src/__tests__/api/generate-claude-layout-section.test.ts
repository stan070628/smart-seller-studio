import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ user: { id: 'test-user' } }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, resetAt: 0 }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
}));

vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: vi.fn().mockReturnValue({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({
          blocks: [
            { type: 'badge', text: 'Point 1' },
            { type: 'heading', text: '국내 최초 NMN', size: 'xl' },
          ],
          bgStyle: 'white',
          padding: 'normal',
        }) }],
      }),
    },
  }),
}));

vi.mock('@/lib/ai/imagen', () => ({
  generateFrameImage: vi.fn().mockResolvedValue({
    imageBase64: 'base64data',
    mimeType: 'image/jpeg',
  }),
}));

vi.mock('@/lib/ai/remove-background', () => ({
  removeImageBackgrounds: vi.fn().mockImplementation(async (refs) => ({
    refs,
    anyRemoved: false,
  })),
}));

vi.mock('@/lib/ai/reference-images', () => ({
  loadReferenceImages: vi.fn().mockResolvedValue([
    { base64: 'b64', mimeType: 'image/jpeg' },
  ]),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue({
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: { path: 'test.jpg' }, error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/test.jpg' } }),
      }),
    },
  }),
}));

import { POST } from '@/app/api/ai/generate-claude-layout-section/route';
import { NextRequest } from 'next/server';

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/ai/generate-claude-layout-section', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/generate-claude-layout-section', () => {
  it('유효한 요청 — 200, blocks 반환', async () => {
    const req = makeRequest({
      title: '국내 최초 건조효모 유래 NMN',
      points: ['250mg 함유', '건조효모 유래'],
      imageSlots: [],
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data.blocks)).toBe(true);
    expect(data.data.imageUrls).toEqual([]);
  });

  it('title 누락 — 400', async () => {
    const req = makeRequest({ points: [], imageSlots: [] });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('imageSlots upload — 이미지 URL 반환', async () => {
    const req = makeRequest({
      title: '테스트',
      points: [],
      imageSlots: [{ source: 'upload', url: 'https://example.com/product.jpg' }],
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data.imageUrls).toHaveLength(1);
  });

  it('imageSlots gemini — Gemini 생성 후 URL 반환', async () => {
    const req = makeRequest({
      title: '테스트',
      points: [],
      imageSlots: [{ source: 'gemini', generationHint: '알약 흰 배경' }],
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data.imageUrls).toHaveLength(1);
  });

  it('Claude JSON 파싱 실패 — blocks: [] fallback', async () => {
    const { getAnthropicClient } = await import('@/lib/ai/claude');
    vi.mocked(getAnthropicClient).mockReturnValueOnce({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'not json at all' }],
        }),
      },
    } as unknown as ReturnType<typeof getAnthropicClient>);

    const req = makeRequest({ title: '테스트', points: [], imageSlots: [] });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data.blocks).toEqual([]);
  });
});
