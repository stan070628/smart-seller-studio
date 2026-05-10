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
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 })),
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
// Anthropic SDK Mock
// ---------------------------------------------------------------------------

const mockMessagesCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: mockMessagesCreate,
      },
    })),
  };
});

// ---------------------------------------------------------------------------
// withRetry Mock — 재시도 없이 fn()을 바로 실행
// ---------------------------------------------------------------------------

vi.mock('@/lib/ai/resilience', () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

// ---------------------------------------------------------------------------
// getAnthropicClient Mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: vi.fn(() => ({
    messages: {
      create: mockMessagesCreate,
    },
  })),
}));

import { POST } from '@/app/api/detail-page/edit-section/route';

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
  content: { type: 'hero', headline: '기존 헤드라인', subheadline: '기존 서브' },
  attachedImages: [],
};

const VALID_INSTRUCTION = '더 임팩트 있게 수정해주세요';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/detail-page/edit-section', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockClaudeSuccess(contentJson: object): void {
  mockMessagesCreate.mockResolvedValueOnce({
    content: [
      {
        type: 'text',
        text: JSON.stringify(contentJson),
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('POST /api/detail-page/edit-section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('정상 요청 시 200과 { section, html }을 반환한다', async () => {
    mockClaudeSuccess({
      type: 'hero',
      headline: '수정된 헤드라인',
      subheadline: '수정된 서브',
    });

    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: VALID_INSTRUCTION,
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('section');
    expect(data).toHaveProperty('html');
    expect(typeof data.html).toBe('string');
  });

  it('응답 section.type이 요청 section.type과 일치한다', async () => {
    mockClaudeSuccess({
      type: 'hero',
      headline: '수정된 헤드라인',
      subheadline: '서브',
    });

    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: '수정',
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data.section.type).toBe('hero');
  });

  it('AI가 type 필드를 변경해도 원본 type으로 강제 고정된다', async () => {
    mockClaudeSuccess({
      type: 'cta',
      headline: '타입 변조 시도',
      subheadline: '',
    });

    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: '수정',
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data.section.type).toBe('hero');
    expect(data.section.content.type).toBe('hero');
  });

  it('응답 section.id가 요청 section.id와 동일하다', async () => {
    mockClaudeSuccess({ type: 'hero', headline: '수정됨', subheadline: '' });

    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: '수정',
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data.section.id).toBe('hero-001');
  });

  it('html에 section.id가 data-section-id 속성으로 포함된다', async () => {
    mockClaudeSuccess({ type: 'hero', headline: '수정됨', subheadline: '' });

    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: '수정',
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data.html).toContain('data-section-id="hero-001"');
  });

  it('selling_points 섹션 타입도 정상 처리된다', async () => {
    const spSection = {
      id: 'sp-001',
      type: 'selling_points' as const,
      order: 1,
      content: {
        type: 'selling_points',
        points: [{ icon: '🔥', title: '내열', description: '강함' }],
      },
      attachedImages: [],
    };

    mockClaudeSuccess({
      type: 'selling_points',
      points: [
        { icon: '✅', title: '수정된 타이틀', description: '수정된 설명' },
      ],
    });

    const request = makeRequest({
      section: spSection,
      instruction: '소구점을 더 강하게',
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.section.type).toBe('selling_points');
  });

  it('금지어(선착순)가 포함된 AI 응답 → 400을 반환한다', async () => {
    mockClaudeSuccess({
      type: 'hero',
      headline: '선착순 100명 한정',
      subheadline: '서브',
    });

    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: '특별 이벤트로 수정',
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('금지 표현');
  });

  it('금지어(감염예방)가 포함된 AI 응답 → 400을 반환한다', async () => {
    mockClaudeSuccess({
      type: 'hero',
      headline: '감염예방에 탁월한 제품',
      subheadline: '',
    });

    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: '건강 관련으로 수정',
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('금지 표현');
  });

  it('Claude API 호출 실패 → 500을 반환한다', async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error('Claude API 연결 실패'));

    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: VALID_INSTRUCTION,
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toHaveProperty('error');
  });

  it('AI가 유효하지 않은 JSON을 반환하면 500을 반환한다', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '죄송합니다, JSON을 반환할 수 없습니다.' }],
    });

    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: VALID_INSTRUCTION,
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toHaveProperty('error');
  });

  it('AI가 배열을 반환하면 500을 반환한다', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '[{"type":"hero"}]' }],
    });

    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: VALID_INSTRUCTION,
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toHaveProperty('error');
  });

  it('AI가 null을 반환하면 500을 반환한다', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'null' }],
    });

    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: VALID_INSTRUCTION,
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toHaveProperty('error');
  });

  it('instruction 필드 누락 → 400을 반환한다', async () => {
    const request = makeRequest({
      section: VALID_HERO_SECTION,
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('instruction이 빈 문자열 → 400을 반환한다', async () => {
    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: '',
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('instruction이 500자를 초과하면 400을 반환한다', async () => {
    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: 'A'.repeat(501),
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('section 필드 누락 → 400을 반환한다', async () => {
    const request = makeRequest({
      instruction: VALID_INSTRUCTION,
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('productName과 existingSections 선택 필드가 있을 때도 정상 동작한다', async () => {
    mockClaudeSuccess({ type: 'hero', headline: '수정됨', subheadline: '' });

    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: VALID_INSTRUCTION,
      theme: VALID_THEME,
      productName: '스테인리스 텀블러',
      existingSections: [
        { type: 'hero', content: { type: 'hero', headline: 'H', subheadline: 'S' } },
      ],
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('section');
  });

  it('유효하지 않은 JSON 바디 → 400을 반환한다', async () => {
    const request = new NextRequest('http://localhost:3000/api/detail-page/edit-section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json }{',
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('error');
  });

  it('Rate Limit 초과 시 429를 반환한다', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit');
    vi.mocked(checkRateLimit).mockReturnValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const request = makeRequest({
      section: VALID_HERO_SECTION,
      instruction: VALID_INSTRUCTION,
      theme: VALID_THEME,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data).toHaveProperty('error');
  });
});
