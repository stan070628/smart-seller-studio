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

/**
 * 신발 카테고리 전용 안내 (780×764).
 *
 * 고정 3종과 달리 **모든 상품에 붙이지 않는다.** 신발은 박스 훼손·택 제거가
 * 곧 재판매 불가로 이어져 반품 1건이 정상 판매 2건의 이익을 지우는데, 이 손실
 * 구조가 신발에만 있기 때문이다. 세차타월에 "밑창 흔적" 안내가 붙으면 고지가
 * 아니라 잡음이 된다.
 *
 * 소스는 고정 3종과 같은 docs/assets/notice-frames.html의 #shoes 패널이다.
 */
export const SHOES_NOTICE_IMAGE =
  'https://mvergrjqfjuwndveztts.supabase.co/storage/v1/object/public/smart-seller-studio/fixed/frame-04-custom_shoes.jpg';

/** 내부 별칭 — 아래 함수들이 쓰는 이름을 짧게 유지한다. */
const SHOES_IMAGE = SHOES_NOTICE_IMAGE;

/** 이미지를 세로로 쌓는 래퍼. 고정 3종과 신발 안내가 같은 규격을 쓴다. */
function makeImageStack(images: readonly string[], layoutMode?: string): string {
  const maxWidth = layoutMode === 'mobile' ? '390px' : '780px';
  // 세로 스택 고정. 원본이 780x1100 세로 텍스트 고지라 가로 3분할(flex:1)로 깔면
  // 모바일에서 장당 130px까지 줄어 본문 글자가 2px가 된다 — 법적 고지가 판독
  // 불가능해진다. flex 대신 블록 스택을 쓰는 이유: column + flex:1은 자식 높이를
  // 균등 분배하려 들어 종횡비가 다른 이미지를 왜곡하고, 마켓플레이스가 붙여넣기
  // HTML의 flex를 떨어뜨려도 블록 스택은 그대로 세로로 쌓인다.
  const wrapStyle = `max-width:${maxWidth};margin:0 auto;line-height:0;`;
  return (
    `<div style="${wrapStyle}">` +
    images
      .map(
        (src) =>
          `<div><img src="${src}" alt="" style="width:100%;display:block;" /></div>`,
      )
      .join('') +
    `</div>`
  );
}

function makePrivacyFooterHtml(layoutMode?: string): string {
  return makeImageStack(FIXED_IMAGES, layoutMode);
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

/**
 * 신발 상품 상세페이지에 신발 전용 안내를 붙인다.
 *
 * 고정 3종 **앞**에 들어간다. 순서는 상품 안내 → 주문/배송 → 반품/CS → 개인정보다.
 * 박스와 택을 어떻게 다뤄야 하는지는 반품을 신청한 뒤에 읽으면 늦어서, 법적 고지
 * 3종보다 앞에 둔다.
 *
 * appendPrivacyFooter와 호출 순서가 무관하다 — 3종이 이미 붙어 있으면 그 컨테이너
 * 앞에 끼워 넣고, 아직 없으면 본문 끝에 붙인다. AssetsTab처럼 appendPrivacyFooter를
 * 먼저 부르는 경로가 여럿이라 순서를 강제하면 그 경로마다 신발 안내가 빠진다.
 */
export function appendShoesNotice(html: string, layoutMode?: string): string {
  const block = makeImageStack([SHOES_IMAGE], layoutMode);
  if (!html) return block;
  if (html.includes(SHOES_IMAGE)) return html;

  const footerIdx = html.indexOf(FIXED_IMAGES[0]);
  if (footerIdx === -1) {
    // 고정 3종이 아직 없다. 본문 끝에 붙이면 이후 appendPrivacyFooter가 뒤에 쌓는다.
    if (html.includes('</body>')) {
      return html.replace('</body>', `${block}\n</body>`);
    }
    return html + '\n' + block;
  }

  // 고정 3종이 이미 있다. 그 래퍼 div 시작 지점을 찾아 바로 앞에 끼워 넣는다.
  const wrapIdx = html.lastIndexOf('<div style="max-width:', footerIdx);
  if (wrapIdx === -1) return html + '\n' + block;
  return html.slice(0, wrapIdx) + block + '\n' + html.slice(wrapIdx);
}
