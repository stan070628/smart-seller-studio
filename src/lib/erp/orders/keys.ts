// src/lib/erp/orders/keys.ts
// 외부 id 검사 · 판매 멱등키 · 옛 장부(sale_records) 키.
import { assertIdemKey } from '@/lib/erp/ledger/plan';
import type { ShippingSource } from '@/lib/cost-management/sale-shipping';
import type { OrderChannel } from './types';

// 라인 키는 멱등키 안에 들어간다: '#'(전표 순번)·'@'(차감 버전)·공백이 섞이면 다른 전표와 키가 겹친다. DB check와 같은 식
const EXT_ID = /^[0-9A-Za-z_-]+(:[0-9A-Za-z_-]+)*$/;

export function assertExternalId(v: string, what: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 120 || !EXT_ID.test(v)) {
    throw new RangeError(`${what}가 잘못됐다: ${String(v)}`);
  }
  return v;
}

/** 판매 차감 멱등키. SKU를 붙인다 — postConsume·reverse는 SKU 하나 단위라 bundle 라인의 SKU마다 키가 달라야 한다 */
export function saleIdemKey(channel: OrderChannel, externalLineId: string, skuId: number, version: number): string {
  assertExternalId(externalLineId, '라인 키');
  if (!Number.isInteger(skuId) || skuId <= 0) throw new RangeError(`skuId가 잘못됐다: ${skuId}`);
  if (!Number.isInteger(version) || version < 1) throw new RangeError(`차감 버전은 1 이상이다: ${version}`);
  const k = `sale:${channel}:${externalLineId}:s${skuId}${version >= 2 ? `@${version}` : ''}`;
  assertIdemKey(k);
  return k;
}

/** 옛 장부 키 — 옛 불러오기 버튼과 같은 형식이라 과거 행과 겹쳐도 두 번 세지 않는다 */
export function legacyKeyOf(l: { channel: OrderChannel; externalOrderId: string; externalLineId: string; productId: string }): string {
  switch (l.channel) {
    case 'coupang_wing':
      return `wing-${l.externalOrderId}-${l.productId}`;
    case 'coupang_rg':
      return `rg-${l.externalOrderId}-${l.productId}`;
    case 'naver':
      return `naver-${l.externalLineId}`;
    case 'toss':
      return `toss-${l.externalLineId}`;
  }
}

/** sale_records.channel */
export const LEGACY_CHANNEL: Record<OrderChannel, string> = {
  coupang_wing: 'coupang',
  coupang_rg: 'rocket_growth',
  naver: 'naver',
  toss: 'toss',
};

/** sale_records.shipping_fee 산정 소스(resolveSaleShippingFee) */
export const SHIPPING_SOURCE: Record<OrderChannel, ShippingSource> = {
  coupang_wing: 'wing',
  coupang_rg: 'rg',
  naver: 'naver',
  toss: 'toss',
};

/** 상품별 불러오기(coupang-import)가 남긴 무접두 Wing 키 `<orderId>-<vid>` — 새 키를 쓸 때 무효화한다(판매자배송 이중 기록 제거) */
export const bareWingKey = (legacyKey: string): string | null => (legacyKey.startsWith('wing-') ? legacyKey.slice('wing-'.length) : null);
