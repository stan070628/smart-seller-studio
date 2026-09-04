// 선형 아이콘 라이브러리 — 손으로 관리하는 로직. 데이터(ICON_PATHS)는
// scripts/gen-icon-library.mjs가 생성하는 ./icon-paths.ts에서 가져온다.
import { ICON_PATHS } from './icon-paths';

export const ICON_KEYS = Object.keys(ICON_PATHS);

// color는 인라인 SVG 속성에 이스케이프 없이 그대로 들어간다. HEX 색상값 또는
// CSS 색상 키워드(currentColor 포함) 형태만 통과시키고, 그 외(따옴표·태그
// 등 주입 시도 포함)는 안전한 기본값으로 대체한다.
const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z-]+)$/;

function sanitizeColor(color: string): string {
  return SAFE_COLOR.test(color) ? color : 'currentColor';
}

/**
 * 유효한 키면 인라인 SVG 문자열, 아니면 null. color는 stroke 색이며
 * 검증에 실패하면 'currentColor'로 대체된다. 여백(margin)은 넣지 않는다 —
 * 배치는 호출부(렌더러)의 책임이다.
 */
export function getIcon(key: string, size = 26, color = 'currentColor'): string | null {
  const inner = ICON_PATHS[key];
  if (!inner) return null;
  const safeColor = sanitizeColor(color);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${safeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">${inner}</svg>`;
}
