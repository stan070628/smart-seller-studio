import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// 인증 Mock — requireAuth가 항상 인증된 사용자를 반환하도록
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(() => Promise.resolve({ userId: 'user-test-001', email: 'test@example.com' })),
  verifyAuth: vi.fn(() => Promise.resolve({ userId: 'user-test-001', email: 'test@example.com' })),
}));

// ---------------------------------------------------------------------------
// Rate Limit Mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 })),
  getRateLimitKey: vi.fn((ip: string, endpoint: string) => `${ip}:${endpoint}`),
}));

// ---------------------------------------------------------------------------
// next/headers Mock (cookies() 호출 방지)
// ---------------------------------------------------------------------------

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(() => null),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

import { POST } from '@/app/api/detail-page/render/route';

// ---------------------------------------------------------------------------
// 픽스처
// ---------------------------------------------------------------------------

const VALID_THEME = {
  palette: 'warm_cream' as const,
  primaryColor: '#F5F0E8',
  accentColor: '#7A5C10',
  fontStyle: 'mixed' as const,
  imageLayout: 'fullbleed' as const,
};

const VALID_HERO_SECTION = {
  id: 'hero-001',
  type: 'hero' as const,
  order: 0,
  content: { type: 'hero', headline: '최고의 텀블러', subheadline: '365일 차갑게' },
  attachedImages: [],
};

const VALID_CTA_SECTION = {
  id: 'cta-001',
  type: 'cta' as const,
  order: 1,
  content: { type: 'cta', text: '지금 구매하기' },
  attachedImages: [],
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/detail-page/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('POST /api/detail-page/render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('유효한 sections + theme 전송 시 200과 { html, snippet }을 반환한다', async () => {
    const request = makeRequest({
      sections: [VALID_HERO_SECTION, VALID_CTA_SECTION],
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('html');
    expect(data).toHaveProperty('snippet');
    expect(typeof data.html).toBe('string');
    expect(typeof data.snippet).toBe('string');
  });

  it('html에 개인정보 고지 이미지 URL이 포함된다 (appendPrivacyFooter)', async () => {
    const request = makeRequest({
      sections: [VALID_HERO_SECTION],
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data.html).toContain('frame-02-custom_privacy.jpg');
  });

  it('snippet에는 개인정보 고지 이미지가 포함되지 않는다', async () => {
    const request = makeRequest({
      sections: [VALID_HERO_SECTION],
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data.snippet).not.toContain('frame-02-custom_privacy.jpg');
  });

  it('html에 섹션 headline 텍스트가 포함된다', async () => {
    const request = makeRequest({
      sections: [VALID_HERO_SECTION],
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data.html).toContain('최고의 텀블러');
  });

  it('snippet이 max-width:780px 컨테이너로 래핑된다', async () => {
    const request = makeRequest({
      sections: [VALID_HERO_SECTION],
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data.snippet).toContain('max-width:780px');
  });

  it('sections 필드 누락 → 400을 반환한다', async () => {
    const request = makeRequest({ theme: VALID_THEME });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('sections이 빈 배열 → 400을 반환한다', async () => {
    const request = makeRequest({ sections: [], theme: VALID_THEME });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('sections이 21개를 초과하면 400을 반환한다', async () => {
    const sections = Array.from({ length: 21 }, (_, i) => ({
      ...VALID_HERO_SECTION,
      id: `hero-${i}`,
      order: i,
    }));
    const request = makeRequest({ sections, theme: VALID_THEME });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('theme 필드 누락 → 400을 반환한다', async () => {
    const request = makeRequest({ sections: [VALID_HERO_SECTION] });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('잘못된 palette 값 → 400을 반환한다', async () => {
    const request = makeRequest({
      sections: [VALID_HERO_SECTION],
      theme: { ...VALID_THEME, palette: 'invalid_palette' },
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('잘못된 primaryColor 형식 → 400을 반환한다', async () => {
    const request = makeRequest({
      sections: [VALID_HERO_SECTION],
      theme: { ...VALID_THEME, primaryColor: 'not-a-color' },
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('유효하지 않은 JSON 바디 → 400을 반환한다', async () => {
    const request = new NextRequest('http://localhost:3000/api/detail-page/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json }{',
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('section type이 유효하지 않으면 400을 반환한다', async () => {
    const request = makeRequest({
      sections: [{ ...VALID_HERO_SECTION, type: 'unknown_type' }],
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('복수 섹션 렌더링 시 모든 섹션 내용이 html에 포함된다', async () => {
    const sections = [
      VALID_HERO_SECTION,
      {
        id: 'warn-001',
        type: 'warning' as const,
        order: 1,
        content: { type: 'warning', warnings: ['직사광선 금지'] },
        attachedImages: [],
      },
      VALID_CTA_SECTION,
    ];
    const request = makeRequest({ sections, theme: VALID_THEME });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.html).toContain('최고의 텀블러');
    expect(data.html).toContain('직사광선 금지');
    expect(data.html).toContain('지금 구매하기');
  });

  it('deep_dark 팔레트로 요청 시 해당 배경색이 html에 포함된다', async () => {
    const request = makeRequest({
      sections: [VALID_HERO_SECTION],
      theme: {
        palette: 'deep_dark',
        primaryColor: '#1A1A1A',
        accentColor: '#FFC107',
        fontStyle: 'sans',
        imageLayout: 'fullbleed',
      },
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.html).toContain('#1A1A1A');
  });
});
