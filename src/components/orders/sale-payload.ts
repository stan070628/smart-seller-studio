export interface SaleFormInput {
  sold_at: string;
  quantity: string;
  selling_price: string;
  shipping_fee: string;
  coupon_discount: string;
  channel: string;
}

export interface SalePayload {
  sold_at: string;
  quantity: number;
  selling_price: number;
  shipping_fee: number;
  coupon_discount: number;
  channel: string;
}

export function buildSalePayload(form: SaleFormInput): SalePayload {
  return {
    sold_at: form.sold_at,
    quantity: Math.round(Number(form.quantity)),
    selling_price: Math.max(0, Math.round(Number(form.selling_price))),
    shipping_fee: Math.max(0, Math.round(Number(form.shipping_fee))),
    coupon_discount: Math.max(0, Math.round(Number(form.coupon_discount))),
    channel: form.channel,
  };
}
