/**
 * html-sanitizer.ts
 *
 * 도매꾹 상품상세 HTML을 정제하는 유틸리티.
 * - img src URL 추출
 * - 판매자 연락처·도매꾹 광고 배너 등 불필요 요소 제거
 * - img src URL 치환 (외부 URL → Supabase Storage URL)
 *
 * 서버 전용 — Node.js 런타임에서만 실행됩니다.
 */

// ─────────────────────────────────────────
// img URL 추출
// ─────────────────────────────────────────

/**
 * HTML 문자열에서 모든 <img src="..."> URL을 추출합니다.
 * data: URL과 빈 src는 제외합니다.
 */
export function extractImageUrls(html: string): string[] {
  const urls: string[] = [];
  const regex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const src = match[1];
    if (src && !src.startsWith('data:') && src.trim() !== '') {
      urls.push(src);
    }
  }

  // 중복 제거
  return [...new Set(urls)];
}

// ─────────────────────────────────────────
// 불필요 요소 제거 패턴
// ─────────────────────────────────────────

/** 제거 대상 패턴 목록 */
const SANITIZE_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // 도매꾹 도메인 링크 (배너 등)
  {
    pattern: /<a[^>]*href=["'][^"']*domeggook\.com[^"']*["'][^>]*>[\s\S]*?<\/a>/gi,
    description: '도매꾹 링크',
  },
  // 판매자 전화번호 텍스트 (텍스트 노드 포함 p/span/div)
  {
    pattern: /(?:연락처|문의|전화|TEL|tel|T\.)\s*[:：]?\s*0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/gi,
    description: '판매자 전화번호',
  },
  // 카카오톡 ID / 네이버 톡톡
  {
    pattern: /(?:카카오톡?|카톡|네이버\s*톡톡?|플러스친구|kakao)\s*[:：]?\s*[\w@가-힣_-]+/gi,
    description: '메신저 ID',
  },
  // 이메일 주소
  {
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    description: '이메일',
  },
  // 사업자번호 패턴 (XXX-XX-XXXXX)
  {
    pattern: /\d{3}-\d{2}-\d{5}/g,
    description: '사업자번호',
  },
  // 도매꾹 공급사 추천상품 / 관련상품 영역
  {
    pattern: /(?:상품공급사|공급사|도매꾹)\s*추천상품[\s\S]*?(?=<hr|<div[^>]*style|$)/gi,
    description: '공급사 추천상품 텍스트',
  },
  // zentrade/hgodo 등 도매 플랫폼 배너 이미지
  {
    pattern: /<img[^>]*(?:notice|banner|recommend|bnr)[^>]*>/gi,
    description: '배너/공지 이미지',
  },
];

/**
 * HTML에서 판매자 개인정보, 광고 요소를 제거합니다.
 */
export function sanitizeHtml(html: string): string {
  let result = html;

  for (const { pattern } of SANITIZE_PATTERNS) {
    result = result.replace(pattern, '');
  }

  // 빈 <p>, <div>, <span> 정리
  result = result
    .replace(/<p[^>]*>\s*<\/p>/gi, '')
    .replace(/<div[^>]*>\s*<\/div>/gi, '')
    .replace(/<span[^>]*>\s*<\/span>/gi, '');

  return result.trim();
}

// ─────────────────────────────────────────
// URL 치환
// ─────────────────────────────────────────

/**
 * HTML 내 img src URL을 urlMap에 따라 치환합니다.
 * urlMap: { 원본URL → 새URL }
 * 매핑에 없는 URL(다운로드 실패)은 해당 <img> 태그를 제거합니다.
 */
export function replaceImageUrls(
  html: string,
  urlMap: Map<string, string>,
): string {
  return html.replace(
    /<img([^>]*?)src=["']([^"']+)["']([^>]*)>/gi,
    (_match, before: string, src: string, after: string) => {
      // data: URL은 그대로 유지
      if (src.startsWith('data:')) {
        return `<img${before}src="${src}"${after}>`;
      }

      const newUrl = urlMap.get(src);
      if (!newUrl) {
        // 매핑 없음 = 다운로드 실패 → 태그 제거 (깨진 이미지 방지)
        return '';
      }

      return `<img${before}src="${newUrl}"${after}>`;
    },
  );
}
