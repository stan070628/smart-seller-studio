export interface SubdivisionInput {
  purchaseQuantity: number;
  totalPurchaseCost: number;
  subdivisionUnit: number;
  carryoverQuantity: number;
  carryoverUnitCost: number;
}

export interface SubdivisionResult {
  sellablePacks: number;
  packUnitCost: number;
  newCarryoverQuantity: number;
  newCarryoverUnitCost: number;
  totalAvailable: number;
  perItemCost: number;
}

export function calculateSubdivision(input: SubdivisionInput): SubdivisionResult {
  const {
    purchaseQuantity,
    totalPurchaseCost,
    subdivisionUnit,
    carryoverQuantity,
    carryoverUnitCost,
  } = input;

  const totalAvailable = carryoverQuantity + purchaseQuantity;

  // 재고가 없거나 소분 단위가 유효하지 않으면 빈 결과 반환
  if (totalAvailable === 0 || subdivisionUnit <= 0) {
    return {
      sellablePacks: 0,
      packUnitCost: 0,
      newCarryoverQuantity: 0,
      newCarryoverUnitCost: 0,
      totalAvailable: 0,
      perItemCost: 0,
    };
  }

  // 판매 가능 팩 수 및 이월 수량 계산
  const sellablePacks = Math.floor(totalAvailable / subdivisionUnit);
  const newCarryoverQuantity = totalAvailable % subdivisionUnit;

  // 이월분과 신규 입고분을 합산한 총 원가 계산 (가중평균)
  const carryoverTotalCost = carryoverQuantity * carryoverUnitCost;
  const combinedTotalCost = carryoverTotalCost + totalPurchaseCost;
  const combinedPerItemCost = combinedTotalCost / totalAvailable;

  // 팩당 원가: 개당 합산 원가 × 소분 단위 (팩이 없으면 0)
  const packUnitCost = sellablePacks > 0
    ? Math.round(combinedPerItemCost * subdivisionUnit)
    : 0;

  // 이월 개당 원가: 합산 개당 원가 반올림
  const newCarryoverUnitCost = Math.round(combinedPerItemCost);

  // 신규 입고분의 개당 원가 (이월 미포함)
  const perItemCost = purchaseQuantity > 0
    ? Math.round(totalPurchaseCost / purchaseQuantity)
    : 0;

  return {
    sellablePacks,
    packUnitCost,
    newCarryoverQuantity,
    newCarryoverUnitCost,
    totalAvailable,
    perItemCost,
  };
}
