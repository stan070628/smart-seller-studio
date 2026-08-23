import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/listing/naver-commerce-client', () => ({
  getNaverCommerceClient: vi.fn(),
}));

import { fetchNoticeSpecs, mergeSpecs } from '@/lib/listing/fetch-notice-specs';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';

const mockClient = (detail: unknown) => {
  (getNaverCommerceClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    getProductDetail: vi.fn().mockResolvedValue(detail),
  });
};

describe('fetchNoticeSpecs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('네이버 고시정보를 productSpecs로 가져온다', async () => {
    mockClient({
      originProduct: {
        detailAttribute: {
          productInfoProvidedNotice: {
            productInfoProvidedNoticeType: 'COSMETIC',
            cosmetic: { capacity: '150g', producer: '대한민국', usage: '세안 후 사용', returnCostReason: '0' },
          },
        },
      },
    });
    const { specs, error } = await fetchNoticeSpecs({ channel: 'naver', productNo: 123 });
    expect(error).toBeUndefined();
    expect(specs.map(s => s.label)).toEqual(expect.arrayContaining(['용량', '제조국', '사용법(제조사 표기)']));
  });

  it('고시정보가 없으면 빈 배열과 사유를 준다 — 생성은 계속되어야 한다', async () => {
    mockClient({ originProduct: { detailAttribute: {} } });
    const { specs, error } = await fetchNoticeSpecs({ channel: 'naver', productNo: 123 });
    expect(specs).toEqual([]);
    expect(error).toBe('고시정보 없음');
  });

  it('조회가 실패해도 예외를 던지지 않는다', async () => {
    (getNaverCommerceClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      getProductDetail: vi.fn().mockRejectedValue(new Error('401 인증 실패')),
    });
    const { specs, error } = await fetchNoticeSpecs({ channel: 'naver', productNo: 123 });
    expect(specs).toEqual([]);
    expect(error).toContain('401');
  });
});

describe('mergeSpecs', () => {
  it('판매자가 직접 넣은 값이 고시정보보다 우선한다', () => {
    const merged = mergeSpecs(
      [{ label: '용량', value: '150g (직접 입력)' }],
      [{ label: '용량', value: '150g x 2ea' }, { label: '제조국', value: '대한민국' }],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].value).toBe('150g (직접 입력)');
    expect(merged[1].label).toBe('제조국');
  });

  it('명시 스펙이 없으면 고시정보만 쓴다', () => {
    expect(mergeSpecs(undefined, [{ label: '용량', value: '150g' }])).toHaveLength(1);
  });
});
