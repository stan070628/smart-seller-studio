/**
 * deli-policy.ts
 * 도매꾹 deli 필드에서 배송비 정책을 파싱하고 개당 배송비로 환산한다.
 *
 * 기존 deli-parser.ts와의 차이:
 *   deli-parser.parseEffectiveDeliFee는 "구간 요금"(한 번 주문 시 붙는 금액)을 반환한다.
 *   listing이 총원가에 1회 더하는 용법에는 그게 맞다.
 *   쇼트리스트는 개당 원가가 필요하므로 주문 수량으로 나눠야 하고, 그러려면
 *   "30개당 3,000원"의 30을 알아야 한다. 그래서 정책 구조를 그대로 보존한다.
 */

import type { DeliPolicy } from '@/types/shortlist';

const FREE: DeliPolicy = { isFree: true, type: 'fixed', unitQty: null, fee: 0 };

function toInt(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * getItemView 응답의 deli 필드를 배송비 정책으로 파싱한다.
 * 형태가 버전·상품마다 달라 unknown으로 받는다.
 */
export function parseDeliPolicy(deli: unknown): DeliPolicy {
  if (!deli || typeof deli !== 'object') return FREE;
  const raw = deli as Record<string, unknown>;

  // 무료배송 판단 — 신형은 pay, 구형은 who
  const pay = typeof raw.pay === 'string' ? raw.pay : '';
  const who = typeof raw.who === 'string' ? raw.who : '';
  if (pay === '무료' || who === 'S') return FREE;

  const dome = raw.dome as Record<string, unknown> | undefined;

  // 수량별비례: tbl "30+3000|30+3000" → 첫 구간만 사용
  // 두 번째 이후 구간은 실제 응답에서 동일 값 반복이었고, 검증 물량(10개 내외)에서는
  // 첫 구간을 넘지 않는다. 넘을 때는 unitDeliveryFee가 ceil 배수로 근사한다.
  const tblRaw = dome?.tbl ?? raw.tbl;
  if (typeof tblRaw === 'string' && tblRaw.includes('+')) {
    const [qtyPart, feePart] = tblRaw.split('|')[0].split('+');
    const unitQty = toInt(qtyPart);
    const fee = toInt(feePart);
    if (unitQty > 0 && fee > 0) {
      return { isFree: false, type: 'tiered', unitQty, fee };
    }
  }

  // 고정배송비
  const fee = toInt(dome?.fee ?? raw.fee);
  if (fee > 0) return { isFree: false, type: 'fixed', unitQty: null, fee };

  return FREE;
}

/**
 * 주문 수량 기준 개당 배송비(원).
 *
 * 개당 배송비는 주문 수량에 따라 달라진다.
 * "30개당 3,000원"을 10개 주문하면 개당 300원, 30개 주문하면 개당 100원이다.
 */
export function unitDeliveryFee(policy: DeliPolicy, orderQty: number): number {
  if (policy.isFree || orderQty <= 0) return 0;

  const total =
    policy.type === 'tiered' && policy.unitQty && policy.unitQty > 0
      ? Math.ceil(orderQty / policy.unitQty) * policy.fee
      : policy.fee;

  return Math.ceil(total / orderQty);
}
