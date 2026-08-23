import { calcMargin, type MarginInput } from '@/lib/roi/calculations';

/**
 * 건당 마진 (원 단위 반올림).
 *
 * 산식 본체는 `src/lib/roi/calculations.ts`의 `calcMargin`이며 이 함수는 반올림 래퍼다.
 * 원장을 하나로 두는 이유는, 두 벌로 두면 매출세액·판매자 할인 같은 항목이
 * 한쪽에만 추가되어 같은 상품의 마진이 화면마다 달라지기 때문이다.
 *
 * shippingFee: 건당 정액 물류비.
 *   로켓그로스는 사이즈별 입출고비+배송비(극소형 실청구 3,080원),
 *   판매자로켓은 택배비(3,500~6,500원)를 넘긴다.
 *   → src/lib/roi/rg-fees.ts 의 resolveRgShippingFee()
 *
 * 이 값을 빼지 않으면 마진이 과대평가되고, 그 결과 손익분기 ROAS가
 * 과소평가되어 적자 광고를 흑자로 오판하게 된다.
 */
export function calcMarginPerUnit(
  input: Omit<MarginInput, 'deliveryFee' | 'rgShippingFee'> & { shippingFee?: number },
): number {
  return Math.round(
    calcMargin({
      sellingPrice: input.sellingPrice,
      costPrice: input.costPrice,
      feeRate: input.feeRate,
      rgShippingFee: input.shippingFee ?? 0,
      sellerDiscount: input.sellerDiscount,
    }),
  );
}

/**
 * 손익분기점 ROAS (부가세 보정 포함)
 * = (판매가 ÷ 마진) × 1.1 × 100
 * 마진 ≤ 0 이면 Infinity 반환
 */
export function calcBreakEvenRoas(salePrice: number, marginPerUnit: number): number {
  if (marginPerUnit <= 0) return Infinity;
  return (salePrice / marginPerUnit) * 1.1 * 100;
}

interface NetProfitInput {
  monthlySales: number;
  monthlyAdSpend: number;
  marginPerUnit: number;
}

interface NetProfitResult {
  perUnit: number;    // 건당 순이익 (원)
  monthly: number;    // 월 순이익 (원)
}

/**
 * 순이익 계산
 * - 판매량 0이면 광고비 안분 불가 → 건당 순이익 = 마진(광고비 미반영)
 */
export function calcNetProfit(input: NetProfitInput): NetProfitResult {
  const { monthlySales, monthlyAdSpend, marginPerUnit } = input;

  if (monthlySales === 0) {
    return { perUnit: marginPerUnit, monthly: 0 };
  }

  const adCostPerUnit = Math.round(monthlyAdSpend / monthlySales);
  const perUnit = marginPerUnit - adCostPerUnit;
  const monthly = perUnit * monthlySales;

  return { perUnit, monthly };
}
