import { describe, it, expect } from 'vitest';
import { PRIVACY_FOOTER_HTML, appendPrivacyFooter } from '@/lib/detail-page-privacy';

describe('PRIVACY_FOOTER_HTML', () => {
  it('3개 이미지가 flex 컨테이너 안에 가로로 배치된다', () => {
    expect(PRIVACY_FOOTER_HTML).toContain('display:flex');
    expect(PRIVACY_FOOTER_HTML).toContain('flex:1');
    expect(PRIVACY_FOOTER_HTML).toContain('frame-03-custom_notice.jpg');
    expect(PRIVACY_FOOTER_HTML).toContain('frame-01-custom_return_notice.jpg');
    expect(PRIVACY_FOOTER_HTML).toContain('frame-02-custom_privacy.jpg');
  });

  it('3개의 개별 max-width 래퍼가 아니라 하나의 flex 컨테이너다', () => {
    const divCount = (PRIVACY_FOOTER_HTML.match(/<div/g) ?? []).length;
    // 부모 1개 + 자식 3개 = 4개
    expect(divCount).toBe(4);
  });

  it('appendPrivacyFooter가 flex HTML을 올바르게 추가한다', () => {
    const result = appendPrivacyFooter('<div>상품 설명</div>');
    expect(result).toContain('display:flex');
    expect(result).toContain('상품 설명');
  });

  it('이미 footer가 있으면 중복 삽입하지 않는다', () => {
    const withFooter = appendPrivacyFooter('');
    const result = appendPrivacyFooter(withFooter);
    const count = (result.match(/frame-03-custom_notice/g) ?? []).length;
    expect(count).toBe(1);
  });
});
