import { describe, it, expect } from 'vitest';
import { decideDeduction, type DeductInput } from '@/lib/erp/orders/deduct-plan';

const CUT = '2026-09-26T11:07:04.989Z';
const base = (o: Partial<DeductInput> = {}): DeductInput => ({
  channel: 'naver', externalLineId: '2026092611111111', status: 'paid', attribution: 'mapped',
  alloc: [{ skuId: 7, qty: 2 }], paidAt: '2026-09-27T01:00:00.000Z', state: 'none', version: 0, posted: [], ...o,
});
const ON = { enabled: true, cutover: CUT };
const OFF = { enabled: false, cutover: CUT };
const K1 = 'sale:naver:2026092611111111:s7';

describe('decideDeduction', () => {
  it('켜짐 + 팔림 + 연결됨 + 기초 이후 → 첫 차감(버전 1)', () => {
    expect(decideDeduction(base(), ON)).toEqual({
      reverse: [], post: { version: 1, items: [{ skuId: 7, qty: 2, idemKey: K1 }] }, state: 'posted', note: null,
    });
  });

  it('꺼짐이면 같은 라인은 pending(기록만)', () => {
    expect(decideDeduction(base(), OFF)).toEqual({ reverse: [], post: null, state: 'pending', note: null });
  });

  it('재고 부족으로 건너뛴 라인은 다음에 같은 버전으로 다시 시도한다', () => {
    expect(decideDeduction(base({ state: 'skipped_short' }), ON).post).toEqual({ version: 1, items: [{ skuId: 7, qty: 2, idemKey: K1 }] });
  });

  it('차감 대상이 아닌 이유를 남긴다: 기초 이전 · 미결제 · 미귀속 · 무효', () => {
    expect(decideDeduction(base({ paidAt: '2026-09-26T11:00:00.000Z' }), ON)).toEqual({ reverse: [], post: null, state: 'none', note: 'pre_cutover' });
    expect(decideDeduction(base({ paidAt: null }), ON).note).toBe('not_paid');
    expect(decideDeduction(base({ status: 'unpaid' }), ON).note).toBe('not_paid');
    expect(decideDeduction(base({ attribution: 'unattributed', alloc: [] }), ON).note).toBe('unattributed');
    expect(decideDeduction(base({ status: 'canceled' }), ON).note).toBe('voided');
  });

  it('뺀 라인이 취소되면 역전표만, 상태 reversed', () => {
    const posted = [{ skuId: 7, qty: 2, idemKey: K1 }];
    expect(decideDeduction(base({ status: 'canceled', state: 'posted', version: 1, posted }), ON))
      .toEqual({ reverse: [K1], post: null, state: 'reversed', note: 'voided' });
  });

  it('되돌린 라인이 다시 팔림이면 @2로 새로 뺀다', () => {
    expect(decideDeduction(base({ state: 'reversed', version: 1 }), ON).post)
      .toEqual({ version: 2, items: [{ skuId: 7, qty: 2, idemKey: `${K1}@2` }] });
  });

  it('뺀 수량·SKU가 바뀌면(부분 취소·연결 변경) 되돌리고 다음 버전으로 다시 뺀다', () => {
    const posted = [{ skuId: 7, qty: 2, idemKey: K1 }];
    expect(decideDeduction(base({ alloc: [{ skuId: 7, qty: 1 }], state: 'posted', version: 1, posted }), ON))
      .toEqual({ reverse: [K1], post: { version: 2, items: [{ skuId: 7, qty: 1, idemKey: `${K1}@2` }] }, state: 'posted', note: null });
  });

  it('뺀 것과 같으면 아무것도 하지 않는다', () => {
    const posted = [{ skuId: 7, qty: 2, idemKey: K1 }];
    expect(decideDeduction(base({ status: 'delivered', state: 'posted', version: 1, posted }), ON))
      .toEqual({ reverse: [], post: null, state: 'posted', note: null });
  });

  it('unknown 상태는 지금 상태를 그대로 둔다(뺀 것을 되돌리지 않는다)', () => {
    const posted = [{ skuId: 7, qty: 2, idemKey: K1 }];
    expect(decideDeduction(base({ status: 'unknown', state: 'posted', version: 1, posted }), ON))
      .toEqual({ reverse: [], post: null, state: 'posted', note: 'unknown_status' });
  });

  it('bundle 라인은 SKU마다 키 하나', () => {
    const p = decideDeduction(base({ channel: 'toss', externalLineId: '9001', alloc: [{ skuId: 4, qty: 1 }, { skuId: 9, qty: 2 }] }), ON);
    expect(p.post?.items.map((i) => i.idemKey)).toEqual(['sale:toss:9001:s4', 'sale:toss:9001:s9']);
  });

  it('되돌린 뒤 여전히 무효면 reversed를 유지한다(none으로 떨어지지 않는다)', () => {
    expect(decideDeduction(base({ status: 'returned', state: 'reversed', version: 1 }), ON).state).toBe('reversed');
  });

  it('뺀 라인이 여전히 팔림인데 연결이 사라지면(미귀속) 되돌리지 않고 posted를 유지한다', () => {
    const posted = [{ skuId: 7, qty: 2, idemKey: K1 }];
    expect(decideDeduction(base({ attribution: 'unattributed', alloc: [], state: 'posted', version: 1, posted }), ON))
      .toEqual({ reverse: [], post: null, state: 'posted', note: 'unattributed' });
  });

  it('연결이 다른 SKU로 바뀌면(mapped) 되돌리고 다시 뺀다', () => {
    const posted = [{ skuId: 7, qty: 2, idemKey: K1 }];
    expect(decideDeduction(base({ alloc: [{ skuId: 8, qty: 2 }], state: 'posted', version: 1, posted }), ON))
      .toEqual({ reverse: [K1], post: { version: 2, items: [{ skuId: 8, qty: 2, idemKey: 'sale:naver:2026092611111111:s8@2' }] }, state: 'posted', note: null });
  });
});
