// src/__tests__/lib/erp/stock/rg-auto.test.ts
import { describe, it, expect } from 'vitest';
import { STALE_DAYS, alertKey, alertText, oldestWaiting, planRgAuto, stripAlertKeys, type RgAutoRow } from '@/lib/erp/stock/rg-auto';

const NOW = new Date('2026-10-05T00:30:00.000Z');
const row = (o: Partial<RgAutoRow>): RgAutoRow => ({ skuId: 72, ledger: 100, actual: 100, inbound: 0, prevDiff: null, inflows: [], ...o });

describe('oldestWaiting — 입고중에 남은 가장 오래된 발송(먼저 보낸 것부터 빠진다)', () => {
  it('들어온 줄을 오래된 순으로, 나간 합계만큼 지우고 남은 첫 줄의 시각', () => {
    const rows = [
      { qty: 10, occurredAt: '2026-09-20T01:00:00Z' }, { qty: 5, occurredAt: '2026-09-28T01:00:00Z' }, { qty: -12, occurredAt: '2026-09-30T01:00:00Z' },
    ];
    expect(oldestWaiting(rows)).toBe('2026-09-28T01:00:00Z');
    expect(oldestWaiting(rows, 3)).toBeNull();
    expect(oldestWaiting([])).toBeNull();
  });

  it('역전표는 되돌린 원 줄과 짝으로 빼고 나머지로 FIFO — 나중 발송을 되돌려도 앞 발송이 남는다', () => {
    // 9/25 발송(id 2)을 역전표(id 3)로 되돌렸다 → 9/20 발송분이 그대로 남아 있다(짝 없이 빼면 9/20이 빠진 것처럼 보인다)
    expect(oldestWaiting([
      { id: 1, reversesId: null, qty: 5, occurredAt: '2026-09-20T01:00:00Z' },
      { id: 2, reversesId: null, qty: 10, occurredAt: '2026-09-25T01:00:00Z' },
      { id: 3, reversesId: 2, qty: -10, occurredAt: '2026-09-26T01:00:00Z' },
    ])).toBe('2026-09-20T01:00:00Z');
    // 나간 줄(입고 완료 이동)을 되돌리면 그 이동은 없던 일이다
    expect(oldestWaiting([
      { id: 1, reversesId: null, qty: 5, occurredAt: '2026-09-20T01:00:00Z' },
      { id: 2, reversesId: null, qty: 5, occurredAt: '2026-09-28T01:00:00Z' },
      { id: 3, reversesId: null, qty: -5, occurredAt: '2026-09-29T01:00:00Z' },
      { id: 4, reversesId: 3, qty: 5, occurredAt: '2026-09-30T01:00:00Z' },
    ])).toBe('2026-09-20T01:00:00Z');
  });
});

describe('alertText — 실행기가 더하는 알림', () => {
  it('비활성 SKU RG 재고 · 자동 이동 실패', () => {
    const name = () => '수건';
    expect(alertText({ kind: 'inactive_sku', skuId: 90, qty: 3 }, name)).toBe('비활성 SKU 수건 RG 재고 3개');
    expect(alertText({ kind: 'move_failed', skuId: 90, error: '입고중 부족' }, name)).toBe('수건 자동 이동 실패: 입고중 부족');
  });
});

describe('alertKey · stripAlertKeys — 텔레그램 중복 방지는 문구가 아니라 고정 키로', () => {
  it('종류별 고정 키(입고중 초과는 발송 시각까지 — 날짜 수가 늘어도 같은 키)', () => {
    expect(alertKey({ kind: 'unsent_increase', skuId: 72, qty: 3 })).toBe('unsent_increase:72');
    expect(alertKey({ kind: 'decrease', skuId: 72, qty: 2 })).toBe('decrease:72');
    expect(alertKey({ kind: 'inbound_stale', skuId: 72, since: '2026-09-20T00:00:00.000Z', days: 15 }))
      .toBe(alertKey({ kind: 'inbound_stale', skuId: 72, since: '2026-09-20T00:00:00.000Z', days: 16 }));
    expect(alertKey({ kind: 'unmapped_vid', vid: '959', qty: 2 })).toBe('unmapped_vid:959');
    expect(alertKey({ kind: 'inactive_sku', skuId: 90, qty: 3 })).toBe('inactive_sku:90');
    expect(alertKey({ kind: 'move_failed', skuId: 90, error: 'x' })).toBe('move_failed:90');
  });

  it('기록의 「키|문구」 앞머리를 떼어 보인다(키 없는 문구·문구 속 |는 그대로)', () => {
    expect(stripAlertKeys('unsent_increase:72|A 많다 / move_failed:72|A 자동 이동 실패: x|y')).toBe('A 많다 / A 자동 이동 실패: x|y');
    expect(stripAlertKeys('그냥 문구')).toBe('그냥 문구');
    expect(stripAlertKeys(null)).toBeNull();
  });
});

describe('planRgAuto', () => {
  it('실재고 > 원장이고 입고중이 있으면 min(차이, 입고중)만큼 옮긴다 · 남는 증가는 알림', () => {
    const p = planRgAuto([row({ ledger: 100, actual: 108, inbound: 5, inflows: [{ qty: 5, occurredAt: '2026-10-03T00:00:00Z' }] })], [], NOW);
    expect(p.moves).toEqual([{ skuId: 72, qty: 5 }]);
    expect(p.alerts).toEqual([{ kind: 'unsent_increase', skuId: 72, qty: 3 }]);
  });

  it('감소는 직전 실행도 감소였을 때만 알린다', () => {
    expect(planRgAuto([row({ actual: 98, prevDiff: null })], [], NOW).alerts).toEqual([]);
    expect(planRgAuto([row({ actual: 98, prevDiff: 0 })], [], NOW).alerts).toEqual([]);
    expect(planRgAuto([row({ actual: 98, prevDiff: -1 })], [], NOW).alerts).toEqual([{ kind: 'decrease', skuId: 72, qty: 2 }]);
  });

  it(`옮기고도 입고중에 ${7}일 넘은 발송이 남으면 알림`, () => {
    expect(STALE_DAYS).toBe(7);
    const inflows = [{ qty: 3, occurredAt: '2026-09-25T00:00:00Z' }, { qty: 4, occurredAt: '2026-10-04T00:00:00Z' }];
    // 차이 2 → 가장 오래된 3개 중 2개만 빠져 9/25 발송분이 남는다
    const p = planRgAuto([row({ actual: 102, inbound: 7, inflows })], [], NOW);
    expect(p.moves).toEqual([{ skuId: 72, qty: 2 }]);
    expect(p.alerts).toEqual([{ kind: 'inbound_stale', skuId: 72, since: '2026-09-25T00:00:00Z', days: 10 }]);
    // 차이 3이면 9/25분이 다 빠져 알림 없음
    expect(planRgAuto([row({ actual: 103, inbound: 7, inflows })], [], NOW).alerts).toEqual([]);
  });

  it('연결 안 된 RG 번호(재고 > 0)는 알림', () => {
    expect(planRgAuto([], [{ vid: '95999999999', qty: 2 }], NOW).alerts).toEqual([{ kind: 'unmapped_vid', vid: '95999999999', qty: 2 }]);
  });
});
