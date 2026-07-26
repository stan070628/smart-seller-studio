import { describe, it, expect } from 'vitest';
import { PRIVACY_FOOTER_HTML, appendPrivacyFooter } from '@/lib/detail-page-privacy';

describe('PRIVACY_FOOTER_HTML', () => {
  it('3개 이미지가 세로로 쌓이고 각각 전체 폭을 쓴다', () => {
    // 원본이 780x1100 세로 텍스트 고지라 가로 3분할은 모바일에서 장당 130px까지
    // 줄어 글자가 판독 불가능해진다. 가로 배치를 되살리는 회귀를 여기서 막는다.
    expect(PRIVACY_FOOTER_HTML).not.toContain('display:flex');
    expect(PRIVACY_FOOTER_HTML).not.toContain('flex:1');
    expect(PRIVACY_FOOTER_HTML).toContain('width:100%');
    expect(PRIVACY_FOOTER_HTML).toContain('frame-03-custom_notice.jpg');
    expect(PRIVACY_FOOTER_HTML).toContain('frame-01-custom_return_notice.jpg');
    expect(PRIVACY_FOOTER_HTML).toContain('frame-02-custom_privacy.jpg');
  });

  it('3개의 개별 max-width 래퍼가 아니라 하나의 컨테이너다', () => {
    const divCount = (PRIVACY_FOOTER_HTML.match(/<div/g) ?? []).length;
    // 부모 1개 + 자식 3개 = 4개
    expect(divCount).toBe(4);
    expect((PRIVACY_FOOTER_HTML.match(/max-width:/g) ?? []).length).toBe(1);
  });

  it('appendPrivacyFooter가 기존 HTML 뒤에 footer를 붙인다', () => {
    const result = appendPrivacyFooter('<div>상품 설명</div>');
    expect(result).toContain('frame-03-custom_notice.jpg');
    expect(result).toContain('상품 설명');
  });

  it('이미 footer가 있으면 중복 삽입하지 않는다', () => {
    const withFooter = appendPrivacyFooter('');
    const result = appendPrivacyFooter(withFooter);
    const count = (result.match(/frame-03-custom_notice/g) ?? []).length;
    expect(count).toBe(1);
  });
});
