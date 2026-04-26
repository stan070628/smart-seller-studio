import { buildDraftData } from '@/components/listing/workflow/CoupangAutoRegisterPanel';

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
