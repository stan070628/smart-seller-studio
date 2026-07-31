/**
 * 수입 관세·부가세 계산.
 *
 * 계산식 근거: 더싼배대지 통관 안내 (thessanchina.co.kr, 2026-07-31 확인)
 *   과세가격 = 상품 총 결제금액 × 관세청 고시환율 + 과세운임
 *   관세     = 과세가격 × 품목별 관세율
 *   부가세   = (과세가격 + 관세) × 0.1
 *
 * 주의 1: 과세가격에 **운임이 포함된다.** 상품가만 쓰면 관세·부가세가 과소 계상된다.
 * 주의 2: 관세사 수임료는 과세운임이 아니다. 과세가격에 넣으면 세금이 이중으로 붙는다.
 * 주의 3: 간이과세자는 수입 부가세를 매입세액으로 공제받지 못하므로 그대로 원가가 된다.
 *
 * 품목별 세율의 근거는 두 갈래이며 신뢰도가 다르다 (TARIFF_TABLE 참고):
 *   - **관세청 관세법령정보포털(unipass.customs.go.kr) 확인분**: 의류 13%, 신발 13%,
 *     가방/핸드백 8%, 화장품·향수 6.5%, 레고/블럭/퍼즐 0%.
 *   - **더싼배대지 고시(thessanchina.co.kr, 2026-07-31)만 근거로 있고 관세청으로
 *     교차검증하지 않은 미검증분**: 우산 13%, 카페트 10%.
 * 적용 규칙: 원산지증명서가 없는 1688 소량 사입 기준이므로 **min(기본세율, WTO
 * 양허세율)**을 쓴다. 한중FTA 특혜세율은 기관발급 C/O가 있어야 적용되므로 이 소싱
 * 경로에는 해당하지 않아 원가모델 기본값으로 쓰지 않는다.
 * 배대지 고시표를 그대로 베끼면 위험하다는 근거: 화장품·향수는 배대지 표에 8%로
 * 적혀 있지만 실제 적용 세율은 WTO 양허세율 6.5%이고, 레고/블럭/퍼즐(HS 9503 조립식
 * 완구·퍼즐)도 배대지 표엔 8%지만 실제로는 0%다 — 배대지 고시가 기본세율만 옮겨 적고
 * 협정세율 우선 적용을 반영하지 않은 것으로 보인다. 다음에 배대지 표를 다시 근거로
 * 삼으려는 사람은 이 사실을 먼저 확인할 것.
 */

/** 관세율표에 없는 품목의 기본 세율 */
export const DEFAULT_TARIFF_RATE = 0.08;

/** 수입 부가세율 */
export const IMPORT_VAT_RATE = 0.1;

/**
 * 품목 키워드 → 관세율.
 *
 * 매칭 규칙: 앞에서부터 순서대로 부분 문자열 매칭하며, **첫 번째로 매칭되는 행이 이긴다**
 * ("더 구체적인 항목을 위에 둔다"는 규칙이 아니다 — 예컨대 '의류/신발' 행은 표에서 가장
 * 넓은 키워드를 쥐고 있지만 상단 근처에 있다). 이 때문에 다음과 같은 오분류가 알려져
 * 있다. 표에 longest-match나 제외 목록 같은 메커니즘은 없으므로 새 행을 추가할 때
 * 아래 함정을 반드시 염두에 둘 것:
 *   - '의류건조대'  → 13% (실제로는 생활용품, 8%가 맞음)
 *   - '신발장'      → 13% (실제로는 가구, 8%가 맞음)
 *   - '신발 건조기' → 13% (실제로는 가전, 8%가 맞음)
 *   - '속옷 정리함' → 13% (실제로는 생활용품, 8%가 맞음)
 * 위 오분류는 의도적으로 고치지 않았다 — longest-match/제외 목록은 이 모듈의 범위를
 * 넘는 설계 변경이다.
 *
 * '우산' 키워드에도 같은 종류의 위험이 있다: '우산꽂이'(우산을 세워두는 생활용품, 우산
 * 자체가 아님)도 이 substring에 걸려 13%로 잘못 분류될 수 있다. 지금은 예외 처리를
 * 만들지 않고 위험만 기록해 둔다.
 *
 * 행 순서가 살아있는 로직임에 주의:
 *   - '레고/블럭/퍼즐' 행(0%)은 표의 **맨 위**에 있어야 한다. 0%는 기본값(8%)과 크게
 *     다르고, 첫 매치 승리 규칙상 이 행보다 위에 폭넓은 키워드(예: 의류·완구 관련 다른
 *     행)가 없어야 레고류가 올바로 0%로 떨어진다.
 *   - '가방/핸드백' 행은 '스카프/숄/넥타이/장갑' 행보다 반드시 위에 있어야 한다.
 *     '숄더백'.includes('숄')이 true이므로, 순서가 뒤바뀌면 숄더백이 (가방이 아니라)
 *     스카프/숄 행에서 매칭돼 버린다. 현재는 두 행 모두 8%라 증상이 없지만, 둘 중
 *     하나의 세율만 바뀌어도 즉시 드러나는 잠복 버그였다.
 */
const TARIFF_TABLE: ReadonlyArray<{ keywords: readonly string[]; rate: number }> = [
  // WTO 양허세율 0% (HS 9503.00 조립식 완구·퍼즐). 0%가 기본값과 크게 달라 순서가
  // load-bearing하므로 맨 위에 둔다. 액션피규어·인형은 WTO 양허세율이 13%라 기본세율
  // 8%가 그대로 적용되므로(min(8%, 13%)=8%) 별도 행이 필요 없다.
  { keywords: ['레고', '블럭', '퍼즐'], rate: 0 },
  { keywords: ['의류', '수영복', '속옷', '신발'], rate: 0.13 },
  { keywords: ['우산'], rate: 0.13 }, // 미검증: 더싼배대지 고시만 근거. 관세청 교차검증 안 함
  { keywords: ['카페트'], rate: 0.1 }, // 미검증: 더싼배대지 고시만 근거. 관세청 교차검증 안 함
  { keywords: ['가방', '핸드백'], rate: 0.08 },
  { keywords: ['스카프', '숄', '넥타이', '장갑'], rate: 0.08 },
  { keywords: ['액세서리', '악세서리', '선글라스'], rate: 0.08 },
  // WTO 양허세율 6.5% (HS 3303/3304). 배대지 고시의 8%는 기본세율만 반영한 값으로,
  // 원산지증명서 없이도 자동 적용되는 협정세율(6.5%)보다 높아 그대로 쓰면 과다계상된다.
  { keywords: ['화장품', '향수'], rate: 0.065 },
  // 면도기/다리미/헤어용품, 유리식기, 액션피규어·인형, 건강보조식품/과자류,
  // 카메라렌즈/공기청정기 등도 실제 적용 세율이 8%다. 이들은 DEFAULT_TARIFF_RATE(8%)와
  // 정확히 같은 값이므로 행으로 등재하지 않는다 — 등재해도 동작이 바뀌지 않고
  // 유지보수 부담만 늘어난다. 빠뜨린 것이 아니라 의도적으로 생략한 것이다.
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
  /**
   * 과세가격 + 관세 + 부가세 (과세가격 완납 후 가치).
   * 주의: 이 값을 그대로 `purchaseCostKrw`에 대입하지 말 것 — 둘은 실제로 같지 않다.
   * `purchaseCostKrw`에는 관세사 수임료 등 과세운임에 포함되지 않은 비용이 별도로
   * 더 필요할 수 있다.
   */
  dutyPaidValueKrw: number;
}

export function calcImportTax(input: ImportTaxInput): ImportTaxResult {
  const dutiableValueKrw = Math.round(input.goodsKrw + input.dutiableFreightKrw);
  const tariffKrw = Math.round(dutiableValueKrw * input.tariffRate);
  const importVatKrw = Math.round((dutiableValueKrw + tariffKrw) * IMPORT_VAT_RATE);
  return {
    dutiableValueKrw,
    tariffKrw,
    importVatKrw,
    dutyPaidValueKrw: dutiableValueKrw + tariffKrw + importVatKrw,
  };
}
