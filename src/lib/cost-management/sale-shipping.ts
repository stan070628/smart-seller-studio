/** 판매자 택배 기본 배송비 (원). 윙·네이버 판매자배송 주문 1건당 차감. */
export const DEFAULT_PARCEL_SHIPPING_FEE = 3500;

/** 배송비 산정 대상 임포트 소스 */
export type ShippingSource = 'wing' | 'rg' | 'naver';

/**
 * 임포트 소스별 건당 배송비.
 * 윙·네이버(판매자 택배) = 기본 택배비, RG(로켓그로스) = 0 (unit_rg_shipping_fee로 별도 반영).
 */
export function resolveSaleShippingFee(source: ShippingSource): number {
  return source === 'rg' ? 0 : DEFAULT_PARCEL_SHIPPING_FEE;
}
