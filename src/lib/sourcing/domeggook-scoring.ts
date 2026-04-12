/**
 * domeggook-scoring.ts
 * 도매꾹 드롭쉬핑 7개 항목 + 보너스 종합 점수 계산
 *
 * 기본 배점 (100점):
 *   법적·IP       20점
 *   가격경쟁력    20점
 *   CS안전성      15점
 *   마진          15점
 *   수요          15점
 *   공급안정성    10점
 *   MOQ 적합성     5점
 *   ─────────────────
 *   기본 합계    100점
 *
 * 보너스 (최대 10점, 총 110점 캡):
 *   남성 타겟   high=5, mid=3, neutral=0
 *   시즌 가산점 0~10 (최대 1개 시즌)
 */

import { getCsRisk, type CsRiskLevel } from './domeggook-cs-filter';
import { classifyMaleTarget, type MaleTier } from './shared/male-classifier';
import { getSeasonBonus } from './shared/season-bonus';

export interface ScoreInput {
  // 법적·IP
  legalStatus: 'blocked' | 'warning' | 'safe' | 'unchecked';
  ipRiskLevel: 'low' | 'medium' | 'high' | null;

  // 가격경쟁력 (perUnitPrice 기준 격차율)
  priceGapRate: number | null; // % (양수 = 경쟁력 있음)

  // CS안전성
  categoryName: string | null;

  // 마진
  marginRate: number | null; // % (수익)

  // 수요
  sales7d: number;

  // 공급안정성
  latestInventory: number;

  // MOQ 적합성
  moq: number | null;

  // 남성/시즌 보너스 (선택 — 없으면 자동 계산)
  title?: string;           // 상품명 (보너스 자동 계산용)
  today?: Date;             // 기준 날짜 (테스트용)
}

export interface ScoreResult {
  /** 7개 기본 항목 합산 (0-100) */
  baseTotal: number;
  /** 남성 보너스 (0, 3, 5) */
  maleBonus: number;
  /** 시즌 가산점 (0-10) */
  seasonBonus: number;
  /** 최종 점수 = min(baseTotal + maleBonus + seasonBonus, 110) */
  total: number;

  // 항목별 점수
  legalIp: number;
  priceComp: number;
  csSafety: number;
  margin: number;
  demand: number;
  supply: number;
  moqFit: number;

  // 보너스 세부
  maleTier: MaleTier | null;
  matchedSeasons: string[];

  // CS 위험 정보
  csRiskLevel: CsRiskLevel;
  csRiskReason: string | null;

  /** 차단 사유 (차단 조건 충족 시 설정) */
  blockedReason: string | null;

  /** 리뷰 필요 여부 (전동공구·보충제 등) */
  needsReview: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 항목별 점수 계산 함수
// ─────────────────────────────────────────────────────────────────────────────

/** 법적·IP 점수 (0-20) */
function scoreLegalIp(
  legalStatus: ScoreInput['legalStatus'],
  ipRiskLevel: ScoreInput['ipRiskLevel'],
): number {
  const legalScore =
    legalStatus === 'safe' ? 12 :
    legalStatus === 'warning' ? 6 :
    legalStatus === 'unchecked' ? 3 :
    0; // blocked

  const ipScore =
    ipRiskLevel === 'low' ? 8 :
    ipRiskLevel === 'medium' ? 4 :
    ipRiskLevel === 'high' ? 0 :
    2; // unchecked

  return legalScore + ipScore;
}

/** 가격경쟁력 점수 (0-20): perUnitPrice 기준 단가 격차율 */
function scorePriceComp(priceGapRate: number | null): number {
  if (priceGapRate === null) return 5;
  if (priceGapRate >= 30) return 20;
  if (priceGapRate >= 20) return 15;
  if (priceGapRate >= 10) return 10;
  if (priceGapRate >= 0)  return 5;
  return 0;
}

/** CS안전성 점수 (0-15) */
function scoreCsSafety(csRisk: CsRiskLevel): number {
  if (csRisk === 'low')    return 15;
  if (csRisk === 'medium') return 8;
  return 0; // high
}

/** 마진 점수 (0-15) */
function scoreMargin(marginRate: number | null): number {
  if (marginRate === null) return 3;
  if (marginRate >= 20) return 15;
  if (marginRate >= 15) return 12;
  if (marginRate >= 10) return 8;
  if (marginRate >= 5)  return 4;
  return 0;
}

/** 수요 점수 (0-15): 7일 판매량 기반 */
function scoreDemand(sales7d: number): number {
  if (sales7d >= 50) return 15;
  if (sales7d >= 20) return 12;
  if (sales7d >= 10) return 8;
  if (sales7d >= 5)  return 5;
  if (sales7d >  0)  return 2;
  return 0;
}

/** 공급안정성 점수 (0-10) */
function scoreSupply(inventory: number): number {
  if (inventory >= 500) return 10;
  if (inventory >= 200) return 7;
  if (inventory >= 50)  return 4;
  if (inventory >= 10)  return 2;
  return 0;
}

/** MOQ 적합성 점수 (0-5) */
function scoreMoqFit(moq: number | null): number {
  if (moq === null) return 0;
  if (moq === 1) return 5;
  if (moq <= 3)  return 3;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 종합 점수 계산
// ─────────────────────────────────────────────────────────────────────────────

export function calcScore(input: ScoreInput): ScoreResult {
  const csRiskResult = getCsRisk(input.categoryName);

  // ── 7개 기본 항목 ──────────────────────────────────────────────────────────
  const legalIp   = scoreLegalIp(input.legalStatus, input.ipRiskLevel);
  const priceComp = scorePriceComp(input.priceGapRate);
  const csSafety  = scoreCsSafety(csRiskResult.level);
  const margin    = scoreMargin(input.marginRate);
  const demand    = scoreDemand(input.sales7d);
  const supply    = scoreSupply(input.latestInventory);
  const moqFit    = scoreMoqFit(input.moq);

  const baseTotal = legalIp + priceComp + csSafety + margin + demand + supply + moqFit;

  // ── 남성 타겟 보너스 ───────────────────────────────────────────────────────
  let maleBonus = 0;
  let maleTier: MaleTier | null = null;
  let legalBlocked = false;
  let needsReview = false;

  if (input.title) {
    const maleResult = classifyMaleTarget(input.title, input.categoryName ?? '');
    maleBonus = maleResult.bonusScore;
    maleTier = maleResult.tier;
    legalBlocked = maleResult.legalBlocked;
    needsReview = maleResult.needsReview;
  }

  // ── 시즌 가산점 ────────────────────────────────────────────────────────────
  let seasonBonus = 0;
  let matchedSeasons: string[] = [];

  if (input.title) {
    const seasonResult = getSeasonBonus(input.title, input.today);
    seasonBonus = seasonResult.bonus;
    matchedSeasons = seasonResult.matchedSeasons;
  }

  // ── 총점 (110점 캡) ────────────────────────────────────────────────────────
  const total = Math.min(baseTotal + maleBonus + seasonBonus, 110);

  // ── 차단 사유 결정 ─────────────────────────────────────────────────────────
  let blockedReason: string | null = null;
  if (legalBlocked) {
    blockedReason = '법적 통신판매 금지 키워드 포함';
  } else if (input.legalStatus === 'blocked') {
    blockedReason = '법적 검토: 차단 상태';
  } else if (csRiskResult.level === 'high') {
    blockedReason = `고위험 CS 카테고리: ${csRiskResult.reason ?? ''}`;
  } else if (input.moq !== null && input.moq >= 4) {
    blockedReason = 'MOQ 4개 이상 (위탁 부적합)';
  }

  return {
    baseTotal,
    maleBonus,
    seasonBonus,
    total,
    legalIp,
    priceComp,
    csSafety,
    margin,
    demand,
    supply,
    moqFit,
    maleTier,
    matchedSeasons,
    csRiskLevel: csRiskResult.level,
    csRiskReason: csRiskResult.reason,
    blockedReason,
    needsReview,
  };
}

/** 종합 점수 등급 (110점 기준) */
export function getScoreGrade(total: number): { label: string; color: string; bg: string } {
  if (total >= 85) return { label: 'S', color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.08)' };
  if (total >= 70) return { label: 'A', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.08)' };
  if (total >= 55) return { label: 'B', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.08)' };
  if (total >= 40) return { label: 'C', color: '#d97706', bg: 'rgba(217, 119, 6, 0.08)' };
  return { label: 'D', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.08)' };
}
