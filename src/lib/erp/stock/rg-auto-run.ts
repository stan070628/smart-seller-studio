// src/lib/erp/stock/rg-auto-run.ts
// (1-C2b ④) 매일 RG 대조 실행. 순서: 차감 꺼짐이면 건너뜀 → RG 주문 수집(최신 판매를 원장에) → 원장·입고중·이전 기록 읽기
//   → 쿠팡 RG 재고 → 판정(rg-auto.ts) → 한 트랜잭션[기록(rg_recon_snapshots) → 자동 이동이 켜져 있으면 SKU 잠금 → 입고중 → RG 전표].
// 자동 이동 스위치(erp.settings rg_auto_arrive_enabled)가 꺼져 있거나 forceDry면 「옮길 예정」만 기록한다.
// RG 수집이 busy(15분 주문 수집 orders-sync가 같은 시각 :30에 임대를 잡고 있다)면 30초 간격으로 4번까지 다시 부른다 — 그래도 못 하면 던진다.
import { randomUUID } from 'node:crypto';
import type { Connectable } from '@/lib/erp/orders/collect';
import { collectOrders } from '@/lib/erp/orders/collect';
import { getSourcingPool } from '@/lib/sourcing/db';
import { lockSku, postTransfer } from '@/lib/erp/ledger/store';
import { rgQtyBySku, type RgStock } from '@/lib/erp/ledger/opening';
import { fetchRgStock, readRgLinks } from '@/lib/erp/ledger/opening-db';
import { activeSkuIds, rgLedgerBySku } from '@/lib/erp/stock/queries';
import { alertText, planRgAuto, type Inflow } from './rg-auto';

export interface RgAutoDeps {
  pool: Connectable;
  collectRg: () => Promise<{ ok: boolean; error: string | null; busy?: boolean }>;
  fetchRgStock: () => Promise<RgStock[]>;
  sleep?: (ms: number) => Promise<void>;
}

/** busy일 때 다시 부르는 횟수·간격 — 최악 2분 대기(maxDuration 300초 안) */
export const BUSY_RETRIES = 4;
export const BUSY_WAIT_MS = 30_000;

export interface RgAutoSummary {
  skipped: 'deduct_off' | null;
  autoMove: boolean;
  runId: string | null;
  skus: number;
  moves: { skuId: number; qty: number }[];
  alerts: string[];
}

const defaultDeps = (): RgAutoDeps => ({
  pool: getSourcingPool(),
  collectRg: async () => {
    const [r] = await collectOrders({ channels: ['coupang_rg'], dryRun: false });
    return { ok: r.ok, error: r.error, busy: r.skipped === 'busy' };
  },
  fetchRgStock,
});

const enabledOf = (rows: { value?: { enabled?: boolean } }[]) => rows[0]?.value?.enabled === true;

export async function runRgAuto(p: { now: Date; forceDry: boolean; deps?: RgAutoDeps }): Promise<RgAutoSummary> {
  const deps = p.deps ?? defaultDeps();
  const c = await deps.pool.connect();
  try {
    const deduct = await c.query(`select value from erp.settings where name = 'deduct_enabled'`);
    if (!enabledOf(deduct.rows)) return { skipped: 'deduct_off', autoMove: false, runId: null, skus: 0, moves: [], alerts: [] };
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
    let rg = await deps.collectRg();
    for (let i = 0; i < BUSY_RETRIES && !rg.ok && rg.busy; i++) {
      await sleep(BUSY_WAIT_MS);
      rg = await deps.collectRg();
    }
    if (!rg.ok) throw new Error(`RG 주문 수집 실패 — 대조하지 않는다: ${rg.error ?? ''}`);

    const auto = await c.query(`select value from erp.settings where name = 'rg_auto_arrive_enabled'`);
    const autoMove = !p.forceDry && enabledOf(auto.rows);
    const ledger = await rgLedgerBySku(c);
    const { rows: ib } = await c.query(`select sku_id, qty from erp.stock_on_hand where location = 'rg_inbound'`);
    const inbound = new Map(ib.map((r) => [Number(r.sku_id), Number(r.qty)]));
    const links = await readRgLinks(c);
    const active = await activeSkuIds(c);
    const { rows: fl } = await c.query(`select sku_id, qty, occurred_at from erp.stock_ledger where location = 'rg_inbound' order by occurred_at, id`);
    const inflows = new Map<number, Inflow[]>();
    for (const r of fl) {
      const k = Number(r.sku_id);
      inflows.set(k, [...(inflows.get(k) ?? []), { qty: Number(r.qty), occurredAt: (r.occurred_at instanceof Date ? r.occurred_at : new Date(String(r.occurred_at))).toISOString() }]);
    }
    const { rows: pv } = await c.query(
      `select distinct on (sku_id) sku_id, actual - ledger as diff from erp.rg_recon_snapshots where sku_id is not null order by sku_id, run_at desc`,
    );
    const prev = new Map(pv.map((r) => [Number(r.sku_id), Number(r.diff)]));

    const stock = await deps.fetchRgStock();
    const actual = rgQtyBySku(links, stock, new Set());
    const unmapped = actual.issues.filter((i) => i.kind === 'rg_vid_unmapped')
      .map((i) => ({ vid: i.ref, qty: stock.find((s) => s.vid === i.ref)?.qty ?? 0 }));
    const skuIds = [...new Set([...ledger.keys(), ...actual.bySku.keys(), ...inbound.keys()])].filter((id) => active.has(id)).sort((a, b) => a - b);
    const plan = planRgAuto(skuIds.map((skuId) => ({
      skuId, ledger: ledger.get(skuId) ?? 0, actual: actual.bySku.get(skuId) ?? 0, inbound: inbound.get(skuId) ?? 0,
      prevDiff: prev.get(skuId) ?? null, inflows: inflows.get(skuId) ?? [],
    })), unmapped, p.now);

    const { rows: nm } = await c.query(`select id, name, option_label from erp.skus where id = any($1::bigint[])`, [skuIds]);
    const names = new Map(nm.map((r) => [Number(r.id), `${r.name}${r.option_label ? ` · ${r.option_label}` : ''}`]));
    const name = (id: number) => names.get(id) ?? `SKU ${id}`;
    const alertOf = new Map<string, string[]>();
    for (const a of plan.alerts) {
      const k = a.kind === 'unmapped_vid' ? `v:${a.vid}` : `s:${a.skuId}`;
      alertOf.set(k, [...(alertOf.get(k) ?? []), alertText(a, name)]);
    }
    const moveOf = new Map(plan.moves.map((m) => [m.skuId, m.qty]));
    const runId = randomUUID();
    const at = p.now.toISOString();

    await c.query('BEGIN');
    try {
      for (const skuId of skuIds) {
        const planned = moveOf.get(skuId) ?? 0;
        await c.query(
          `insert into erp.rg_recon_snapshots (run_id, run_at, sku_id, vid, ledger, actual, inbound, planned_move, moved, alert)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [runId, at, skuId, null, ledger.get(skuId) ?? 0, actual.bySku.get(skuId) ?? 0, inbound.get(skuId) ?? 0, planned, autoMove ? planned : 0,
            (alertOf.get(`s:${skuId}`) ?? []).join(' / ') || null],
        );
      }
      for (const u of unmapped) {
        await c.query(
          `insert into erp.rg_recon_snapshots (run_id, run_at, sku_id, vid, ledger, actual, inbound, planned_move, moved, alert)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [runId, at, null, u.vid, 0, u.qty, 0, 0, 0, (alertOf.get(`v:${u.vid}`) ?? []).join(' / ') || null],
        );
      }
      if (autoMove) {
        for (const m of plan.moves) await lockSku(c, m.skuId);
        for (const m of plan.moves) {
          await postTransfer(c, {
            skuId: m.skuId, from: 'rg_inbound', to: 'rg', qty: m.qty, occurredAt: at,
            idemKey: `rgauto:${runId}:${m.skuId}`, refType: 'rg_auto', refId: runId, note: 'RG 입고 완료(자동 대조)',
          });
        }
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    }
    return { skipped: null, autoMove, runId, skus: skuIds.length, moves: plan.moves, alerts: plan.alerts.map((a) => alertText(a, name)) };
  } finally {
    c.release();
  }
}
