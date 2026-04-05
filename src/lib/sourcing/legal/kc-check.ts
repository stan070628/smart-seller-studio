/**
 * Layer 1: KC 인증 체크
 *
 * 도매꾹 API detail.safetyCert 필드 우선 파싱
 * 인증 정보 없으면 상품명 키워드로 KC 의무 여부 판별
 *
 * RED(BLOCK) / YELLOW(WARN) / GREEN(PASS)
 */

import type { LegalIssue } from './types';

// ─── KC 의무 품목 키워드 (전기용품안전관리법, 어린이제품안전특별법 등) ───
const KC_REQUIRED_KEYWORDS = [
  // 어린이 제품 (어린이제품안전특별법)
  '유아용', '아기용', '어린이용', '키즈', '유아', '아동', '장난감',
  '젖병', '젖꼭지', '보행기', '카시트', '유모차', '아기띠',
  // 전기용품 (전기용품안전관리법)
  '충전기', '어댑터', 'USB충전', '전원코드', '멀티탭', '콘센트',
  '전기장판', '전기히터', '가습기', '제습기', '선풍기', '전기포트',
  '전기밥솥', '전자레인지', '헤어드라이기', '드라이어', '다리미',
  // 생활용품 (생활용품안전관리법)
  '헬멧', '안전모', '무릎보호대', '보호장비',
  // 식품용 용기 (식품위생법)
  '식품용기', '밀폐용기', '텀블러', '물병', '수저', '도마',
] as const;

// KC 의무이지만 인증 없어도 경고 수준인 품목 (YELLOW)
const KC_WARN_KEYWORDS = [
  'LED', '램프', '조명', '전구', '보조배터리', '이어폰', '헤드폰',
  '마우스', '키보드', '스피커', '리모컨',
] as const;

export function checkKcCertification(
  title: string,
  safetyCert?: string | null,
): LegalIssue | null {
  const titleLower = title.toLowerCase();

  // safetyCert가 있으면 PASS
  if (safetyCert && safetyCert.trim().length > 0) {
    return null; // GREEN — 이슈 없음
  }

  // RED: KC 필수 품목인데 인증 정보 없음 → BLOCK
  for (const kw of KC_REQUIRED_KEYWORDS) {
    if (titleLower.includes(kw.toLowerCase())) {
      return {
        layer: 'kc',
        severity: 'RED',
        code: 'KC_REQUIRED_NO_CERT',
        message: `KC 인증 필수 품목이나 인증 정보가 없습니다 (키워드: ${kw})`,
        detail: { keyword: kw, safetyCert: null },
      };
    }
  }

  // YELLOW: 인증 권장 품목 → WARN
  for (const kw of KC_WARN_KEYWORDS) {
    if (titleLower.includes(kw.toLowerCase())) {
      return {
        layer: 'kc',
        severity: 'YELLOW',
        code: 'KC_RECOMMENDED',
        message: `KC 인증 권장 품목입니다. 인증 여부를 확인하세요 (키워드: ${kw})`,
        detail: { keyword: kw, safetyCert: null },
      };
    }
  }

  // GREEN: 해당 없음
  return null;
}
