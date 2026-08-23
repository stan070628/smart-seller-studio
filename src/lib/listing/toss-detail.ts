/**
 * 토스쇼핑 상세 HTML 보정
 *
 * 🔴 2026-08-11 현재 이 함수로는 문제가 해결되지 않는다. 원인 미규명 상태다.
 *
 * 증상: `DESCRIPTION_HTML`로 넣은 상세가 앱에서 좌우로 분할되어, 텍스트가 한 단어씩
 * 세로로 흐르고 이미지가 화면 밖으로 잘린다. 같은 계정에서 `DESCRIPTION`(이미지 나열)
 * 방식은 정상이므로 HTML 방식 특유의 문제다.
 *
 * 아래 셋을 시도했으나 **모두 무효**였다.
 *   ① 최상위 요소 단일화  ② max-width 고정 px → 100%  ③ display:block 명시
 *
 * 처음에는 "최상위 요소가 여러 개인 것"이 원인이라 보았으나, 최상위가 1개인 예일
 * 후드티(825404659)도 동일하게 깨져 **반증**됐다. 저장본을 조회하면 인라인 style이
 * 원본 그대로 보존돼 있어 sanitization 탓도 아니다.
 *
 * 현재 운영 대응은 `DESCRIPTION` 이미지 방식으로 전환하는 것이고, 토스쇼핑
 * 개발자센터에 렌더링 규격을 문의해 둔 상태다. 답변이 오면 이 함수를 고치거나 폐기한다.
 *
 * 이 함수의 처리는 **해가 되지는 않으므로**(좁은 화면에서 더 안전한 방향) 남겨 두되,
 * 이것만으로 문제가 풀린다고 기대하지 않는다.
 * 상세 생성기(`max-width:780px` 래퍼)는 네이버·쿠팡에서 정상 동작 중이므로 건드리지 않는다.
 */

/** HTML의 최상위 요소 개수를 센다 (div 기준) */
export function countTopLevelDivs(html: string): number {
  let depth = 0;
  let tops = 0;
  for (const m of html.matchAll(/<\/?div\b[^>]*>/g)) {
    if (m[0].startsWith('</')) depth--;
    else {
      if (depth === 0) tops++;
      depth++;
    }
  }
  return tops;
}

export interface FitOptions {
  /** 고정 max-width(px)를 100%로 바꾼다. 기본 false — 근거가 확인된 상품에만 켠다 */
  relaxMaxWidth?: boolean;
}

export interface FitResult {
  html: string;
  /** 보정 전 최상위 요소 수 */
  topLevelBefore: number;
  /** 단일 래퍼로 감쌌는지 */
  wrapped: boolean;
  /** 100%로 바꾼 max-width 개수 */
  relaxedCount: number;
}

/**
 * 토스 앱 폭에 맞게 상세 HTML을 보정한다.
 *
 * @example
 *   const { html } = fitDetailHtmlForToss(naverDetailHtml);
 *   images.push({ type: 'DESCRIPTION_HTML', html, order: '1' });
 */
export function fitDetailHtmlForToss(raw: string, opts: FitOptions = {}): FitResult {
  // 네이버가 남긴 속성 필터링 주석은 토스에서 의미가 없다
  let html = raw.replace(/<!--\s*Not Allowed Attribute Filtered[\s\S]*?-->/g, '');

  let relaxedCount = 0;
  if (opts.relaxMaxWidth) {
    const before = html;
    html = html.replace(/max-width:\s*\d+px/g, 'max-width:100%');
    relaxedCount = (before.match(/max-width:\s*\d+px/g) ?? []).length;
  }

  const topLevelBefore = countTopLevelDivs(html);
  const wrapped = topLevelBefore > 1;
  if (wrapped) {
    // 최상위를 하나로 묶는다. 렌더링 문제를 해결하지는 못했으나(위 주석 참조)
    // 구조를 단순하게 유지하는 편이 안전하다
    html = `<div style="width:100%;box-sizing:border-box;">${html}</div>`;
  }

  return { html, topLevelBefore, wrapped, relaxedCount };
}
