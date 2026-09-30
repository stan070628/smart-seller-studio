import { calc1688UnitCost } from '@/lib/sourcing/cost-1688';
import { DEFAULT_ORDER_QTY, marginVerdict, minViablePrice, type MarginVerdict } from '@/lib/sourcing/coupang-price';
import type { LogisticsSize } from '@/types/shortlist';

/**
 * 실측 판정 — 앱의 원가·마진 모듈을 그대로 부른다. 사본을 만들지 않는다.
 *
 * 환율 217: 2026-08-25 1688 실결제 두 건(152.30위안=33,062원, 50위안=10,855원) 역산
 * (위키 20-wiki/outputs/1688 샘플 8종 강의 검토 목록 2026-09-26).
 * margin-1688.ts의 DEFAULT_EXCHANGE_RATE_KRW_PER_RMB(195)와 다르다 — 그쪽 정리는 별도 과제.
 */
export const REAL_FX_KRW_PER_CNY = 217;

/** 하한선 계산용 최소 현실 원가 (위키 「판매가 하한선」의 가정) */
export const FLOOR_CNY = 5;

export function effectiveCostOf(cny: number, size: LogisticsSize, itemName: string | null): number | null {
  if (!(cny > 0)) return null;
  const r = calc1688UnitCost({
    buyKrwTotal: Math.round(cny * REAL_FX_KRW_PER_CNY),
    orderQty: 1,
    sourcingOrderQty: DEFAULT_ORDER_QTY,
    intlShipPerUnitKrw: null,
    itemName,
    logisticsSize: size,
  });
  return r.effectiveCostKrw;
}

/** 원가를 보기 전에 버릴 판매가 하한 */
export function sourcingFloorPrice(size: LogisticsSize): number {
  return minViablePrice(effectiveCostOf(FLOOR_CNY, size, null)!, size);
}

export interface RealJudgement extends MarginVerdict {
  effectiveCost: number;
}

export function judgeReal(
  cny: number,
  price: number,
  size: LogisticsSize,
  itemName: string | null,
): RealJudgement | null {
  if (!(price > 0)) return null;
  const effectiveCost = effectiveCostOf(cny, size, itemName);
  if (effectiveCost === null) return null;
  return { effectiveCost, ...marginVerdict(price, effectiveCost, size) };
}
