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

function makePrivacyFooterHtml(layoutMode?: string): string {
  const maxWidth = layoutMode === 'mobile' ? '390px' : '780px';
  const wrapStyle = `max-width:${maxWidth};margin:0 auto;display:flex;flex-direction:row;gap:0;line-height:0;`;
  return (
    `<div style="${wrapStyle}">` +
    FIXED_IMAGES.map(
      (src) =>
        `<div style="flex:1;min-width:0;"><img src="${src}" alt="" style="width:100%;display:block;" /></div>`,
    ).join('') +
    `</div>`
  );
}

export const PRIVACY_FOOTER_HTML = makePrivacyFooterHtml();

/**
 * 기존 HTML 끝에 고정 이미지 3종을 붙인다.
 * 이미 포함돼 있으면 중복 삽입하지 않는다.
 */
export function appendPrivacyFooter(html: string, layoutMode?: string): string {
  const footerHtml = makePrivacyFooterHtml(layoutMode);
  if (!html) return footerHtml;
  // 이미 포함됐는지 첫 번째 이미지 URL로 판단
  if (html.includes(FIXED_IMAGES[0])) return html;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${footerHtml}\n</body>`);
  }
  return html + '\n' + footerHtml;
}
