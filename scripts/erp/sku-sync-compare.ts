// scripts/erp/sku-sync-compare.ts
// 사용법: npx --no-install tsx scripts/erp/sku-sync-compare.ts [상품번호…]
// 읽기 전용 대조: syncSellerProduct의 계획 단계(planOnly — 존재 확인·잠금·쓰기 없음)가 만들 행과
// 지금 DB의 행(전체 적재가 만든 것)이 같은지 본다. DB는 BEGIN READ ONLY로만 읽고(끝에 ROLLBACK), 쿠팡은 상품 상세 GET만.
// 기본 대상 = 2026-10-10 원가관리에 추가한 4개. 계획은 이미 DB에 있는 네이버·토스 리스팅을 빼므로(설계상 건드리지 않는다),
// 네이버·토스 리스팅이 붙은 상품에서는 「DB에만」 줄이 나오는 것이 정상이다.
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { syncSellerProduct } from '@/lib/erp/sku/sync-product';
import { getCoupangClient } from '@/lib/listing/coupang-client';

loadEnvLocal();
const DEFAULT_IDS = [16405441934, 16405396513, 16404126884, 16399766529];
const argIds = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const targets = argIds.length > 0 ? argIds : DEFAULT_IDS;

function diffSets(label: string, plan: string[], db: string[]): string[] {
  const a = new Set(plan);
  const b = new Set(db);
  return [
    ...[...a].filter((x) => !b.has(x)).map((x) => `${label} 계획에만: ${x}`),
    ...[...b].filter((x) => !a.has(x)).map((x) => `${label} DB에만: ${x}`),
  ];
}

(async () => {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const coupang = getCoupangClient();
  let bad = 0;
  try {
    await c.query('BEGIN READ ONLY');
    for (const id of targets) {
      const r = await syncSellerProduct(
        { db: c, tx: async () => { throw new Error('읽기 전용 대조 — 쓰지 않는다'); }, coupang },
        id,
        { planOnly: true },
      );
      if (r.status !== 'planned') {
        bad++;
        console.log(`❌ ${id} 계획 실패: ${r.status} ${r.error ?? ''}`);
        continue;
      }
      const like = `cp:${id}:%`;
      const skus = (await c.query(
        `select key, name, option_label, status, legacy_product_cost_ids::text[] as legacy from erp.skus where key like $1`,
        [like],
      )).rows;
      const links = (await c.query(
        `select l.channel || '|' || l.external_product_id || '|' || l.external_option_key as lkey,
                l.alt_product_id, l.label, l.link_mode, s.key as skey, x.multiplier
           from erp.listing_skus x join erp.channel_listings l on l.id = x.listing_id join erp.skus s on s.id = x.sku_id
          where s.key like $1`,
        [like],
      )).rows;
      const out: string[] = [];
      out.push(...diffSets(
        'SKU',
        r.plan.skus.map((s) => `${s.key} | ${s.name} | ${s.optionLabel} | ${s.status}`),
        skus.map((s) => `${s.key} | ${s.name} | ${s.option_label} | ${s.status}`),
      ));
      for (const s of r.plan.skus) {
        const row = skus.find((x) => x.key === s.key);
        const missing = row ? s.legacyProductCostIds.filter((x) => !((row.legacy ?? []) as string[]).includes(x)) : [];
        if (missing.length > 0) out.push(`원가 연결 계획에만: ${s.key} → ${missing.join(',')}`);
      }
      out.push(...diffSets(
        '리스팅',
        r.plan.listings.map((l) => `${l.key} | ${l.altProductId} | ${l.label} | ${l.linkMode}`),
        [...new Set(links.map((l) => `${l.lkey} | ${l.alt_product_id} | ${l.label} | ${l.link_mode}`))],
      ));
      out.push(...diffSets(
        '연결',
        r.plan.links.map((k) => `${k.listingKey}→${k.skuKey}×${k.multiplier}`),
        links.map((l) => `${l.lkey}→${l.skey}×${l.multiplier}`),
      ));
      if (out.length > 0) {
        bad++;
        console.log(`❌ ${id} 다름 ${out.length}건`);
        for (const x of out) console.log(`   ${x}`);
      } else {
        console.log(`✅ ${id} SKU ${r.plan.skus.length} · 리스팅 ${r.plan.listings.length} · 연결 ${r.plan.links.length} — DB와 같다`);
      }
      // 자동 추가가 건너뛰거나 보류할 것 — 같고 다름과 별개로 알린다
      console.log(`   건너뛴 네이버·토스 리스팅 ${r.plan.skippedListings}개 · 이슈 ${r.issues.length}개${r.issues.length ? ` (${[...new Set(r.issues.map((i) => i.kind))].join(', ')})` : ''}`);
      const blocking = r.issues.filter((i) => i.kind === 'suspect_merge' || i.kind === 'quantity_invalid');
      if (blocking.length > 0) console.log(`   ⚠️ 검토 필요 이슈가 있어 실제 자동 추가는 보류된다: ${blocking.map((i) => i.kind).join(', ')}`);
    }
    await c.query('ROLLBACK');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
  console.log(bad > 0 ? `다름 ${bad}개 상품 — 고치지 말고 보고한다` : `${targets.length}개 상품 모두 같다`);
  if (bad > 0) process.exitCode = 1;
})().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exitCode = 1;
});
