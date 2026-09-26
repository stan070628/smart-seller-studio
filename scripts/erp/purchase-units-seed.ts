// scripts/erp/purchase-units-seed.ts
// 사용법: npx --no-install tsx scripts/erp/purchase-units-seed.ts [--apply] [--include=693742,888450]
// erp.purchase_units 첫 적재: costco_item_map(품번 → product_cost) → SKU(legacy_product_cost_ids). 품번 : SKU = 1 : N.
// 기본(점검): 적재할 행과 보류·미연결 품번만 출력한다(DB 읽기 전용).
// --apply : 한 트랜잭션. 이미 있는 (costco, 품번, SKU)는 건너뛴다 — 다시 돌려도 안전하다.
// 🔴 오매핑 의심 품번(693742·888450)은 사용자가 맞다고 확인한 것만 --include로 넣는다.
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { planPurchaseUnits } from '@/lib/erp/ledger/purchase-units';

loadEnvLocal();
const APPLY = process.argv.includes('--apply');
const includeArg = process.argv.find((a) => a.startsWith('--include='));
const include = new Set((includeArg ? includeArg.slice('--include='.length) : '').split(',').map((s) => s.trim()).filter(Boolean));

async function main(): Promise<void> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const maps = (await c.query(
      `select item_code, item_label, product_cost_id::text as pc, default_decision
         from costco_item_map where product_cost_id is not null order by item_code`,
    )).rows.map((r) => ({ itemCode: String(r.item_code), itemLabel: r.item_label ?? null, productCostId: String(r.pc), defaultDecision: String(r.default_decision) }));
    const skus = (await c.query(
      `select id, key, legacy_product_cost_ids::text[] as legacy from erp.skus where status = 'active' order by id`,
    )).rows.map((r) => ({ id: Number(r.id), key: String(r.key), legacyProductCostIds: (r.legacy ?? []) as string[] }));
    const pcNames = new Map((await c.query(`select id::text as id, product_name from product_costs`)).rows.map((r) => [String(r.id), String(r.product_name)]));
    await c.query('COMMIT');

    const plan = planPurchaseUnits(maps, skus, include);
    console.log(`품번 ${maps.length}개 → purchase_units ${plan.rows.length}행 · 보류 ${plan.held.length} · SKU 없음 ${plan.unlinked.length} · 제외(skip) ${plan.skipped.length}`);
    console.table(plan.rows.map((r) => ({ 품번: r.supplierCode, 영수증표기: r.label ?? '', SKU: r.skuKey })));
    for (const h of plan.held) {
      console.log(`  🔴 보류(사용자 확인 필요) ${h.itemCode} 「${h.itemLabel ?? ''}」 → ${pcNames.get(h.productCostId) ?? h.productCostId} (기억된 결정 ${h.defaultDecision})`);
    }
    for (const u of plan.unlinked) {
      console.log(`  ⚠️ SKU 없음 ${u.itemCode} 「${u.itemLabel ?? ''}」 → ${pcNames.get(u.productCostId) ?? u.productCostId}`);
    }
    if (!APPLY) {
      console.log('(점검만 — 적재하려면 --apply)');
      return;
    }

    await c.query('BEGIN');
    try {
      let n = 0;
      for (const r of plan.rows) {
        const res = await c.query(
          `insert into erp.purchase_units (supplier, supplier_code, label, sku_id) values ('costco', $1, $2, $3)
           on conflict (supplier, supplier_code, sku_id) do nothing`,
          [r.supplierCode, r.label, r.skuId],
        );
        n += res.rowCount ?? 0;
      }
      await c.query('COMMIT');
      console.log(`✅ purchase_units ${n}행 적재(이미 있던 ${plan.rows.length - n}행은 건너뜀)`);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exitCode = 1;
});
