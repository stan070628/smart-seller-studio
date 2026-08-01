/**
 * 1688 사입 원가 계산.
 *
 * 붙여넣기로 저장한 입력값에서 조회 시점마다 다시 계산한다.
 * 파생값을 저장하지 않는 이유: 관세율·수수료율 같은 정책값이 바뀌면
 * 저장된 원가가 조용히 낡는다. (선행 작업에서 verified_at이 같은 문제를 냈다)
 *
 * 중국 내 배송비는 이미 buyKrwTotal(合计의 원화)에 포함돼 있다.
 * 여기서 더하는 intlShipPerUnitKrw는 배대지 → 한국 구간이다.
 */

import { calcImportTax, getTariffRate } from '@/lib/sourcing/tariff';
import { breakEvenPrice } from '@/lib/sourcing/coupang-price';
import { estimateIntlShipPerUnitKrw } from '@/lib/sourcing/intl-shipping';
import type { LogisticsSize } from '@/types/shortlist';

export interface Cost1688Input {
  /** 붙여넣기의 원화 합계 (中国内 배송비 포함) */
  buyKrwTotal: number;
  /** 1688에서 실제로 산 수량. 샘플 구매면 2~3개일 수 있다 */
  orderQty: number;
  /** 사입 예정 수량 — 국제배송비 환산 기준. 1688에서 실제로 산 수량(orderQty)과 다르다 */
  sourcingOrderQty: number;
  /** 개당 국제배송비 — 배대지 → 한국. null이면 사이즈·사입 수량으로 추정한다 */
  intlShipPerUnitKrw: number | null;
  /** 관세율 판단용. 상품명이 없으면 null */
  itemName: string | null;
  logisticsSize: LogisticsSize;
}

export interface Cost1688Result {
  unitKrw: number | null;
  dutiableValueKrw: number | null;
  tariffRate: number;
  tariffKrw: number | null;
  importVatKrw: number | null;
  effectiveCostKrw: number | null;
  breakEvenPriceKrw: number | null;
  /** 실제로 계산에 쓰인 개당 국제배송비 */
  intlShipPerUnitKrw: number;
  /** 위 값이 추정치인가 (사람이 넣은 값이 아닌가) */
  shipEstimated: boolean;
  /** 국제배송비가 0이라 원가가 낙관적으로 낮다 */
  shippingMissing: boolean;
}

export function calc1688UnitCost(input: Cost1688Input): Cost1688Result {
  const tariffRate = getTariffRate(input.itemName);

  // 사람이 넣은 값이 항상 이긴다. 추정은 실측이 없을 때의 대체재다.
  const est = input.intlShipPerUnitKrw === null
    ? estimateIntlShipPerUnitKrw(input.logisticsSize, input.sourcingOrderQty)
    : null;
  const ship = input.intlShipPerUnitKrw ?? est?.perUnitKrw ?? 0;
  const shipEstimated = input.intlShipPerUnitKrw === null && est !== null;
  // 추정조차 못 한 경우에만 누락이다 — 추정값이 있으면 0이 아니므로 낙관 오류가 아니다
  const shippingMissing = ship <= 0;

  if (input.orderQty <= 0 || input.buyKrwTotal <= 0) {
    return {
      unitKrw: null, dutiableValueKrw: null, tariffRate,
      tariffKrw: null, importVatKrw: null,
      effectiveCostKrw: null, breakEvenPriceKrw: null,
      intlShipPerUnitKrw: ship, shipEstimated, shippingMissing,
    };
  }

  const unitKrw = Math.round(input.buyKrwTotal / input.orderQty);
  const tax = calcImportTax({
    goodsKrw: unitKrw,
    dutiableFreightKrw: ship,
    tariffRate,
  });

  return {
    unitKrw,
    dutiableValueKrw: tax.dutiableValueKrw,
    tariffRate,
    tariffKrw: tax.tariffKrw,
    importVatKrw: tax.importVatKrw,
    effectiveCostKrw: tax.dutyPaidValueKrw,
    breakEvenPriceKrw: breakEvenPrice(tax.dutyPaidValueKrw, input.logisticsSize),
    intlShipPerUnitKrw: ship,
    shipEstimated,
    shippingMissing,
  };
}
