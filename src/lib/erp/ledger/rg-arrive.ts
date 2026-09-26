// src/lib/erp/ledger/rg-arrive.ts
// RG 입고 완료 → 원장 rg_inbound → rg 이동(SKU별). 재고 화면의 RG 대조에서 사람이 「입고 완료 m개 옮기기」를 눌렀을 때.
// 1-C1에는 자동 입고 완료(쿠팡 입고 확인)가 없다 — 보낸 물건이 RG에 들어가면 원장은 rg_inbound에 남고
// RG 실재고는 늘어 「RG 차이 +」로 보인다. 그 차이를 「반영」(rg 지금 개수 조정)으로 맞추면 rg_inbound가 그대로 남아
// 같은 물건이 두 번 세어진다 — 그래서 입고중에서 옮기는 길을 따로 둔다.
// 멱등키 rgdone:<uuid>(요청마다 화면이 만든다). 되돌리기 가능(adjust.ts isReversibleKey).
import { AdjustInputError, AdjustItemError } from './adjust';
import { lockSku, postTransfer, type Db } from './store';

export interface RgArriveItem {
  skuId: number;
  qty: number;
  requestId: string;
}

export interface RgArriveResult extends RgArriveItem {
  /** duplicate = 같은 요청 id가 이미 기록돼 아무것도 쓰지 않았다 */
  outcome: 'posted' | 'duplicate';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_RG_ARRIVE_ITEMS = 300;

export const rgArriveIdemKey = (requestId: string): string => `rgdone:${requestId}`;

/** 요청 본문 items → 검사한 목록. 요청 id는 소문자로 맞춘다(대소문자만 다른 재전송도 같은 요청) */
export function validateRgArriveItems(raw: unknown): RgArriveItem[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_RG_ARRIVE_ITEMS) {
    throw new AdjustInputError(`items는 1~${MAX_RG_ARRIVE_ITEMS}건 배열이다`);
  }
  const skus = new Set<number>();
  const reqs = new Set<string>();
  return raw.map((x) => {
    const o = (x ?? {}) as { skuId?: unknown; qty?: unknown; requestId?: unknown };
    const skuId = typeof o.skuId === 'number' ? o.skuId : NaN;
    const qty = typeof o.qty === 'number' ? o.qty : NaN;
    if (!Number.isInteger(skuId) || skuId <= 0) throw new AdjustInputError(`skuId가 잘못됐다: ${String(o.skuId)}`);
    if (!Number.isInteger(qty) || qty <= 0) throw new AdjustInputError(`SKU ${skuId} 옮길 수량은 양의 정수다: ${String(o.qty)}`);
    if (typeof o.requestId !== 'string' || !UUID.test(o.requestId)) throw new AdjustInputError(`요청 id는 uuid다: ${String(o.requestId)}`);
    const requestId = o.requestId.toLowerCase();
    if (skus.has(skuId)) throw new AdjustInputError(`SKU ${skuId}가 두 번 있다`);
    if (reqs.has(requestId)) throw new AdjustInputError(`요청 id가 두 번 쓰였다: ${requestId}`);
    skus.add(skuId);
    reqs.add(requestId);
    return { skuId, qty, requestId };
  });
}

/**
 * 호출자가 연 트랜잭션 안에서 부른다. SKU 오름차순으로 먼저 모두 잠근다(1-B 인계 I4 — 교착 방지).
 * 입고중 재고가 모자라면 AdjustItemError(inner = InsufficientStockError)로 던진다 — 호출자가 전부 되돌린다(409).
 * 결과는 SKU 오름차순.
 */
export async function postRgArrivals(db: Db, items: RgArriveItem[], occurredAt: string): Promise<RgArriveResult[]> {
  const indexed = items.map((it, index) => ({ it, index })).sort((a, b) => a.it.skuId - b.it.skuId);
  for (const { it } of indexed) await lockSku(db, it.skuId);
  const out: RgArriveResult[] = [];
  for (const { it, index } of indexed) {
    try {
      const r = await postTransfer(db, {
        skuId: it.skuId, from: 'rg_inbound', to: 'rg', qty: it.qty, occurredAt,
        idemKey: rgArriveIdemKey(it.requestId), refType: 'rg_arrive', refId: it.requestId, note: 'RG 입고 완료',
      });
      out.push({ ...it, outcome: r.posted ? 'posted' : 'duplicate' });
    } catch (e) {
      throw new AdjustItemError(index, it.skuId, 'rg_inbound', e);
    }
  }
  return out;
}
