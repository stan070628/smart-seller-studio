import { describe, it, expect } from 'vitest';
import { resolveSaleShippingFee, DEFAULT_PARCEL_SHIPPING_FEE } from '@/lib/cost-management/sale-shipping';

describe('resolveSaleShippingFee', () => {
  it('윙은 기본 택배비', () => {
    expect(resolveSaleShippingFee('wing')).toBe(DEFAULT_PARCEL_SHIPPING_FEE);
    expect(DEFAULT_PARCEL_SHIPPING_FEE).toBe(3500);
  });
  it('네이버는 기본 택배비', () => {
    expect(resolveSaleShippingFee('naver')).toBe(3500);
  });
  it('RG는 0 (unit_rg_shipping_fee로 별도 반영)', () => {
    expect(resolveSaleShippingFee('rg')).toBe(0);
  });
});
