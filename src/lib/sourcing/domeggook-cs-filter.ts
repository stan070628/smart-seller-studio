/**
 * domeggook-cs-filter.ts
 * CS(고객 서비스) 위험 카테고리 분류
 *
 * 고위험(high): 식품, 의약품, 건강기능식품, 유아용품, 전기·전자 (KC인증 필수품)
 * 중위험(medium): 의류, 화장품, 스포츠 (교환/반품 비율 높음)
 * 저위험(low): 생활용품, 문구, 가전 액세서리 등
 */

export type CsRiskLevel = 'low' | 'medium' | 'high';

interface CsRiskResult {
  level: CsRiskLevel;
  reason: string | null;
}

/** 고위험 카테고리 키워드 */
const HIGH_RISK_KEYWORDS = [
  '식품', '식음료', '과자', '음료', '주류', '유제품', '육류', '수산물', '농산물',
  '의약품', '의료기기', '건강기능', '건강식품', '영양제', '비타민',
  '유아', '아기', '신생아', '육아', '완구', '장난감',
  '전기용품', '생활가전', '주방가전',
];

/** 중위험 카테고리 키워드 */
const MEDIUM_RISK_KEYWORDS = [
  '의류', '패션', '의복', '패딩', '자켓', '코트', '셔츠', '바지', '치마',
  '화장품', '뷰티', '스킨케어', '헤어케어', '메이크업',
  '스포츠', '헬스', '운동',
  '속옷', '수영복',
];

/**
 * 카테고리명으로 CS 위험 등급 결정
 */
export function getCsRisk(categoryName: string | null): CsRiskResult {
  if (!categoryName) return { level: 'low', reason: null };

  const cat = categoryName.toLowerCase();

  for (const kw of HIGH_RISK_KEYWORDS) {
    if (cat.includes(kw.toLowerCase())) {
      return { level: 'high', reason: `고위험 카테고리: ${kw}` };
    }
  }

  for (const kw of MEDIUM_RISK_KEYWORDS) {
    if (cat.includes(kw.toLowerCase())) {
      return { level: 'medium', reason: `중위험 카테고리: ${kw}` };
    }
  }

  return { level: 'low', reason: null };
}

/** CS 위험 등급 한국어 레이블 */
export const CS_RISK_LABEL: Record<CsRiskLevel, { label: string; color: string; bg: string }> = {
  high:   { label: '고위험', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.08)' },
  medium: { label: '중위험', color: '#d97706', bg: 'rgba(217, 119, 6, 0.08)' },
  low:    { label: '안전',   color: '#16a34a', bg: 'rgba(22, 163, 74, 0.08)' },
};
