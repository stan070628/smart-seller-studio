// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
}));

const mockGenerateContent = vi.fn();
vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: vi.fn().mockReturnValue({
    models: { generateContent: (...args: unknown[]) => mockGenerateContent(...args) },
  }),
}));

// Sharp mock — vi.hoisted()로 hoisting 문제 해결
const FAKE_BUF = Buffer.from('fake');
const mockSharpInstance = vi.hoisted(() => {
  const inst: Record<string, ReturnType<typeof vi.fn>> = {
    rotate: vi.fn(),
    metadata: vi.fn().mockResolvedValue({ width: 500, height: 500 }),
    clone: vi.fn(),
    resize: vi.fn(),
    extract: vi.fn(),
    png: vi.fn(),
    jpeg: vi.fn(),
    stats: vi.fn().mockResolvedValue({
      channels: [{ mean: 120 }, { mean: 120 }, { mean: 120 }],
    }),
    linear: vi.fn(),
    ensureAlpha: vi.fn(),
    composite: vi.fn(),
    blur: vi.fn(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake')),
  };
  // 체이닝 메서드는 자기 자신을 반환
  ['rotate', 'clone', 'resize', 'extract', 'png', 'jpeg', 'linear', 'ensureAlpha', 'composite', 'blur'].forEach(k => {
    inst[k].mockReturnValue(inst);
  });
  return inst;
});

vi.mock('sharp', () => ({ default: vi.fn().mockReturnValue(mockSharpInstance) }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { POST } from '@/app/api/ai/cleanup-image-region/route';

const SUPABASE_URL =
  'https://abcdef.supabase.co/storage/v1/object/public/images/test.jpg';
const VALID_REGION = { x: 0.1, y: 0.1, width: 0.4, height: 0.3 };
const MOCK_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
const MOCK_GEMINI_RESPONSE = {
  candidates: [{
    content: {
      parts: [{ inlineData: { data: MOCK_IMAGE_BASE64, mimeType: 'image/png' } }],
    },
  }],
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/cleanup-image-region', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 체이닝 메서드 재설정
  ['rotate', 'clone', 'resize', 'extract', 'png', 'jpeg', 'linear', 'ensureAlpha', 'composite', 'blur'].forEach(k => {
    mockSharpInstance[k].mockReturnValue(mockSharpInstance);
  });
  mockSharpInstance.metadata.mockResolvedValue({ width: 500, height: 500 });
  mockSharpInstance.stats.mockResolvedValue({
    channels: [{ mean: 120 }, { mean: 120 }, { mean: 120 }],
  });
  mockSharpInstance.toBuffer.mockResolvedValue(FAKE_BUF);
  mockFetch.mockResolvedValue({
    ok: true,
    arrayBuffer: async () => Buffer.from(MOCK_IMAGE_BASE64, 'base64').buffer,
  });
  mockGenerateContent.mockResolvedValue(MOCK_GEMINI_RESPONSE);
});

describe('POST /api/ai/cleanup-image-region', () => {
  it('정상 요청 시 imageBase64와 mimeType 반환', async () => {
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL, region: VALID_REGION }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(typeof json.imageBase64).toBe('string');
    expect(json.mimeType).toBe('image/jpeg');
  });

  it('Supabase URL 아닌 외부 URL → 403', async () => {
    const res = await POST(makeRequest({ imageUrl: 'https://evil.com/img.jpg', region: VALID_REGION }));
    expect(res.status).toBe(403);
  });

  it('region.width < 0.01 → 400', async () => {
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL, region: { ...VALID_REGION, width: 0.005 } }));
    expect(res.status).toBe(400);
  });

  it('region 없으면 400', async () => {
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL }));
    expect(res.status).toBe(400);
  });

  it('이미지 fetch 실패 → 422', async () => {
    mockFetch.mockResolvedValue({ ok: false });
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL, region: VALID_REGION }));
    expect(res.status).toBe(422);
  });

  it('Gemini 응답에 imageData 없으면 500', async () => {
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'no image here' }] } }],
    });
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL, region: VALID_REGION }));
    expect(res.status).toBe(500);
  });

  it('Gemini AbortError → 500 + 타임아웃 메시지', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    mockGenerateContent.mockRejectedValue(abortErr);
    const res = await POST(makeRequest({ imageUrl: SUPABASE_URL, region: VALID_REGION }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toMatch(/시간/);
  });

  it('region 경계 clamp 케이스 (x=0, y=0) — 정상 처리', async () => {
    const res = await POST(makeRequest({
      imageUrl: SUPABASE_URL,
      region: { x: 0, y: 0, width: 0.2, height: 0.2 },
    }));
    expect(res.status).toBe(200);
  });
});
