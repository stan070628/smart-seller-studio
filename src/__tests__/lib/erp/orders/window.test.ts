import { describe, it, expect } from 'vitest';
import {
  BACKFILL_MAX_DAYS, BackfillError, addDays, backfillEnd, backfillStart, dayChunks, hourChunks, isoFromChannel, kstDay, kstDayStart, kstIso, parseBackfillDay, windowFor,
} from '@/lib/erp/orders/window';

const CUT = '2026-09-26T11:07:04.989Z';
const H = 3600_000;

describe('windowFor', () => {
  it('첫 실행(커서 없음)은 기초재고 시각부터', () => {
    const now = new Date('2026-09-27T00:00:00.000Z');
    expect(windowFor({ cursor: null, cutover: CUT, now, tailDays: 7 })).toEqual({ from: new Date(CUT), to: now });
  });

  it('커서에서 48시간 겹친다(기초 시각보다 앞으로는 가지 않는다)', () => {
    const now = new Date('2026-10-10T00:00:00.000Z');
    const w = windowFor({ cursor: '2026-10-09T23:45:00.000Z', cutover: CUT, now, tailDays: 0 });
    expect(w.from.toISOString()).toBe(new Date(Date.parse('2026-10-09T23:45:00.000Z') - 48 * H).toISOString());
    expect(windowFor({ cursor: '2026-09-27T00:00:00.000Z', cutover: CUT, now, tailDays: 0 }).from.toISOString()).toBe(CUT);
  });

  it('꼬리일수가 겹침보다 길면 꼬리일수만큼 읽는다(늦은 취소)', () => {
    const now = new Date('2026-10-10T00:00:00.000Z');
    const w = windowFor({ cursor: '2026-10-09T23:45:00.000Z', cutover: CUT, now, tailDays: 7 });
    expect(w.from.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });
});

describe('KST 날짜·시각', () => {
  it('kstDay / kstDayStart / addDays', () => {
    expect(kstDay(new Date('2026-09-26T15:30:00.000Z'))).toBe('2026-09-27');
    expect(kstDayStart('2026-09-27').toISOString()).toBe('2026-09-26T15:00:00.000Z');
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('kstIso는 +09:00 표기, isoFromChannel은 오프셋 없는 채널 시각을 KST로 읽는다', () => {
    expect(kstIso(new Date('2026-09-26T15:00:00.000Z'))).toBe('2026-09-27T00:00:00.000+09:00');
    expect(isoFromChannel('2026-09-27T09:10:11')).toBe('2026-09-27T00:10:11.000Z');
    expect(isoFromChannel('2026-09-27 09:10:11')).toBe('2026-09-27T00:10:11.000Z');
    expect(isoFromChannel('2026-09-27T09:10:11.000+09:00')).toBe('2026-09-27T00:10:11.000Z');
    expect(isoFromChannel('2026-09-27T00:10:11Z')).toBe('2026-09-27T00:10:11.000Z');
    expect(isoFromChannel('2026-09-27T09:10:11+0900')).toBe('2026-09-27T00:10:11.000Z');
    expect(isoFromChannel('2026-09-27T09:10:11.000+0900')).toBe('2026-09-27T00:10:11.000Z');
    expect(isoFromChannel('2026-09-27 09:10:11-0100')).toBe('2026-09-27T10:10:11.000Z');
    expect(() => isoFromChannel('어제')).toThrow(RangeError);
  });

  it('dayChunks는 시작·끝 포함 maxDays씩', () => {
    expect(dayChunks('2026-09-01', '2026-10-05', 30)).toEqual([
      { from: '2026-09-01', to: '2026-09-30' }, { from: '2026-10-01', to: '2026-10-05' },
    ]);
    expect(dayChunks('2026-09-27', '2026-09-27', 29)).toEqual([{ from: '2026-09-27', to: '2026-09-27' }]);
  });

  it('hourChunks는 24시간 미만 조각으로 빈틈없이 잇는다', () => {
    const from = new Date('2026-09-26T11:07:04.989Z');
    const to = new Date('2026-09-28T12:00:00.000Z');
    const cs = hourChunks({ from, to });
    expect(cs[0].from).toEqual(from);
    expect(cs[cs.length - 1].to).toEqual(to);
    for (let i = 1; i < cs.length; i++) expect(cs[i].from).toEqual(cs[i - 1].to);
    for (const c of cs) expect(c.to.getTime() - c.from.getTime()).toBeLessThan(24 * H);
  });
});

describe('과거 보충(backfill) 시작일', () => {
  it('parseBackfillDay는 실제 있는 YYYY-MM-DD만 받는다', () => {
    expect(parseBackfillDay('2026-09-01')).toBe('2026-09-01');
    for (const bad of ['2026-9-1', '2026-02-30', '20260901', '2026-09-01T00:00:00Z', '', 20260901, null]) {
      expect(() => parseBackfillDay(bad)).toThrow(BackfillError);
    }
  });

  it('backfillStart = 그날 KST 0시 — 기초 시각보다 앞이고 기초 시각 − 62일 이후만', () => {
    expect(BACKFILL_MAX_DAYS).toBe(62);
    expect(backfillStart('2026-09-01', CUT).toISOString()).toBe('2026-08-31T15:00:00.000Z');
    // 기초 당일 0시(KST)는 기초 시각보다 앞이다
    expect(backfillStart('2026-09-26', CUT).toISOString()).toBe('2026-09-25T15:00:00.000Z');
    // 기초 시각 이후 날짜는 보충이 아니다
    expect(() => backfillStart('2026-09-27', CUT)).toThrow(/기초/);
    // 62일 경계: 07-27 KST 0시 = 07-26 15:00Z ≥ 컷 − 62일(07-26 11:07Z) · 07-26은 넘는다
    expect(backfillStart('2026-07-27', CUT).toISOString()).toBe('2026-07-26T15:00:00.000Z');
    expect(() => backfillStart('2026-07-26', CUT)).toThrow(/62일/);
  });
});

describe('과거 보충(backfill) 끝날', () => {
  const NOW = new Date('2026-09-27T00:00:00.000Z');
  const start = new Date('2026-08-31T15:00:00.000Z'); // 9/1 KST 0시
  it('없으면 지금 · 있으면 그날을 포함(다음 날 KST 0시) · 지금을 넘지 않는다', () => {
    expect(backfillEnd(undefined, start, NOW)).toEqual(NOW);
    expect(backfillEnd('2026-09-07', start, NOW).toISOString()).toBe('2026-09-07T15:00:00.000Z');
    expect(backfillEnd('2026-09-01', start, NOW).toISOString()).toBe('2026-09-01T15:00:00.000Z');
    expect(backfillEnd('2026-09-30', start, NOW)).toEqual(NOW);
  });
  it('시작일보다 앞이거나 형식이 틀리면 BackfillError', () => {
    expect(() => backfillEnd('2026-08-31', start, NOW)).toThrow(BackfillError);
    expect(() => backfillEnd('2026/09/07', start, NOW)).toThrow(BackfillError);
  });
});
