/**
 * costco-scoring.ts — v2
 * 코스트코 사입 모델 7개 항목 + 보너스 종합 점수 계산
 *
 * 기본 배점 (100점):
 *   법적·IP 안전성   15점  ← 도매꾹 20점에서 하향 (정품 브랜드라 법적 리스크 낮음)
 *   가격 경쟁력      25점  ← 도매꾹 20점에서 상향 (사입 자본 회수 핵심)
 *   CS 안전성        10점  ← 도매꾹 15점에서 하향 (정품이라 CS 부담 상대적으로 낮음)
 *   마진 안전성      20점  ← 도매꾹 15점에서 상향 (자본 회수 리스크)
 *   수요 신호        15점  ← 도매꾹과 동일
 *   재고 회전 속도   10점  ← 사입 모델 신규 항목 (재고 적체 리스크)
 *   공급 안정성       5점  ← 도매꾹 10점에서 하향 (코스트코 자체가 안정적 공급원)
 *   ──────────────────────
 *   기본 합계       100점
 *
 * 보너스 (110점 캡):
 *   남성 타겟    high=5, mid=3, neutral=0
 *   시즌 가산점  0~10 (최대 1개 시즌)
 *   별표 상품    +5 (코스트코 단종·희소 상품 — 가격표 * 표시)
 */

import { getCsRisk, type CsRiskLevel } from './domeggook-cs-filter';
import { classifyMaleTarget, type MaleTier } from './shared/male-classifier';
import { getSeasonBonus } from './shared/season-bonus';
import { getGrade, type GradeInfo } from './shared/grade';

// ─────────────────────────────────────────────────────────────────────────────
// 입력 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface CostcoScoreInput {
  // 법적·IP 안전성
  /** 'safe' | 'blocked' | 'unchecked' */
  legalStatus: 'safe' | 'blocked' | 'unchecked';
  /** 'low' | 'medium' | 'high' | null (미검사) */
  ipRiskLevel: 'low' | 'medium' | 'high' | null;

  // 가격 경쟁력
  /** 시장가 대비 격차율 (%). (시장가 - 추천가) / 시장가 × 100. null = 데이터 없음 */
  vsMarket: number | null;

  // CS 안전성
  categoryName: string | null;

  // 마진 안전성
  /** 순이익률 (%). null = 데이터 없음 */
  realMarginRate: number | null;

  // 수요 신호
  /** 최근 7일 판매량 (재고 감소분 추정) */
  weeklySales: number;
  /** 일평균 판매량 */
  dailyAvg: number;

  // 재고 회전 속도
  /** 사입 예정 수량 (미지정 시 기본값 10개) */
  expectedStock?: number;

  // 공급 안정성
  /** 'inStock' | 'lowStock' | 'outOfStock' */
  stockStatus: 'inStock' | 'lowStock' | 'outOfStock' | string;

  // 보너스 — 상품명 제공 시 자동 계산
  /** 상품명 (남성 분류 + 시즌 가산점 자동 계산용) */
  title?: string;
  /** 기준 날짜 (테스트용. 기본값: 오늘) */
  today?: Date;
  /** 코스트코 별표(*) 상품 여부 — 단종·희소 기회 상품 +5점 */
  hasAsterisk?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 결과 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface CostcoScoreResult {
  /** 7개 기본 항목 합산 (0~100) */
  baseTotal: number;
  /** 남성 타겟 보너스 (0, 3, 5) */
  maleBonus: number;
  /** 시즌 가산점 (0~10) */
  seasonBonus: number;
  /** 별표 상품 보너스 (0 or 5) */
  asteriskBonus: number;
  /** 최종 점수 = min(baseTotal + maleBonus + seasonBonus + asteriskBonus, 110) */
  total: number;

  // 항목별 점수
  legalIp: number;
  priceComp: number;
  csSafety: number;
  margin: number;
  demand: number;
  turnover: number;
  supply: number;

  // 등급 정보
  gradeInfo: GradeInfo;

  // 보너스 세부
  maleTier: MaleTier | null;
  matchedSeasons: string[];

  // CS 위험 정보
  csRiskLevel: CsRiskLevel;
  csRiskReason: string | null;

  /** 차단 사유 (차단 조건 충족 시 설정, null = 정상) */
  blockedReason: string | null;
  /** 셀러 검토 필요 여부 (전동공구·보충제 등) */
  needsReview: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 항목별 점수 계산 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 법적·IP 점수 (0~15)
 * 도매꾹보다 5점 낮음 — 코스트코 정품 브랜드라 법적 리스크 기본적으로 낮음
 */
function scoreLegalIp(
  legalStatus: CostcoScoreInput['legalStatus'],
  ipRiskLevel: CostcoScoreInput['ipRiskLevel'],
): number {
  const legalScore =
    legalStatus === 'safe'      ? 9 :
    legalStatus === 'unchecked' ? 2 :
    0; // blocked

  const ipScore =
    ipRiskLevel === 'low'    ? 6 :
    ipRiskLevel === 'medium' ? 3 :
    ipRiskLevel === 'high'   ? 0 :
    1; // null = 미검사

  return legalScore + ipScore;
}

/**
 * 가격 경쟁력 점수 (0~25)
 * 도매꾹보다 5점 높음 — 사입 자본 회수 핵심 지표
 * vsMarket = (시장가 - 추천가) / 시장가 × 100
 */
function scorePriceComp(vsMarket: number | null): number {
  if (vsMarket === null) return 10; // 데이터 없음 → 중립 점수
  if (vsMarket >= 20)   return 25;
  if (vsMarket >= 10)   return 19;
  if (vsMarket >= 5)    return 13;
  if (vsMarket >= 0)    return 6;
  return 0; // 시장가 초과 (isOverprice)
}

/**
 * CS 안전성 점수 (0~10)
 * 도매꾹보다 5점 낮음 — 코스트코 정품이라 CS 부담 상대적으로 낮음
 */
function scoreCsSafety(csRisk: CsRiskLevel): number {
  if (csRisk === 'low')    return 10;
  if (csRisk === 'medium') return 6;
  return 0; // high
}

/**
 * 마진 안전성 점수 (0~20)
 * 도매꾹 15점에서 상향 — 사입 자본 회수 리스크 반영
 * realMarginRate: 순이익률 (%)
 */
function scoreMargin(realMarginRate: number | null): number {
  if (realMarginRate === null) return 5; // 데이터 없음 → 보수적 중립
  if (realMarginRate >= 20)   return 20;
  if (realMarginRate >= 15)   return 16;
  if (realMarginRate >= 10)   return 11;
  if (realMarginRate >= 5)    return 5;
  return 0;
}

/**
 * 수요 신호 점수 (0~15)
 * 7일 판매량(s1) + 일평균(s2) 조합 — 도매꾹과 동일 배점
 */
function scoreDemand(weeklySales: number, dailyAvg: number): number {
  let s1 = 0;
  if (weeklySales >= 50) s1 = 10;
  else if (weeklySales >= 20) s1 = 7;
  else if (weeklySales >= 10) s1 = 5;
  else if (weeklySales >= 5)  s1 = 3;
  else if (weeklySales >= 1)  s1 = 1;

  let s2 = 0;
  if (dailyAvg >= 5)    s2 = 5;
  else if (dailyAvg >= 1)   s2 = 3;
  else if (dailyAvg >= 0.3) s2 = 1;

  return Math.min(s1 + s2, 15);
}

/**
 * 재고 회전 속도 점수 (0~10) — 코스트코 사입 모델 전용 신규 항목
 * "사입하면 얼마나 빨리 팔리는가" — 재고 적체 리스크 역방향 지표
 *
 * daysToSell = (expectedStock / weeklySales) × 7
 */
function scoreInventoryTurnover(weeklySales: number, expectedStock: number): number {
  if (weeklySales <= 0) return 0;

  const daysToSell = (expectedStock / weeklySales) * 7;

  if (daysToSell <= 14) return 10; // 2주 내 소진
  if (daysToSell <= 30) return 8;  // 1개월 내
  if (daysToSell <= 60) return 5;  // 2개월 내
  if (daysToSell <= 90) return 2;  // 3개월 내
  return 0;                        // 3개월+ 적체 위험
}

/**
 * 공급 안정성 점수 (0~5)
 * 도매꾹 10점에서 하향 — 코스트코 자체가 안정적 공급원
 * 재고 상태 기반 (재고 수량 대신 stock_status 사용)
 */
function scoreSupply(stockStatus: string): number {
  if (stockStatus === 'inStock')    return 5;
  if (stockStatus === 'lowStock')   return 2; // 재입고 가능성 있음
  if (stockStatus === 'outOfStock') return 0;
  return 3; // 알 수 없음 → 보수적 중립
}

// ─────────────────────────────────────────────────────────────────────────────
// 종합 점수 계산
// ─────────────────────────────────────────────────────────────────────────────

export function calcCostcoScore(input: CostcoScoreInput): CostcoScoreResult {
  const csRiskResult = getCsRisk(input.categoryName);

  // ── 7개 기본 항목 ──────────────────────────────────────────────────────────
  const legalIp  = scoreLegalIp(input.legalStatus, input.ipRiskLevel);
  const priceComp = scorePriceComp(input.vsMarket);
  const csSafety = scoreCsSafety(csRiskResult.level);
  const margin   = scoreMargin(input.realMarginRate);
  const demand   = scoreDemand(input.weeklySales, input.dailyAvg);
  const turnover = scoreInventoryTurnover(input.weeklySales, input.expectedStock ?? 10);
  const supply   = scoreSupply(input.stockStatus);

  const baseTotal = legalIp + priceComp + csSafety + margin + demand + turnover + supply;

  // ── 남성 타겟 보너스 ───────────────────────────────────────────────────────
  let maleBonus = 0;
  let maleTier: MaleTier | null = null;
  let legalBlocked = false;
  let needsReview = false;

  if (input.title) {
    const maleResult = classifyMaleTarget(input.title, input.categoryName ?? '');
    maleBonus    = maleResult.bonusScore;
    maleTier     = maleResult.tier;
    legalBlocked = maleResult.legalBlocked;
    needsReview  = maleResult.needsReview;
  }

  // ── 시즌 가산점 ────────────────────────────────────────────────────────────
  let seasonBonus = 0;
  let matchedSeasons: string[] = [];

  if (input.title) {
    const seasonResult = getSeasonBonus(input.title, input.today);
    seasonBonus    = seasonResult.bonus;
    matchedSeasons = seasonResult.matchedSeasons;
  }

  // ── 별표 상품 보너스 (단종·희소 기회 상품) ──────────────────────────────────
  const asteriskBonus = input.hasAsterisk ? 5 : 0;

  // ── 총점 (110점 캡) ────────────────────────────────────────────────────────
  const total = Math.min(baseTotal + maleBonus + seasonBonus + asteriskBonus, 110);

  // ── 차단 사유 결정 ─────────────────────────────────────────────────────────
  let blockedReason: string | null = null;
  if (legalBlocked) {
    blockedReason = '법적 통신판매 금지 키워드 포함';
  } else if (input.legalStatus === 'blocked') {
    blockedReason = '법적 검토: 차단 상태';
  } else if (csRiskResult.level === 'high') {
    blockedReason = `고위험 CS 카테고리: ${csRiskResult.reason ?? ''}`;
  }
  // ※ 코스트코는 MOQ 제한 없으므로 MOQ 차단 없음

  return {
    baseTotal,
    maleBonus,
    seasonBonus,
    asteriskBonus,
    total,
    legalIp,
    priceComp,
    csSafety,
    margin,
    demand,
    turnover,
    supply,
    gradeInfo: getGrade(total),
    maleTier,
    matchedSeasons,
    csRiskLevel: csRiskResult.level,
    csRiskReason: csRiskResult.reason,
    blockedReason,
    needsReview,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 점수 분해표 (UI 툴팁용)
// ─────────────────────────────────────────────────────────────────────────────

/** 항목별 최대 배점 (UI 표시용) */
export const COSTCO_SCORE_MAX: Record<string, number> = {
  legalIp:  15,
  priceComp: 25,
  csSafety: 10,
  margin:   20,
  demand:   15,
  turnover: 10,
  supply:    5,
};

/** 항목 한국어 레이블 */
export const COSTCO_SCORE_LABELS: Record<string, string> = {
  legalIp:  '법적·IP',
  priceComp: '가격경쟁력',
  csSafety: 'CS안전성',
  margin:   '마진안전성',
  demand:   '수요신호',
  turnover: '재고회전',
  supply:   '공급안정성',
};
