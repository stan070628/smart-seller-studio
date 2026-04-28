import { compareWholesaleVsBuy, type CompareInput, type CompareResult } from './margin-1688';

export interface RecommendInput extends CompareInput {
  skuCode: string;
  productName: string;
}

export interface RecommendResult extends CompareResult {
  skuCode: string;
  productName: string;
}

export function generateRecommendation(input: RecommendInput): RecommendResult {
  const cmp = compareWholesaleVsBuy({
    wholesaleMarginPerUnitKrw: input.wholesaleMarginPerUnitKrw,
    buyMarginPerUnitKrw: input.buyMarginPerUnitKrw,
    monthlySalesQty: input.monthlySalesQty,
    buyCapitalNeededKrw: input.buyCapitalNeededKrw,
  });
  return {
    skuCode: input.skuCode,
    productName: input.productName,
    ...cmp,
  };
}
