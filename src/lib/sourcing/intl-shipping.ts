/**
 * 국제배송(중국 → 한국) 비용 계산.
 *
 * 요율 출처: 더싼배대지 위해 해운 (2026-07-31 확인).
 *   개인회원·사업자회원 요율이 동일하다.
 *   "배송요금은 관·부가세 수입세 및 특별처리비용이 포함되지 않은 금액"
 *
 * 선형 근사식을 쓰지 않는 이유: 증분이 1~10kg 구간에서는 660~800원이지만
 * 11kg부터 550~600원으로 꺾인다. 근사식 `4580 + (kg-1)*1423`은 15kg에서
 * 24,502원을 내는데 실제는 23,190원으로 1,312원 과대평가한다.
 */

/** 부피무게 제수. 항공 기준으로 안내되어 있다 */
export const VOLUMETRIC_DIVISOR = 6000;

/** 관세사 수임료 (사업자). 발주 건당 정액이며 과세운임이 아니다 */
export const CUSTOMS_BROKER_FEE_KRW = 22000;

/** 0.5kg 단위 요율표. 인덱스 = kg × 2 - 1 */
const RATE_TABLE_KRW: readonly number[] = [
  4180,  // 0.5
  4580,  // 1.0
  5280,  // 1.5
  5990,  // 2.0
  6680,  // 2.5
  7430,  // 3.0
  8130,  // 3.5
  8830,  // 4.0
  9490,  // 4.5
  10290, // 5.0
  10970, // 5.5
  11670, // 6.0
  12390, // 6.5
  13090, // 7.0
  13790, // 7.5
  14540, // 8.0
  15280, // 8.5
  15980, // 9.0
  16640, // 9.5
  17390, // 10.0
  18090, // 10.5
  18690, // 11.0
  19240, // 11.5
  19840, // 12.0
  20390, // 12.5
  20940, // 13.0
  21490, // 13.5
  22040, // 14.0
  22640, // 14.5
  23190, // 15.0
  23740, // 15.5
];

/** 표 범위를 넘어설 때 쓰는 0.5kg당 증분 (마지막 구간 기울기) */
const EXTRAPOLATION_STEP_KRW = 550;

export interface Dimensions {
  /** cm */
  w: number;
  d: number;
  h: number;
}

/** 부피무게(kg) */
export function volumetricWeightKg(dims: Dimensions): number {
  return (dims.w * dims.d * dims.h) / VOLUMETRIC_DIVISOR;
}

/** 과금무게 = max(실무게, 부피무게). 치수를 모르면 실무게 */
export function chargeableWeightKg(actualKg: number, dims: Dimensions | null): number {
  if (!dims) return actualKg;
  return Math.max(actualKg, volumetricWeightKg(dims));
}

export interface ShippingFee {
  fee: number;
  /** 요율표 범위를 벗어나 외삽한 값인가 */
  estimated: boolean;
  /** 실제 과금에 쓰인 절상 무게 */
  billedKg: number;
}

/**
 * 절상 전에 흡수할 부동소수점 오차.
 *
 * 과금무게는 보통 `수량 × 개당무게`로 만들어지는데, 이 곱셈이 IEEE754에서
 * 경계값을 미세하게 넘긴다. 25 × 1.1 = 27.500000000000004이라 그냥 절상하면
 * 27.5kg짜리 발주가 28kg으로 청구돼 한 칸(550~800원)이 더 붙는다.
 * 실무 저울은 g 단위이므로 1e-9kg(=1μg)을 깎아도 실제 무게 판정은 바뀌지 않는다.
 */
const WEIGHT_EPSILON_KG = 1e-9;

/** 과금무게 → 배송비. 0.5kg 단위로 절상한다 */
export function shippingFeeKrw(weightKg: number): ShippingFee {
  const steps = Math.max(1, Math.ceil(weightKg * 2 - WEIGHT_EPSILON_KG));
  const billedKg = steps / 2;

  if (steps <= RATE_TABLE_KRW.length) {
    return { fee: RATE_TABLE_KRW[steps - 1], estimated: false, billedKg };
  }

  const last = RATE_TABLE_KRW[RATE_TABLE_KRW.length - 1];
  const over = steps - RATE_TABLE_KRW.length;
  return { fee: last + over * EXTRAPOLATION_STEP_KRW, estimated: true, billedKg };
}

export interface AllocationItemInput {
  key: string;
  qty: number;
  /** 개당 과금무게 */
  unitWeightKg: number;
}

export interface AllocationItemResult extends AllocationItemInput {
  totalWeightKg: number;
  /** 배송비 + 고정비 배분액 */
  allocatedKrw: number;
  perUnitKrw: number;
  /** 관세 과표에 넣을 개당 운임 — 배송비 몫만 */
  dutiableFreightPerUnitKrw: number;
}

export interface AllocationInput {
  /** 실제 청구된 배송비 */
  actualShippingKrw: number;
  /** 발주 건당 고정비 (관세사 수임료 등). 과세운임이 아니다 */
  fixedCostKrw: number;
  items: readonly AllocationItemInput[];
}

export interface AllocationResult {
  totalWeightKg: number;
  totalCostKrw: number;
  items: AllocationItemResult[];
}

/**
 * 발주 실비를 과금무게 비례로 배분한다.
 *
 * 배송비와 고정비를 모두 배분하되, 관세 과표에 쓸 운임은 배송비 몫만 따로 낸다.
 * 반올림 잔차는 가장 무거운 항목에 흡수시켜 합계가 총액과 일치하게 한다.
 */
export function allocateOrderCost(input: AllocationInput): AllocationResult {
  const rows = input.items.map((it) => ({ ...it, totalWeightKg: it.qty * it.unitWeightKg }));
  const totalWeightKg = rows.reduce((a, r) => a + r.totalWeightKg, 0);
  const totalCostKrw = input.actualShippingKrw + input.fixedCostKrw;

  if (totalWeightKg <= 0) {
    return {
      totalWeightKg: 0,
      totalCostKrw,
      items: rows.map((r) => ({
        ...r,
        allocatedKrw: 0,
        perUnitKrw: 0,
        dutiableFreightPerUnitKrw: 0,
      })),
    };
  }

  const items: AllocationItemResult[] = rows.map((r) => {
    const share = r.totalWeightKg / totalWeightKg;
    const allocatedKrw = Math.round(totalCostKrw * share);
    const shippingShare = Math.round(input.actualShippingKrw * share);
    return {
      ...r,
      allocatedKrw,
      perUnitKrw: r.qty > 0 ? Math.round(allocatedKrw / r.qty) : 0,
      dutiableFreightPerUnitKrw: r.qty > 0 ? Math.round(shippingShare / r.qty) : 0,
    };
  });

  // 반올림 잔차를 가장 무거운 항목에 흡수시킨다
  const diff = totalCostKrw - items.reduce((a, i) => a + i.allocatedKrw, 0);
  if (diff !== 0) {
    let heaviest = 0;
    for (let i = 1; i < items.length; i++) {
      if (items[i].totalWeightKg > items[heaviest].totalWeightKg) heaviest = i;
    }
    items[heaviest].allocatedKrw += diff;
    items[heaviest].perUnitKrw =
      items[heaviest].qty > 0 ? Math.round(items[heaviest].allocatedKrw / items[heaviest].qty) : 0;
  }

  return { totalWeightKg, totalCostKrw, items };
}
