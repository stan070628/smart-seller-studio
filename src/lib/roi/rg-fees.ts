/**
 * 로켓그로스 사이즈 유형별 물류비 (입출고비 + 배송비)
 *
 * 출처: 쿠팡 판매자센터 > 로켓그로스 비용/수수료 (2026-07-28 조회)
 * 사이즈 판정: 개별 포장 상품의 세 변의 합(cm)과 무게(kg)를 **모두** 충족해야 해당 유형이며,
 *             둘 중 하나라도 초과하면 상위 사이즈로 분류된다.
 *             최종 유형은 물류센터 최초 입고 시 실측값으로 결정된다.
 *
 * 주의: 요금표는 "600원~" 형태의 최저값이며 카테고리·판매가에 따라 실제 청구액이 더 높을 수 있다.
 *      실측 정산액이 확보되면 cost_entries.unit_rg_shipping_fee 에 입력하고, 그 값이 우선 적용된다.
 *
 * 신규 판매자 90일 무료 프로모션은 2026-07-31 종료되었으며,
 * 종료 시점 기준 **이미 입고된 재고에도 판매 시점에 부과**된다.
 */

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
}

export const RG_SIZE_SPECS: Record<RgSizeType, RgSizeSpec> = {
  extra_small: { label: '극소형', inboundOutboundFee: 600, deliveryFee: 1125, maxDimensionSum: 80, maxWeightKg: 2 },
  small: { label: '소형', inboundOutboundFee: 650, deliveryFee: 1250, maxDimensionSum: 100, maxWeightKg: 5 },
  medium: { label: '중형', inboundOutboundFee: 1240, deliveryFee: 1500, maxDimensionSum: 120, maxWeightKg: 10 },
  // 대형 이상은 요금표 미확인. 확인 전까지 중형 요율을 하한으로 사용한다.
  large1: { label: '대형1', inboundOutboundFee: 1240, deliveryFee: 1500, maxDimensionSum: 140, maxWeightKg: 15 },
  large2: { label: '대형2', inboundOutboundFee: 1240, deliveryFee: 1500, maxDimensionSum: 160, maxWeightKg: 20 },
  extra_large: { label: '특대형', inboundOutboundFee: 1240, deliveryFee: 1500, maxDimensionSum: 250, maxWeightKg: 30 },
};

/** 사이즈 유형별 개당 물류비 합계 (입출고비 + 배송비) */
export function getRgShippingFee(sizeType: RgSizeType | null | undefined): number {
  if (!sizeType) return 0;
  const spec = RG_SIZE_SPECS[sizeType];
  if (!spec) return 0;
  return spec.inboundOutboundFee + spec.deliveryFee;
}

/**
 * 실효 로켓그로스 물류비.
 * 실측값(정산서 기반)이 있으면 그것을 쓰고, 없으면 사이즈 유형 기본값으로 폴백한다.
 */
export function resolveRgShippingFee(
  measuredFee: number | null | undefined,
  sizeType: RgSizeType | null | undefined,
): number {
  if (measuredFee && measuredFee > 0) return measuredFee;
  return getRgShippingFee(sizeType);
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
