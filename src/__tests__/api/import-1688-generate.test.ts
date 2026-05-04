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

vi.mock('@/lib/listing/import-1688-thumbnail', () => ({
  generateAndUploadThumbnail: vi.fn(),
}));

vi.mock('@/lib/detail-page/html-builder', () => ({
  buildDetailPageHtml: vi.fn().mockReturnValue('<html>detail</html>'),
}));

import { requireAuth } from '@/lib/supabase/auth';
import { getAnthropicClient } from '@/lib/ai/claude';
import { generateAndUploadThumbnail } from '@/lib/listing/import-1688-thumbnail';

const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockGetClient = getAnthropicClient as ReturnType<typeof vi.fn>;
const mockGenerateThumbnail = generateAndUploadThumbnail as ReturnType<typeof vi.fn>;

const { POST } = await import('@/app/api/listing/import-1688/generate/route');

const VALID_SESSION_ID = '123e4567-e89b-12d3-a456-426614174000';
const VALID_IMAGES = [
  { url: 'https://cdn.example.com/1.jpg', type: 'main_product' as const },
  { url: 'https://cdn.example.com/2.jpg', type: 'lifestyle' as const },
];
const VALID_THUMBNAIL_URL = 'https://cdn.example.com/thumb.jpg';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/listing/import-1688/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const MOCK_GENERATE_RESPONSE = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        headline: '테스트 상품',
        subheadline: '부제목',
        sellingPoints: [
          { icon: '✅', title: '포인트1', description: '설명1' },
          { icon: '✅', title: '포인트2', description: '설명2' },
          { icon: '✅', title: '포인트3', description: '설명3' },
        ],
        features: [{ title: '특징1', description: '설명1' }],
        specs: [{ label: '소재', value: '면' }],
        usageSteps: ['단계1'],
        warnings: ['주의1'],
        ctaText: '구매',
      }),
    },
  ],
};

describe('POST /api/listing/import-1688/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'test-user' });
    mockGetClient.mockReturnValue({
      messages: { create: vi.fn().mockResolvedValue(MOCK_GENERATE_RESPONSE) },
    });
    mockGenerateThumbnail.mockResolvedValue('https://storage.example.com/thumb.jpg');
  });

  // ── 인증 ──────────────────────────────────────────────────────────────────

  it('인증 실패 시 401을 반환한다', async () => {
    mockRequireAuth.mockResolvedValue(new Response(null, { status: 401 }));
    const res = await POST(
      makeRequest({ images: VALID_IMAGES, thumbnailUrl: VALID_THUMBNAIL_URL, sessionId: VALID_SESSION_ID })
    );
    expect(res.status).toBe(401);
  });

  // ── 입력 검증 ──────────────────────────────────────────────────────────────

  it('images 빈 배열이면 400을 반환한다', async () => {
    const res = await POST(
      makeRequest({ images: [], thumbnailUrl: VALID_THUMBNAIL_URL, sessionId: VALID_SESSION_ID })
    );
    expect(res.status).toBe(400);
  });

  it('sessionId가 UUID 형식이 아니면 400을 반환한다', async () => {
    const res = await POST(
      makeRequest({ images: VALID_IMAGES, thumbnailUrl: VALID_THUMBNAIL_URL, sessionId: 'not-a-uuid' })
    );
    expect(res.status).toBe(400);
  });

  it('thumbnailUrl이 http://이면 400을 반환한다 (https-only 정책)', async () => {
    const res = await POST(
      makeRequest({ images: VALID_IMAGES, thumbnailUrl: 'http://cdn.example.com/t.jpg', sessionId: VALID_SESSION_ID })
    );
    expect(res.status).toBe(400);
  });

  it('images[].type이 올바르지 않으면 400을 반환한다', async () => {
    const res = await POST(
      makeRequest({
        images: [{ url: 'https://cdn.example.com/1.jpg', type: 'unknown_type' }],
        thumbnailUrl: VALID_THUMBNAIL_URL,
        sessionId: VALID_SESSION_ID,
      })
    );
    expect(res.status).toBe(400);
  });

  // ── 성공 ──────────────────────────────────────────────────────────────────

  it('성공 시 thumbnailUrl과 detailPageHtml을 반환한다', async () => {
    const res = await POST(
      makeRequest({ images: VALID_IMAGES, thumbnailUrl: VALID_THUMBNAIL_URL, sessionId: VALID_SESSION_ID })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.thumbnailUrl).toBe('string');
    expect(typeof json.detailPageHtml).toBe('string');
  });

  // ── Claude 오류 ───────────────────────────────────────────────────────────

  it('Claude API 오류 시 502를 반환한다', async () => {
    mockGetClient.mockReturnValue({
      messages: { create: vi.fn().mockRejectedValue(new Error('Claude 오류')) },
    });
    const res = await POST(
      makeRequest({ images: VALID_IMAGES, thumbnailUrl: VALID_THUMBNAIL_URL, sessionId: VALID_SESSION_ID })
    );
    expect(res.status).toBe(502);
  });

  // ── 썸네일 생성 오류 ───────────────────────────────────────────────────────

  it('썸네일 생성 실패 시 502를 반환한다', async () => {
    mockGenerateThumbnail.mockRejectedValue(new Error('Sharp 오류'));
    const res = await POST(
      makeRequest({ images: VALID_IMAGES, thumbnailUrl: VALID_THUMBNAIL_URL, sessionId: VALID_SESSION_ID })
    );
    expect(res.status).toBe(502);
  });
});
