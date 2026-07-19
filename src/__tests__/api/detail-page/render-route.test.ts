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

// ---------------------------------------------------------------------------
// 유튜브 썸네일 합성 Mock — 실제 fetch/sharp/Supabase 업로드를 피하고
// composeYoutubeThumbnail 호출 여부/인자를 검증하기 위한 스파이
// ---------------------------------------------------------------------------

const { composeYoutubeThumbnailMock } = vi.hoisted(() => ({
  composeYoutubeThumbnailMock: vi.fn(() =>
    Promise.resolve('https://storage.example.com/ai-detail/youtube/mocked-thumb.jpg'),
  ),
}));

vi.mock('@/lib/detail-page/youtube-thumbnail', () => ({
  composeYoutubeThumbnail: composeYoutubeThumbnailMock,
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

const VALID_YOUTUBE_SECTION = {
  id: 'youtube-001',
  type: 'youtube' as const,
  order: 0,
  content: {
    type: 'youtube',
    enabled: true,
    videoId: 'dQw4w9WgXcQ', // 11자 유효 videoId
    aspect: 'horizontal' as const,
  },
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

describe('POST /api/detail-page/render — youtube 섹션 + mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    composeYoutubeThumbnailMock.mockClear();
    composeYoutubeThumbnailMock.mockResolvedValue('https://storage.example.com/ai-detail/youtube/mocked-thumb.jpg');
  });

  it('mode 생략(기본값 export) → 유튜브 썸네일이 합성되어 html에 포함되고 iframe은 없다', async () => {
    const request = makeRequest({
      sections: [VALID_YOUTUBE_SECTION],
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(composeYoutubeThumbnailMock).toHaveBeenCalledTimes(1);
    expect(composeYoutubeThumbnailMock).toHaveBeenCalledWith('dQw4w9WgXcQ', 'horizontal');
    expect(data.html).toContain('https://storage.example.com/ai-detail/youtube/mocked-thumb.jpg');
    expect(data.html).not.toContain('<iframe');
  });

  it('mode=export → 명시적으로 지정해도 동일하게 썸네일이 합성된다', async () => {
    const request = makeRequest({
      sections: [VALID_YOUTUBE_SECTION],
      theme: VALID_THEME,
      mode: 'export',
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(composeYoutubeThumbnailMock).toHaveBeenCalledTimes(1);
    expect(data.html).toContain('https://storage.example.com/ai-detail/youtube/mocked-thumb.jpg');
    expect(data.html).not.toContain('<iframe');
  });

  it('mode=preview → 썸네일 합성을 호출하지 않고 iframe을 렌더링한다', async () => {
    const request = makeRequest({
      sections: [VALID_YOUTUBE_SECTION],
      theme: VALID_THEME,
      mode: 'preview',
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(composeYoutubeThumbnailMock).not.toHaveBeenCalled();
    expect(data.html).toContain('<iframe');
  });

  it('enabled:false인 유튜브 섹션은 export 모드에서도 썸네일을 합성하지 않는다', async () => {
    const request = makeRequest({
      sections: [
        { ...VALID_YOUTUBE_SECTION, content: { ...VALID_YOUTUBE_SECTION.content, enabled: false } },
      ],
      theme: VALID_THEME,
      mode: 'export',
    });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(composeYoutubeThumbnailMock).not.toHaveBeenCalled();
  });

  it('썸네일 합성 실패 시 500이 아닌 200으로 폴백 렌더링된다', async () => {
    composeYoutubeThumbnailMock.mockRejectedValueOnce(new Error('업로드 실패'));
    const request = makeRequest({
      sections: [VALID_YOUTUBE_SECTION],
      theme: VALID_THEME,
      mode: 'export',
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('html');
  });

  it('잘못된 mode 값 → 400을 반환한다', async () => {
    const request = makeRequest({
      sections: [VALID_YOUTUBE_SECTION],
      theme: VALID_THEME,
      mode: 'invalid_mode',
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });
});
