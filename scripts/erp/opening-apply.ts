// scripts/erp/opening-apply.ts
// 사용법: npx --no-install tsx scripts/erp/opening-apply.ts <실사표.csv> [--apply]
//         npx --no-install tsx scripts/erp/opening-apply.ts --verify
// 사람이 채운 실사표(경로를 반드시 준다 — 최신 파일을 짐작하지 않는다) + 지금 읽은 쿠팡 RG 재고 → erp.stock_ledger 기초 전표.
// 필수: docs/erp/opening-overrides.json의 countedAt(실사를 마친 시각, 오프셋 있는 ISO). 적재 시점에 24시간 이내여야 한다.
// 단가: overrides unitCost[SKU 키] > 옛 입고 이력(실사 보유 수량으로 다시 계산) > CSV unit_cost(이력이 없을 때만).
// 기본(점검): 적재할 합계와 멈출 이유만 출력한다.
// --apply : 한 트랜잭션. 전역 잠금 → 기초 전표 재확인 → 기준 시각 커서 선점 → 전표. 기초 전표가 이미 있으면 거부한다(고칠 때는 조정 전표).
//           기준 시각(cutoverAt)은 RG 재고를 읽기 직전 시각이다 — 1-C 판매 소급의 시작점.
// --verify: rg-reconcile과 같다.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { OVERRIDES_PATH, fetchRgStock, loadOverrides, readDb } from './opening-collect';
import { runReconcile } from './rg-reconcile';
import {
  checkCountedAt, groupSkus, parseCountCsv, resolveOpeningCosts, rgOutsideActive, rgQtyBySku,
} from '@/lib/erp/ledger/opening';
import { postLotCreate } from '@/lib/erp/ledger/store';
import type { Location } from '@/lib/erp/ledger/fifo';

loadEnvLocal();
const APPLY = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');
/** 기초재고 적재 전역 잠금(pg_advisory_xact_lock(bigint)) — SKU 잠금(7101, sku) 네임스페이스와 겹치지 않는다 */
const OPENING_LOCK = 7102;

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
  const csvArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!csvArg) throw new Error('실사표 CSV 경로를 준다: opening-apply.ts <실사표.csv> [--apply] (--verify는 경로 없이)');
  const csvPath = path.resolve(csvArg);
  if (!fs.existsSync(csvPath)) throw new Error(`실사표가 없다: ${csvArg}`);
  const file = path.basename(csvPath);
  const rows = parseCountCsv(fs.readFileSync(csvPath, 'utf-8'));

  const errs: string[] = [];
  const ovExists = fs.existsSync(OVERRIDES_PATH);
  if (!ovExists) errs.push('docs/erp/opening-overrides.json이 없다 — countedAt(실사를 마친 시각, 예: "2026-09-27T09:30:00+09:00")을 적어 만든다');
  const ov = loadOverrides();

  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const db = await readDb(c);
    const existing = Number((await c.query(`select count(*) from erp.stock_ledger where kind = 'opening'`)).rows[0].count);
    const allKeys = new Map((await c.query(`select id, key, status from erp.skus`)).rows.map((r) => [Number(r.id), `${r.key}(${r.status})`]));
    await c.query('COMMIT');

    const active = new Map(db.skus.map((s) => [s.id, s]));
    if (existing > 0) errs.push(`기초 전표가 이미 ${existing}건 있다 — 다시 적재하지 않는다. 고칠 것은 조정 전표로`);
    const bySku = new Map(rows.map((r) => [r.skuId, r]));
    for (const s of db.skus) if (!bySku.has(s.id)) errs.push(`실사표에 없는 활성 SKU: ${s.key}`);
    for (const r of rows) {
      const s = active.get(r.skuId);
      if (!s) errs.push(`실사표의 SKU ${r.skuId}(${r.skuKey})가 활성 SKU가 아니다`);
      else if (s.key !== r.skuKey) errs.push(`SKU ${r.skuId} 키가 다르다: 실사표 ${r.skuKey} / DB ${s.key}`);
      if (r.selfCount === null) errs.push(`self_count 빈칸: ${r.skuKey}`);
      else if (r.selfCount < 0) errs.push(`self_count 음수: ${r.skuKey}`);
      if (r.rgInbound < 0) errs.push(`rg_inbound 음수: ${r.skuKey}`);
    }
    const activeKeys = new Set(db.skus.map((s) => s.key));
    for (const k of Object.keys(ov.unitCost ?? {})) if (!activeKeys.has(k)) errs.push(`opening-overrides unitCost의 SKU 키 ${k}가 활성 SKU가 아니다`);
    for (const [k, v] of Object.entries(ov.unitCost ?? {})) if (!Number.isInteger(v) || v < 0) errs.push(`opening-overrides unitCost[${k}] = ${v} — 0 이상 정수여야 한다`);

    // 기준 시각은 RG 재고를 읽기 직전 — 이 시각 이후 판매는 1-C가 소급해 차감한다
    const cutoverAt = new Date().toISOString();
    const rg = rgQtyBySku(db.links, await fetchRgStock(), new Set(Object.keys(ov.ignoreRgVids)));
    for (const i of rg.issues) errs.push(`${i.kind} ${i.ref} — ${i.detail}`);
    for (const o of rgOutsideActive(rg.bySku, new Set(active.keys()))) {
      errs.push(`활성이 아닌 SKU ${allKeys.get(o.skuId) ?? o.skuId}에 RG 재고 ${o.qty}개 — 보관된 SKU다. 리스팅 연결을 고치거나 ignoreRgVids로 뺀다`);
    }
    if (ovExists) {
      const bad = checkCountedAt(ov.countedAt, new Date(cutoverAt));
      if (bad) errs.push(bad);
    }

    const cost = resolveOpeningCosts(db.skus, groupSkus(db.skus), db.legacy, rows.filter((r) => active.has(r.skuId)), rg.bySku, ov.unitCost ?? {});
    const costById = new Map(cost.costs.map((x) => [x.skuId, x]));
    for (const m of cost.missing) errs.push(`재고 ${m.onHand}개인데 단가를 모른다(덮어쓰기·입고 이력·CSV 모두 없음): ${m.skuKey}`);

    const plan: Plan[] = [];
    for (const r of rows) {
      const unitCost = costById.get(r.skuId)?.unitCost;
      if (unitCost === null || unitCost === undefined) continue;
      const rgNow = rg.bySku.get(r.skuId) ?? 0;
      for (const [location, qty] of [['self', r.selfCount ?? 0], ['rg_inbound', r.rgInbound], ['rg', rgNow]] as const) {
        if (qty > 0) plan.push({ skuId: r.skuId, key: r.skuKey, location, qty, unitCost });
      }
    }

    const rgMoved = rows.filter((r) => (rg.bySku.get(r.skuId) ?? 0) !== r.rgActual);
    const total = (loc: Location) => plan.filter((p) => p.location === loc).reduce((s, p) => s + p.qty, 0);
    const value = plan.reduce((s, p) => s + p.qty * p.unitCost, 0);
    console.log(`${file} → 기초 전표 ${plan.length}건 · self ${total('self')} · rg_inbound ${total('rg_inbound')} · rg ${total('rg')} · 평가액 ${value.toLocaleString()}원`);
    console.log(`실사 시각(countedAt) ${ov.countedAt ?? '없음'} · 기준 시각(cutoverAt) ${cutoverAt}`);
    if (rgMoved.length > 0) console.log(`(참고) 실사표 작성 후 RG 재고가 바뀐 SKU ${rgMoved.length}개 — 적재는 지금 값으로 한다`);
    if (cost.changed.length > 0) {
      console.log(`단가가 실사표 unit_cost와 다른 SKU ${cost.changed.length}개(적재는 「적재 단가」로):`);
      console.table(cost.changed.map((x) => ({ SKU: x.skuKey, 보유: x.onHand, 실사표: x.csvCost ?? '', 적재단가: x.unitCost ?? '', 출처: x.source })));
    }
    if (cost.baseUnitCheck.length > 0) {
      console.log(`기준 단위 확인 필요 ${cost.baseUnitCheck.length}개 — 기준 단위가 정해졌는데 단가가 옛 입고 이력에서 왔다(옛 cost_entries는 다른 단위일 수 있다. 다르면 overrides unitCost에 적는다):`);
      for (const x of cost.baseUnitCheck) console.log(`  ${x.skuKey} · 기준 단위 「${x.baseUnitLabel}」 · 이력 단가 ${x.unitCost}`);
    }
    if (errs.length > 0) throw new Error(`적재할 수 없다 ${errs.length}건:\n  ${errs.slice(0, 40).join('\n  ')}`);
    if (!APPLY) {
      console.log('(점검만 — 적재하려면 --apply)');
      return;
    }

    await c.query('BEGIN');
    try {
      // 겹친 실행 방지: 전역 잠금 → 잠금 안에서 기초 전표를 다시 센다 → 커서를 선점한다
      await c.query('select pg_advisory_xact_lock($1::bigint)', [OPENING_LOCK]);
      const again = Number((await c.query(`select count(*) from erp.stock_ledger where kind = 'opening'`)).rows[0].count);
      if (again > 0) throw new Error(`잠금 뒤 다시 보니 기초 전표가 이미 ${again}건 있다 — 중단`);
      await c.query(
        `insert into erp.sync_cursors (name, cursor_at) values ('ledger_cutover', $1) on conflict (name) do nothing`,
        [cutoverAt],
      );
      const cur = (await c.query(`select cursor_at from erp.sync_cursors where name = 'ledger_cutover'`)).rows[0]?.cursor_at;
      if (!cur || new Date(cur).getTime() !== new Date(cutoverAt).getTime()) {
        throw new Error(`ledger_cutover 커서가 이미 다른 값(${cur instanceof Date ? cur.toISOString() : String(cur)})이다 — 중단`);
      }
      for (const p of plan) {
        await postLotCreate(c, {
          skuId: p.skuId, location: p.location, qty: p.qty, unitCost: p.unitCost, kind: 'opening',
          occurredAt: cutoverAt, idemKey: `opening:${p.skuId}:${p.location}`, refType: 'opening', refId: file,
        });
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    }
    console.log(`✅ 기초재고 적재 — ${plan.length}건 · 실사 시각 ${ov.countedAt} · 기준 시각 ${cutoverAt}`);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exitCode = 1;
});
