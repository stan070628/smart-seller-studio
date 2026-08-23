/**
 * 로켓그로스 사이즈 유형별 물류비 (입출고비 + 배송비)
 *
 * 출처: 쿠팡 판매자센터 > 예상 정산액 화면 **실청구 실측** (2026-08-13 조회)
 *      직전 판은 요금표(2026-07-28 조회)의 "600원~" 형태 **최소값**이었고,
 *      실청구가 그 1.6~1.9배임이 확인되어 실측값으로 교체했다.
 *
 * 사이즈 판정: 개별 포장 상품의 세 변의 합(cm)과 무게(kg)를 **모두** 충족해야 해당 유형이며,
 *             둘 중 하나라도 초과하면 상위 사이즈로 분류된다.
 *             최종 유형은 물류센터 최초 입고 시 실측값으로 결정되며,
 *             **입고 이후에는 판매자가 변경할 수 없다**(윙 온라인 문의만 가능).
 *
 * 신규 판매자 90일 무료 프로모션은 2026-07-31 종료되었으며,
 * 종료 시점 기준 **이미 입고된 재고에도 판매 시점에 부과**된다.
 * 정산 실측에서 개당 공제액이 7월 395원 → 8월 2,791원(7.1배)으로 뛴 것이 그 증거다.
 *
 * ⚠️ **같은 극소형에서 관측이 두 값으로 갈린다.**
 *    극세사 블루(69.7cm · 판매가 12,200원) 2,800원 · 덴프스 NMN(43.6cm · 판매가 38,200원) 3,725원.
 *    더 작은 쪽이 925원 더 비싸 사이즈로 설명되지 않으며, 판매가 구간인지 카테고리 요율인지
 *    관측 3점으로는 확정할 수 없다. 아래 표는 **다수 상품이 속하는 저가 극소형 실측(2,800원)**을
 *    기본값으로 쓴다 — 고가 극소형 상품의 마진은 그만큼 과대평가된다.
 *
 * ⚠️ 화면 금액이 "예상" 정산액이지 실제 청구서가 아니다. `settlements` 실제 정산서가 확보되면
 *    cost_entries.unit_rg_shipping_fee 에 입력하고, 그 값이 아래 기본값보다 우선 적용된다.
 *
 * 아래 요율은 모두 **VAT 별도 고지값**이다. 실질 부담액은 `resolveRgShippingFee`가 반환한다.
 */

import { effectiveCost } from '@/lib/tax';

export const RG_SIZE_TYPES = [
  'extra_small',
  'small',
  'medium',
  'large1',
  'large2',
  'extra_large',
] as const;

export type RgSizeType = (typeof RG_SIZE_TYPES)[number];

interface RgSizeSpec {
  /** 판매자센터 표기 명칭 */
  label: string;
  /** 입출고비 (원) */
  inboundOutboundFee: number;
  /** 배송비 (원) */
  deliveryFee: number;
  /** 세 변의 합 상한 (cm). null 이면 상한 없음 */
  maxDimensionSum: number | null;
  /** 무게 상한 (kg). null 이면 상한 없음 */
  maxWeightKg: number | null;
  /**
   * 실청구 정산 화면으로 확인된 값인가.
   * false면 요금표 최소값에 실측 배율을 적용한 **추정치**이며 실제 청구액은 다를 수 있다.
   */
  measured: boolean;
}

/**
 * 미실측 사이즈에 적용하는 실청구 배율.
 *
 * 실측 2건에서 극소형 1.62배·소형 1.91배가 확인됐고, 중형 이상은 실측이 없다.
 * 사이즈가 커질수록 배율이 높아지는 방향이므로 **관측된 최대 배율(1.9)**을 쓴다.
 * 마진을 낙관적으로 잡아 적자 상품을 흑자로 오판하는 쪽이 반대보다 비싸기 때문이다.
 */
const UNMEASURED_SURCHARGE_MULTIPLIER = 1.9;

/** 요금표 최소값(2026-07-28)에 배율을 적용한 추정 요율 */
const estimate = (listedFee: number) => Math.round(listedFee * UNMEASURED_SURCHARGE_MULTIPLIER);

export const RG_SIZE_SPECS: Record<RgSizeType, RgSizeSpec> = {
  // 극소형·소형은 2026-08-13 예상 정산액 화면 실측값이다 (극세사 타월 블루/옐로우).
  // 요금표 최소값은 각각 600+1,125 / 650+1,250 이었다.
  extra_small: { label: '극소형', inboundOutboundFee: 1025, deliveryFee: 1775, maxDimensionSum: 80, maxWeightKg: 2, measured: true },
  small: { label: '소형', inboundOutboundFee: 1350, deliveryFee: 2275, maxDimensionSum: 100, maxWeightKg: 5, measured: true },
  // 중형 이상은 실측이 없다. 전 SKU 스캔(2026-08-13) 결과 로켓그로스 34개 옵션 중
  // 중형 이상이 0건이라 측정 대상 자체가 없었다. 요금표 최소값 × 1.9 추정치를 쓴다.
  medium: { label: '중형', inboundOutboundFee: estimate(1240), deliveryFee: estimate(1500), maxDimensionSum: 120, maxWeightKg: 10, measured: false },
  // 대형 이상은 요금표조차 미확인. 확인 전까지 중형 요율을 하한으로 사용한다.
  large1: { label: '대형1', inboundOutboundFee: estimate(1240), deliveryFee: estimate(1500), maxDimensionSum: 140, maxWeightKg: 15, measured: false },
  large2: { label: '대형2', inboundOutboundFee: estimate(1240), deliveryFee: estimate(1500), maxDimensionSum: 160, maxWeightKg: 20, measured: false },
  extra_large: { label: '특대형', inboundOutboundFee: estimate(1240), deliveryFee: estimate(1500), maxDimensionSum: 250, maxWeightKg: 30, measured: false },
};

/**
 * 사이즈 유형별 개당 물류비 합계 (입출고비 + 배송비).
 *
 * ⚠️ **고지 금액(VAT 별도)이다.** 실질 부담액이 필요하면 `resolveRgShippingFee`를 쓸 것.
 */
export function getRgShippingFee(sizeType: RgSizeType | null | undefined): number {
  if (!sizeType) return 0;
  const spec = RG_SIZE_SPECS[sizeType];
  if (!spec) return 0;
  return spec.inboundOutboundFee + spec.deliveryFee;
}

/**
 * 실효 로켓그로스 물류비 — **VAT 포함 실질 부담액**.
 *
 * 로켓그로스 입출고·배송 비용은 VAT 별도로 고지된다
 * (서비스 소개서 2025-01, 6p: "판매 완료 시 비용이 부과됩니다. (VAT별도)").
 * 간이과세자는 이 VAT를 매입세액으로 공제받지 못하므로 그대로 비용이 된다.
 *
 * 실측값(정산서 기반)이 있으면 그것을 쓰고, 없으면 사이즈 유형 기본값에 VAT를 반영한다.
 * 실측값은 이미 실제 차감액이므로 VAT를 다시 곱하지 않는다.
 */
export function resolveRgShippingFee(
  measuredFee: number | null | undefined,
  sizeType: RgSizeType | null | undefined,
): number {
  if (measuredFee && measuredFee > 0) return measuredFee;
  return effectiveCost(getRgShippingFee(sizeType));
}

/** 판매자센터 표기 명칭 → 내부 코드 */
const LABEL_TO_TYPE: Record<string, RgSizeType> = Object.fromEntries(
  (Object.entries(RG_SIZE_SPECS) as [RgSizeType, RgSizeSpec][]).map(([type, spec]) => [spec.label, type]),
) as Record<string, RgSizeType>;

export function rgSizeTypeFromLabel(label: string | null | undefined): RgSizeType | null {
  if (!label) return null;
  return LABEL_TO_TYPE[label.trim()] ?? null;
}

export function rgSizeLabel(sizeType: RgSizeType | null | undefined): string {
  if (!sizeType) return '미지정';
  return RG_SIZE_SPECS[sizeType]?.label ?? '미지정';
}
