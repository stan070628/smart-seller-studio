// src/lib/erp/ledger/rg-ship.ts
// RG 보내기 → 원장 self → rg_inbound 이동(SKU별). 옛 rg-shipments 라우트의 트랜잭션 안에서 부른다.
// self(집) 위치에 원장 전표가 하나도 없는 SKU는 건너뛴다(기초재고 전에도 옛 원가 배분 흐름이 막히지 않게) —
// 호출자가 사용자에게 알린다. 'rg' 등 다른 위치에만 전표가 있는 SKU도 옮길 원본(self)이 비어 있으므로 건너뛴다.
// self 전표가 있는데 집 재고가 모자라면 던진다 — 호출자가 전부 되돌린다. 입고 완료(rg_inbound → rg)는 1-C1에서는 사람이
// 재고 화면 RG 대조의 「입고 완료 m개 옮기기」로(rg-arrive.ts), 자동 판정은 1-C2.
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
): Promise<{ posted: RgShipSkuItem[]; skipped: (RgShipSkuItem & { reason: 'no_self_ledger' })[] }> {
  if (p.items.length === 0) return { posted: [], skipped: [] };
  const items = [...p.items].sort((a, b) => a.skuId - b.skuId);
  const { rows } = await db.query(
    `select s.id, s.status from erp.skus s where s.id = any($1::bigint[])`,
    [items.map((i) => i.skuId)],
  );
  const byId = new Map(rows.map((r) => [Number(r.id), r as { status: string }]));
  for (const i of items) {
    const s = byId.get(i.skuId);
    if (!s || s.status !== 'active') throw new RgShipInputError(`SKU ${i.skuId}가 활성 SKU가 아니다`);
  }
  // 1-B 인계(I4): 여러 SKU는 오름차순으로 먼저 잠근다
  for (const i of items) await lockSku(db, i.skuId);

  // self 위치에 원장 전표가 있는지는 잠금을 다 잡은 뒤에 다시 확인한다 — 검사와 잠금 사이에
  // 다른 트랜잭션이 self 첫 전표(기초재고 등)를 끼워 넣었을 수 있어, 잠금 전에 본 값은 낡을 수 있다.
  // 위치를 self로 좁힌 이유: 'rg' 위치에만 전표가 있는 SKU(예: RG 재고만 있고 집 재고는 아직 없음)를
  // "원장 있음"으로 잘못 판단해 postTransfer(self→rg_inbound)를 태우면 재고 부족(409)으로 던진다 —
  // 여기서는 옮길 원본 위치가 self이므로 self 전표 존재 여부만 봐야 한다.
  const { rows: ledgerRows } = await db.query(
    `select s.id, exists (select 1 from erp.stock_ledger l where l.sku_id = s.id and l.location = 'self') as has_self_ledger
       from erp.skus s where s.id = any($1::bigint[])`,
    [items.map((i) => i.skuId)],
  );
  const hasSelfLedger = new Map(ledgerRows.map((r) => [Number(r.id), r.has_self_ledger === true]));

  const posted: RgShipSkuItem[] = [];
  const skipped: (RgShipSkuItem & { reason: 'no_self_ledger' })[] = [];
  for (const i of items) {
    if (!hasSelfLedger.get(i.skuId)) {
      skipped.push({ ...i, reason: 'no_self_ledger' });
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
