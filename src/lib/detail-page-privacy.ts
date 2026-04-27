/**
 * 상세페이지 하단 고정 이미지 3종
 * 모든 상품 상세페이지 끝에 반드시 포함 (법적 요건 + 고객 안내).
 *
 * 순서: Notice(주문/배송) → Return(반품/CS) → Privacy(개인정보)
 */

const FIXED_IMAGES = [
  'https://mvergrjqfjuwndveztts.supabase.co/storage/v1/object/public/smart-seller-studio/fixed/frame-03-custom_notice.jpg',
  'https://mvergrjqfjuwndveztts.supabase.co/storage/v1/object/public/smart-seller-studio/fixed/frame-01-custom_return_notice.jpg',
  'https://mvergrjqfjuwndveztts.supabase.co/storage/v1/object/public/smart-seller-studio/fixed/frame-02-custom_privacy.jpg',
] as const;

export const PRIVACY_FOOTER_HTML = FIXED_IMAGES.map(
  (src) =>
    `<div style="max-width:780px;margin:0 auto;line-height:0;"><img src="${src}" alt="" style="width:100%;display:block;" /></div>`,
).join('\n');

/**
 * 기존 HTML 끝에 고정 이미지 3종을 붙인다.
 * 이미 포함돼 있으면 중복 삽입하지 않는다.
 */
export function appendPrivacyFooter(html: string): string {
  if (!html) return PRIVACY_FOOTER_HTML;
  // 이미 포함됐는지 첫 번째 이미지 URL로 판단
  if (html.includes(FIXED_IMAGES[0])) return html;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${PRIVACY_FOOTER_HTML}\n</body>`);
  }
  return html + '\n' + PRIVACY_FOOTER_HTML;
}
