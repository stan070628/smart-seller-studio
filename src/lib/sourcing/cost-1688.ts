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
import type { LogisticsSize } from '@/types/shortlist';

export interface Cost1688Input {
  /** 붙여넣기의 원화 합계 (中国内 배송비 포함) */
  buyKrwTotal: number;
  /** 주문 총 수량 */
  orderQty: number;
  /** 개당 국제배송비 — 배대지 → 한국 */
  intlShipPerUnitKrw: number;
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
  /** 국제배송비가 0이라 원가가 낙관적으로 낮다 */
  shippingMissing: boolean;
}

export function calc1688UnitCost(input: Cost1688Input): Cost1688Result {
  const tariffRate = getTariffRate(input.itemName);
  const shippingMissing = input.intlShipPerUnitKrw <= 0;

  if (input.orderQty <= 0 || input.buyKrwTotal <= 0) {
    return {
      unitKrw: null, dutiableValueKrw: null, tariffRate,
      tariffKrw: null, importVatKrw: null,
      effectiveCostKrw: null, breakEvenPriceKrw: null, shippingMissing,
    };
  }

  const unitKrw = Math.round(input.buyKrwTotal / input.orderQty);
  const tax = calcImportTax({
    goodsKrw: unitKrw,
    dutiableFreightKrw: input.intlShipPerUnitKrw,
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
    shippingMissing,
  };
}
