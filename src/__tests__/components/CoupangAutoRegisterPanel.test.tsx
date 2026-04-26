import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { buildDraftData } from '@/components/listing/workflow/CoupangAutoRegisterPanel';
import CoupangAutoRegisterPanel from '@/components/listing/workflow/CoupangAutoRegisterPanel';

// useListingStore mock
vi.mock('@/store/useListingStore', () => ({
  useListingStore: () => ({
    sharedDraft: {
      name: '도매꾹 상품',
      salePrice: '12000',
      originalPrice: '15000',
      thumbnailImages: ['https://img.domeggook.com/thumb.jpg'],
      detailImages: ['https://img.domeggook.com/detail.jpg'],
      pickedDetailImages: [],
      description: '<p>상세설명</p>',
      tags: ['가전', 'USB'],
      coupangCategoryCode: '',
      coupangCategoryPath: '',
      categoryHint: '생활가전',
      deliveryChargeType: 'FREE',
      deliveryCharge: '0',
      stock: '100',
    },
  }),
}));

describe('CoupangAutoRegisterPanel 컴포넌트', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('ai-map')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              fields: {
                sellerProductName: { value: '도매꾹 상품 AI', confidence: 0.9 },
                displayCategoryCode: { value: 78780, confidence: 0.7 },
                brand: { value: '기타', confidence: 0.5 },
                salePrice: { value: 12000, confidence: 0.9 },
                originalPrice: { value: 15000, confidence: 0.9 },
                stockQuantity: { value: 100, confidence: 0.9 },
                deliveryChargeType: { value: 'FREE', confidence: 0.9 },
                deliveryCharge: { value: 0, confidence: 0.9 },
                searchTags: { value: ['가전', 'USB'], confidence: 0.8 },
              },
            }),
        });
      }
      if (url.includes('delivery-defaults')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ outboundShippingPlaceCode: 'OUT001', returnCenterCode: 'RET001' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('마운트 시 AI 매핑과 배송 기본값을 로드한다', async () => {
    render(<CoupangAutoRegisterPanel onSuccess={() => {}} />);

    // AI 매핑 로딩 배너 표시
    expect(screen.getByText(/AI 필드 매핑/)).toBeInTheDocument();

    // 매핑 완료 후 fetch가 호출됨
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('ai-map'),
        expect.any(Object),
      );
    });
  });

  it('sharedDraft.name으로 상품명 input이 초기화된다', async () => {
    render(<CoupangAutoRegisterPanel onSuccess={() => {}} />);
    // sharedDraft.name 값으로 초기화됨
    expect(screen.getByDisplayValue('도매꾹 상품')).toBeInTheDocument();
  });
});

describe('buildDraftData', () => {
  it('필수 필드를 올바르게 매핑한다', () => {
    const result = buildDraftData({
      name: '테스트 상품',
      categoryCode: '78780',
      brand: '기타',
      manufacturer: '',
      salePrice: 15000,
      originalPrice: 20000,
      stock: 100,
      thumbnail: 'https://example.com/img.jpg',
      detailHtml: '<p>상세</p>',
      deliveryChargeType: 'FREE',
      deliveryCharge: 0,
      outboundCode: 'ABC123',
      returnCode: 'DEF456',
      notices: [{ categoryName: '의류', detailName: '제조국', content: '대한민국' }],
      tags: ['태그1', '태그2'],
      detailImages: [],
    });

    expect(result.name).toBe('테스트 상품');
    expect(result.categoryCode).toBe('78780');
    expect(result.brand).toBe('기타');
    expect(result.salePrice).toBe(15000);
    expect(result.originalPrice).toBe(20000);
    expect(result.stock).toBe(100);
    expect(result.thumbnail).toBe('https://example.com/img.jpg');
    expect(result.deliveryChargeType).toBe('FREE');
    expect(result.notices).toHaveLength(1);
    expect(result.tags).toEqual(['태그1', '태그2']);
  });

  it('originalPrice가 salePrice보다 작으면 salePrice × 1.25로 보정한다', () => {
    const result = buildDraftData({
      name: '상품',
      categoryCode: '1',
      brand: '',
      manufacturer: '',
      salePrice: 10000,
      originalPrice: 5000, // salePrice보다 작음
      stock: 50,
      thumbnail: '',
      detailHtml: '',
      deliveryChargeType: 'FREE',
      deliveryCharge: 0,
      outboundCode: '',
      returnCode: '',
      notices: [],
      tags: [],
      detailImages: [],
    });

    expect(result.originalPrice).toBe(13000); // ceil(10000 * 1.25 / 1000) * 1000
  });

  it('thumbnail이 없으면 detailImages 첫 번째를 폴백으로 사용한다', () => {
    const result = buildDraftData({
      name: '상품',
      categoryCode: '1',
      brand: '',
      manufacturer: '',
      salePrice: 10000,
      originalPrice: 12000,
      stock: 50,
      thumbnail: '', // 없음
      detailHtml: '',
      deliveryChargeType: 'FREE',
      deliveryCharge: 0,
      outboundCode: '',
      returnCode: '',
      notices: [],
      tags: [],
      detailImages: ['https://example.com/detail.jpg'],
    });

    expect(result.thumbnail).toBe('https://example.com/detail.jpg');
  });
});
