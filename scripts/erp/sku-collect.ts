// scripts/erp/sku-collect.ts
// 사용법: npx --no-install tsx scripts/erp/sku-collect.ts
// DB(읽기 전용 세션)와 쿠팡 API(GET만)에서 입력을 모아 SKU 초안(JSON)과 점검 보고서(MD)를 docs/erp/에 쓴다.
// 구매자 정보는 읽지 않는다 — sale_records에서는 vid·product_cost_id·건수만 모은다.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { buildDraft, type DraftInput } from '@/lib/erp/sku/draft';
import { renderReport } from '@/lib/erp/sku/report';
import { getCoupangClient } from '@/lib/listing/coupang-client';

loadEnvLocal();
const DATE = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const OUT = path.join(__dirname, '..', '..', 'docs', 'erp');

type DbInput = Omit<DraftInput, 'coupangProducts'> & { sellerProductIds: number[] };

async function collectDb(): Promise<DbInput> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('set default_transaction_read_only = on');
    const pcs = (await c.query(`select id, product_name, seller_product_id, vendor_item_id from product_costs`)).rows;
    const pcc = (await c.query(`select product_cost_id, channel_type, external_id, unit_multiplier from product_cost_channels`)).rows;
    const ssl = (await c.query(`select coupang_vendor_item_id, channel, product_id, option_key, label from stock_sync_links`)).rows;
    const sales = (await c.query(`
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
      sellerProductIds: [...new Set(pcs.map((r) => Number(r.seller_product_id)).filter((n) => n > 0))],
    };
  } finally {
    await c.end();
  }
}

async function collectCoupang(extraIds: number[]): Promise<{ products: DraftInput['coupangProducts']; failed: number[] }> {
  const cp = getCoupangClient();
  const ids = new Set(extraIds);
  for (const bt of [undefined, 'rocketGrowth']) {
    let token = '';
    do {
      const page = await cp.getSellerProducts('APPROVED', 50, token, bt);
      for (const p of page.items) ids.add(Number((p as unknown as { sellerProductId: number }).sellerProductId));
      token = page.nextToken ?? '';
    } while (token);
  }
  console.log(`쿠팡 상품 ${ids.size}개 상세 조회…`);
  const products: DraftInput['coupangProducts'] = [];
  const failed: number[] = [];
  for (const id of ids) {
    try {
      const d = (await cp.getProductDetail(id)) as { sellerProductId: number; sellerProductName: string; items?: Record<string, unknown>[] };
      products.push({
        sellerProductId: Number(d.sellerProductId),
        productName: d.sellerProductName,
        items: (d.items ?? []).map((it) => {
          // 로켓그로스 동시 운영 상품은 Wing vid가 최상위가 아니라 marketplaceItemData.vendorItemId에 있다(2026-09-26 실측).
          const rg = it.rocketGrowthItemData as { vendorItemId?: number } | undefined;
          const mp = it.marketplaceItemData as { vendorItemId?: number } | undefined;
          const wing = it.vendorItemId ?? mp?.vendorItemId;
          return {
            itemName: String(it.itemName ?? ''),
            attributes: Array.isArray(it.attributes) ? (it.attributes as { attributeTypeName: string; attributeValueName: string }[]) : [],
            wingVid: wing ? Number(wing) : null,
            rgVid: rg?.vendorItemId ? Number(rg.vendorItemId) : null,
          };
        }),
      });
    } catch (e) {
      failed.push(id);
      console.error(`⚠️ 쿠팡 상품 ${id} 조회 실패: ${(e as Error).message}`);
    }
  }
  return { products, failed };
}

(async () => {
  const db = await collectDb();
  const { products: coupangProducts, failed } = await collectCoupang(db.sellerProductIds);
  const { sellerProductIds: _unused, ...rest } = db;
  void _unused;
  const input: DraftInput = { ...rest, coupangProducts };
  const draft = buildDraft(input);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `sku-draft-${DATE}.json`), JSON.stringify({ input, draft, coupangFetchFailed: failed }, null, 2));
  const notes = [
    '네이버 판매 가져오기(naver-bulk-import)는 product_costs.naver_channel_product_no(2건: 흰티 L·XL)만 본다 — 품절 동기화에 연결된 네이버 상품 51개 중 나머지 판매는 기록되지 않았을 가능성이 크다. 1-C(주문 수집)에서 channel_listings로 해결한다.',
    'costco_item_map 오매핑 의심: 693742 「프로틴커피쉐이크」→퓨어틴 초코, 888450 「PUMA주니어팬티5P」(ask)→극세사 타월. purchase_units 적재 전 확인이 필요하다.',
  ];
  if (failed.length) notes.push(`쿠팡 상품 상세 조회 실패 ${failed.length}건(판매 종료·삭제 상품일 수 있다): ${failed.join(', ')}`);
  fs.writeFileSync(path.join(OUT, `sku-review-${DATE}.md`), renderReport(draft, { date: DATE, notes }));
  console.log(`SKU ${draft.skus.length} · 리스팅 ${draft.listings.length} · 연결 ${draft.links.length} · 이슈 ${draft.issues.length}`);
  console.log(`→ docs/erp/sku-draft-${DATE}.json, docs/erp/sku-review-${DATE}.md`);
})().catch((e) => {
  console.error(`실패: ${(e as Error).message}`);
  process.exit(1);
});
