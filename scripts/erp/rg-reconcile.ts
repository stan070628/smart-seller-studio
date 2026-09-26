// scripts/erp/rg-reconcile.ts
// 사용법: npx --no-install tsx scripts/erp/rg-reconcile.ts
// 원장 RG 재고(erp.stock_on_hand location='rg') ↔ 쿠팡 RG 판매 가능 수량. 다르면 표로 보이고 exit 1.
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { fetchRgStock, loadOverrides } from './opening-collect';
import { reconcileRg, rgQtyBySku } from '@/lib/erp/ledger/opening';

loadEnvLocal();

export async function runReconcile(): Promise<number> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  let ledger: Map<number, number>;
  let links: { vid: string; skuId: number; multiplier: number }[];
  let keys: Map<number, string>;
  let cutover: string | null;
  try {
    await c.query('BEGIN READ ONLY');
    ledger = new Map((await c.query(`select sku_id, qty from erp.stock_on_hand where location = 'rg'`)).rows.map((r) => [Number(r.sku_id), Number(r.qty)]));
    links = (await c.query(
      `select l.external_product_id as vid, x.sku_id, x.multiplier
         from erp.channel_listings l join erp.listing_skus x on x.listing_id = l.id
        where l.channel = 'coupang_rg' and l.active`,
    )).rows.map((r) => ({ vid: String(r.vid), skuId: Number(r.sku_id), multiplier: Number(r.multiplier) }));
    keys = new Map((await c.query(`select id, key from erp.skus`)).rows.map((r) => [Number(r.id), r.key]));
    cutover = (await c.query(`select cursor_at::text from erp.sync_cursors where name = 'ledger_cutover'`)).rows[0]?.cursor_at ?? null;
    await c.query('COMMIT');
  } finally {
    await c.end();
  }
  const rg = rgQtyBySku(links, await fetchRgStock(), new Set(Object.keys(loadOverrides().ignoreRgVids)));
  const diff = reconcileRg(ledger, rg.bySku);
  console.log(`기초재고 시각: ${cutover ?? '없음'} · 원장 RG SKU ${ledger.size} · 실재고 SKU ${rg.bySku.size} · 불일치 ${diff.length} · 매핑 이슈 ${rg.issues.length}`);
  if (diff.length > 0) console.table(diff.map((d) => ({ SKU: keys.get(d.skuId) ?? d.skuId, 원장: d.ledger, 실재고: d.actual, 차이: d.diff })));
  for (const i of rg.issues) console.log(`  ⚠️ ${i.kind} ${i.ref} — ${i.detail}`);
  return diff.length + rg.issues.length;
}

if (require.main === module) {
  runReconcile()
    .then((n) => { if (n > 0) process.exitCode = 1; else console.log('✅ 원장 RG = 쿠팡 RG 실재고'); })
    .catch((e) => { console.error(`❌ ${(e as Error).message}`); process.exitCode = 1; });
}
