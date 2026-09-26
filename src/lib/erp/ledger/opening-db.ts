// src/lib/erp/ledger/opening-db.ts
// 기초재고 읽기(DB 읽기 전용 · 쿠팡 RG 재고 GET). scripts/erp/opening-collect.ts에서 옮겼다(1-C1) —
// 화면(실사표 불러오기·RG 대조)도 쓰므로 scripts/가 아니라 여기 둔다. 스크립트는 opening-collect에서 다시 내보낸다.
// 구매자 정보는 읽지 않는다 — sale_records에서는 product_cost별 수량 합계만.
import { getCoupangClient } from '@/lib/listing/coupang-client';
import type { Db } from './store';
import type { LegacyFacts, OpeningSku, RgLink, RgStock } from './opening';

export async function fetchRgStock(): Promise<RgStock[]> {
  const client = getCoupangClient();
  const out: RgStock[] = [];
  let token: string | null = null;
  do {
    const page = await client.getRocketGrowthInventories(token ? { nextToken: token } : undefined);
    for (const it of page.items) out.push({ vid: String(it.vendorItemId), qty: it.totalOrderableQuantity });
    token = page.nextToken;
  } while (token);
  return out;
}

/** 활성 RG 리스팅(vendorItemId) ↔ SKU 연결 */
export async function readRgLinks(db: Db): Promise<RgLink[]> {
  const { rows } = await db.query(
    `select l.external_product_id as vid, x.sku_id, x.multiplier
       from erp.channel_listings l join erp.listing_skus x on x.listing_id = l.id
      where l.channel = 'coupang_rg' and l.active`,
  );
  return rows.map((r) => ({ vid: String(r.vid), skuId: Number(r.sku_id), multiplier: Number(r.multiplier) }));
}

export async function readDb(db: Db): Promise<{ skus: OpeningSku[]; links: RgLink[]; legacy: LegacyFacts[]; baseUnitMissing: { key: string; name: string; maxMultiplier: number }[] }> {
  const skus = (await db.query(
    `select id, key, name, option_label, base_unit_label, legacy_product_cost_ids::text[] as legacy from erp.skus where status = 'active' order by id`,
  )).rows.map((r) => ({
    id: Number(r.id), key: r.key, name: r.name, optionLabel: r.option_label, legacyProductCostIds: r.legacy ?? [], baseUnitLabel: r.base_unit_label ?? null,
  }));
  const links = await readRgLinks(db);
  const entries = (await db.query(
    `select product_cost_id, received_at::text as received_at, quantity::int as quantity, unit_cost from cost_entries`,
  )).rows;
  const sales = (await db.query(
    `select product_cost_id,
            coalesce(sum(quantity) filter (where voided_at is null), 0)::int as sold,
            coalesce(sum(quantity) filter (where voided_at is not null), 0)::int as voided
       from sale_records group by product_cost_id`,
  )).rows;
  const byPc = new Map<string, LegacyFacts>();
  const get = (pc: string) => byPc.get(pc) ?? byPc.set(pc, { productCostId: pc, entries: [], soldQty: 0, voidedQty: 0 }).get(pc)!;
  for (const e of entries) get(e.product_cost_id).entries.push({ receivedAt: e.received_at, quantity: Number(e.quantity), unitCost: Number(e.unit_cost) });
  for (const s of sales) Object.assign(get(s.product_cost_id), { soldQty: Number(s.sold), voidedQty: Number(s.voided) });
  const baseUnitMissing = (await db.query(
    `select s.key, s.name, max(x.multiplier)::int as m
       from erp.skus s join erp.listing_skus x on x.sku_id = s.id
      where s.status = 'active' and s.base_unit_label is null
      group by s.key, s.name having max(x.multiplier) > 1 order by s.key`,
  )).rows.map((r) => ({ key: r.key, name: r.name, maxMultiplier: Number(r.m) }));
  return { skus, links, legacy: [...byPc.values()], baseUnitMissing };
}
