// scripts/erp/sku-apply.ts
// 사용법: npx --no-install tsx scripts/erp/sku-apply.ts [--apply | --verify]
// 최신 초안 + docs/erp/sku-overrides.json → erp.skus / channel_listings / listing_skus 적재.
//
// 기본(점검): 적재할 내용과 현재 DB와의 차이만 출력한다. DB는 BEGIN READ ONLY 트랜잭션으로만 읽는다.
// --apply : 트랜잭션 하나로 적재한다. 키 기준 upsert라 다시 돌려도 안전하다. 오류가 나면 전부 롤백하고 exit 1.
//           SKU 마스터 잠금(lockSkuMaster, 7103)을 먼저 잡는다 — 원가관리 상품 추가(sync-product)와 겹쳐 쓰지 않게.
//           초안에서 빠진 연결은 지운다(listing_skus는 초안이 원장이다). skus·channel_listings는 지우지 않고
//           보관(archived / active=false)한다.
//           보관·비활성화·연결 삭제는 origin='draft' 행에만 한다 — 1-B 이후 손으로 만든 행(manual)은 건드리지 않는다.
//           원가 연결(legacy_product_cost_ids)은 DB 값과 초안 값의 합집합으로 둔다 — 초안은 옛 판매 기록으로만 연결을 찾아,
//           사람이 손으로 붙인 연결(2026-10-05 콜맨·트루릴리젼·마크곤잘레스)을 모른다. 지우면 옛 장부 경고가 되살아난다.
//           upsert·불변식은 src/lib/erp/sku/upsert.ts(원가관리 상품 추가와 공유), 정리(보관·비활성화·삭제)는 여기만.
// --verify: 적재 결과 점검표(1-1 완료 기준)를 읽기 전용으로 출력한다.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { applyOverrides, type Draft, type Overrides } from '@/lib/erp/sku/draft';
import { findNewerThanDraft, staleDraftMessage, type DraftKeys } from '@/lib/erp/sku/stale-guard';
import { insertLinks, lockSkuMaster, upsertListings, upsertSkus, validateDraft } from '@/lib/erp/sku/upsert';

loadEnvLocal();
const DIR = path.join(__dirname, '..', '..', 'docs', 'erp');
const APPLY = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');

const newClient = () => new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

/** 초안에 실린 key로 만든 stale-guard 입력 */
const draftKeysOf = (d: Draft): DraftKeys => ({
  skuKeys: new Set(d.skus.map((x) => x.key)),
  listingKeys: new Set(d.listings.map((l) => `${l.channel}|${l.externalProductId}|${l.externalOptionKey}`)),
});

function loadFinalDraft(): { draftFile: string; d: Draft; collectedAt: string | null } {
  const draftFile = fs.readdirSync(DIR).filter((n) => /^sku-draft-.*\.json$/.test(n)).sort().pop();
  if (!draftFile) throw new Error('docs/erp/sku-draft-*.json이 없다 — sku-collect.ts를 먼저 돌린다');
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, draftFile), 'utf-8')) as { draft: Draft; coupangFetchFailed?: unknown[]; collectedAt?: string };
  // 쿠팡 조회가 일부 실패한 초안은 SKU가 빠져 있다 — 그대로 적재하면 빠진 SKU가 보관 처리된다.
  if (raw.coupangFetchFailed && raw.coupangFetchFailed.length > 0) {
    throw new Error(`${draftFile}은 쿠팡 조회 실패 ${raw.coupangFetchFailed.length}건이 있는 초안이다 — sku-collect.ts를 다시 돌린다`);
  }
  const overrides = JSON.parse(fs.readFileSync(path.join(DIR, 'sku-overrides.json'), 'utf-8')) as Overrides;
  // 수집 시각 — sku-collect가 기록한다. 없는 옛 초안은 오래됐는지 알 수 없으므로(파일 수정 시각은 믿을 수 없다) --apply가 거부한다.
  return { draftFile, d: applyOverrides(raw.draft, overrides), collectedAt: raw.collectedAt ?? null };
}

const sameArr = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
const unionArr = (a: string[], b: string[]) => [...new Set([...a, ...b])];

const NO_COLLECTED_AT = '초안에 수집 시각(collectedAt)이 없다 — sku-collect를 다시 돌린다';

async function dryRun(draftFile: string, d: Draft, collectedAt: string | null): Promise<void> {
  const c = newClient();
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    if (!collectedAt) console.log(`⚠️ ${NO_COLLECTED_AT} (--apply는 거부한다)`);
    const stale = collectedAt ? await findNewerThanDraft(c, new Date(collectedAt), draftKeysOf(d)) : { skus: [], listings: [], count: 0 };
    if (stale.count > 0) console.log(`⚠️ ${staleDraftMessage(draftFile, collectedAt ?? "", stale.count)} — ${[...stale.skus, ...stale.listings].slice(0, 5).join(', ')} (--apply는 거부한다)`);
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
    const keptLegacy: string[] = [];
    for (const s of d.skus) {
      const r = skuByKey.get(s.key);
      if (!r) { skuIns++; continue; }
      const same = r.name === s.name && r.option_label === s.optionLabel && (r.base_unit_label ?? null) === s.baseUnitLabel
        && r.status === s.status && sameArr(r.legacy ?? [], unionArr(r.legacy ?? [], s.legacyProductCostIds));
      const kept = (r.legacy ?? []).filter((x: string) => !s.legacyProductCostIds.includes(x));
      if (kept.length > 0) keptLegacy.push(`${s.key} ${s.name.slice(0, 24)} — DB에만 있는 원가 연결 ${kept.length}개 유지`);
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
    for (const k of keptLegacy) console.log(`  (유지) ${k}`);
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

async function apply(d: Draft, draftFile: string, collectedAt: string): Promise<void> {
  const c = newClient();
  await c.connect();
  try {
    await c.query('BEGIN');
    await lockSkuMaster(c);
    // 잠금 안에서 확인한다 — 원가관리 상품 추가가 초안 수집 뒤에 만든 행은 초안에 없어 아래 정리가 지워 버린다
    const stale = await findNewerThanDraft(c, new Date(collectedAt), draftKeysOf(d));
    if (stale.count > 0) throw new Error(`${staleDraftMessage(draftFile, collectedAt, stale.count)}\n  ${[...stale.skus, ...stale.listings].slice(0, 10).join('\n  ')}`);
    const skuId = await upsertSkus(c, d.skus);
    const archived = await c.query(
      `update erp.skus set status = 'archived', updated_at = now()
        where status <> 'archived' and origin = 'draft' and not (key = any($1::text[]))`,
      [d.skus.map((s) => s.key)],
    );
    // P5: SKU 키는 동결이다. 초안에서 키가 사라지거나 병합(overrides)으로 보관되는 SKU에 원장 재고가 있으면
    //     재고가 보이지 않게 된다 — 보관을 반영한 뒤 같은 트랜잭션에서 확인하고, 있으면 전부 롤백한다.
    const stocked = await c.query(
      `select s.key, h.location, h.qty
         from erp.skus s join erp.stock_on_hand h on h.sku_id = s.id
        where s.status = 'archived' and s.origin = 'draft' and h.qty <> 0`,
    );
    if (stocked.rows.length > 0) {
      throw new Error(`재고가 있는 SKU를 보관하려 한다 — 키가 바뀌었거나 병합됐다. 초안(overrides)을 고친다:\n  ${stocked.rows.map((r) => `${r.key} ${r.location} ${r.qty}`).join('\n  ')}`);
    }

    const listingId = await upsertListings(c, d.listings);
    const deactivated = await c.query(
      `update erp.channel_listings set active = false where active and origin = 'draft' and not (id = any($1::bigint[]))`,
      [[...listingId.values()]],
    );

    await c.query(`delete from erp.listing_skus where origin = 'draft'`);
    await insertLinks(c, d.links, skuId, listingId);
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
  const { draftFile, d, collectedAt } = loadFinalDraft();
  validateDraft(d);
  if (!APPLY) return dryRun(draftFile, d, collectedAt);
  if (!collectedAt) throw new Error(NO_COLLECTED_AT);
  console.log(`${draftFile} + overrides → SKU ${d.skus.length} · 리스팅 ${d.listings.length} · 연결 ${d.links.length} 적재 시작`);
  return apply(d, draftFile, collectedAt);
})().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exitCode = 1;
});
