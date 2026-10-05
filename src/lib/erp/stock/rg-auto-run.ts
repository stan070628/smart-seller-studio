// src/lib/erp/stock/rg-auto-run.ts
// (1-C2b ④) 매일 RG 대조 실행. 순서: 차감 꺼짐이면 건너뜀 → RG 주문 수집(최신 판매를 원장에 — 끝난 뒤에 DB 연결을 잡는다)
//   → 원장·입고중·이전 기록 읽기 → 쿠팡 RG 재고 → 판정(rg-auto.ts) → 한 트랜잭션[자동 이동이 켜져 있으면 SKU 오름차순으로
//   잠금 → 잠금 뒤 원장 RG·입고중을 다시 읽어 min(실재고 − 원장, 입고중)으로 재계산 → SKU별 savepoint 안에서 입고중 → RG 전표
//   (한 SKU 실패는 그 SKU만 되돌리고 알림) → 기록(rg_recon_snapshots — moved는 실제로 옮긴 수량)].
// 「2회 연속 감소」의 직전 차이는 20시간보다 앞선 기록만 본다(몇 분 간격 수동·dry 실행이 연속으로 잡히지 않게).
// 텔레그램 중복 방지용으로 직전 실행(이번 시각보다 앞선 마지막 run)과 고정 키(alertKey — 기록에 「키|문구」)로 비교해 newAlerts·movesChanged를
// 돌려준다 — 감소 알림은 늘 새 알림.
// 자동 이동 스위치(erp.settings rg_auto_arrive_enabled)가 꺼져 있거나 forceDry면 「옮길 예정」만 기록한다.
// RG 수집이 busy(15분 주문 수집 orders-sync가 임대를 잡고 있다 — 길어진 실행과 겹칠 때)면 30초 간격으로 4번까지 다시 부른다 — 그래도 못 하면 던진다.
// (1-C2c) 같은 SKU 잠금·savepoint 안에서 입고 이동 뒤 원장을 다시 읽어 min(실재고 − 원장 RG, 복귀 한도)만큼 취소·반품 복귀(adjust/rg_return, 멱등키
// rg-return:<sku>:<KST 날짜>)를 기록한다. 단가는 원장 최근 lot → 옛 원가 → 없으면 기록하지 않고 return_no_cost 알림.
import { randomUUID } from 'node:crypto';
import type { Connectable } from '@/lib/erp/orders/collect';
import { collectOrders } from '@/lib/erp/orders/collect';
import { maskPII } from '@/lib/jobs/mask';
import { getSourcingPool } from '@/lib/sourcing/db';
import { lockSku, postLotCreate, postTransfer } from '@/lib/erp/ledger/store';
import { latestLotCost, legacyUnitCost } from '@/lib/erp/ledger/adjust-store';
import { kstDay } from '@/lib/erp/orders/window';
import { returnRoomBySku } from './rg-return-room';
import { rgQtyBySku, type RgStock } from '@/lib/erp/ledger/opening';
import { fetchRgStock, readRgLinks } from '@/lib/erp/ledger/opening-db';
import { activeSkuIds, rgLedgerBySku } from '@/lib/erp/stock/queries';
import { ALERT_SEP, alertKey, alertText, keyOfStored, planRgAuto, type Inflow, type RgAlert } from './rg-auto';

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
  /** 판정(옮길 예정) */
  moves: { skuId: number; qty: number }[];
  /** 실제로 옮긴 것(잠금 뒤 재계산·실패 반영). 자동 이동이 꺼져 있으면 빈 배열 */
  moved: { skuId: number; qty: number }[];
  /** 전표가 실패한 SKU 수(알림에도 실린다) */
  failed: number;
  alerts: string[];
  /** 직전 실행에 없던 알림(감소는 늘 포함) — 텔레그램은 이것만 보낸다 */
  newAlerts: string[];
  /** 옮길 예정(SKU:수량) 집합이 직전 실행과 다르다 */
  movesChanged: boolean;
  /** (1-C2c) 복귀 판정 */
  returns: { skuId: number; qty: number }[];
  /** 실제로 기록한 복귀(자동 이동 켜짐 · 같은 날 이미 기록됐으면 빠진다) */
  returned: { skuId: number; qty: number }[];
  /** 복귀 예정 집합이 직전 실행과 다르다 */
  returnsChanged: boolean;
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
const SNAP_SQL = `insert into erp.rg_recon_snapshots (run_id, run_at, sku_id, vid, ledger, actual, inbound, planned_move, moved, alert, planned_return, returned)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;
const moveKey = (ms: { skuId: number; qty: number }[]) => ms.map((x) => `${x.skuId}:${x.qty}`).sort().join(',');

export async function runRgAuto(p: { now: Date; forceDry: boolean; deps?: RgAutoDeps }): Promise<RgAutoSummary> {
  const deps = p.deps ?? defaultDeps();
  const skipped: RgAutoSummary = { skipped: 'deduct_off', autoMove: false, runId: null, skus: 0, moves: [], moved: [], failed: 0, alerts: [], newAlerts: [], movesChanged: false, returns: [], returned: [], returnsChanged: false };
  // 차감 스위치만 먼저 본다 — 수집(최대 수십 초 + busy 재시도 2분) 동안 연결을 붙잡지 않는다
  const c0 = await deps.pool.connect();
  let deductOn: boolean;
  try {
    deductOn = enabledOf((await c0.query(`select value from erp.settings where name = 'deduct_enabled'`)).rows);
  } finally {
    c0.release();
  }
  if (!deductOn) return skipped;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  let rg = await deps.collectRg();
  for (let i = 0; i < BUSY_RETRIES && !rg.ok && rg.busy; i++) {
    await sleep(BUSY_WAIT_MS);
    rg = await deps.collectRg();
  }
  if (!rg.ok) throw new Error(`RG 주문 수집 실패 — 대조하지 않는다: ${rg.error ?? ''}`);

  const c = await deps.pool.connect();
  try {
    const at = p.now.toISOString();
    const auto = await c.query(`select value from erp.settings where name = 'rg_auto_arrive_enabled'`);
    const autoMove = !p.forceDry && enabledOf(auto.rows);
    const ledger = await rgLedgerBySku(c);
    const { rows: ib } = await c.query(`select sku_id, qty from erp.stock_on_hand where location = 'rg_inbound'`);
    const inbound = new Map(ib.map((r) => [Number(r.sku_id), Number(r.qty)]));
    const links = await readRgLinks(c);
    const active = await activeSkuIds(c);
    const { rows: fl } = await c.query(
      `select id, reverses_id, sku_id, qty, occurred_at from erp.stock_ledger where location = 'rg_inbound' order by occurred_at, id`,
    );
    const inflows = new Map<number, Inflow[]>();
    for (const r of fl) {
      const k = Number(r.sku_id);
      inflows.set(k, [...(inflows.get(k) ?? []), {
        id: Number(r.id), reversesId: r.reverses_id == null ? null : Number(r.reverses_id), qty: Number(r.qty),
        occurredAt: (r.occurred_at instanceof Date ? r.occurred_at : new Date(String(r.occurred_at))).toISOString(),
      }]);
    }
    const { rows: pv } = await c.query(
      `select distinct on (sku_id) sku_id, actual - ledger as diff from erp.rg_recon_snapshots
        where sku_id is not null and run_at < $1::timestamptz - interval '20 hours' order by sku_id, run_at desc`,
      [at],
    );
    const prev = new Map(pv.map((r) => [Number(r.sku_id), Number(r.diff)]));
    const { rows: lastRun } = await c.query(
      `with last as (select run_id from erp.rg_recon_snapshots where run_at < $1::timestamptz order by run_at desc limit 1)
       select s.sku_id, s.vid, s.planned_move, s.planned_return, s.alert from erp.rg_recon_snapshots s join last on last.run_id = s.run_id`,
      [at],
    );

    const stock = await deps.fetchRgStock();
    const actual = rgQtyBySku(links, stock, new Set());
    const unmapped = actual.issues.filter((i) => i.kind === 'rg_vid_unmapped')
      .map((i) => ({ vid: i.ref, qty: stock.find((s) => s.vid === i.ref)?.qty ?? 0 }));
    const allIds = [...new Set([...ledger.keys(), ...actual.bySku.keys(), ...inbound.keys()])].sort((a, b) => a - b);
    const skuIds = allIds.filter((id) => active.has(id));
    const inactive = allIds.filter((id) => !active.has(id) && (actual.bySku.get(id) ?? 0) > 0);
    const room = await returnRoomBySku(c, at, skuIds);
    const plan = planRgAuto(skuIds.map((skuId) => ({
      skuId, ledger: ledger.get(skuId) ?? 0, actual: actual.bySku.get(skuId) ?? 0, inbound: inbound.get(skuId) ?? 0,
      returnRoom: room.get(skuId) ?? 0, prevDiff: prev.get(skuId) ?? null, inflows: inflows.get(skuId) ?? [],
    })), unmapped, p.now);
    const alerts: RgAlert[] = [...plan.alerts, ...inactive.map((skuId): RgAlert => ({ kind: 'inactive_sku', skuId, qty: actual.bySku.get(skuId) ?? 0 }))];

    const { rows: nm } = await c.query(`select id, name, option_label from erp.skus where id = any($1::bigint[])`, [[...skuIds, ...inactive]]);
    const names = new Map(nm.map((r) => [Number(r.id), `${r.name}${r.option_label ? ` · ${r.option_label}` : ''}`]));
    const name = (id: number) => names.get(id) ?? `SKU ${id}`;
    const moveOf = new Map(plan.moves.map((m) => [m.skuId, m.qty]));
    const movedOf = new Map<number, number>();
    const retOf = new Map(plan.returns.map((r) => [r.skuId, r.qty]));
    const returnedOf = new Map<number, number>();
    const day = kstDay(p.now);
    const runId = randomUUID();

    await c.query('BEGIN');
    try {
      if (autoMove) {
        const work = [...new Set([...plan.moves.map((x) => x.skuId), ...plan.returns.map((x) => x.skuId)])].sort((a, b) => a - b);
        for (const [n, skuId] of work.entries()) {
          await lockSku(c, skuId);
          await c.query(`savepoint rgauto_${n}`);
          try {
            // 읽은 뒤 잠금 전에 바뀌었을 수 있다(사람의 입고 완료·역전표·판매 차감) — 잠금 뒤 값으로 다시 잰다
            const read = async () => {
              const { rows: now } = await c.query(
                `select location, qty from erp.stock_on_hand where sku_id = $1 and location in ('rg', 'rg_inbound')`, [skuId],
              );
              return (loc: string) => Number(now.find((r) => r.location === loc)?.qty ?? 0);
            };
            const act = actual.bySku.get(skuId) ?? 0;
            let onHand = await read();
            if (moveOf.has(skuId)) {
              const qty = Math.min(act - onHand('rg'), onHand('rg_inbound'));
              if (qty > 0) {
                await postTransfer(c, {
                  skuId, from: 'rg_inbound', to: 'rg', qty, occurredAt: at,
                  idemKey: `rgauto:${runId}:${skuId}`, refType: 'rg_auto', refId: runId, note: 'RG 입고 완료(자동 대조)',
                });
                movedOf.set(skuId, qty);
                onHand = await read();
              }
            }
            if (retOf.has(skuId)) {
              const roomNow = (await returnRoomBySku(c, at, [skuId])).get(skuId) ?? 0;
              const qty = Math.min(act - onHand('rg'), roomNow);
              if (qty > 0) {
                const unitCost = (await latestLotCost(c, skuId)) ?? (await legacyUnitCost(c, skuId));
                if (unitCost === null) {
                  alerts.push({ kind: 'return_no_cost', skuId, qty });
                } else {
                  const r = await postLotCreate(c, {
                    skuId, location: 'rg', qty, unitCost, kind: 'adjust', reason: 'rg_return', occurredAt: at,
                    idemKey: `rg-return:${skuId}:${day}`, refType: 'rg_auto', refId: runId, note: 'RG 취소·반품 복귀(자동 대조)',
                  });
                  if (r.posted) returnedOf.set(skuId, qty);
                }
              }
            }
            await c.query(`release savepoint rgauto_${n}`);
          } catch (e) {
            await c.query(`rollback to savepoint rgauto_${n}`);
            movedOf.delete(skuId);
            returnedOf.delete(skuId);
            alerts.push({ kind: 'move_failed', skuId, error: maskPII(e instanceof Error ? e.message : String(e)) });
          }
        }
      }
      const alertOf = new Map<string, string[]>();
      for (const a of alerts) {
        const k = a.kind === 'unmapped_vid' ? `v:${a.vid}` : `s:${a.skuId}`;
        alertOf.set(k, [...(alertOf.get(k) ?? []), `${alertKey(a)}|${alertText(a, name)}`]);
      }
      const joined = (k: string) => (alertOf.get(k) ?? []).join(ALERT_SEP) || null;
      for (const skuId of [...skuIds, ...inactive]) {
        await c.query(SNAP_SQL, [runId, at, skuId, null, ledger.get(skuId) ?? 0, actual.bySku.get(skuId) ?? 0, inbound.get(skuId) ?? 0,
          moveOf.get(skuId) ?? 0, movedOf.get(skuId) ?? 0, joined(`s:${skuId}`), retOf.get(skuId) ?? 0, returnedOf.get(skuId) ?? 0]);
      }
      for (const u of unmapped) {
        await c.query(SNAP_SQL, [runId, at, null, u.vid, 0, u.qty, 0, 0, 0, joined(`v:${u.vid}`), 0, 0]);
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    }

    const texts = alerts.map((a) => alertText(a, name));
    // 직전 실행의 고정 키(「키|문구」 앞머리) — 문구가 아니라 키로 비교해 날짜 수·수량만 바뀐 같은 사안은 다시 보내지 않는다
    const seen = new Set(lastRun.flatMap((r) => (r.alert ? String(r.alert).split(ALERT_SEP).map(keyOfStored) : [])));
    const newAlerts = texts.filter((_, i) => alerts[i].kind === 'decrease' || !seen.has(alertKey(alerts[i])));
    const prevMoves = lastRun.filter((r) => r.sku_id != null && Number(r.planned_move) > 0).map((r) => ({ skuId: Number(r.sku_id), qty: Number(r.planned_move) }));
    const prevReturns = lastRun.filter((r) => r.sku_id != null && Number(r.planned_return ?? 0) > 0).map((r) => ({ skuId: Number(r.sku_id), qty: Number(r.planned_return) }));
    return {
      skipped: null, autoMove, runId, skus: skuIds.length, moves: plan.moves,
      moved: [...movedOf].map(([skuId, qty]) => ({ skuId, qty })), failed: alerts.filter((a) => a.kind === 'move_failed').length,
      alerts: texts, newAlerts, movesChanged: moveKey(plan.moves) !== moveKey(prevMoves),
      returns: plan.returns, returned: [...returnedOf].map(([skuId, qty]) => ({ skuId, qty })),
      returnsChanged: moveKey(plan.returns) !== moveKey(prevReturns),
    };
  } finally {
    c.release();
  }
}
