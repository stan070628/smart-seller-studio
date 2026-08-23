/**
 * renderAllSections 결과를 상세페이지 본문 컨테이너로 감싼다.
 *
 * ── 왜 별도 모듈인가 ─────────────────────────────────────────
 * 이 래핑은 원래 `/api/detail-page/render`(route.ts) 안에 인라인 한 줄로 있었다.
 * 그래서 **라우트를 거치지 않는 경로에서 통째로 빠졌다** — API 라우트는 전부
 * `requireAuth`라 앱 밖에서 부를 수 없어 스크립트는 `renderAllSections`를 직접
 * import하는데, 그때 이 한 줄을 함께 재현해야 한다는 것이 코드에 드러나 있지 않았다.
 *
 * 2026-08-17 거실화(등록상품ID 16349039276)가 그렇게 나갔다:
 *   appendPrivacyFooter(renderAllSections(sections, THEME, 'export'), 'mobile')
 * 결과로 **본문 폭 래퍼와 font-family가 둘 다 빠졌다.** 폭이 빠지면 본문은 부모 폭을
 * 무제한 따라가는데 고지 푸터만 고정돼 넓은 화면에서 둘이 갈리고(390 대 780),
 * 폰트가 빠지면 마켓플레이스 기본 폰트로 렌더돼 PRO 화면 결과와 다르게 보인다.
 * **둘 다 모바일만 열어보면 발견되지 않는다.**
 *
 * `renderAllSections`는 섹션을 join만 하므로 컨테이너를 만들지 않는다. 그 역할이
 * 여기다 — 렌더 경로가 하나든 열이든 **본문 컨테이너는 이 함수 하나만 만든다.**
 * ────────────────────────────────────────────────────────────
 */
import type { DetailPageTheme, FontStyle } from '@/types/detail-page';

/** fontStyle → CSS font-family. sans와 mixed는 같은 스택을 쓴다. */
export const FONT_FAMILY_MAP: Record<FontStyle, string> = {
  sans:  "'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif",
  serif: "'Batang','HY신명조','Noto Serif KR',Georgia,serif",
  mixed: "'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif",
};

/** 본문 컨테이너 폭. `appendPrivacyFooter`의 푸터 래퍼와 반드시 같은 값이어야 한다. */
export function bodyMaxWidth(layoutMode?: string): string {
  return layoutMode === 'mobile' ? '390px' : '780px';
}

/**
 * 렌더된 섹션 문자열을 본문 컨테이너로 감싼다.
 *
 * 반환값은 `appendPrivacyFooter`에 그대로 넘길 수 있다 — 폭 계산이 같은 규칙을 쓰므로
 * 본문과 고지 푸터가 어긋나지 않는다. **`layoutMode`를 두 함수에 같은 값으로 넘겨라.**
 */
export function wrapRenderedSections(
  renderedSections: string,
  theme: Pick<DetailPageTheme, 'fontStyle' | 'layoutMode'>,
): string {
  const maxWidth = bodyMaxWidth(theme.layoutMode);
  // fontStyle이 없는 테마(스크립트가 직접 만든 부분 테마 등)에서도 유효한 CSS가 나가야 한다.
  const fontFamily = FONT_FAMILY_MAP[theme.fontStyle] ?? FONT_FAMILY_MAP.sans;
  return `<div style="max-width:${maxWidth};margin:0 auto;font-family:${fontFamily};">\n${renderedSections}\n</div>`;
}
