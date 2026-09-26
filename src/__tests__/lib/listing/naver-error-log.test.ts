import { describe, it, expect } from 'vitest';
import { naverErrorSummary } from '@/lib/listing/naver-commerce-client';

// M6 — 네이버 오류 응답은 code·message(·invalidInputs의 칸 이름)만 남긴다. 본문 전체를 로그·오류 문구에 싣지 않는다
describe('naverErrorSummary', () => {
  it('JSON 오류는 message·code·invalidInputs만 — 다른 칸(주문 데이터)은 싣지 않는다', () => {
    const s = naverErrorSummary(JSON.stringify({
      code: 'BAD_REQUEST', message: '요청이 잘못됐다',
      invalidInputs: [{ name: 'originProduct.detailAttribute.productCertificationInfos', message: '필수' }],
      data: { ordererName: '테스트구매자', ordererTel: '010-0000-0000' },
    }));
    expect(s).toContain('요청이 잘못됐다');
    expect(s).toContain('BAD_REQUEST');
    // 등록 재시도(registerProduct)가 칸 이름으로 고른다 — 남아야 한다
    expect(s).toContain('productCertificationInfos');
    expect(s).not.toMatch(/테스트구매자|010-0000-0000/);
  });

  it('JSON이 아니면 본문을 싣지 않고 길이만', () => {
    const s = naverErrorSummary('<html>테스트구매자 010-0000-0000</html>');
    expect(s).not.toMatch(/테스트구매자|010-0000-0000|html/);
    expect(s).toMatch(/바이트/);
  });
});
