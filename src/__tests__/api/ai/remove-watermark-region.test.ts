import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateContentMock = vi.fn();

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, resetAt: 0 }),
  getRateLimitKey: vi.fn().mockReturnValue('k'),
}));
vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: () => ({ models: { generateContent: generateContentMock } }),
}));

import sharp from 'sharp';
import { POST } from '@/app/api/ai/remove-watermark-region/route';

async function pngBase64(): Promise<string> {
  const buf = await sharp({
    create: { width: 200, height: 200, channels: 3, background: { r: 200, g: 200, b: 200 } },
  }).png().toBuffer();
  return buf.toString('base64');
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/ai/remove-watermark-region', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const REGION = { x: 0.7, y: 0.8, width: 0.2, height: 0.15 };

describe('POST /api/ai/remove-watermark-region', () => {
  beforeEach(async () => {
    generateContentMock.mockReset();
    const clean = await sharp({
      create: { width: 60, height: 60, channels: 3, background: { r: 210, g: 210, b: 210 } },
    }).png().toBuffer();
    generateContentMock.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { data: clean.toString('base64'), mimeType: 'image/png' } }] } }],
    });
  });

  it('imageBase64로 호출하면 처리된다', async () => {
    const res = await POST(request({
      imageBase64: await pngBase64(),
      mimeType: 'image/png',
      region: REGION,
    }) as never);

    expect(res.status).toBe(200);
    const json = await res.json() as { imageBase64?: string };
    expect(json.imageBase64).toBeTruthy();
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('imageUrl 분기의 SSRF 검사는 그대로 유지된다', async () => {
    const res = await POST(request({
      imageUrl: 'https://evil.example.com/a.jpg',
      region: REGION,
    }) as never);

    expect(res.status).toBe(403);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('imageUrl도 imageBase64도 없으면 400', async () => {
    const res = await POST(request({ region: REGION }) as never);
    expect(res.status).toBe(400);
  });

  it('region이 없으면 400', async () => {
    const res = await POST(request({
      imageBase64: await pngBase64(),
      mimeType: 'image/png',
    }) as never);
    expect(res.status).toBe(400);
  });
});
