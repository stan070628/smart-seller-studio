// src/lib/erp/orders/collect.ts
// 채널 수집 한 번(설계 해석 #15·#24). 순서: 커서 행 보장 → 채널 임대(lease — autocommit, 못 잡으면 busy·실패 보고) → 구간(window.ts)
//   → 채널 호출(트랜잭션 밖 — 수십 초)
//   → 한 트랜잭션[pg_advisory_xact_lock(7102, 채널) → 리스팅 연결·사람이 정한 SKU(manual_sku_id)·옛 장부 대상 판정(resolveFetched) → upsert
//     → 사라진 라인(두 번 연속) → unknown 재판정(#23) → 옛 장부 → 차감 → 커서] → 임대 반납(주인일 때만).
// (1-C2b ①) 판정을 잠금 뒤로 미룬다 — 사람의 링크(link.ts, 같은 채널 잠금)가 잠금을 잡고 commit하는 사이에 끼어들면,
//   잠금 전에 읽은 리스팅·manual_sku_id로 upsert해 사람이 갓 정한 연결을 덮어쓰게 된다. dryRun은 잠글 것도 커밋할 것도
//   없으니 트랜잭션 밖에서 그대로 판정한다.
// 세션 advisory lock은 쓰지 않는다 — Supavisor 트랜잭션 풀러에서는 문장마다 다른 백엔드에 붙어 잠금·해제가 어긋난다.
// 과거 보충(backfillFrom — 결정 5 · 설계 해석 #25): 구간 시작만 그날 KST 0시로 바꾼다(끝 = 지금). 사라짐 판정은 통째로 끄고(absent_since도 안 적는다)
//   커서는 움직이지 않는다. 임대·트랜잭션 잠금·upsert·옛 장부·unknown 재판정·차감은 그대로 — 차감은 진짜 기초 시각으로 판정하므로 기초 이전 라인은 none(pre_cutover).
//   보충 시작일 전에 주문된 라인(네이버 변경 조회가 끌고 오는 옛 주문)은 쓰지 않고 backfillSkipped로 센다.
// 실패는 던지지 않고 보고서(ok:false)로 돌려준다 — 한 채널 실패가 다른 채널을 막지 않는다. 오류 문구는 maskPII를 거친다.
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Db } from '@/lib/erp/ledger/store';
import { maskPII } from '@/lib/jobs/mask';
import { getSourcingPool } from '@/lib/sourcing/db';
import { ADAPTER_FACTORIES } from './adapters';
import { runDeductions } from './deduct';
import { legacyKeyOf } from './keys';
import { pickLegacy } from './legacy';
import { syncLegacySales } from './legacy-store';
import { applyManualSku, resolveLine } from './resolve';
import {
  advanceCursor, ensureCursorRow, loadLegacyIndex, loadListingIndex, loadManualSkus, markAbsentCanceled, readCursor, readCutover, readDeductSetting,
  reevaluateUnknownLines, releaseLease, takeLease, upsertOrderLines, type AbsenceRefusal, type AbsenceResult, type ResolvedLine,
} from './store';
import type { OrderAdapter, OrderChannel, OrderLine, RejectedLine } from './types';
import { backfillEnd, backfillStart, windowFor } from './window';

/** 주문 수집 트랜잭션 잠금 네임스페이스(원장 SKU 잠금 7101과 겹치지 않는다) */
export const LOCK_NS = 7102;
export const CHANNEL_LOCK: Record<OrderChannel, number> = { coupang_wing: 1, coupang_rg: 2, naver: 3, toss: 4 };
/** 보고서에 싣는 버린 라인 표본 수 */
const REJECTED_SAMPLE = 20;

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
  /** 과거 보충 실행(backfillFrom) — 사라짐 판정·커서 이동 없음 */
  backfill: boolean;
  window: { from: string; to: string } | null;
  fetched: number;
  inserted: number;
  /** 바뀐 라인 수(안 바뀐 라인은 쓰지 않는다 — M3) */
  updated: number;
  unchanged: number;
  /** 이번에 취소한 사라진 라인(두 번 연속 사라짐) */
  absent: number;
  /** 이번에 처음 사라져 absent_since만 적은 라인 */
  absenceMarked: number;
  /** 사라짐 판정을 거절했다(응답이 비었을 수 있다) — 알림 대상 */
  absenceRefused: AbsenceRefusal | null;
  /** 어댑터가 형식 오류로 버린 라인 수(I5) — 알림 대상 */
  rejected: number;
  /** 버린 라인 표본(라인 키 + 이유 코드. 구매자 정보 없음) */
  rejectedLines: RejectedLine[];
  unattributed: number;
  /** 과거 보충에서 보충 시작일 전에 주문돼 쓰지 않은 라인 수(보통 수집은 0) */
  backfillSkipped: number;
  /** 이번에 새로 받은 라인 중 unknown 상태 수(어댑터 응답 기준) */
  unknownStatus: number;
  /** 매핑 안 된(status_unmapped) 저장 라인 중 이번에 raw_status로 다시 판정해 바뀐 수(설계 해석 #23·#24). dryRun은 재판정하지 않아 항상 0 */
  unknownReEvaluated: number;
  /** 재판정 뒤 이 채널에 남은 매핑 안 된 라인 수 — 크론 알림(Task 6) 문턱: > 0이면 알린다. dryRun은 재판정하지 않으므로 null */
  unknownRemaining: number | null;
  legacy: { upserted: number; inserted: number; voided: number; warnings: number };
  deduct: DeductSummary | null;
  error: string | null;
}

export interface Connectable {
  connect(): Promise<PoolClient>;
}

export const emptyReport = (channel: OrderChannel, dryRun: boolean, backfill = false): ChannelReport => ({
  channel, ok: false, skipped: null, dryRun, backfill, backfillSkipped: 0, window: null, fetched: 0, inserted: 0, updated: 0, unchanged: 0, absent: 0,
  absenceMarked: 0, absenceRefused: null, rejected: 0, rejectedLines: [], unattributed: 0, unknownStatus: 0, unknownReEvaluated: 0, unknownRemaining: null,
  legacy: { upserted: 0, inserted: 0, voided: 0, warnings: 0 }, deduct: null, error: null,
});

const errText = (e: unknown) => maskPII(e instanceof Error ? e.message : String(e));

const NO_ABSENCE: AbsenceResult = { ids: [], legacyKeys: [], marked: 0, absent: 0, refused: null };

/**
 * 리스팅 연결 · 사람이 정한 SKU(manual_sku_id) · 옛 장부 대상을 판정한다. dryRun은 트랜잭션·잠금 밖에서 이 함수를 부르고,
 * 실제 수집은 채널 잠금(pg_advisory_xact_lock)을 잡은 뒤에 부른다 — 사람의 링크(link.ts, 같은 잠금)가 잠금 사이에
 * 끼어들어 커밋하면, 잠금 전에 읽은 판정으로 upsert해 사람이 갓 정한 연결을 덮어쓰게 된다.
 */
async function resolveFetched(
  c: Db, ch: OrderChannel, lines: OrderLine[], bfStart: Date | null, bfEnd: Date | null,
): Promise<{ resolved: ResolvedLine[]; backfillSkipped: number }> {
  const listings = await loadListingIndex(c);
  const legacyIdx = await loadLegacyIndex(c);
  const manual = await loadManualSkus(c, ch, lines.map((l) => l.externalLineId));
  // 보충 구간 밖(시작 전 · 끝 뒤)에 주문된 라인은 쓰지 않고 센다 — 끝 뒤 라인은 다음 조각이나 보통 수집이 받는다
  const kept = bfStart && bfEnd
    ? lines.filter((l) => { const t = Date.parse(l.orderedAt); return t >= bfStart.getTime() && t < bfEnd.getTime(); })
    : lines;
  const resolved: ResolvedLine[] = kept.map((l) => {
    const resolution = applyManualSku(l, resolveLine(l, listings), manual.get(l.externalLineId) ?? null);
    return { ...l, resolution, legacyKey: legacyKeyOf(l), legacy: pickLegacy(l, resolution, legacyIdx) };
  });
  return { resolved, backfillSkipped: lines.length - kept.length };
}

export async function collectChannel(
  pool: Connectable,
  adapter: OrderAdapter,
  opts: { now: Date; dryRun: boolean; deduct: DeductRunner; backfillFrom?: string; backfillTo?: string },
): Promise<ChannelReport> {
  const ch = adapter.channel;
  const backfill = opts.backfillFrom !== undefined;
  const report = emptyReport(ch, opts.dryRun, backfill);
  const c = await pool.connect();
  const owner = randomUUID();
  let leased = false;
  try {
    const cutover = await readCutover(c);
    // 과거 보충 시작일은 임대·채널 호출 전에 검사한다(범위 밖이면 아무것도 하지 않는다)
    const bfStart = backfill ? backfillStart(opts.backfillFrom as string, cutover) : null;
    const bfEnd = bfStart ? backfillEnd(opts.backfillTo, bfStart, opts.now) : null;
    // 수집 시작 시각 — 사라짐 판정은 이 시각 전에 처음 본 라인만 본다(겹친 실행이 방금 넣은 라인을 오판하지 않게)
    let startedAt = opts.now.toISOString();
    if (!opts.dryRun) {
      await ensureCursorRow(c, ch, cutover);
      const lease = await takeLease(c, ch, owner);
      if (!lease.ok) {
        return { ...report, ok: false, skipped: 'busy', error: '다른 수집이 이 채널의 임대를 잡고 있다(최대 10분) — 이번 실행은 건너뛴다' };
      }
      leased = true;
      startedAt = lease.at ?? startedAt;
    }

    const w = bfStart && bfEnd
      ? { from: bfStart, to: new Date(bfEnd.getTime()) }
      : windowFor({ cursor: await readCursor(c, ch), cutover, now: opts.now, tailDays: adapter.tailDays });
    report.window = { from: w.from.toISOString(), to: w.to.toISOString() };

    // 채널 호출은 트랜잭션 밖 — 수십 초 동안 원장 잠금을 잡지 않는다
    const res = await adapter.fetch(w);
    report.rejected = res.rejected.length;
    report.rejectedLines = res.rejected.slice(0, REJECTED_SAMPLE);

    if (opts.dryRun) {
      // 읽기만 — 잠글 것도 커밋할 것도 없으니 트랜잭션 밖에서 바로 판정한다
      const { resolved, backfillSkipped } = await resolveFetched(c, ch, res.lines, bfStart, bfEnd);
      report.backfillSkipped = backfillSkipped;
      report.fetched = resolved.length;
      report.unattributed = resolved.filter((r) => r.resolution.attribution === 'unattributed').length;
      report.unknownStatus = resolved.filter((r) => r.status === 'unknown').length;
      return { ...report, ok: true };
    }

    await c.query('BEGIN');
    try {
      // 임대가 만료돼 다른 실행이 들어와도 쓰기는 채널마다 한 줄로 선다(트랜잭션 잠금 — 풀러에서도 안전)
      await c.query('select pg_advisory_xact_lock($1::int, $2::int)', [LOCK_NS, CHANNEL_LOCK[ch]]);
      // 리스팅·사람이 정한 SKU 판정은 잠금을 잡은 뒤에 한다(위 resolveFetched 주석) — link.ts가 잠금 사이에 끼어드는 창을 없앤다
      const { resolved, backfillSkipped } = await resolveFetched(c, ch, res.lines, bfStart, bfEnd);
      report.backfillSkipped = backfillSkipped;
      report.fetched = resolved.length;
      report.unattributed = resolved.filter((r) => r.resolution.attribution === 'unattributed').length;
      report.unknownStatus = resolved.filter((r) => r.status === 'unknown').length;
      const up = await upsertOrderLines(c, resolved);
      // 과거 보충은 사라짐 판정을 하지 않는다 — 긴 옛 구간의 누락을 취소로 읽으면 멀쩡한 판매가 무효가 된다
      const absent = !backfill && res.absenceMeansCancel && res.cover
        ? await markAbsentCanceled(c, ch, res.cover, resolved, startedAt)
        : NO_ABSENCE;
      // 설계 해석 #23 — 채널을 다시 부르지 않고 저장된 raw_status로 매핑 안 된 라인을 다시 판정한다
      const reeval = await reevaluateUnknownLines(c, ch);
      const legacy = await syncLegacySales(c, [...new Set([...resolved.map((r) => r.legacyKey), ...absent.legacyKeys, ...reeval.legacyKeys])]);
      const setting = await readDeductSetting(c);
      // M3 — 안 바뀐 라인은 넘기지 않는다(차감기는 pending·skipped_short를 따로 다시 본다)
      const deduct = await opts.deduct(c, {
        enabled: setting.enabled, cutover, lineIds: [...up.changedIds, ...absent.ids, ...reeval.ids], channel: ch, at: opts.now.toISOString(),
      });
      // 과거 보충은 커서를 앞으로도 뒤로도 움직이지 않는다(보통 수집의 구간이 그대로 이어진다)
      if (!backfill) await advanceCursor(c, ch, opts.now.toISOString());
      await c.query('COMMIT');
      return {
        ...report, ok: true, inserted: up.inserted, updated: up.updated, unchanged: up.unchanged,
        absent: absent.ids.length, absenceMarked: absent.marked, absenceRefused: absent.refused,
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
    if (leased) await releaseLease(c, ch, owner).catch(() => {});
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
  /** 과거 보충 시작일(KST YYYY-MM-DD) — 설계 해석 #25 */
  backfillFrom?: string;
  /** 과거 보충 끝날(그날 포함). 없으면 지금까지 */
  backfillTo?: string;
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
      out.push({ ...emptyReport(ch, p.dryRun, p.backfillFrom !== undefined), error: errText(e) });
      continue;
    }
    out.push(await collectChannel(pool, adapter, { now, dryRun: p.dryRun, deduct: runDeductions, backfillFrom: p.backfillFrom, backfillTo: p.backfillTo }));
  }
  return out;
}

/** erp.job_runs.counts — 채널별 <ch>_fetched·<ch>_new·<ch>_error(0/1)·<ch>_busy·<ch>_rejected·<ch>_absence_refused + 합계. 수집 현황 패널이 마지막 실행의 채널 성패를 여기서 읽는다 */
export function reportCounts(reports: ChannelReport[]): Record<string, number> {
  const counts: Record<string, number> = {
    channels: reports.length, errors: 0, busy: 0, fetched: 0, inserted: 0, posted: 0, short: 0, unattributed: 0, rejected: 0, absence_refused: 0,
  };
  for (const r of reports) {
    counts[`${r.channel}_fetched`] = r.fetched;
    counts[`${r.channel}_new`] = r.inserted;
    counts[`${r.channel}_error`] = r.ok ? 0 : 1;
    counts[`${r.channel}_busy`] = r.skipped === 'busy' ? 1 : 0;
    counts[`${r.channel}_rejected`] = r.rejected;
    counts[`${r.channel}_absence_refused`] = r.absenceRefused ? 1 : 0;
    counts.errors += r.ok ? 0 : 1;
    counts.busy += r.skipped === 'busy' ? 1 : 0;
    counts.fetched += r.fetched;
    counts.inserted += r.inserted;
    counts.posted += r.deduct?.posted ?? 0;
    counts.short += r.deduct?.short ?? 0;
    counts.unattributed += r.unattributed;
    counts.rejected += r.rejected;
    counts.absence_refused += r.absenceRefused ? 1 : 0;
  }
  return counts;
}

/** 크론 알림(Task 6) 재료 — 이 채널 보고서에서 사람이 봐야 할 것. 빈 배열이면 알릴 것이 없다. 구매자 정보는 없다 */
export function reportAlerts(r: ChannelReport): string[] {
  const out: string[] = [];
  if (!r.ok) out.push(r.skipped === 'busy' ? '임대 못 잡음(busy)' : `실패: ${r.error ?? ''}`);
  if (r.absenceRefused) {
    const a = r.absenceRefused;
    out.push(`사라짐 판정 거절 ${a.reason} — 사라짐 ${a.absent} · 받은 라인(cover) ${a.seenInCover} · cover 행 ${a.coverRows}`);
  }
  if (r.rejected > 0) out.push(`잘못된 라인 ${r.rejected}건 버림(${[...new Set(r.rejectedLines.map((x) => x.reason))].join('·')})`);
  if ((r.unknownRemaining ?? 0) > 0) out.push(`매핑 안 된 상태 ${r.unknownRemaining}건`);
  if (r.legacy.warnings > 0) out.push(`옛 장부 경고 ${r.legacy.warnings}건`);
  return out;
}
