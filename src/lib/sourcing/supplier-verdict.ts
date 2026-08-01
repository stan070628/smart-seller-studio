/**
 * 공급처별 판정과 "좋은 쪽" 선택.
 *
 * 상단 표와 비교 패널이 같은 규칙을 써야 하므로 순수 함수로 뽑았다.
 * 이전에는 shortlist-verify.ts(저장용)와 SupplierCompare.tsx(화면용)에
 * 같은 규칙이 두 벌 있었다.
 */

import { marginOf, MIN_SELL_PRICE_KRW } from '@/lib/sourcing/coupang-price';
import type { LogisticsSize, Verdict } from '@/types/shortlist';

export type SupplierKind = 'dome' | 'cn1688';

export interface SupplierCost {
  supplier: SupplierKind;
  /** 개당 매입가 */
  unitPriceKrw: number;
  /** 개당 배송비 (도매꾹은 국내, 1688은 국제 구간) */
  shipPerUnitKrw: number;
  /** 배송비가 추정치인가 */
  shipEstimated: boolean;
  /** 관세·부가세까지 포함한 개당 실효원가 */
  effectiveCostKrw: number;
  breakEvenPriceKrw: number;
}

export interface SupplierJudgement {
  verdict: Verdict;
  /** 사람이 읽는 사유 */
  why: string;
  marginKrw: number | null;
  marginRatePct: number | null;
}

/**
 * 판정. 하한이 손익분기보다 **먼저**다 —
 * 애초에 팔지 않을 가격대라면 손익분기를 논할 이유가 없다.
 */
export function judgeSupplier(
  coupangP25: number | null,
  cost: SupplierCost,
  size: LogisticsSize,
): SupplierJudgement {
  if (coupangP25 === null) {
    return { verdict: 'unknown', why: '쿠팡 실판가 미입력', marginKrw: null, marginRatePct: null };
  }

  if (coupangP25 < MIN_SELL_PRICE_KRW) {
    return {
      verdict: 'fail',
      // "공급처와 무관"을 붙이는 이유: 하한은 판매가의 성질이라 두 줄이 함께
      // 미달로 나온다. 문구가 없으면 1688 줄까지 미달인 것이 계산 오류처럼 읽힌다.
      why: `판매가 ${coupangP25.toLocaleString()}원 · ${MIN_SELL_PRICE_KRW.toLocaleString()}원 하한 미만 (공급처와 무관)`,
      marginKrw: null,
      marginRatePct: null,
    };
  }

  const margin = marginOf(coupangP25, cost.effectiveCostKrw, size);
  const marginRatePct = Math.round((margin / coupangP25) * 1000) / 10;

  if (coupangP25 >= cost.breakEvenPriceKrw) {
    return {
      verdict: 'pass',
      why: `개당 ${margin.toLocaleString()}원 · ${marginRatePct}%`,
      marginKrw: margin,
      marginRatePct,
    };
  }

  return {
    verdict: 'fail',
    why: `손익분기 ${(cost.breakEvenPriceKrw - coupangP25).toLocaleString()}원 부족`,
    marginKrw: margin,
    marginRatePct,
  };
}

/**
 * 두 공급처 중 좋은 쪽.
 *
 * 실효원가가 낮은 쪽이 무조건 이긴다. 물류비는 사이즈로 정해지고 같은
 * 상품이라 양쪽이 같으므로, 손익분기도 마진도 실효원가에 단조다.
 * 즉 "원가가 싼 쪽"과 "판정이 좋은 쪽"이 항상 일치한다.
 *
 * 동률이면 도매꾹을 고른다 — 리드타임이 2~3일이고 통관 위험이 없다.
 */
export function pickBestSupplier(
  dome: SupplierCost,
  cn1688: SupplierCost | null,
): SupplierCost {
  if (!cn1688) return dome;
  return cn1688.effectiveCostKrw < dome.effectiveCostKrw ? cn1688 : dome;
}
