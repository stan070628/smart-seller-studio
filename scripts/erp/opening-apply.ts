// scripts/erp/opening-apply.ts
// 사용법: npx --no-install tsx scripts/erp/opening-apply.ts [--apply | --verify]
// 최신 docs/erp/opening-count-*.csv(사람이 채운 실사표) + 지금 읽은 쿠팡 RG 재고 → erp.stock_ledger 기초 전표.
// 기본(점검): 적재할 합계와 멈출 이유만 출력한다.
// --apply : 한 트랜잭션. 기초 전표가 이미 있으면 거부한다(고칠 때는 조정 전표). 끝에 sync_cursors 'ledger_cutover'를 적는다.
// --verify: rg-reconcile과 같다.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { fetchRgStock, loadOverrides } from './opening-collect';
import { runReconcile } from './rg-reconcile';
import { parseCountCsv, rgQtyBySku, type CountRow } from '@/lib/erp/ledger/opening';
import { postLotCreate } from '@/lib/erp/ledger/store';
import type { Location } from '@/lib/erp/ledger/fifo';

loadEnvLocal();
const DIR = path.join(__dirname, '..', '..', 'docs', 'erp');
const APPLY = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');

function latestCsv(): { file: string; rows: CountRow[] } {
  const file = fs.readdirSync(DIR).filter((n) => /^opening-count-.*\.csv$/.test(n)).sort().pop();
  if (!file) throw new Error('docs/erp/opening-count-*.csv가 없다 — opening-collect.ts를 먼저 돌린다');
  return { file, rows: parseCountCsv(fs.readFileSync(path.join(DIR, file), 'utf-8')) };
}

interface Plan {
  skuId: number;
  key: string;
  location: Location;
  qty: number;
  unitCost: number;
}

async function main(): Promise<void> {
  if (VERIFY) {
    if ((await runReconcile()) > 0) process.exitCode = 1;
    return;
  }
  const { file, rows } = latestCsv();
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const active = (await c.query(`select id, key from erp.skus where status = 'active'`)).rows.map((r) => ({ id: Number(r.id), key: r.key as string }));
    const links = (await c.query(
      `select l.external_product_id as vid, x.sku_id, x.multiplier
         from erp.channel_listings l join erp.listing_skus x on x.listing_id = l.id
        where l.channel = 'coupang_rg' and l.active`,
    )).rows.map((r) => ({ vid: String(r.vid), skuId: Number(r.sku_id), multiplier: Number(r.multiplier) }));
    const existing = Number((await c.query(`select count(*) from erp.stock_ledger where kind = 'opening'`)).rows[0].count);
    await c.query('COMMIT');

    const errs: string[] = [];
    if (existing > 0) errs.push(`기초 전표가 이미 ${existing}건 있다 — 다시 적재하지 않는다. 고칠 것은 조정 전표로`);
    const bySku = new Map(rows.map((r) => [r.skuId, r]));
    for (const s of active) if (!bySku.has(s.id)) errs.push(`실사표에 없는 활성 SKU: ${s.key}`);
    for (const r of rows) {
      const s = active.find((a) => a.id === r.skuId);
      if (!s) errs.push(`실사표의 SKU ${r.skuId}(${r.skuKey})가 활성 SKU가 아니다`);
      else if (s.key !== r.skuKey) errs.push(`SKU ${r.skuId} 키가 다르다: 실사표 ${r.skuKey} / DB ${s.key}`);
      if (r.selfCount === null) errs.push(`self_count 빈칸: ${r.skuKey}`);
      else if (r.selfCount < 0) errs.push(`self_count 음수: ${r.skuKey}`);
      if (r.rgInbound < 0) errs.push(`rg_inbound 음수: ${r.skuKey}`);
    }

    const rg = rgQtyBySku(links, await fetchRgStock(), new Set(Object.keys(loadOverrides().ignoreRgVids)));
    for (const i of rg.issues) errs.push(`${i.kind} ${i.ref} — ${i.detail}`);

    const plan: Plan[] = [];
    for (const r of rows) {
      const rgNow = rg.bySku.get(r.skuId) ?? 0;
      const total = (r.selfCount ?? 0) + r.rgInbound + rgNow;
      if (total > 0 && r.unitCost === null) errs.push(`재고 ${total}개인데 unit_cost 빈칸: ${r.skuKey}`);
      for (const [location, qty] of [['self', r.selfCount ?? 0], ['rg_inbound', r.rgInbound], ['rg', rgNow]] as const) {
        if (qty > 0) plan.push({ skuId: r.skuId, key: r.skuKey, location, qty, unitCost: r.unitCost ?? 0 });
      }
    }

    const rgMoved = rows.filter((r) => (rg.bySku.get(r.skuId) ?? 0) !== r.rgActual);
    const total = (loc: Location) => plan.filter((p) => p.location === loc).reduce((s, p) => s + p.qty, 0);
    const value = plan.reduce((s, p) => s + p.qty * p.unitCost, 0);
    console.log(`${file} → 기초 전표 ${plan.length}건 · self ${total('self')} · rg_inbound ${total('rg_inbound')} · rg ${total('rg')} · 평가액 ${value.toLocaleString()}원`);
    if (rgMoved.length > 0) console.log(`(참고) 실사표 작성 후 RG 재고가 바뀐 SKU ${rgMoved.length}개 — 적재는 지금 값으로 한다`);
    if (errs.length > 0) throw new Error(`적재할 수 없다 ${errs.length}건:\n  ${errs.slice(0, 40).join('\n  ')}`);
    if (!APPLY) {
      console.log('(점검만 — 적재하려면 --apply)');
      return;
    }

    const cutoverAt = new Date().toISOString();
    await c.query('BEGIN');
    try {
      for (const p of plan) {
        await postLotCreate(c, {
          skuId: p.skuId, location: p.location, qty: p.qty, unitCost: p.unitCost, kind: 'opening',
          occurredAt: cutoverAt, idemKey: `opening:${p.skuId}:${p.location}`, refType: 'opening', refId: file,
        });
      }
      await c.query(
        `insert into erp.sync_cursors (name, cursor_at) values ('ledger_cutover', $1)
         on conflict (name) do update set cursor_at = excluded.cursor_at, updated_at = now()`,
        [cutoverAt],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    }
    console.log(`✅ 기초재고 적재 — ${plan.length}건 · 기준 시각 ${cutoverAt}`);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exitCode = 1;
});
