// src/lib/erp/orders/collect.ts
// 채널 수집 한 번. 순서: 채널 세션 잠금(pg_try_advisory_lock — 못 잡으면 busy) → 구간(window.ts) → 채널 호출(트랜잭션 밖 — 수십 초)
//   → 리스팅 연결·옛 장부 대상 → 한 트랜잭션[upsert → 사라진 라인 취소 → unknown 재판정(설계 해석 #23) → 옛 장부 → 차감 → 커서] → 잠금 해제.
// 실패는 던지지 않고 보고서(ok:false)로 돌려준다 — 한 채널 실패가 다른 채널을 막지 않는다. 오류 문구는 maskPII를 거친다.
import type { PoolClient } from 'pg';
import type { Db } from '@/lib/erp/ledger/store';
import { maskPII } from '@/lib/jobs/mask';
import { getSourcingPool } from '@/lib/sourcing/db';
import { ADAPTER_FACTORIES } from './adapters';
import { runDeductions } from './deduct';
import { legacyKeyOf } from './keys';
import { pickLegacy } from './legacy';
import { syncLegacySales } from './legacy-store';
import { resolveLine } from './resolve';
import {
  advanceCursor, loadLegacyIndex, loadListingIndex, markAbsentCanceled, readCursor, readCutover, readDeductSetting,
  reevaluateUnknownLines, upsertOrderLines, type ResolvedLine,
} from './store';
import type { OrderAdapter, OrderChannel } from './types';
import { windowFor } from './window';

/** 주문 수집 세션 잠금 네임스페이스(원장 SKU 잠금 7101과 겹치지 않는다) */
const LOCK_NS = 7102;
const CHANNEL_LOCK: Record<OrderChannel, number> = { coupang_wing: 1, coupang_rg: 2, naver: 3, toss: 4 };

export interface DeductSummary {
  posted: number;
  reversed: number;
  short: number;
  pending: number;
  unchanged: number;
}

export type DeductRunner = (
  db: Db,
  p: { enabled: boolean; cutover: string; lineIds: number[]; channel: OrderChannel; at: string },
) => Promise<DeductSummary>;

export interface ChannelReport {
  channel: OrderChannel;
  ok: boolean;
  skipped: 'busy' | null;
  dryRun: boolean;
  window: { from: string; to: string } | null;
  fetched: number;
  inserted: number;
  updated: number;
  absent: number;
  unattributed: number;
  /** 이번에 새로 받은 라인 중 unknown 상태 수(어댑터 응답 기준) */
  unknownStatus: number;
  /** status='unknown'이던 저장된 라인 중 이번에 raw_status로 다시 판정해 바뀐 수(설계 해석 #23). dryRun은 재판정하지 않아 항상 0 */
  unknownReEvaluated: number;
  /** 재판정 뒤 이 채널에 남은 unknown 라인 수 — 크론 알림(Task 6) 문턱: > 0이면 알린다. dryRun은 재판정하지 않으므로 null */
  unknownRemaining: number | null;
  legacy: { upserted: number; inserted: number; voided: number; warnings: number };
  deduct: DeductSummary | null;
  error: string | null;
}

export interface Connectable {
  connect(): Promise<PoolClient>;
}

export const emptyReport = (channel: OrderChannel, dryRun: boolean): ChannelReport => ({
  channel, ok: false, skipped: null, dryRun, window: null, fetched: 0, inserted: 0, updated: 0, absent: 0,
  unattributed: 0, unknownStatus: 0, unknownReEvaluated: 0, unknownRemaining: null,
  legacy: { upserted: 0, inserted: 0, voided: 0, warnings: 0 }, deduct: null, error: null,
});

const errText = (e: unknown) => maskPII(e instanceof Error ? e.message : String(e));

export async function collectChannel(
  pool: Connectable,
  adapter: OrderAdapter,
  opts: { now: Date; dryRun: boolean; deduct: DeductRunner },
): Promise<ChannelReport> {
  const ch = adapter.channel;
  const report = emptyReport(ch, opts.dryRun);
  const c = await pool.connect();
  let locked = false;
  try {
    const lock = await c.query('select pg_try_advisory_lock($1::int, $2::int) as ok', [LOCK_NS, CHANNEL_LOCK[ch]]);
    locked = lock.rows[0]?.ok === true;
    if (!locked) return { ...report, ok: true, skipped: 'busy' };

    const cutover = await readCutover(c);
    const cursor = await readCursor(c, ch);
    const w = windowFor({ cursor, cutover, now: opts.now, tailDays: adapter.tailDays });
    report.window = { from: w.from.toISOString(), to: w.to.toISOString() };

    // 채널 호출은 트랜잭션 밖 — 수십 초 동안 원장 잠금을 잡지 않는다
    const res = await adapter.fetch(w);

    const listings = await loadListingIndex(c);
    const legacyIdx = await loadLegacyIndex(c);
    const resolved: ResolvedLine[] = res.lines.map((l) => {
      const resolution = resolveLine(l, listings);
      return { ...l, resolution, legacyKey: legacyKeyOf(l), legacy: pickLegacy(l, resolution, legacyIdx) };
    });
    report.fetched = resolved.length;
    report.unattributed = resolved.filter((r) => r.resolution.attribution === 'unattributed').length;
    report.unknownStatus = resolved.filter((r) => r.status === 'unknown').length;
    if (opts.dryRun) return { ...report, ok: true };

    await c.query('BEGIN');
    try {
      const up = await upsertOrderLines(c, resolved);
      const absent = res.absenceMeansCancel && res.cover
        ? await markAbsentCanceled(c, ch, res.cover, resolved.map((r) => r.externalLineId))
        : { ids: [] as number[], legacyKeys: [] as string[] };
      // 설계 해석 #23 — 채널을 다시 부르지 않고 저장된 raw_status로 unknown 라인을 다시 판정한다
      const reeval = await reevaluateUnknownLines(c, ch);
      const legacy = await syncLegacySales(c, [...new Set([...resolved.map((r) => r.legacyKey), ...absent.legacyKeys, ...reeval.legacyKeys])]);
      const setting = await readDeductSetting(c);
      const deduct = await opts.deduct(c, {
        enabled: setting.enabled, cutover, lineIds: [...up.ids, ...absent.ids, ...reeval.ids], channel: ch, at: opts.now.toISOString(),
      });
      await advanceCursor(c, ch, opts.now.toISOString());
      await c.query('COMMIT');
      return {
        ...report, ok: true, inserted: up.inserted, updated: up.updated, absent: absent.ids.length,
        unknownReEvaluated: reeval.ids.length, unknownRemaining: reeval.remaining,
        legacy: { upserted: legacy.upserted, inserted: legacy.inserted, voided: legacy.voided, warnings: legacy.warnings.length },
        deduct,
      };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    }
  } catch (e) {
    return { ...report, ok: false, error: errText(e) };
  } finally {
    if (locked) await c.query('select pg_advisory_unlock($1::int, $2::int)', [LOCK_NS, CHANNEL_LOCK[ch]]).catch(() => {});
    c.release();
  }
}

/** 크론·화면 공용: 채널을 차례로 수집한다. 한 채널 실패(어댑터 생성 포함)가 다른 채널을 막지 않는다 */
export async function collectOrders(p: {
  channels: OrderChannel[];
  dryRun: boolean;
  now?: Date;
  pool?: Connectable;
  factories?: Record<OrderChannel, () => OrderAdapter>;
}): Promise<ChannelReport[]> {
  const pool = p.pool ?? getSourcingPool();
  const factories = p.factories ?? ADAPTER_FACTORIES;
  const now = p.now ?? new Date();
  const out: ChannelReport[] = [];
  for (const ch of p.channels) {
    let adapter: OrderAdapter;
    try {
      adapter = factories[ch]();
    } catch (e) {
      out.push({ ...emptyReport(ch, p.dryRun), error: errText(e) });
      continue;
    }
    out.push(await collectChannel(pool, adapter, { now, dryRun: p.dryRun, deduct: runDeductions }));
  }
  return out;
}

/** erp.job_runs.counts — 채널별 <ch>_fetched·<ch>_new·<ch>_error(0/1) + 합계. 수집 현황 패널이 마지막 실행의 채널 성패를 여기서 읽는다 */
export function reportCounts(reports: ChannelReport[]): Record<string, number> {
  const counts: Record<string, number> = { channels: reports.length, errors: 0, fetched: 0, inserted: 0, posted: 0, short: 0, unattributed: 0 };
  for (const r of reports) {
    counts[`${r.channel}_fetched`] = r.fetched;
    counts[`${r.channel}_new`] = r.inserted;
    counts[`${r.channel}_error`] = r.ok ? 0 : 1;
    counts.errors += r.ok ? 0 : 1;
    counts.fetched += r.fetched;
    counts.inserted += r.inserted;
    counts.posted += r.deduct?.posted ?? 0;
    counts.short += r.deduct?.short ?? 0;
    counts.unattributed += r.unattributed;
  }
  return counts;
}
