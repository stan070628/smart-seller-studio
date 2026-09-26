// src/lib/erp/orders/window.ts
// 수집 구간과 KST 날짜·시각 도우미. 채널 API는 KST 날짜(쿠팡·토스)나 +09:00 시각(네이버)으로 거른다.
import { kstDate } from '@/lib/erp/stock/count-queue';
import { LineRejectError, type FetchWindow } from './types';

export const OVERLAP_MS = 48 * 3600_000;
const DAY_MS = 86_400_000;
const KST_MS = 9 * 3600_000;

/** Date·ISO → KST 날짜 YYYY-MM-DD */
export const kstDay = (v: Date | string): string => kstDate(v);

/** KST 날짜의 0시 */
export const kstDayStart = (day: string): Date => new Date(`${day}T00:00:00+09:00`);

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** [from, to] 날짜(둘 다 포함)를 maxDays일씩 */
export function dayChunks(from: string, to: string, maxDays: number): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (let cur = from; cur <= to; ) {
    const end = addDays(cur, maxDays - 1) < to ? addDays(cur, maxDays - 1) : to;
    out.push({ from: cur, to: end });
    cur = addDays(end, 1);
  }
  return out;
}

/** '2026-09-27T00:00:00.000+09:00' 형식(네이버 변경 조회 파라미터) */
export function kstIso(d: Date): string {
  return new Date(d.getTime() + KST_MS).toISOString().replace('Z', '+09:00');
}

/** 채널 시각 문자열 → UTC ISO. 오프셋이 없으면 KST로 읽는다(쿠팡·토스는 KST 현지 시각을 준다) */
export function isoFromChannel(s: string): string {
  // '+0900'처럼 콜론 없는 오프셋은 '+09:00'으로 고친다 — 엔진마다 받아들이는지가 다르다
  const v = String(s ?? '').trim().replace(' ', 'T').replace(/(T[\d:.]+[+-]\d{2})(\d{2})$/, '$1:$2');
  const t = /([zZ]|[+-]\d{2}:?\d{2})$/.test(v) ? Date.parse(v) : Date.parse(`${v}+09:00`);
  if (!v || Number.isNaN(t)) throw new LineRejectError('bad_time', `시각을 읽을 수 없다: ${String(s).slice(0, 40)}`);
  return new Date(t).toISOString();
}

/**
 * 이번 수집 구간. 시작 = max(기초 시각, min(커서 − 48h, 지금 − 꼬리일수)). 끝 = 지금.
 * 첫 실행(커서 없음)은 기초 시각부터.
 */
export function windowFor(p: { cursor: string | null; cutover: string; now: Date; tailDays: number }): FetchWindow {
  const cut = Date.parse(p.cutover);
  const now = p.now.getTime();
  const fromCursor = p.cursor === null ? cut : Date.parse(p.cursor) - OVERLAP_MS;
  const fromTail = now - p.tailDays * DAY_MS;
  return { from: new Date(Math.max(cut, Math.min(fromCursor, fromTail))), to: new Date(now) };
}

/** [from, to)를 24시간 미만 조각으로 빈틈없이(네이버 변경 조회는 한 번에 24시간까지) */
export function hourChunks(w: FetchWindow, spanMs = DAY_MS - 1000): FetchWindow[] {
  const out: FetchWindow[] = [];
  for (let t = w.from.getTime(); t < w.to.getTime(); t += spanMs) {
    out.push({ from: new Date(t), to: new Date(Math.min(t + spanMs, w.to.getTime())) });
  }
  return out;
}

/** 과거 보충(결정 5 · 설계 해석 #25)은 기초 시각 − 이 일수보다 앞으로 가지 않는다 */
export const BACKFILL_MAX_DAYS = 62;

/** 과거 보충 시작일이 잘못됐다 — 라우트는 400, 수집기는 그 채널 실패로 보고한다 */
export class BackfillError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'BackfillError';
  }
}

/** 과거 보충 시작일 형식 검사 — 실제 있는 KST 날짜 YYYY-MM-DD만 */
export function parseBackfillDay(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || addDays(v, 0) !== v) {
    throw new BackfillError(`과거 보충 시작일은 YYYY-MM-DD(KST)여야 한다: ${String(v).slice(0, 30)}`);
  }
  return v;
}

/**
 * 과거 보충 구간 끝 = to일 다음 날 KST 0시(그날 포함). 없으면 지금. 시작보다 뒤여야 하고 지금을 넘지 않는다.
 * 줄이 많은 채널(RG 657줄)은 한 번에 쓰면 Vercel 300초를 넘는다(2026-09-27 504) — 며칠씩 나눠 부르려고 둔다.
 */
export function backfillEnd(to: string | undefined, start: Date, now: Date): Date {
  if (to === undefined) return now;
  const end = kstDayStart(addDays(parseBackfillDay(to), 1));
  if (end.getTime() <= start.getTime()) throw new BackfillError(`과거 보충 끝날 ${to}이(가) 시작일보다 앞이다`);
  return end.getTime() < now.getTime() ? end : now;
}

/** 과거 보충 구간 시작 = 그날 KST 0시. 기초 시각보다 앞이어야 하고 기초 시각 − 62일보다 앞으로 가지 않는다 */
export function backfillStart(day: string, cutover: string): Date {
  const start = kstDayStart(parseBackfillDay(day));
  const cut = Date.parse(cutover);
  if (start.getTime() >= cut) throw new BackfillError(`과거 보충 시작일 ${day}이(가) 기초 시각(${cutover}) 이후다 — 기초 이후는 보통 수집이 받는다`);
  if (start.getTime() < cut - BACKFILL_MAX_DAYS * DAY_MS) {
    throw new BackfillError(`과거 보충 시작일 ${day}이(가) 기초 시각 − ${BACKFILL_MAX_DAYS}일보다 앞이다`);
  }
  return start;
}
