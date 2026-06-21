/**
 * FIFO(선입선출) 원가 계산 라이브러리
 *
 * 입고 배치를 수령일 오름차순으로 정렬하고,
 * 판매 발생 시 오래된 배치부터 순서대로 재고를 소진하여
 * 단위 원가 및 실현손익을 계산한다.
 */

export const ENTRY_CHANNEL = {
  RG: 'rg',
  WING: 'wing',
} as const;

export const SALE_CHANNEL = {
  ROCKET_GROWTH: 'rocket_growth',
  MANUAL: 'manual',
  COUPANG: 'coupang',
  NAVER: 'naver',
} as const;

/** 입고 배치 */
export interface PurchaseBatch {
  id: string;
  /** 입고일 (ISO 8601 YYYY-MM-DD 문자열, Date 객체 불가) */
  received_at: string;
  /** 입고 수량 */
  quantity: number;
  /** 단위 매입가 (원) */
  unit_cost: number;
  /** 단위 배송비 (원) — 원가에 포함, 재고 평가액에서는 제외 */
  unit_shipping_fee: number;
  /** 단위 로켓그로스 입고 배송비 (원) — 원가에 포함, 재고 평가액에서는 제외 */
  unit_rg_shipping_fee: number;
}

/** 판매 행 */
export interface SaleRow {
  id: string;
  /** 판매일 (ISO 8601 YYYY-MM-DD 문자열, Date 객체 불가) */
  sold_at: string;
  /** 판매 수량 */
  quantity: number;
  /** 판매 단가 (원) */
  selling_price: number;
  /** 채널 ('rocket_growth' | 'coupang' | 'manual' 등) — 채널별 FIFO 분리 시 필터링에 사용 */
  channel?: string;
  /** 건당 택배비 (원) — 실현손익에서 차감 */
  shipping_fee?: number;
}

/** 판매 건별 FIFO 상세 결과 */
export interface SaleFifoDetail {
  saleId: string;
  /** FIFO 적용 단위 원가 (배송비 포함, 반올림) */
  fifo_cost_per_unit: number;
  /** 단위 실현손익 = 판매가 - FIFO원가 - 플랫폼수수료 */
  realized_profit_per_unit: number;
}

/** calculateFifo 반환 요약 */
export interface FifoSummary {
  /** 현재 잔여 재고 수량 */
  current_stock: number;
  /** 잔여 재고 평가액 (unit_cost × 잔여수량, 배송비 미포함) */
  stock_value: number;
  /** 전체 실현손익 합계 */
  total_realized_profit: number;
  /** 판매 건별 FIFO 상세 목록 */
  sale_details: SaleFifoDetail[];
}

/**
 * FIFO 원가 계산 함수
 *
 * @param batches - 입고 배치 목록 (순서 무관, 함수 내에서 정렬)
 * @param sales   - 판매 목록 (순서 무관, 함수 내에서 정렬)
 * @param platformFeeRate - 플랫폼 수수료율 (0.0 ~ 1.0, 예: 0.108 = 10.8%)
 * @returns FifoSummary
 */
export function calculateFifo(
  batches: PurchaseBatch[],
  sales: SaleRow[],
  platformFeeRate: number,
): FifoSummary {
  // 입고 배치를 수령일 오름차순 정렬 (가장 오래된 배치 먼저 소진)
  const sortedBatches = [...batches].sort((a, b) =>
    a.received_at.localeCompare(b.received_at),
  );
  // 판매를 판매일 오름차순 정렬
  const sortedSales = [...sales].sort((a, b) =>
    a.sold_at.localeCompare(b.sold_at),
  );

  // 큐: 각 배치에 현재 잔여 수량을 추가하여 관리
  const queue = sortedBatches.map((b) => ({ ...b, remaining: b.quantity }));

  const sale_details: SaleFifoDetail[] = [];
  let total_realized_profit = 0;

  for (const sale of sortedSales) {
    let qtyLeft = sale.quantity;
    let totalCost = 0; // 이번 판매에 소진된 총 원가 (배송비 포함)

    // 오래된 배치부터 순서대로 소진
    for (const batch of queue) {
      if (qtyLeft <= 0) break;
      const take = Math.min(batch.remaining, qtyLeft);
      // 원가 = (단위매입가 + 단위배송비 + 단위RG배송비) × 소진수량
      totalCost += (batch.unit_cost + batch.unit_shipping_fee + batch.unit_rg_shipping_fee) * take;
      batch.remaining -= take;
      qtyLeft -= take;
    }

    // 재고 부족 시 에러: 판매 수량이 가용 재고를 초과하면 원가가 왜곡됨
    if (qtyLeft > 0) {
      throw new RangeError(
        `판매 수량(${sale.quantity})이 남은 재고(${sale.quantity - qtyLeft})를 초과합니다. sale.id=${sale.id}`,
      );
    }

    // 단위 FIFO 원가: 총 소진 원가 / 판매 수량 (반올림)
    const fifo_cost_per_unit =
      sale.quantity > 0 ? Math.round(totalCost / sale.quantity) : 0;

    // 플랫폼 수수료: 판매가 × 수수료율 (반올림)
    const fee_per_unit = Math.round(sale.selling_price * platformFeeRate);

    // 택배비: 건당 고정 (없으면 0)
    const shipping_fee_per_unit = sale.shipping_fee ?? 0;

    // 단위 실현손익
    const realized_profit_per_unit =
      sale.selling_price - fifo_cost_per_unit - fee_per_unit - shipping_fee_per_unit;

    sale_details.push({ saleId: sale.id, fifo_cost_per_unit, realized_profit_per_unit });
    total_realized_profit += realized_profit_per_unit * sale.quantity;
  }

  // 잔여 재고 수량 합산
  const current_stock = queue.reduce((sum, b) => sum + b.remaining, 0);

  // 잔여 재고 평가액: unit_cost × 잔여수량 (배송비는 재고 평가에서 제외)
  const stock_value = queue.reduce(
    (sum, b) => sum + b.unit_cost * b.remaining,
    0,
  );

  return { current_stock, stock_value, total_realized_profit, sale_details };
}
