// scripts/erp/opening-collect.ts
// 사용법: npx --no-install tsx scripts/erp/opening-collect.ts
// DB(읽기 전용)와 쿠팡 RG 재고 API(GET)로 기초재고 실사표(CSV)와 점검 보고서(MD)를 docs/erp/에 쓴다.
// 구매자 정보는 읽지 않는다 — sale_records에서는 product_cost별 수량 합계만.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import {
  buildCountSheet, groupSkus, rgQtyBySku, toCsv,
  type LegacyFacts, type OpeningSku, type RgLink, type RgStock,
} from '@/lib/erp/ledger/opening';

loadEnvLocal();
const DATE = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const OUT = path.join(__dirname, '..', '..', 'docs', 'erp');
const OVERRIDES = path.join(OUT, 'opening-overrides.json');

export interface OpeningOverrides {
  /** 원장에 넣지 않을 RG vendorItemId → 사유(예: 승인 해제된 옵션의 잔여 재고) */
  ignoreRgVids: Record<string, string>;
}

export function loadOverrides(): OpeningOverrides {
  if (!fs.existsSync(OVERRIDES)) return { ignoreRgVids: {} };
  return JSON.parse(fs.readFileSync(OVERRIDES, 'utf-8')) as OpeningOverrides;
}

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

export async function readDb(c: pg.Client): Promise<{ skus: OpeningSku[]; links: RgLink[]; legacy: LegacyFacts[]; baseUnitMissing: { key: string; name: string; maxMultiplier: number }[] }> {
  const skus = (await c.query(
    `select id, key, name, option_label, legacy_product_cost_ids::text[] as legacy from erp.skus where status = 'active' order by id`,
  )).rows.map((r) => ({ id: Number(r.id), key: r.key, name: r.name, optionLabel: r.option_label, legacyProductCostIds: r.legacy ?? [] }));
  const links = (await c.query(
    `select l.external_product_id as vid, x.sku_id, x.multiplier
       from erp.channel_listings l join erp.listing_skus x on x.listing_id = l.id
      where l.channel = 'coupang_rg' and l.active`,
  )).rows.map((r) => ({ vid: String(r.vid), skuId: Number(r.sku_id), multiplier: Number(r.multiplier) }));
  const entries = (await c.query(
    `select product_cost_id, received_at::text as received_at, quantity::int as quantity, unit_cost from cost_entries`,
  )).rows;
  const sales = (await c.query(
    `select product_cost_id,
            coalesce(sum(quantity) filter (where voided_at is null), 0)::int as sold,
            coalesce(sum(quantity) filter (where voided_at is not null), 0)::int as voided
       from sale_records group by product_cost_id`,
  )).rows;
  const byPc = new Map<string, LegacyFacts>();
  const get = (pc: string) => byPc.get(pc) ?? byPc.set(pc, { productCostId: pc, entries: [], soldQty: 0, voidedQty: 0 }).get(pc)!;
  for (const e of entries) get(e.product_cost_id).entries.push({ receivedAt: e.received_at, quantity: Number(e.quantity), unitCost: Number(e.unit_cost) });
  for (const s of sales) Object.assign(get(s.product_cost_id), { soldQty: Number(s.sold), voidedQty: Number(s.voided) });
  const baseUnitMissing = (await c.query(
    `select s.key, s.name, max(x.multiplier)::int as m
       from erp.skus s join erp.listing_skus x on x.sku_id = s.id
      where s.status = 'active' and s.base_unit_label is null
      group by s.key, s.name having max(x.multiplier) > 1 order by s.key`,
  )).rows.map((r) => ({ key: r.key, name: r.name, maxMultiplier: Number(r.m) }));
  return { skus, links, legacy: [...byPc.values()], baseUnitMissing };
}

async function main(): Promise<void> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  let db: Awaited<ReturnType<typeof readDb>>;
  try {
    await c.query('BEGIN READ ONLY');
    db = await readDb(c);
    await c.query('COMMIT');
  } finally {
    await c.end();
  }
  const stock = await fetchRgStock();
  const ov = loadOverrides();
  const rg = rgQtyBySku(db.links, stock, new Set(Object.keys(ov.ignoreRgVids)));
  const sheet = buildCountSheet(db.skus, groupSkus(db.skus), rg.bySku, db.legacy);
  const issues = [...rg.issues, ...sheet.issues];

  fs.writeFileSync(path.join(OUT, `opening-count-${DATE}.csv`), toCsv(sheet.rows));

  const sum = (f: (r: (typeof sheet.rows)[number]) => number) => sheet.rows.reduce((s, r) => s + f(r), 0);
  const md = [
    `# 기초재고 실사표 점검 ${DATE}`,
    '',
    `- 활성 SKU ${db.skus.length} · RG 재고 응답 ${stock.length}건(수량>0 ${stock.filter((s) => s.qty > 0).length})`,
    `- RG 실재고 합계 ${sum((r) => r.rgActual)} · 자체보관 미리 채운 합계 ${sum((r) => r.selfCount ?? 0)} · **빈칸(옵션별 실사 필요) ${sheet.rows.filter((r) => r.selfCount === null).length}행**`,
    '',
    '## 채우는 법',
    '',
    `1. \`opening-count-${DATE}.csv\`를 연다(Numbers·엑셀).`,
    '2. `self_count` = **지금 집에 있는 개수**(SKU 기준 단위). 미리 채운 값은 옛 장부 계산이다 — 다르면 고친다. 빈칸은 옵션별로 세서 적는다.',
    '3. `rg_inbound` = RG로 보냈는데 아직 쿠팡 판매 가능 수량에 안 잡힌 개수. 없으면 0.',
    '4. `unit_cost` 빈칸인데 재고가 있으면 개당 매입가를 적는다.',
    '5. `rg_actual`은 적재 때 API로 다시 읽으므로 고치지 않는다.',
    '',
    `## 이슈 ${issues.length}건`,
    '',
    '| 종류 | 대상 | 내용 |',
    '|---|---|---|',
    ...issues.map((i) => `| ${i.kind} | ${i.ref} | ${i.detail.replace(/\|/g, '\\|')} |`),
    '',
    `## 기준 단위 미정 — 배수 > 1인 SKU ${db.baseUnitMissing.length}건`,
    '',
    '배수 1이 무엇인지(예: 「6팩」 「낱포 1개」)를 정해야 실사 개수를 셀 수 있다. 답은 `docs/erp/sku-overrides.json`의 `baseUnit`에 넣는다.',
    '',
    '| SKU | 상품 | 최대 배수 |',
    '|---|---|---|',
    ...db.baseUnitMissing.map((b) => `| ${b.key} | ${b.name} | ${b.maxMultiplier} |`),
    '',
    '`rg_vid_unmapped`·`rg_listing_multi_sku`가 남아 있으면 적재가 멈춘다. 원장에 넣지 않을 vid는 `docs/erp/opening-overrides.json`의 `ignoreRgVids`에 사유와 함께 적는다.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, `opening-review-${DATE}.md`), md);
  console.log(`✅ opening-count-${DATE}.csv · opening-review-${DATE}.md — 이슈 ${issues.length}건 · 빈칸 ${sheet.rows.filter((r) => r.selfCount === null).length}행`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`❌ ${(e as Error).message}`);
    process.exitCode = 1;
  });
}
