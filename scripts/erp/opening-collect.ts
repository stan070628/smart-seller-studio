// scripts/erp/opening-collect.ts
// 사용법: npx --no-install tsx scripts/erp/opening-collect.ts [--carry=<이전 실사표 CSV>] [--force]
// DB(읽기 전용)와 쿠팡 RG 재고 API(GET)로 기초재고 실사표(CSV)와 점검 보고서(MD)를 docs/erp/에 쓴다.
// 🔴 같은 날짜의 opening-count-<날짜>.csv가 이미 있으면 쓰지 않는다(사람이 채운 실사를 덮어쓰지 않게) — 덮어쓰려면 --force.
// --carry=<CSV>: 이전 실사표의 self_count·rg_inbound·unit_cost·note를 sku_id로 새 실사표에 옮긴다(새 SKU는 미리 채운 값 그대로).
// 구매자 정보는 읽지 않는다 — sale_records에서는 product_cost별 수량 합계만.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { fetchRgStock, readDb } from '@/lib/erp/ledger/opening-db';
import {
  buildCountSheet, carryCounts, groupSkus, parseCountCsv, rgQtyBySku, toCsv,
} from '@/lib/erp/ledger/opening';

// 1-C1: 화면도 쓰므로 src/lib/erp/ledger/opening-db.ts로 옮겼다. opening-apply·rg-reconcile은 계속 여기서 가져간다.
export { fetchRgStock, readDb };

loadEnvLocal();
const DATE = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const OUT = path.join(__dirname, '..', '..', 'docs', 'erp');
export const OVERRIDES_PATH = path.join(OUT, 'opening-overrides.json');

export interface OpeningOverrides {
  /** 원장에 넣지 않을 RG vendorItemId → 사유(예: 승인 해제된 옵션의 잔여 재고) */
  ignoreRgVids: Record<string, string>;
  /** 실사를 마친 시각(오프셋 있는 ISO). 적재 때 24시간 이내여야 한다 — opening-apply가 요구한다 */
  countedAt?: string;
  /** SKU 키 → 적재 단가(원). 옛 입고 이력으로 다시 계산한 값·CSV 값보다 우선한다 */
  unitCost?: Record<string, number>;
}

export function loadOverrides(): OpeningOverrides {
  if (!fs.existsSync(OVERRIDES_PATH)) return { ignoreRgVids: {} };
  const o = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf-8')) as Partial<OpeningOverrides>;
  return { ...o, ignoreRgVids: o.ignoreRgVids ?? {} };
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const carryArg = process.argv.find((a) => a.startsWith('--carry='));
  const carryPath = carryArg ? path.resolve(carryArg.slice('--carry='.length)) : null;
  const csvPath = path.join(OUT, `opening-count-${DATE}.csv`);
  if (fs.existsSync(csvPath) && !force) {
    throw new Error(
      `opening-count-${DATE}.csv가 이미 있다 — 사람이 채운 실사를 덮어쓰지 않으려고 멈춘다.\n` +
      '  기존 실사를 살려 새로 뽑으려면: --carry=<기존 CSV> --force · 그냥 덮어쓰려면: --force',
    );
  }
  // 이전 실사표는 DB·API를 읽기 전에 먼저 읽는다 — 잘못된 파일이면 일찍 멈춘다(덮어쓸 대상과 같은 파일일 수도 있다)
  const prev = carryPath ? parseCountCsv(fs.readFileSync(carryPath, 'utf-8')) : null;
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

  let rows = sheet.rows;
  if (prev) {
    const carried = carryCounts(sheet.rows, prev);
    rows = carried.rows;
    console.log(`옮김 ${carried.carried}행 · 새 행 ${carried.added.length}(미리 채운 값) · 빠진 행 ${carried.dropped.length}`);
    for (const d of carried.dropped) console.log(`  빠짐: ${d.skuKey} (self_count ${d.selfCount ?? '빈칸'} · rg_inbound ${d.rgInbound})`);
    for (const a of carried.added) console.log(`  새 행: ${a.skuKey}`);
  }
  fs.writeFileSync(csvPath, toCsv(rows));

  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const md = [
    `# 기초재고 실사표 점검 ${DATE}`,
    '',
    `- 활성 SKU ${db.skus.length} · RG 재고 응답 ${stock.length}건(수량>0 ${stock.filter((s) => s.qty > 0).length})`,
    `- RG 실재고 합계 ${sum((r) => r.rgActual)} · 자체보관${prev ? '(옮긴 실사 포함)' : ' 미리 채운'} 합계 ${sum((r) => r.selfCount ?? 0)} · **빈칸(옵션별 실사 필요) ${rows.filter((r) => r.selfCount === null).length}행**`,
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
  console.log(`✅ opening-count-${DATE}.csv · opening-review-${DATE}.md — 이슈 ${issues.length}건 · 빈칸 ${rows.filter((r) => r.selfCount === null).length}행`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`❌ ${(e as Error).message}`);
    process.exitCode = 1;
  });
}
