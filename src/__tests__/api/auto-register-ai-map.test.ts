/**
 * auto-register-ai-map.test.ts
 * POST /api/auto-register/ai-map — 인증·입력 검증·성공·오류·타임아웃 검증
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 의존성 mock ────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/auto-register/ai-field-mapper', () => ({
  mapProductToCoupangFields: vi.fn(),
}));

import { requireAuth } from '@/lib/supabase/auth';
import { mapProductToCoupangFields } from '@/lib/auto-register/ai-field-mapper';
import type { NormalizedProduct, MappedCoupangFields } from '@/lib/auto-register/types';

const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockMapProductToCoupangFields = mapProductToCoupangFields as ReturnType<typeof vi.fn>;

const { POST } = await import('@/app/api/auto-register/ai-map/route');

// ── 헬퍼 ──────────────────────────────────────────────────────────────────
function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/auto-register/ai-map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest(): Request {
  return new Request('http://localhost/api/auto-register/ai-map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ bad json',
  });
}

const sampleProduct: NormalizedProduct = {
  source: 'domeggook',
  itemId: '123456',
  title: '테스트 상품',
  price: 15000,
  imageUrls: [],
  description: '상품 설명',
};

const sampleFields: MappedCoupangFields = {
  sellerProductName: { value: '테스트 상품명', confidence: 0.9 },
  displayCategoryCode: { value: 56137, confidence: 0.7 },
  brand: { value: '브랜드A', confidence: 0.8 },
  salePrice: { value: 20000, confidence: 0.95 },
  originalPrice: { value: 25000, confidence: 0.85 },
  stockQuantity: { value: 100, confidence: 1.0 },
  deliveryChargeType: { value: 'FREE', confidence: 0.9 },
  deliveryCharge: { value: 0, confidence: 1.0 },
  searchTags: { value: ['태그1', '태그2'], confidence: 0.8 },
};

// ── 테스트 ────────────────────────────────────────────────────────────────

describe('POST /api/auto-register/ai-map', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'test-user' });
  });

  // ── 인증 ────────────────────────────────────────────────────────────────

  it('인증 실패 시 401을 반환한다', async () => {
    mockRequireAuth.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await POST(makeRequest({ product: sampleProduct }) as never);
    expect(res.status).toBe(401);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('인증이 필요합니다.');
  });

  // ── 입력 검증 ────────────────────────────────────────────────────────────

  it('유효하지 않은 JSON이면 400을 반환한다', async () => {
    const res = await POST(makeInvalidJsonRequest() as never);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('유효한 JSON 형식이 아닙니다.');
  });

  it('product 필드가 없으면 400을 반환한다', async () => {
    const res = await POST(makeRequest({}) as never);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('product 데이터가 필요합니다.');
  });

  // ── 성공 ─────────────────────────────────────────────────────────────────

  it('정상 요청 시 200과 fields를 반환한다', async () => {
    mockMapProductToCoupangFields.mockResolvedValue(sampleFields);

    const res = await POST(makeRequest({ product: sampleProduct }) as never);
    expect(res.status).toBe(200);
    const data = await res.json() as { fields: MappedCoupangFields };
    expect(data.fields.sellerProductName.value).toBe('테스트 상품명');
    expect(data.fields.salePrice.value).toBe(20000);
  });

  // ── 오류 ─────────────────────────────────────────────────────────────────

  it('AI 매핑 오류 시 500을 반환한다', async () => {
    mockMapProductToCoupangFields.mockRejectedValue(new Error('Claude API Error'));

    const res = await POST(makeRequest({ product: sampleProduct }) as never);
    expect(res.status).toBe(500);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('AI 매핑 중 오류');
  });

  // ── 타임아웃 ─────────────────────────────────────────────────────────────

  it('타임아웃 시 504를 반환한다', async () => {
    // AI_MAP_TIMEOUT_MS(10초)보다 오래 걸리는 것을 시뮬레이션:
    // TIMEOUT 에러를 직접 reject해서 타임아웃 분기를 트리거한다
    mockMapProductToCoupangFields.mockRejectedValue(new Error('TIMEOUT'));

    const res = await POST(makeRequest({ product: sampleProduct }) as never);
    expect(res.status).toBe(504);
    const data = await res.json() as { fields: null; timedOut: boolean };
    expect(data.fields).toBeNull();
    expect(data.timedOut).toBe(true);
  });
});
