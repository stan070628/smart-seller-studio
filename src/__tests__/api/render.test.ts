/**
 * render.test.ts
 * POST /api/render Route Handler 단위 테스트
 *
 * 실제 구현: src/app/api/render/route.ts
 * 의존성:
 *   - sharp → vi.mock으로 대체
 *   - @/lib/supabase/server → uploadToStorage 를 vi.mock으로 대체
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Sharp Mock
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rate Limit Mock (429 차단 방지)
// ---------------------------------------------------------------------------

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 })),
  getRateLimitKey: vi.fn((ip: string, endpoint: string) => `${ip}:${endpoint}`),
  RATE_LIMITS: {
    AI_API: { windowMs: 60_000, maxRequests: 10 },
    UPLOAD: { windowMs: 60_000, maxRequests: 30 },
    RENDER: { windowMs: 60_000, maxRequests: 5 },
  },
}));

vi.mock('sharp', () => {
  const mockInstance = {
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-jpeg')),
  };
  return { default: vi.fn(() => mockInstance) };
});

// ---------------------------------------------------------------------------
// Supabase server Mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  uploadToStorage: vi.fn(),
  getServerClient: vi.fn(),
}));

import sharp from 'sharp';
import { uploadToStorage } from '@/lib/supabase/server';
import { POST } from '@/app/api/render/route';

// 타입 단언
const mockSharp = sharp as ReturnType<typeof vi.fn>;
const mockUpload = uploadToStorage as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// 픽스처: 1x1 PNG data URL
// ---------------------------------------------------------------------------

const VALID_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ---------------------------------------------------------------------------
// 헬퍼: NextRequest 생성
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// 헬퍼: sharp mock 인스턴스 접근
// ---------------------------------------------------------------------------

function getMockSharpInstance() {
  return mockSharp.mock.results[0]?.value as {
    resize: ReturnType<typeof vi.fn>;
    jpeg: ReturnType<typeof vi.fn>;
    toBuffer: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('POST /api/render', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Sharp 기본 mock: Buffer.from('fake-jpeg') 반환
    const mockInstance = {
      resize: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-jpeg')),
    };
    mockSharp.mockReturnValue(mockInstance);
  });

  // ── 테스트 1 ──────────────────────────────────────────────────────────────
  it('정상: 유효한 data URL → 200 + dataUrl(outputDataUrl) 반환', async () => {
    const request = makeRequest({ dataUrl: VALID_DATA_URL });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.dataUrl).toBeDefined();
    expect(typeof json.dataUrl).toBe('string');
  });

  // ── 테스트 2 ──────────────────────────────────────────────────────────────
  it('dataUrl 누락 → 400', async () => {
    const request = makeRequest({ width: 860 });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('dataUrl');
  });

  // ── 테스트 3 ──────────────────────────────────────────────────────────────
  it('data: prefix 없는 문자열 → 400', async () => {
    const request = makeRequest({ dataUrl: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('data URL');
  });

  // ── 테스트 4 ──────────────────────────────────────────────────────────────
  it('width 범위 초과 (3841) → 클램프되어 3840으로 처리됨 (400 아님)', async () => {
    // route.ts 구현을 보면 width는 Math.min(3840, ...) 으로 클램프하여
    // 400을 반환하지 않고 조용히 3840으로 처리함
    const request = makeRequest({ dataUrl: VALID_DATA_URL, width: 3841 });
    const response = await POST(request);
    const json = await response.json();

    // 클램프 처리로 정상 응답
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });

  // ── 테스트 5 ──────────────────────────────────────────────────────────────
  it('quality 범위 초과 (101) → 클램프되어 100으로 처리됨 (400 아님)', async () => {
    // route.ts 구현: quality는 Math.min(100, Math.max(1, ...)) 으로 클램프
    const request = makeRequest({ dataUrl: VALID_DATA_URL, quality: 101 });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });

  // ── 테스트 6 ──────────────────────────────────────────────────────────────
  it('userId + projectId 제공 시 uploadToStorage 호출됨', async () => {
    mockUpload.mockResolvedValueOnce({ url: 'https://example.supabase.co/storage/test.jpg' });

    const request = makeRequest({
      dataUrl: VALID_DATA_URL,
      userId: 'user-123',
      projectId: 'project-456',
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockUpload).toHaveBeenCalledOnce();
    // storageUrl이 응답에 포함되어야 함
    expect(json.storageUrl).toBe('https://example.supabase.co/storage/test.jpg');
  });

  // ── 테스트 7 ──────────────────────────────────────────────────────────────
  it('userId/projectId 미제공 시 uploadToStorage 호출 안 됨', async () => {
    const request = makeRequest({ dataUrl: VALID_DATA_URL });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockUpload).not.toHaveBeenCalled();
    // storageUrl 필드가 undefined이거나 존재하지 않아야 함
    expect(json.storageUrl).toBeUndefined();
  });

  // ── 테스트 8 ──────────────────────────────────────────────────────────────
  it('Sharp toBuffer 실패 시 500', async () => {
    const failInstance = {
      resize: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockRejectedValue(new Error('Sharp 처리 중 오류: unsupported image format')),
    };
    mockSharp.mockReturnValue(failInstance);

    const request = makeRequest({ dataUrl: VALID_DATA_URL });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toContain('이미지 처리 중 오류');
  });

  // ── 테스트 9 ──────────────────────────────────────────────────────────────
  it('비정상 JSON → 400', async () => {
    const request = new NextRequest('http://localhost:3000/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {{{{',
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('JSON');
  });

  // ── 테스트 10 ─────────────────────────────────────────────────────────────
  it('정상 응답에 dataUrl 필드 존재 확인', async () => {
    const request = makeRequest({ dataUrl: VALID_DATA_URL });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    // dataUrl 필드 존재 및 data:image/jpeg;base64, 형식 확인
    expect(json).toHaveProperty('dataUrl');
    expect(json.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    // size 필드도 존재해야 함
    expect(json).toHaveProperty('size');
    expect(typeof json.size).toBe('number');
  });
});
