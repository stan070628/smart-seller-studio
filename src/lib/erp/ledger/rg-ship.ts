// src/lib/erp/ledger/rg-ship.ts
// RG 보내기 → 원장 self → rg_inbound 이동(SKU별). 옛 rg-shipments 라우트의 트랜잭션 안에서 부른다.
// 원장 전표가 하나도 없는 SKU는 건너뛴다(기초재고 전에도 옛 원가 배분 흐름이 막히지 않게) — 호출자가 사용자에게 알린다.
// 전표가 있는데 집 재고가 모자라면 던진다 — 호출자가 전부 되돌린다. 입고 완료(rg_inbound → rg)는 1-C2.
import { InsufficientStockError } from './fifo';
import { lockSku, postTransfer, type Db } from './store';

export interface RgShipSkuItem {
  skuId: number;
  qty: number;
}

export class RgShipInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RgShipInputError';
  }
}

export class RgShipStockError extends Error {
  constructor(public readonly skuId: number, public readonly need: number, public readonly have: number) {
    super(`SKU ${skuId}: 집 원장 재고 ${have}개 < 보낼 ${need}개`);
    this.name = 'RgShipStockError';
  }
}

/** 요청 본문 sku_items: [{ sku_id, quantity }]. 없으면 [](옛 화면) */
export function validateRgShipItems(raw: unknown): RgShipSkuItem[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new RgShipInputError('sku_items는 [{ sku_id, quantity }] 배열이다');
  const seen = new Set<number>();
  return raw.map((x) => {
    const o = (x ?? {}) as { sku_id?: unknown; quantity?: unknown };
    const skuId = Number(o.sku_id);
    const qty = Number(o.quantity);
    if (!Number.isInteger(skuId) || skuId <= 0) throw new RgShipInputError(`sku_id가 잘못됐다: ${String(o.sku_id)}`);
    if (!Number.isInteger(qty) || qty <= 0) throw new RgShipInputError(`SKU ${skuId} 수량은 양의 정수다: ${String(o.quantity)}`);
    if (seen.has(skuId)) throw new RgShipInputError(`SKU ${skuId}가 두 번 있다`);
    seen.add(skuId);
    return { skuId, qty };
  });
}

export async function postRgShipTransfers(
  db: Db,
  p: { eventId: string; occurredAt: string; note: string | null; items: RgShipSkuItem[] },
): Promise<{ posted: RgShipSkuItem[]; skipped: (RgShipSkuItem & { reason: 'no_ledger' })[] }> {
  if (p.items.length === 0) return { posted: [], skipped: [] };
  const items = [...p.items].sort((a, b) => a.skuId - b.skuId);
  const { rows } = await db.query(
    `select s.id, s.status, exists (select 1 from erp.stock_ledger l where l.sku_id = s.id) as has_ledger
       from erp.skus s where s.id = any($1::bigint[])`,
    [items.map((i) => i.skuId)],
  );
  const byId = new Map(rows.map((r) => [Number(r.id), r as { status: string; has_ledger: boolean }]));
  for (const i of items) {
    const s = byId.get(i.skuId);
    if (!s || s.status !== 'active') throw new RgShipInputError(`SKU ${i.skuId}가 활성 SKU가 아니다`);
  }
  // 1-B 인계(I4): 여러 SKU는 오름차순으로 먼저 잠근다
  for (const i of items) await lockSku(db, i.skuId);
  const posted: RgShipSkuItem[] = [];
  const skipped: (RgShipSkuItem & { reason: 'no_ledger' })[] = [];
  for (const i of items) {
    if (!byId.get(i.skuId)!.has_ledger) {
      skipped.push({ ...i, reason: 'no_ledger' });
      continue;
    }
    try {
      await postTransfer(db, {
        skuId: i.skuId, from: 'self', to: 'rg_inbound', qty: i.qty, occurredAt: p.occurredAt,
        idemKey: `rgship:${p.eventId}:${i.skuId}`, refType: 'rg_shipment', refId: p.eventId, note: p.note ?? undefined,
      });
    } catch (e) {
      if (e instanceof InsufficientStockError) throw new RgShipStockError(i.skuId, e.need, e.have);
      throw e;
    }
    posted.push(i);
  }
  return { posted, skipped };
}
