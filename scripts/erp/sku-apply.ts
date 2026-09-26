// scripts/erp/sku-apply.ts
// 사용법: npx --no-install tsx scripts/erp/sku-apply.ts [--apply | --verify]
// 최신 초안 + docs/erp/sku-overrides.json → erp.skus / channel_listings / listing_skus 적재.
//
// 기본(점검): 적재할 내용과 현재 DB와의 차이만 출력한다. DB는 BEGIN READ ONLY 트랜잭션으로만 읽는다.
// --apply : 트랜잭션 하나로 적재한다. 키 기준 upsert라 다시 돌려도 안전하다. 오류가 나면 전부 롤백하고 exit 1.
//           초안에서 빠진 연결은 지운다(listing_skus는 초안이 원장이다). skus·channel_listings는 지우지 않고
//           보관(archived / active=false)한다.
//           보관·비활성화·연결 삭제는 origin='draft' 행에만 한다 — 1-B 이후 손으로 만든 행(manual)은 건드리지 않는다.
// --verify: 적재 결과 점검표(1-1 완료 기준)를 읽기 전용으로 출력한다.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { applyOverrides, type Draft, type Overrides } from '@/lib/erp/sku/draft';

loadEnvLocal();
const DIR = path.join(__dirname, '..', '..', 'docs', 'erp');
const APPLY = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const newClient = () => new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

function loadFinalDraft(): { draftFile: string; d: Draft } {
  const draftFile = fs.readdirSync(DIR).filter((n) => /^sku-draft-.*\.json$/.test(n)).sort().pop();
  if (!draftFile) throw new Error('docs/erp/sku-draft-*.json이 없다 — sku-collect.ts를 먼저 돌린다');
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, draftFile), 'utf-8')) as { draft: Draft; coupangFetchFailed?: unknown[] };
  // 쿠팡 조회가 일부 실패한 초안은 SKU가 빠져 있다 — 그대로 적재하면 빠진 SKU가 보관 처리된다.
  if (raw.coupangFetchFailed && raw.coupangFetchFailed.length > 0) {
    throw new Error(`${draftFile}은 쿠팡 조회 실패 ${raw.coupangFetchFailed.length}건이 있는 초안이다 — sku-collect.ts를 다시 돌린다`);
  }
  const overrides = JSON.parse(fs.readFileSync(path.join(DIR, 'sku-overrides.json'), 'utf-8')) as Overrides;
  return { draftFile, d: applyOverrides(raw.draft, overrides) };
}

/** 적재 전 불변식. 하나라도 어긋나면 던진다(DB에 쓰기 전에). */
function validate(d: Draft): void {
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

const sameArr = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

async function dryRun(draftFile: string, d: Draft): Promise<void> {
  const c = newClient();
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const dbSkus = (await c.query(`select key, name, option_label, base_unit_label, status, legacy_product_cost_ids::text[] as legacy from erp.skus where origin = 'draft'`)).rows;
    const dbListings = (await c.query(`select id, channel, external_product_id, external_option_key, alt_product_id, label, link_mode, active from erp.channel_listings where origin = 'draft'`)).rows;
    const dbLinks = (await c.query(`
      select l.channel || '|' || l.external_product_id || '|' || l.external_option_key as lkey, s.key as skey, x.multiplier
      from erp.listing_skus x join erp.channel_listings l on l.id = x.listing_id join erp.skus s on s.id = x.sku_id
      where x.origin = 'draft'`)).rows;
    const manualSkus = (await c.query(`select key from erp.skus where origin = 'manual'`)).rows;
    const manualListings = (await c.query(`select channel, external_product_id, external_option_key from erp.channel_listings where origin = 'manual'`)).rows;
    const manualLinks = (await c.query(`
      select l.channel || '|' || l.external_product_id || '|' || l.external_option_key as lkey, s.key as skey
      from erp.listing_skus x join erp.channel_listings l on l.id = x.listing_id join erp.skus s on s.id = x.sku_id
      where x.origin = 'manual'`)).rows;
    await c.query('COMMIT');

    const skuByKey = new Map(dbSkus.map((r) => [r.key as string, r]));
    let skuIns = 0, skuUpd = 0, skuSame = 0;
    for (const s of d.skus) {
      const r = skuByKey.get(s.key);
      if (!r) { skuIns++; continue; }
      const same = r.name === s.name && r.option_label === s.optionLabel && (r.base_unit_label ?? null) === s.baseUnitLabel
        && r.status === s.status && sameArr(r.legacy ?? [], s.legacyProductCostIds);
      if (same) skuSame++; else skuUpd++;
    }
    const draftSkuKeys = new Set(d.skus.map((s) => s.key));
    const absent = dbSkus.filter((r) => !draftSkuKeys.has(r.key));
    const skuArchive = absent.filter((r) => r.status !== 'archived').length;

    const lByKey = new Map(dbListings.map((r) => [`${r.channel}|${r.external_product_id}|${r.external_option_key}`, r]));
    let lIns = 0, lUpd = 0, lSame = 0;
    for (const l of d.listings) {
      const r = lByKey.get(l.key);
      if (!r) { lIns++; continue; }
      const same = (r.alt_product_id ?? null) === l.altProductId && (r.label ?? null) === l.label && r.link_mode === l.linkMode && r.active === true;
      if (same) lSame++; else lUpd++;
    }
    const draftListingKeys = new Set(d.listings.map((l) => l.key));
    const lDeactivate = dbListings.filter((r) => r.active && !draftListingKeys.has(`${r.channel}|${r.external_product_id}|${r.external_option_key}`)).length;

    const dbLinkMap = new Map(dbLinks.map((r) => [`${r.lkey}→${r.skey}`, Number(r.multiplier)]));
    const newLinkMap = new Map(d.links.map((k) => [`${k.listingKey}→${k.skuKey}`, k.multiplier]));
    let kAdd = 0, kChg = 0;
    for (const [k, m] of newLinkMap) { const p = dbLinkMap.get(k); if (p === undefined) kAdd++; else if (p !== m) kChg++; }
    const kDel = [...dbLinkMap.keys()].filter((k) => !newLinkMap.has(k)).length;

    const modes = new Map<string, number>();
    for (const l of d.listings) modes.set(l.linkMode, (modes.get(l.linkMode) ?? 0) + 1);
    const byChannel = new Map<string, number>();
    for (const l of d.listings) byChannel.set(l.channel, (byChannel.get(l.channel) ?? 0) + 1);

    const manualSkuKeys = new Set(manualSkus.map((r) => r.key as string));
    const manualListingKeys = new Set(manualListings.map((r) => `${r.channel}|${r.external_product_id}|${r.external_option_key}`));
    const manualLinkKeys = new Set(manualLinks.map((r) => `${r.lkey}→${r.skey}`));
    const skuConflict = d.skus.filter((s) => manualSkuKeys.has(s.key)).length;
    const listingConflict = d.listings.filter((l) => manualListingKeys.has(l.key)).length;
    const linkConflict = d.links.filter((k) => manualLinkKeys.has(`${k.listingKey}→${k.skuKey}`)).length;

    console.log(`${draftFile} + overrides → SKU ${d.skus.length}(active ${d.skus.filter((s) => s.status === 'active').length}) · 리스팅 ${d.listings.length} · 연결 ${d.links.length}`);
    console.log(`  리스팅 채널: ${[...byChannel].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    console.log(`  link_mode: ${[...modes].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    console.log(`현재 DB: SKU ${dbSkus.length} · 리스팅 ${dbListings.length} · 연결 ${dbLinks.length}`);
    console.log('--apply 시 변경:');
    console.log(`  SKU      삽입 ${skuIns} · 갱신 ${skuUpd} · 동일 ${skuSame} · 보관(archived) ${skuArchive}`);
    console.log(`  리스팅   삽입 ${lIns} · 갱신 ${lUpd} · 동일 ${lSame} · 비활성화 ${lDeactivate}`);
    console.log(`  연결     draft ${d.links.length} 재작성 (신규 ${kAdd} · 배수변경 ${kChg} · 삭제 ${kDel})`);
    console.log(`  manual 충돌 SKU ${skuConflict} · 리스팅 ${listingConflict} · 연결 ${linkConflict} — 0이 아니면 --apply가 실패한다`);
    if (absent.length > 0) {
      console.log(`DB에 있으나 초안에 없는 SKU ${absent.length}건:`);
      for (const r of absent) console.log(`  - ${r.key} [${r.status}] ${r.name}`);
    } else {
      console.log('DB에 있으나 초안에 없는 SKU: 없음');
    }
    console.log('(점검만 — 적재하려면 --apply)');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

async function apply(d: Draft): Promise<void> {
  const c = newClient();
  await c.connect();
  try {
    await c.query('BEGIN');
    const skuId = new Map<string, number>();
    for (const s of d.skus) {
      const { rows } = await c.query(
        `insert into erp.skus (key, name, option_label, base_unit_label, status, legacy_product_cost_ids, origin)
         values ($1, $2, $3, $4, $5, $6::uuid[], 'draft')
         on conflict (key) do update set name = excluded.name, option_label = excluded.option_label,
           base_unit_label = excluded.base_unit_label, status = excluded.status,
           legacy_product_cost_ids = excluded.legacy_product_cost_ids, updated_at = now()
         where erp.skus.origin = 'draft'
         returning id`,
        [s.key, s.name, s.optionLabel, s.baseUnitLabel, s.status, s.legacyProductCostIds],
      );
      if (rows.length === 0) throw new Error(`초안 키 ${s.key}가 manual SKU와 겹친다 — 초안을 고친다`);
      skuId.set(s.key, Number(rows[0].id));
    }
    const archived = await c.query(
      `update erp.skus set status = 'archived', updated_at = now()
        where status <> 'archived' and origin = 'draft' and not (key = any($1::text[]))`,
      [d.skus.map((s) => s.key)],
    );

    const listingId = new Map<string, number>();
    for (const l of d.listings) {
      const { rows } = await c.query(
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
    const deactivated = await c.query(
      `update erp.channel_listings set active = false where active and origin = 'draft' and not (id = any($1::bigint[]))`,
      [[...listingId.values()]],
    );

    await c.query(`delete from erp.listing_skus where origin = 'draft'`);
    for (const k of d.links) {
      const lid = listingId.get(k.listingKey);
      const sid = skuId.get(k.skuKey);
      if (!lid || !sid) throw new Error(`연결 대상 누락: ${k.listingKey} → ${k.skuKey}`);
      const { rows } = await c.query(
        `insert into erp.listing_skus (listing_id, sku_id, multiplier, origin) values ($1, $2, $3, 'draft')
         on conflict (listing_id, sku_id) do nothing
         returning 1`,
        [lid, sid, k.multiplier],
      );
      if (rows.length === 0) throw new Error(`연결 ${k.listingKey}→${k.skuKey}가 manual 연결과 겹친다 — 초안을 고친다`);
    }
    await c.query('COMMIT');
    console.log(`✅ 적재 완료 — SKU ${skuId.size}(보관 ${archived.rowCount}) · 리스팅 ${listingId.size}(비활성화 ${deactivated.rowCount}) · 연결 ${d.links.length}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error(`❌ 롤백: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

async function verify(): Promise<void> {
  const c = newClient();
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const { rows } = await c.query(`
      select 'active skus' k, count(*) n from erp.skus where status='active'
      union all select 'active listings', count(*) from erp.channel_listings where active
      union all select 'links', count(*) from erp.listing_skus
      union all select 'listing without sku', count(*) from erp.channel_listings l where active and not exists (select 1 from erp.listing_skus x where x.listing_id=l.id)
      union all select 'sync link unmapped', count(*) from stock_sync_links s where not exists (select 1 from erp.channel_listings l join erp.listing_skus x on x.listing_id=l.id where l.channel=s.channel and l.external_product_id=s.product_id::text and l.external_option_key=s.option_key)
      union all select 'recent sale vid unmapped (90d)', count(distinct regexp_replace(coupang_order_item_id,'^.*-','')) from sale_records r where voided_at is null and sold_at > now()-interval '90 days' and coupang_order_item_id ~ '-[0-9]+$' and not exists (select 1 from erp.channel_listings l where l.channel in ('coupang_wing','coupang_rg') and l.external_product_id = regexp_replace(r.coupang_order_item_id,'^.*-',''))`);
    await c.query('COMMIT');
    console.table(rows.map((r) => ({ 항목: r.k, 건수: Number(r.n) })));
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

(async () => {
  if (VERIFY) return verify();
  const { draftFile, d } = loadFinalDraft();
  validate(d);
  if (!APPLY) return dryRun(draftFile, d);
  console.log(`${draftFile} + overrides → SKU ${d.skus.length} · 리스팅 ${d.listings.length} · 연결 ${d.links.length} 적재 시작`);
  return apply(d);
})().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exitCode = 1;
});
