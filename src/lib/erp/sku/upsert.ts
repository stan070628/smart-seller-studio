// src/lib/erp/sku/upsert.ts
// SKU 초안 행 → erp.skus · erp.channel_listings · erp.listing_skus.
// 전체 적재(scripts/erp/sku-apply.ts --apply)와 상품 하나 추가(sync-product.ts)가 같이 쓴다.
// 보관·비활성화·연결 삭제(정리)는 전체 적재 전용이라 여기 없다.
// 호출자가 트랜잭션을 열고 lockSkuMaster를 먼저 잡는다.
// 원가 연결(legacy_product_cost_ids)은 DB 값과 초안 값의 합집합으로 둔다 — 초안은 옛 판매 기록으로만 연결을 찾아,
// 사람이 손으로 붙인 연결(2026-10-05 콜맨·트루릴리젼·마크곤잘레스)을 모른다. 지우면 옛 장부 경고가 되살아난다.
import type { Db } from '@/lib/erp/ledger/store';
import type { Draft, DraftLink, DraftListing, DraftSku } from './draft';

type Q = Pick<Db, 'query'>;
export type DraftRows = Pick<Draft, 'skus' | 'listings' | 'links'>;

/**
 * SKU 마스터 쓰기 잠금(pg_advisory_xact_lock(bigint)). 전체 적재와 상품 하나 추가가 겹쳐 쓰지 않게 한다.
 * 7101(원장 SKU, int 쌍)·7102(기초재고 bigint · 주문 채널 int 쌍)와 겹치지 않는다.
 */
export const SKU_MASTER_LOCK = 7103;

export async function lockSkuMaster(db: Q): Promise<void> {
  await db.query('select pg_advisory_xact_lock($1::bigint)', [SKU_MASTER_LOCK]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 적재 전 불변식. 하나라도 어긋나면 던진다(DB에 쓰기 전에). */
export function validateDraft(d: DraftRows): void {
  const errs: string[] = [];
  if (d.skus.length === 0 || d.listings.length === 0 || d.links.length === 0) errs.push('SKU·리스팅·연결 중 비어 있는 것이 있다');
  const skuKeys = new Set<string>();
  for (const s of d.skus) {
    if (skuKeys.has(s.key)) errs.push(`SKU 키 중복: ${s.key}`);
    skuKeys.add(s.key);
    if (!s.name) errs.push(`SKU 이름 없음: ${s.key}`);
    for (const id of s.legacyProductCostIds) if (!UUID.test(id)) errs.push(`uuid 아님: ${s.key} → ${id}`);
  }
  const listingKeys = new Set<string>();
  const uniq = new Set<string>();
  for (const l of d.listings) {
    if (listingKeys.has(l.key)) errs.push(`리스팅 키 중복: ${l.key}`);
    listingKeys.add(l.key);
    const u = `${l.channel}|${l.externalProductId}|${l.externalOptionKey}`;
    if (uniq.has(u)) errs.push(`리스팅 유니크 키 중복: ${u}`);
    uniq.add(u);
  }
  const linkCount = new Map<string, number>();
  const linkPair = new Set<string>();
  for (const k of d.links) {
    if (!listingKeys.has(k.listingKey)) errs.push(`연결의 리스팅이 없다: ${k.listingKey} → ${k.skuKey}`);
    if (!skuKeys.has(k.skuKey)) errs.push(`연결의 SKU가 없다: ${k.listingKey} → ${k.skuKey}`);
    if (!Number.isInteger(k.multiplier) || k.multiplier <= 0) errs.push(`배수가 양의 정수가 아니다: ${k.listingKey} → ${k.skuKey} = ${k.multiplier}`);
    const p = `${k.listingKey}→${k.skuKey}`;
    if (linkPair.has(p)) errs.push(`연결 중복: ${p}`);
    linkPair.add(p);
    linkCount.set(k.listingKey, (linkCount.get(k.listingKey) ?? 0) + 1);
  }
  for (const l of d.listings) {
    const n = linkCount.get(l.key) ?? 0;
    if (n === 0) errs.push(`연결 없는 리스팅: ${l.key}`);
    else if (l.linkMode === 'single' && n !== 1) errs.push(`single인데 SKU ${n}개: ${l.key}`);
    else if (l.linkMode === 'any_of' && n < 2) errs.push(`any_of인데 SKU ${n}개: ${l.key}`);
  }
  if (errs.length > 0) throw new Error(`불변식 위반 ${errs.length}건:\n  ${errs.slice(0, 30).join('\n  ')}`);
}

/** 키 기준 upsert(draft 행만 덮는다). 키 → erp.skus.id */
export async function upsertSkus(db: Q, skus: DraftSku[]): Promise<Map<string, number>> {
  const skuId = new Map<string, number>();
  for (const s of skus) {
    const { rows } = await db.query(
      `insert into erp.skus (key, name, option_label, base_unit_label, status, legacy_product_cost_ids, origin)
         values ($1, $2, $3, $4, $5, $6::uuid[], 'draft')
         on conflict (key) do update set name = excluded.name, option_label = excluded.option_label,
           base_unit_label = excluded.base_unit_label, status = excluded.status,
           legacy_product_cost_ids = array(select distinct x from unnest(erp.skus.legacy_product_cost_ids || excluded.legacy_product_cost_ids) as x order by x),
           updated_at = now()
         where erp.skus.origin = 'draft'
         returning id`,
      [s.key, s.name, s.optionLabel, s.baseUnitLabel, s.status, s.legacyProductCostIds],
    );
    if (rows.length === 0) throw new Error(`초안 키 ${s.key}가 manual SKU와 겹친다 — 초안을 고친다`);
    skuId.set(s.key, Number(rows[0].id));
  }
  return skuId;
}

/** (channel, external_product_id, external_option_key) 기준 upsert(draft 행만 덮는다). 리스팅 키 → erp.channel_listings.id */
export async function upsertListings(db: Q, listings: DraftListing[]): Promise<Map<string, number>> {
  const listingId = new Map<string, number>();
  for (const l of listings) {
    const { rows } = await db.query(
      `insert into erp.channel_listings (channel, external_product_id, external_option_key, alt_product_id, label, link_mode, active, origin)
         values ($1, $2, $3, $4, $5, $6, true, 'draft')
         on conflict (channel, external_product_id, external_option_key) do update
           set alt_product_id = excluded.alt_product_id, label = excluded.label, link_mode = excluded.link_mode, active = true
         where erp.channel_listings.origin = 'draft'
         returning id`,
      [l.channel, l.externalProductId, l.externalOptionKey, l.altProductId, l.label, l.linkMode],
    );
    if (rows.length === 0) throw new Error(`초안 리스팅 ${l.key}가 manual 리스팅과 겹친다 — 초안을 고친다`);
    listingId.set(l.key, Number(rows[0].id));
  }
  return listingId;
}

/** 연결을 넣는다(이미 있으면 그대로). manual 연결과 겹치면 던진다 */
export async function insertLinks(db: Q, links: DraftLink[], skuId: Map<string, number>, listingId: Map<string, number>): Promise<void> {
  for (const k of links) {
    const lid = listingId.get(k.listingKey);
    const sid = skuId.get(k.skuKey);
    if (!lid || !sid) throw new Error(`연결 대상 누락: ${k.listingKey} → ${k.skuKey}`);
    const { rows } = await db.query(
      `insert into erp.listing_skus (listing_id, sku_id, multiplier, origin) values ($1, $2, $3, 'draft')
         on conflict (listing_id, sku_id) do nothing
         returning 1`,
      [lid, sid, k.multiplier],
    );
    if (rows.length === 0) throw new Error(`연결 ${k.listingKey}→${k.skuKey}가 manual 연결과 겹친다 — 초안을 고친다`);
  }
}
