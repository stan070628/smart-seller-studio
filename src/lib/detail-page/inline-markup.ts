// src/lib/detail-page/inline-markup.ts
// **텍스트** → accent 색+bold+110%, ==텍스트== → 배경 형광펜
// XSS 안전: 모든 텍스트 세그먼트에 escapeHtml 적용

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// hex → "R,G,B" (rgba() 용, 구형 웹뷰 8자리 hex 미지원 대응)
function hexToRgb(hex: string): string {
  const clean = hex.replace(/^#/, '');
  if (clean.length !== 6) return '0,0,0';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '0,0,0';
  return `${r},${g},${b}`;
}

/**
 * raw 텍스트의 **...** / ==...== 마커를 HTML span으로 변환.
 * 각 세그먼트는 개별 escapeHtml 처리.
 *
 * **72시간** → <span style="color:{accent};font-weight:700;font-size:110%;">72시간</span>
 * ==장벽 강화== → <span style="background:rgba(R,G,B,0.2);padding:0 2px;">장벽 강화</span>
 */
export function renderInlineMarkup(rawText: string, accent: string): string {
  const rgb = hexToRgb(accent);
  let result = '';
  let text = rawText;

  while (text.length > 0) {
    const boldStart = text.indexOf('**');
    const hlStart = text.indexOf('==');

    if (boldStart === -1 && hlStart === -1) {
      result += escapeHtml(text);
      break;
    }

    const isBold =
      boldStart !== -1 && (hlStart === -1 || boldStart <= hlStart);
    const markerStart = isBold ? boldStart : hlStart;
    const marker = isBold ? '**' : '==';

    result += escapeHtml(text.slice(0, markerStart));
    text = text.slice(markerStart + 2);

    const closeIdx = text.indexOf(marker);
    if (closeIdx === -1) {
      // 닫는 마커 없으면 열린 마커를 평문으로
      result += escapeHtml(marker);
      continue;
    }

    const inner = text.slice(0, closeIdx);
    text = text.slice(closeIdx + 2);

    if (isBold) {
      result += `<span style="color:${escapeHtml(accent)};font-weight:700;font-size:110%;">${escapeHtml(inner)}</span>`;
    } else {
      result += `<span style="background:rgba(${rgb},0.2);padding:0 2px;">${escapeHtml(inner)}</span>`;
    }
  }

  return result;
}

/**
 * data-edit-path span으로 감싸는 마크업 필드 전용 editableText.
 * editableText() 대신 마크업 적용 대상 필드에서만 사용.
 */
export function editableMarkupText(path: string, rawValue: string, accent: string): string {
  return `<span data-edit-path="${escapeHtml(path)}">${renderInlineMarkup(rawValue, accent)}</span>`;
}
