/**
 * male-classifier.ts
 * 상품명·카테고리 기반 남성 타겟 분류
 *
 * 반환 등급:
 *   high    (score ≥ 40): "🔵 남성" — 압도적 남성 소비 카테고리
 *   mid     (score ≥ 20): "⚪ 친화"  — 남성 우세 but 혼용 가능
 *   neutral (score < 20): ""          — 중립
 *   female  (score < 0):  "🚫 여성"  — 여성 타겟 키워드 감지
 */

// ─────────────────────────────────────────────────────────────────────────────
// 카테고리 베이스 점수
// ─────────────────────────────────────────────────────────────────────────────

type CategoryTier = 'high' | 'mid_high' | 'neutral';

const MALE_ORIENTED_CATEGORIES: Record<string, CategoryTier> = {
  // 압도적 남성 (90%+)
  낚시: 'high', 캠핑: 'high', 공구: 'high',
  차량용품: 'high', 자동차용품: 'high', DIY: 'high', 골프용품: 'high',
  전자공구: 'high', RC: 'high', 오토바이: 'high',

  // 남성 우세 (60~80%)
  스포츠: 'mid_high', 등산: 'mid_high', 자전거: 'mid_high',
  면도그루밍: 'mid_high', 남성패션잡화: 'mid_high',
  PC주변기기: 'mid_high', 게이밍: 'mid_high', 오디오: 'mid_high',
  헬스용품: 'mid_high', 아웃도어: 'mid_high',
};

// ─────────────────────────────────────────────────────────────────────────────
// 키워드 가중치
// ─────────────────────────────────────────────────────────────────────────────

/** +10점 강력 남성 키워드 */
const STRONG_MALE_KEYWORDS = [
  '남성용', '남자', "men's", '남편', '아빠',
  '낚시', '캠핑', '등산', '골프', '골프공',
  '공구', '수공구', 'diy', '차량용', '카닥터',
  '면도기', '쉐이빙', '수염', '그루밍',
  '지갑', '벨트', '넥타이', '커프스', '시계',
  '헬스기구', '덤벨', '바벨',
  '게이밍', '기계식키보드', '마우스패드',
];

/** +5점 중간 남성 키워드 */
const MEDIUM_MALE_KEYWORDS = [
  '선물용', '기념일', '생일선물',
  '블랙', '메탈', '스틸', '가죽',
  '아웃도어', '오피스', '다용도', '휴대용',
];

/** -15점 여성 타겟 키워드 */
const FEMALE_KEYWORDS = [
  '여성용', '여자', "women's", '엄마', '아내',
  '립스틱', '마스카라', '쿠션팩트', '헤어롤',
  '원피스', '블라우스', '스커트', '레깅스',
  '임산부', '유아', '아동', '키즈',
  '다이어트', '체형보정', '거들',
];

// ─────────────────────────────────────────────────────────────────────────────
// 법적 통신판매 금지 (자동 차단)
// ─────────────────────────────────────────────────────────────────────────────

const LEGAL_BLOCKED_KEYWORDS = [
  '위스키', '양주', '맥주', '와인', '막걸리', '소주',
  '시가', '담배', '전자담배',
  '에어소프트', 'bb탄', '가스건', '모의총포',
];

// ─────────────────────────────────────────────────────────────────────────────
// 셀러 인증·직배송 확인 필요
// ─────────────────────────────────────────────────────────────────────────────

const NEEDS_REVIEW_KEYWORDS = [
  '전동공구', '드릴', '드론', 'rc카',
  '프로틴', '보충제', 'bcaa', '크레아틴',
];

// ─────────────────────────────────────────────────────────────────────────────
// 반환 타입
// ─────────────────────────────────────────────────────────────────────────────

export type MaleTier = 'high' | 'mid' | 'neutral' | 'female';

export interface MaleClassifyResult {
  isMaleTarget: boolean;
  isFemaleTarget: boolean;
  maleScore: number;
  /** 화면 표시 레이블 */
  label: '🔵 남성' | '⚪ 친화' | '' | '🚫 여성';
  tier: MaleTier;
  legalBlocked: boolean;
  needsReview: boolean;
  /** 남성 보너스 점수 (스코어링용: high=5, mid=3, neutral=0) */
  bonusScore: 0 | 3 | 5;
}

// ─────────────────────────────────────────────────────────────────────────────
// 분류 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 상품명과 카테고리 기반 남성 타겟 분류
 *
 * @example
 * classifyMaleTarget('프리미엄 가죽 남성 지갑', '남성패션잡화')
 * // → { tier: 'high', label: '🔵 남성', bonusScore: 5 }
 *
 * classifyMaleTarget('발렌타인 위스키 선물세트', '주류')
 * // → { legalBlocked: true, bonusScore: 0 }
 */
export function classifyMaleTarget(
  productName: string,
  category: string,
): MaleClassifyResult {
  const name = (productName ?? '').toLowerCase();
  const cat  = (category ?? '').toLowerCase();

  // ── 법적 금지 우선 체크 ────────────────────────────────────────────────────
  const legalBlocked = LEGAL_BLOCKED_KEYWORDS.some((kw) => name.includes(kw) || cat.includes(kw));

  // ── 셀러 검토 필요 체크 ────────────────────────────────────────────────────
  const needsReview = NEEDS_REVIEW_KEYWORDS.some((kw) => name.includes(kw) || cat.includes(kw));

  // ── 카테고리 베이스 점수 ───────────────────────────────────────────────────
  // 'high' 카테고리 → +40pts (tier cutoff 40 직접 충족)
  // 'mid_high' 카테고리 → +20pts (tier cutoff 20 직접 충족)
  let score = 0;
  for (const [catKey, tier] of Object.entries(MALE_ORIENTED_CATEGORIES)) {
    if (cat.includes(catKey.toLowerCase())) {
      score += tier === 'high' ? 40 : 20;
      break;
    }
  }

  // ── 키워드 점수 ────────────────────────────────────────────────────────────
  for (const kw of STRONG_MALE_KEYWORDS) {
    if (name.includes(kw)) score += 10;
  }
  for (const kw of MEDIUM_MALE_KEYWORDS) {
    if (name.includes(kw)) score += 5;
  }
  for (const kw of FEMALE_KEYWORDS) {
    if (name.includes(kw)) score -= 15;
  }

  // ── 등급 결정 ──────────────────────────────────────────────────────────────
  if (score < 0) {
    return {
      isMaleTarget: false, isFemaleTarget: true,
      maleScore: score, label: '🚫 여성', tier: 'female',
      legalBlocked, needsReview, bonusScore: 0,
    };
  }

  if (score >= 40) {
    return {
      isMaleTarget: true, isFemaleTarget: false,
      maleScore: score, label: '🔵 남성', tier: 'high',
      legalBlocked, needsReview, bonusScore: 5,
    };
  }

  if (score >= 20) {
    return {
      isMaleTarget: true, isFemaleTarget: false,
      maleScore: score, label: '⚪ 친화', tier: 'mid',
      legalBlocked, needsReview, bonusScore: 3,
    };
  }

  return {
    isMaleTarget: false, isFemaleTarget: false,
    maleScore: score, label: '', tier: 'neutral',
    legalBlocked, needsReview, bonusScore: 0,
  };
}
