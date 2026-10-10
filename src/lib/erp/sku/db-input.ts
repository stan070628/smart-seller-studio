// src/lib/erp/sku/db-input.ts
// DB → SKU 초안 입력(쿠팡 상품을 뺀 나머지). 전체 적재는 범위 없이, 상품 하나 추가는 그 상품번호·vid로 좁혀 읽는다.
// 트랜잭션은 호출자가 연다(전체 적재는 BEGIN READ ONLY). 구매자 정보는 읽지 않는다 — sale_records에서는 vid·product_cost_id·건수만.
import type { Db } from '@/lib/erp/ledger/store';
import type { DraftInput } from './draft';

type Q = Pick<Db, 'query'>;
export type DraftDbInput = Omit<DraftInput, 'coupangProducts'>;
/** 상품 하나로 좁힌다 — 그 상품번호의 원가 행 · 그 vid들을 가리키는 원가 연결·품절 동기화 연결 */
export interface DbScope {
  sellerProductId: number;
  vids: number[];
}

export async function readDraftDbInput(db: Q, scope?: DbScope): Promise<DraftDbInput> {
  const pcs = scope
    ? (await db.query(
        `select id, product_name, seller_product_id, vendor_item_id from product_costs
          where seller_product_id = $1 or vendor_item_id = any($2::bigint[])
             or id in (select product_cost_id from product_cost_channels where channel_type <> 'naver' and external_id = any($2::bigint[]))`,
        [scope.sellerProductId, scope.vids],
      )).rows
    : (await db.query(`select id, product_name, seller_product_id, vendor_item_id from product_costs`)).rows;
  const pcc = scope
    ? (await db.query(
        `select product_cost_id, channel_type, external_id, unit_multiplier from product_cost_channels
          where channel_type <> 'naver' and external_id = any($1::bigint[])`,
        [scope.vids],
      )).rows
    : (await db.query(`select product_cost_id, channel_type, external_id, unit_multiplier from product_cost_channels`)).rows;
  const ssl = scope
    ? (await db.query(
        `select coupang_vendor_item_id, channel, product_id, option_key, label from stock_sync_links
          where coupang_vendor_item_id = any($1::bigint[])`,
        [scope.vids],
      )).rows
    : (await db.query(`select coupang_vendor_item_id, channel, product_id, option_key, label from stock_sync_links`)).rows;
  // 판매 귀속은 점검 이슈(sale_attribution_mismatch)에만 쓰이고 행을 바꾸지 않는다 —
  // 상품 하나 추가에서는 sale_records 전체를 훑는 조회를 돌리지 않는다.
  const sales = scope
    ? []
    : (await db.query(`
      select nullif(regexp_replace(coupang_order_item_id, '^.*-', ''), '')::bigint as vid, product_cost_id, count(*)::int as rows
        from sale_records
       where voided_at is null and channel in ('coupang', 'rocket_growth') and coupang_order_item_id ~ '-[0-9]+$'
       group by 1, 2`)).rows;
  return {
    legacyProductCosts: pcs.map((r) => ({
      id: String(r.id),
      productName: String(r.product_name),
      sellerProductId: Number(r.seller_product_id),
      vendorItemId: r.vendor_item_id ? Number(r.vendor_item_id) : null,
    })),
    legacyChannels: pcc.map((r) => ({
      productCostId: String(r.product_cost_id),
      channelType: r.channel_type as DraftInput['legacyChannels'][number]['channelType'],
      externalId: Number(r.external_id),
      unitMultiplier: Number(r.unit_multiplier),
    })),
    syncLinks: ssl.map((r) => ({
      coupangVid: Number(r.coupang_vendor_item_id),
      channel: r.channel as DraftInput['syncLinks'][number]['channel'],
      productId: Number(r.product_id),
      optionKey: String(r.option_key ?? ''),
      label: r.label ?? null,
    })),
    saleAttributions: sales
      .filter((r) => r.vid && r.product_cost_id)
      .map((r) => ({ vid: Number(r.vid), productCostId: String(r.product_cost_id), rows: Number(r.rows) })),
  };
}
