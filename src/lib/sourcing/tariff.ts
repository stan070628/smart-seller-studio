/**
 * 수입 관세·부가세 계산.
 *
 * 근거: 더싼배대지 통관 안내 (2026-07-31 확인)
 *   과세가격 = 상품 총 결제금액 × 관세청 고시환율 + 과세운임
 *   관세     = 과세가격 × 품목별 관세율
 *   부가세   = (과세가격 + 관세) × 0.1
 *
 * 주의 1: 과세가격에 **운임이 포함된다.** 상품가만 쓰면 관세·부가세가 과소 계상된다.
 * 주의 2: 관세사 수임료는 과세운임이 아니다. 과세가격에 넣으면 세금이 이중으로 붙는다.
 * 주의 3: 간이과세자는 수입 부가세를 매입세액으로 공제받지 못하므로 그대로 원가가 된다.
 */

/** 관세율표에 없는 품목의 기본 세율 */
export const DEFAULT_TARIFF_RATE = 0.08;

/** 수입 부가세율 */
export const IMPORT_VAT_RATE = 0.1;

/**
 * 품목 키워드 → 관세율.
 * 앞에서부터 순서대로 부분 문자열 매칭하므로, 더 구체적인 항목을 위에 둔다.
 */
const TARIFF_TABLE: ReadonlyArray<{ keywords: readonly string[]; rate: number }> = [
  { keywords: ['의류', '수영복', '속옷', '신발'], rate: 0.13 },
  { keywords: ['스카프', '숄', '넥타이', '장갑'], rate: 0.08 },
  { keywords: ['가방', '핸드백'], rate: 0.08 },
  { keywords: ['액세서리', '악세서리', '선글라스'], rate: 0.08 },
  { keywords: ['화장품', '향수'], rate: 0.08 },
];

/** 카테고리명에서 관세율을 찾는다. 못 찾으면 기본값. */
export function getTariffRate(categoryName: string | null): number {
  if (!categoryName) return DEFAULT_TARIFF_RATE;
  for (const row of TARIFF_TABLE) {
    if (row.keywords.some((kw) => categoryName.includes(kw))) return row.rate;
  }
  return DEFAULT_TARIFF_RATE;
}

export interface ImportTaxInput {
  /** 상품가 (원화 환산 후) */
  goodsKrw: number;
  /** 과세운임 — 배송비 몫만. 관세사 수임료는 제외한다 */
  dutiableFreightKrw: number;
  tariffRate: number;
}

export interface ImportTaxResult {
  dutiableValueKrw: number;
  tariffKrw: number;
  importVatKrw: number;
  /** 과세가격 + 관세 + 부가세 */
  totalKrw: number;
}

export function calcImportTax(input: ImportTaxInput): ImportTaxResult {
  const dutiableValueKrw = Math.round(input.goodsKrw + input.dutiableFreightKrw);
  const tariffKrw = Math.round(dutiableValueKrw * input.tariffRate);
  const importVatKrw = Math.round((dutiableValueKrw + tariffKrw) * IMPORT_VAT_RATE);
  return {
    dutiableValueKrw,
    tariffKrw,
    importVatKrw,
    totalKrw: dutiableValueKrw + tariffKrw + importVatKrw,
  };
}
