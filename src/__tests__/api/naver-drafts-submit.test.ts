/**
 * naver-drafts-submit.test.ts
 * POST /api/listing/naver/drafts/[id]/submit
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// 네이버 클라이언트 Mock
const mockRegisterProduct = vi.fn();
const mockUploadImagesFromUrls = vi.fn();

vi.mock('@/lib/listing/naver-commerce-client', () => ({
  getNaverCommerceClient: vi.fn(() => ({
    registerProduct: mockRegisterProduct,
    uploadImagesFromUrls: mockUploadImagesFromUrls,
  })),
}));

// Supabase Mock
const mockSingle = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelect,
      update: mockUpdate,
    })),
  })),
}));

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-123' }),
}));

const VALID_DRAFT_DATA = {
  name: '테스트 선풍기',
  leafCategoryId: '50000795',
  salePrice: 29900,
  stock: 100,
  thumbnailImages: ['https://supabase.co/storage/v1/img1.jpg'],
  detailHtml: '<div>상세 설명</div>',
  tags: ['선풍기', '여름가전'],
  deliveryCharge: 0,
  returnCharge: 4000,
};

describe('POST /api/listing/naver/drafts/[id]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // draft 조회 성공 — eq 체인 끝에서 single() 접근 가능하도록 설정
    mockEq.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
    });

    mockSelect.mockReturnValue({ eq: mockEq });

    mockSingle.mockResolvedValue({
      data: {
        id: 'draft-1',
        user_id: 'user-123',
        product_name: '테스트 선풍기',
        draft_data: VALID_DRAFT_DATA,
        status: 'draft',
      },
      error: null,
    });

    // 이미지 업로드 성공
    mockUploadImagesFromUrls.mockResolvedValue(['https://shop-phinf.naver.com/img1.jpg']);

    // 상품 등록 성공
    mockRegisterProduct.mockResolvedValue({
      originProductNo: 987654321,
      smartstoreChannelProductNo: 111222333,
    });

    // draft 업데이트 성공
    mockUpdate.mockReturnValue({ eq: mockEq });
  });

  it('성공 시 originProductNo를 반환한다', async () => {
    const { POST } = await import('@/app/api/listing/naver/drafts/[id]/submit/route');
    const req = new NextRequest('http://localhost/api/listing/naver/drafts/draft-1/submit', {
      method: 'POST',
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'draft-1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.originProductNo).toBe(987654321);
  });

  it('이미 제출된 draft는 409를 반환한다', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'draft-1', user_id: 'user-123', draft_data: VALID_DRAFT_DATA, status: 'submitted' },
      error: null,
    });

    const { POST } = await import('@/app/api/listing/naver/drafts/[id]/submit/route');
    const req = new NextRequest('http://localhost/api/listing/naver/drafts/draft-1/submit', {
      method: 'POST',
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'draft-1' }) });

    expect(res.status).toBe(409);
  });

  it('이미지 업로드가 모두 실패하면 422를 반환한다', async () => {
    mockUploadImagesFromUrls.mockResolvedValueOnce([]);

    const { POST } = await import('@/app/api/listing/naver/drafts/[id]/submit/route');
    const req = new NextRequest('http://localhost/api/listing/naver/drafts/draft-1/submit', {
      method: 'POST',
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'draft-1' }) });

    expect(res.status).toBe(422);
  });
});
