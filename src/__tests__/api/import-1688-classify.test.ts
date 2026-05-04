// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── 의존성 mock ────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: vi.fn(),
}));

import { requireAuth } from '@/lib/supabase/auth';
import { getAnthropicClient } from '@/lib/ai/claude';

const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockGetClient = getAnthropicClient as ReturnType<typeof vi.fn>;

const { POST } = await import('@/app/api/listing/import-1688/classify/route');

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/listing/import-1688/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_URLS = ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'];

describe('POST /api/listing/import-1688/classify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'test-user' });
  });

  // ── 인증 ──────────────────────────────────────────────────────────────────

  it('인증 실패 시 401을 반환한다', async () => {
    mockRequireAuth.mockResolvedValue(new Response(null, { status: 401 }));
    const res = await POST(makeRequest({ imageUrls: VALID_URLS }));
    expect(res.status).toBe(401);
  });

  // ── 입력 검증 ──────────────────────────────────────────────────────────────

  it('imageUrls 빈 배열이면 400을 반환한다', async () => {
    const res = await POST(makeRequest({ imageUrls: [] }));
    expect(res.status).toBe(400);
  });

  it('imageUrls 21개이면 400을 반환한다', async () => {
    const urls = Array.from({ length: 21 }, (_, i) => `https://cdn.example.com/${i}.jpg`);
    const res = await POST(makeRequest({ imageUrls: urls }));
    expect(res.status).toBe(400);
  });

  it('URL이 아닌 문자열이 포함되면 400을 반환한다', async () => {
    const res = await POST(makeRequest({ imageUrls: ['not-a-url'] }));
    expect(res.status).toBe(400);
  });

  it('http:// URL은 400을 반환한다 (https-only 정책)', async () => {
    const res = await POST(makeRequest({ imageUrls: ['http://cdn.example.com/1.jpg'] }));
    expect(res.status).toBe(400);
  });

  it('잘못된 바디(JSON 아님)이면 400을 반환한다', async () => {
    const req = new NextRequest('http://localhost/api/listing/import-1688/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ── 성공 ──────────────────────────────────────────────────────────────────

  it('Claude Vision 성공 시 분류된 이미지 배열을 반환한다', async () => {
    mockGetClient.mockReturnValue({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: '[{"index":0,"type":"main_product"},{"index":1,"type":"lifestyle"}]',
            },
          ],
        }),
      },
    });
    const res = await POST(makeRequest({ imageUrls: VALID_URLS }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.images).toHaveLength(2);
    expect(json.images[0].type).toBe('main_product');
  });

  it('Claude가 빈 content 배열을 반환하면 모두 lifestyle fallback', async () => {
    mockGetClient.mockReturnValue({
      messages: {
        create: vi.fn().mockResolvedValue({ content: [] }),
      },
    });
    const res = await POST(makeRequest({ imageUrls: VALID_URLS }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.images.every((img: { type: string }) => img.type === 'lifestyle')).toBe(true);
  });

  // ── Claude 오류 ───────────────────────────────────────────────────────────

  it('Claude API 오류 시 502를 반환한다', async () => {
    mockGetClient.mockReturnValue({
      messages: {
        create: vi.fn().mockRejectedValue(new Error('API error')),
      },
    });
    const res = await POST(makeRequest({ imageUrls: VALID_URLS }));
    expect(res.status).toBe(502);
  });
});
