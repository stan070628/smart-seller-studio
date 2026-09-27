// src/lib/erp/orders/relink.ts
// (1-C2b ①③) 저장된 주문 줄을 채널을 다시 부르지 않고 지금 리스팅·사람이 정한 SKU(manual_sku_id)로 다시 판정한다.
// 바뀐 줄만 쓰고 → 옛 장부(sale_records) → 차감(스위치를 따른다). 호출자가 트랜잭션과 채널 잠금(7102)을 잡는다.
// 차감 판정표(deduct-plan.ts)가 그대로 적용된다 — 다른 SKU로 다시 연결되면 역전표 + 새 차감, 연결만 사라진 팔림 줄은 뺀 것을 둔다.
import type { Db } from '@/lib/erp/ledger/store';
import type { DeductSummary } from './collect';
import { runDeductions } from './deduct';
import { pickLegacy } from './legacy';
import { syncLegacySales, type SyncLegacyResult } from './legacy-store';
import { applyManualSku, resolveLine, type AllocItem } from './resolve';
import { loadLegacyIndex, loadListingIndex, readCutover, readDeductSetting } from './store';
import type { OrderChannel, OrderLine, StdStatus } from './types';

export interface RelinkResult {
  checked: number;
  changed: number[];
  legacy: SyncLegacyResult | null;
  deduct: DeductSummary | null;
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const nOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const sameAlloc = (a: AllocItem[], b: AllocItem[]) => JSON.stringify(a) === JSON.stringify(b);

export async function relinkLines(db: Db, channel: OrderChannel, lineIds: number[], at: string): Promise<RelinkResult> {
  if (lineIds.length === 0) return { checked: 0, changed: [], legacy: null, deduct: null };
  const { rows } = await db.query(
    `select l.id, l.channel, o.external_order_id, l.external_line_id, l.ordered_at, l.paid_at, l.raw_status, l.status,
            l.product_id, l.option_key, l.alt_product_id, l.product_label, l.order_qty, l.unit_price, l.amount, l.manual_sku_id,
            l.listing_id, l.alloc, l.attribution, l.unattributed_reason, l.legacy_key, l.legacy_product_cost_id::text as legacy_product_cost_id, l.legacy_qty
       from erp.order_lines l join erp.orders o on o.id = l.order_id
      where l.id = any($1::bigint[]) and l.channel = $2
      order by l.id`,
    [lineIds, channel],
  );
  // 채널 조건으로 걸러져 빠진 줄이 있다 — 다른 채널의 줄이거나 존재하지 않는 id다. 호출자가 잘못된 채널로 잠금을 잡았을 수 있어
  // 조용히 건너뛰지 않고 던진다(호출자가 채널 잠금 7102를 이 채널로 잡았다고 가정하고 쓰기 때문이다).
  if (rows.length !== new Set(lineIds).size) throw new RangeError('relink: 채널이 다르거나 없는 줄이 있다');
  const listings = await loadListingIndex(db);
  const legacyIdx = await loadLegacyIndex(db);
  const changed: number[] = [];
  const keys: string[] = [];
  for (const r of rows) {
    const orderedAt = iso(r.ordered_at);
    if (orderedAt === null) throw new Error('relink: ordered_at은 not null이다 — 없으면 데이터 오류');
    const line: OrderLine = {
      channel: r.channel as OrderChannel, externalOrderId: String(r.external_order_id), externalLineId: String(r.external_line_id),
      orderedAt, paidAt: iso(r.paid_at), rawStatus: String(r.raw_status), status: r.status as StdStatus,
      productId: String(r.product_id ?? ''), optionKey: String(r.option_key ?? ''), altProductId: r.alt_product_id ?? null,
      productLabel: String(r.product_label ?? ''), qty: Number(r.order_qty), unitPrice: Number(r.unit_price), amount: Number(r.amount),
    };
    const res = applyManualSku(line, resolveLine(line, listings), nOrNull(r.manual_sku_id));
    const legacy = pickLegacy(line, res, legacyIdx);
    const oldAlloc = ((r.alloc ?? []) as AllocItem[]).map((a) => ({ skuId: Number(a.skuId), qty: Number(a.qty) }));
    const same = nOrNull(r.listing_id) === res.listingId && sameAlloc(oldAlloc, res.alloc) && r.attribution === res.attribution
      && (r.unattributed_reason ?? null) === res.reason && (r.legacy_product_cost_id ?? null) === (legacy?.productCostId ?? null)
      && nOrNull(r.legacy_qty) === (legacy?.qty ?? null);
    if (same) continue;
    await db.query(
      `update erp.order_lines set listing_id = $2, sku_id = $3, alloc = $4::jsonb, attribution = $5, unattributed_reason = $6, sku_qty = $7,
              legacy_product_cost_id = $8::uuid, legacy_qty = $9, updated_at = now()
        where id = $1`,
      [Number(r.id), res.listingId, res.alloc.length === 1 ? res.alloc[0].skuId : null, JSON.stringify(res.alloc), res.attribution, res.reason,
        res.alloc.reduce((s, a) => s + a.qty, 0), legacy?.productCostId ?? null, legacy?.qty ?? null],
    );
    changed.push(Number(r.id));
    if (typeof r.legacy_key === 'string') keys.push(r.legacy_key);
  }
  if (changed.length === 0) return { checked: rows.length, changed, legacy: null, deduct: null };
  const legacy = await syncLegacySales(db, [...new Set(keys)]);
  const setting = await readDeductSetting(db);
  const cutover = await readCutover(db);
  const deduct = await runDeductions(db, { enabled: setting.enabled, cutover, lineIds: changed, channel: null, at, includeOpen: false });
  return { checked: rows.length, changed, legacy, deduct };
}
