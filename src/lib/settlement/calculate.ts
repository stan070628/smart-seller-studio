/**
 * 일일 정산(현금 기준 손익) 계산.
 *
 * 매출·수수료는 fifo.ts와 동일한 총액 축을 따른다:
 *   매출     = sale_amount ?? selling_price × quantity
 *   수수료   = round((매출 - 쿠폰) × platform_fee_rate)   -- 판매 건별, 그다음 합산
 * 매입은 현금 기준(입고일에 전액 인식, FIFO 아님).
 */

/** 정산 대상 판매 (채널·voided 필터는 호출부에서 완료) */
export interface SettlementSale {
  sold_at: string;
  sale_amount: number | null;
  selling_price: number;
  quantity: number;
  coupon_discount: number;
  platform_fee_rate: number;
}

/** 입고 (매입) */
export interface SettlementEntry {
  received_at: string;
  quantity: number;
  unit_cost: number;
  unit_shipping_fee: number;
  unit_rg_shipping_fee: number;
}

/** 일별 수동 비용 */
export interface SettlementExpense {
  expense_date: string;
  ad_spend: number;
  box_cost: number;
  parcel_cost: number;
}

/** 날짜별 취소 금액 (voided 판매 합계, 정보용 — 순이익엔 영향 없음) */
export interface SettlementCancellation {
  date: string;
  amount: number;
}

export interface SettlementRow {
  date: string;
  revenue: number;
  cancelled: number;
  couponDiscount: number;
  platformFee: number;
  purchase: number;
  parcelFee: number;
  adSpend: number;
  boxCost: number;
  netProfit: number;
  orderCount: number;
}

export interface SettlementResult {
  rows: SettlementRow[];
  monthTotal: Omit<SettlementRow, 'date'>;
}

function emptyAgg(): Omit<SettlementRow, 'date'> {
  return {
    revenue: 0, cancelled: 0, couponDiscount: 0, platformFee: 0, purchase: 0,
    parcelFee: 0, adSpend: 0, boxCost: 0,
    netProfit: 0, orderCount: 0,
  };
}

export function computeDailySettlement(
  sales: SettlementSale[],
  entries: SettlementEntry[],
  expenses: SettlementExpense[],
  cancellations: SettlementCancellation[] = [],
): SettlementResult {
  const byDate = new Map<string, Omit<SettlementRow, 'date'>>();
  const get = (d: string) => {
    let row = byDate.get(d);
    if (!row) { row = emptyAgg(); byDate.set(d, row); }
    return row;
  };

  for (const s of sales) {
    const row = get(s.sold_at);
    const revenue = s.sale_amount ?? s.selling_price * s.quantity;
    const effective = revenue - s.coupon_discount;
    row.revenue += revenue;
    row.couponDiscount += s.coupon_discount;
    row.platformFee += Math.round(effective * s.platform_fee_rate);
    row.orderCount += 1;
  }

  for (const e of entries) {
    const row = get(e.received_at);
    row.purchase += Math.round(
      e.quantity * (e.unit_cost + e.unit_shipping_fee + e.unit_rg_shipping_fee),
    );
  }

  for (const x of expenses) {
    const row = get(x.expense_date);
    row.adSpend += x.ad_spend;
    row.boxCost += x.box_cost;
    row.parcelFee += x.parcel_cost;
  }

  // 취소분(voided 판매)은 정보용 별도 라인. 순이익엔 반영하지 않는다(이미 매출에서 제외됨).
  for (const c of cancellations) {
    get(c.date).cancelled += c.amount;
  }

  const rows: SettlementRow[] = [];
  const total = emptyAgg();
  for (const [date, a] of byDate) {
    a.netProfit =
      a.revenue - a.couponDiscount - a.platformFee - a.purchase
      - a.parcelFee - a.adSpend - a.boxCost;
    rows.push({ date, ...a });
    total.revenue += a.revenue;
    total.cancelled += a.cancelled;
    total.couponDiscount += a.couponDiscount;
    total.platformFee += a.platformFee;
    total.purchase += a.purchase;
    total.parcelFee += a.parcelFee;
    total.adSpend += a.adSpend;
    total.boxCost += a.boxCost;
    total.orderCount += a.orderCount;
  }
  total.netProfit =
    total.revenue - total.couponDiscount - total.platformFee - total.purchase
    - total.parcelFee - total.adSpend - total.boxCost;

  rows.sort((a, b) => b.date.localeCompare(a.date));
  return { rows, monthTotal: total };
}
