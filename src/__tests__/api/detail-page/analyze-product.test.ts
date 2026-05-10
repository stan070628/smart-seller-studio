import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// 인증 Mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(() => Promise.resolve({ userId: 'user-test-001', email: 'test@example.com' })),
  verifyAuth: vi.fn(() => Promise.resolve({ userId: 'user-test-001', email: 'test@example.com' })),
}));

// ---------------------------------------------------------------------------
// Rate Limit Mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 19, resetAt: Date.now() + 60000 })),
  getRateLimitKey: vi.fn((ip: string, endpoint: string) => `${ip}:${endpoint}`),
}));

// ---------------------------------------------------------------------------
// next/headers Mock
// ---------------------------------------------------------------------------

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(() => null),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Google GenAI SDK Mock
// ---------------------------------------------------------------------------

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    })),
  };
});

// ---------------------------------------------------------------------------
// withRetry Mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/ai/resilience', () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

// ---------------------------------------------------------------------------
// getGeminiGenAI Mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: vi.fn(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

import { POST } from '@/app/api/detail-page/analyze-product/route';

// ---------------------------------------------------------------------------
// 픽스처 헬퍼
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/detail-page/analyze-product', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockGeminiSuccess(result: object): void {
  mockGenerateContent.mockResolvedValueOnce({
    candidates: [
      {
        content: {
          parts: [
            { text: JSON.stringify(result) },
          ],
        },
      },
    ],
  });
}

const VALID_GEMINI_RESULT = {
  recommendedPalette: 'warm_cream',
  dominantColors: ['#F5F0E8', '#7A5C10'],
  mood: 'elegant',
  suggestedSections: ['hero', 'selling_points', 'features', 'spec_table', 'cta'],
  reasoning: '따뜻한 크림 톤이 프리미엄 식품 제품에 적합합니다.',
};

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('POST /api/detail-page/analyze-product', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('productName만 제공 시 200과 theme/suggestedSections/reasoning/dominantColors를 반환한다', async () => {
    mockGeminiSuccess(VALID_GEMINI_RESULT);

    const request = makeRequest({ productName: '스테인리스 텀블러' });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('theme');
    expect(data).toHaveProperty('suggestedSections');
    expect(data).toHaveProperty('reasoning');
    expect(data).toHaveProperty('dominantColors');
  });

  it('이미지와 productName 모두 제공 시 정상 응답한다', async () => {
    mockGeminiSuccess(VALID_GEMINI_RESULT);

    const request = makeRequest({
      productName: '텀블러',
      images: [
        { imageBase64: 'base64data', mimeType: 'image/jpeg' },
      ],
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.theme).toBeDefined();
  });

  it('suggestedSections[0]이 항상 hero이다', async () => {
    mockGeminiSuccess(VALID_GEMINI_RESULT);

    const request = makeRequest({ productName: '텀블러' });
    const response = await POST(request);
    const data = await response.json();

    expect(data.suggestedSections[0]).toBe('hero');
  });

  it('Gemini가 hero를 2번째에 반환해도 hero를 첫 번째로 강제 이동한다', async () => {
    mockGeminiSuccess({
      ...VALID_GEMINI_RESULT,
      suggestedSections: ['selling_points', 'hero', 'features', 'cta'],
    });

    const request = makeRequest({ productName: '텀블러' });
    const response = await POST(request);
    const data = await response.json();

    expect(data.suggestedSections[0]).toBe('hero');
  });

  it('Gemini가 hero를 omit해도 응답에 hero가 첫 번째로 추가된다', async () => {
    mockGeminiSuccess({
      ...VALID_GEMINI_RESULT,
      suggestedSections: ['selling_points', 'features', 'cta'],
    });

    const request = makeRequest({ productName: '텀블러' });
    const response = await POST(request);
    const data = await response.json();

    expect(data.suggestedSections[0]).toBe('hero');
  });

  it('theme.palette가 Gemini 추천 팔레트와 일치한다', async () => {
    mockGeminiSuccess({ ...VALID_GEMINI_RESULT, recommendedPalette: 'deep_dark' });

    const request = makeRequest({ productName: '전자기기' });
    const response = await POST(request);
    const data = await response.json();

    expect(data.theme.palette).toBe('deep_dark');
  });

  it('theme에 primaryColor, accentColor, fontStyle, imageLayout이 포함된다', async () => {
    mockGeminiSuccess(VALID_GEMINI_RESULT);

    const request = makeRequest({ productName: '텀블러' });
    const response = await POST(request);
    const data = await response.json();

    expect(data.theme).toHaveProperty('primaryColor');
    expect(data.theme).toHaveProperty('accentColor');
    expect(data.theme).toHaveProperty('fontStyle');
    expect(data.theme).toHaveProperty('imageLayout');
  });

  it('Gemini가 유효하지 않은 palette를 반환하면 cool_white로 fallback된다', async () => {
    mockGeminiSuccess({
      ...VALID_GEMINI_RESULT,
      recommendedPalette: 'invalid_palette_name',
    });

    const request = makeRequest({ productName: '제품' });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.theme.palette).toBe('cool_white');
  });

  it('Gemini가 유효하지 않은 sectionType을 포함하면 해당 항목이 필터링된다', async () => {
    mockGeminiSuccess({
      ...VALID_GEMINI_RESULT,
      suggestedSections: ['hero', 'invalid_section', 'selling_points', 'unknown'],
    });

    const request = makeRequest({ productName: '제품' });
    const response = await POST(request);
    const data = await response.json();

    expect(data.suggestedSections).not.toContain('invalid_section');
    expect(data.suggestedSections).not.toContain('unknown');
    expect(data.suggestedSections).toContain('hero');
    expect(data.suggestedSections).toContain('selling_points');
  });

  it('Gemini suggestedSections이 배열이 아니면 기본 배열로 대체된다', async () => {
    mockGeminiSuccess({
      ...VALID_GEMINI_RESULT,
      suggestedSections: 'not-an-array',
    });

    const request = makeRequest({ productName: '제품' });
    const response = await POST(request);
    const data = await response.json();

    expect(Array.isArray(data.suggestedSections)).toBe(true);
    expect(data.suggestedSections[0]).toBe('hero');
  });

  it('Gemini JSON 파싱 실패 → 500을 반환한다', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            parts: [
              { text: '이것은 JSON이 아닙니다. 응답을 생성할 수 없습니다.' },
            ],
          },
        },
      ],
    });

    const request = makeRequest({ productName: '제품' });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toHaveProperty('error');
  });

  it('Gemini API 호출 자체가 실패하면 500을 반환한다', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('Gemini 서버 오류'));

    const request = makeRequest({ productName: '제품' });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toHaveProperty('error');
  });

  it('Gemini 응답에 candidates가 없으면 500을 반환한다', async () => {
    mockGenerateContent.mockResolvedValueOnce({ candidates: [] });

    const request = makeRequest({ productName: '제품' });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toHaveProperty('error');
  });

  it('Gemini 응답 parts에 text가 없으면 500을 반환한다', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            parts: [{ inlineData: {} }],
          },
        },
      ],
    });

    const request = makeRequest({ productName: '제품' });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toHaveProperty('error');
  });

  it('images와 productName 모두 없으면 400을 반환한다', async () => {
    const request = makeRequest({ categoryCode: 'FOOD' });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('images 배열이 4개 이상이면 400을 반환한다', async () => {
    const request = makeRequest({
      productName: '제품',
      images: [
        { imageBase64: 'a', mimeType: 'image/jpeg' },
        { imageBase64: 'b', mimeType: 'image/jpeg' },
        { imageBase64: 'c', mimeType: 'image/jpeg' },
        { imageBase64: 'd', mimeType: 'image/jpeg' },
      ],
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('유효하지 않은 mimeType → 400을 반환한다', async () => {
    const request = makeRequest({
      productName: '제품',
      images: [{ imageBase64: 'abc', mimeType: 'image/gif' }],
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('유효하지 않은 JSON 바디 → 400을 반환한다', async () => {
    const request = new NextRequest('http://localhost:3000/api/detail-page/analyze-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad json {{',
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('Rate Limit 초과 시 429를 반환한다', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit');
    vi.mocked(checkRateLimit).mockReturnValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const request = makeRequest({ productName: '제품' });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data).toHaveProperty('error');
  });

  it('categoryCode가 있을 때도 정상 응답한다', async () => {
    mockGeminiSuccess(VALID_GEMINI_RESULT);

    const request = makeRequest({ productName: '건강식품', categoryCode: 'HEALTH' });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('theme');
  });

  it('dominantColors가 배열로 반환된다', async () => {
    mockGeminiSuccess(VALID_GEMINI_RESULT);

    const request = makeRequest({ productName: '텀블러' });
    const response = await POST(request);
    const data = await response.json();

    expect(Array.isArray(data.dominantColors)).toBe(true);
  });

  it('Gemini가 dominantColors 배열이 아닌 값을 반환하면 빈 배열로 fallback된다', async () => {
    mockGeminiSuccess({ ...VALID_GEMINI_RESULT, dominantColors: 'not-array' });

    const request = makeRequest({ productName: '제품' });
    const response = await POST(request);
    const data = await response.json();

    expect(data.dominantColors).toEqual([]);
  });

  it('Gemini reasoning이 문자열이 아니면 빈 문자열로 fallback된다', async () => {
    mockGeminiSuccess({ ...VALID_GEMINI_RESULT, reasoning: 12345 });

    const request = makeRequest({ productName: '제품' });
    const response = await POST(request);
    const data = await response.json();

    expect(data.reasoning).toBe('');
  });

  it('imageBase64가 빈 문자열인 이미지는 Zod 검증 실패로 400을 반환한다', async () => {
    const request = makeRequest({
      images: [{ imageBase64: '', mimeType: 'image/jpeg' }],
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });
});
