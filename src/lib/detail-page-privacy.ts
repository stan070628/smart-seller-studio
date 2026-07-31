/**
 * 상세페이지 하단 고정 이미지 3종
 * 모든 상품 상세페이지 끝에 반드시 포함 (법적 요건 + 고객 안내).
 *
 * 순서: Notice(주문/배송) → Return(반품/CS) → Privacy(개인정보)
 *
 * ── 규격 (재제작 시 반드시 지킬 것) ─────────────────────────────
 * 폭은 3장 모두 780px 고정, 높이는 내용에 맞춰 다음 값을 유지한다:
 *   Notice   780×768   Return  780×886   Privacy  780×679   (합계 2,333px)
 * 배경 #D9D9D9 / 본문 #111111 / 보조 텍스트 #4A4A4A.
 *
 * 이 값은 임의로 정한 게 아니다. 원래 3장 모두 780×1100이었는데 본문 사이에
 * 144~368px짜리 빈 구간이 있었고, 세로로 쌓으면 그 여백이 그대로 총 높이에
 * 더해져 상세페이지 최하단에 빈 화면이 길게 남았다. 여백만 걷어낸 결과가
 * 위 높이다(3,300px → 2,333px). 다시 만들 때 세로 여백을 키우면 같은 문제가
 * 재발한다.
 *
 * 소스: docs/assets/notice-frames.html (HTML → 2x 렌더 → 780px 다운스케일).
 * 이미지를 고칠 일이 생기면 그 파일을 수정해 다시 렌더한다.
 * 이전 버전은 Storage의 fixed/archive/ 에 보관돼 있다.
 * ────────────────────────────────────────────────────────────
 */

const FIXED_IMAGES = [
  'https://mvergrjqfjuwndveztts.supabase.co/storage/v1/object/public/smart-seller-studio/fixed/frame-03-custom_notice.jpg',
  'https://mvergrjqfjuwndveztts.supabase.co/storage/v1/object/public/smart-seller-studio/fixed/frame-01-custom_return_notice.jpg',
  'https://mvergrjqfjuwndveztts.supabase.co/storage/v1/object/public/smart-seller-studio/fixed/frame-02-custom_privacy.jpg',
] as const;

function makePrivacyFooterHtml(layoutMode?: string): string {
  const maxWidth = layoutMode === 'mobile' ? '390px' : '780px';
  // 세로 스택 고정. 원본이 780x1100 세로 텍스트 고지라 가로 3분할(flex:1)로 깔면
  // 모바일에서 장당 130px까지 줄어 본문 글자가 2px가 된다 — 법적 고지가 판독
  // 불가능해진다. flex 대신 블록 스택을 쓰는 이유: column + flex:1은 자식 높이를
  // 균등 분배하려 들어 종횡비가 다른 이미지를 왜곡하고, 마켓플레이스가 붙여넣기
  // HTML의 flex를 떨어뜨려도 블록 스택은 그대로 세로로 쌓인다.
  const wrapStyle = `max-width:${maxWidth};margin:0 auto;line-height:0;`;
  return (
    `<div style="${wrapStyle}">` +
    FIXED_IMAGES.map(
      (src) =>
        `<div><img src="${src}" alt="" style="width:100%;display:block;" /></div>`,
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
