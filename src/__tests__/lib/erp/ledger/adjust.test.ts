import { describe, it, expect } from 'vitest';
import {
  AdjustInputError, StaleCountError, adjustIdemKey, isReversibleKey, openingIdemKey, pickUnitCost, planAdjustment, validateAdjustInput,
  type AdjustInput,
} from '@/lib/erp/ledger/adjust';
import { assertIdemKey } from '@/lib/erp/ledger/plan';

const REQ = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const base: AdjustInput = {
  skuId: 7, location: 'self', mode: 'count', value: 5, expected: 3, reason: 'count_diff', requestId: REQ, occurredAt: '2026-09-27T10:00:00+09:00',
};

describe('planAdjustment', () => {
  it('지금 개수는 원장과의 차이를 낸다', () => {
    expect(planAdjustment({ mode: 'count', value: 3, expected: 5, onHand: 5, locationEmpty: false }))
      .toEqual({ diff: -2, lotKind: 'adjust', setsCutover: false });
  });

  it('빈 위치의 첫 지금 개수는 기초재고이고 ledger_cutover를 적는다', () => {
    expect(planAdjustment({ mode: 'count', value: 4, expected: 0, onHand: 0, locationEmpty: true }))
      .toEqual({ diff: 4, lotKind: 'opening', setsCutover: true });
  });

  it('빈 위치에 0을 적으면 기록할 것이 없고 커서도 두지 않는다', () => {
    expect(planAdjustment({ mode: 'count', value: 0, expected: 0, onHand: 0, locationEmpty: true }))
      .toEqual({ diff: 0, lotKind: 'opening', setsCutover: false });
  });

  it('±수량은 비어 있지 않은 위치에서 입력 그대로이고 기초재고가 되지 않는다', () => {
    expect(planAdjustment({ mode: 'delta', value: 2, onHand: 3, locationEmpty: false }))
      .toEqual({ diff: 2, lotKind: 'adjust', setsCutover: false });
    expect(planAdjustment({ mode: 'delta', value: -2, onHand: 3, locationEmpty: false }))
      .toEqual({ diff: -2, lotKind: 'adjust', setsCutover: false });
  });

  it('빈 위치의 +수량은 expected 0인 지금 개수와 같다 — 기초재고 + ledger_cutover', () => {
    expect(planAdjustment({ mode: 'delta', value: 2, onHand: 0, locationEmpty: true }))
      .toEqual({ diff: 2, lotKind: 'opening', setsCutover: true });
  });

  it('빈 위치의 −수량은 AdjustInputError', () => {
    expect(() => planAdjustment({ mode: 'delta', value: -1, onHand: 0, locationEmpty: true })).toThrow(AdjustInputError);
    expect(() => planAdjustment({ mode: 'delta', value: -1, onHand: 0, locationEmpty: true })).toThrow('비어 있는 위치에서는 뺄 수 없다');
  });

  it('화면이 본 재고와 저장 시점 재고가 다르면 StaleCountError', () => {
    try {
      planAdjustment({ mode: 'count', value: 3, expected: 5, onHand: 4, locationEmpty: false });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(StaleCountError);
      expect((e as StaleCountError).expected).toBe(5);
      expect((e as StaleCountError).actual).toBe(4);
    }
  });
});

describe('pickUnitCost', () => {
  it('입력 > 최근 lot > 옛 입고 순이고, 모두 없으면 null', () => {
    expect(pickUnitCost(900, 800, 700)).toEqual({ unitCost: 900, source: 'input' });
    expect(pickUnitCost(undefined, 800, 700)).toEqual({ unitCost: 800, source: 'lot' });
    expect(pickUnitCost(undefined, null, 700)).toEqual({ unitCost: 700, source: 'legacy' });
    expect(pickUnitCost(undefined, null, null)).toBeNull();
  });

  it('입력 0원은 그대로 쓴다(증정품)', () => {
    expect(pickUnitCost(0, 800, null)).toEqual({ unitCost: 0, source: 'input' });
  });
});

describe('validateAdjustInput', () => {
  it('정상 입력은 통과', () => {
    expect(() => validateAdjustInput(base)).not.toThrow();
    expect(() => validateAdjustInput({ ...base, mode: 'delta', value: -2, expected: undefined })).not.toThrow();
    expect(() => validateAdjustInput({ ...base, location: 'rg', reason: 'rg_reconcile' })).not.toThrow();
  });

  it('요청 id를 소문자로 맞춘다(대소문자만 다른 재전송도 같은 요청)', () => {
    const p = { ...base, requestId: REQ.toUpperCase() };
    validateAdjustInput(p);
    expect(p.requestId).toBe(REQ);
  });

  it.each<[string, Partial<AdjustInput>]>([
    ['음수 지금 개수', { value: -1 }],
    ['지금 개수인데 expected 없음', { expected: undefined }],
    ['±수량 0', { mode: 'delta', value: 0 }],
    ['소수', { value: 1.5 }],
    ['opening 사유(서버 전용)', { reason: 'opening' as never }],
    ['uuid 아닌 요청 id', { requestId: 'abc' }],
    ['오프셋 없는 시각', { occurredAt: '2026-09-27T10:00:00' }],
    ['음수 단가', { unitCost: -1 }],
    ['잘못된 위치', { location: 'home' as never }],
    ['201자 메모', { note: 'x'.repeat(201) }],
    ['RG 위치인데 RG 대조 사유가 아님', { location: 'rg', reason: 'count_diff' }],
    ['RG 대조 사유인데 RG 위치가 아님', { location: 'self', reason: 'rg_reconcile' }],
  ])('%s → AdjustInputError', (_, patch) => {
    expect(() => validateAdjustInput({ ...base, ...patch })).toThrow(AdjustInputError);
  });
});

describe('멱등키', () => {
  it('조정·기초 키는 1-B assertIdemKey를 통과한다', () => {
    expect(() => assertIdemKey(adjustIdemKey(REQ))).not.toThrow();
    expect(() => assertIdemKey(openingIdemKey(7, 'rg_inbound'))).not.toThrow();
  });

  it('되돌리기는 조정·기초 키만', () => {
    expect(isReversibleKey(`adj:${REQ}`)).toBe(true);
    expect(isReversibleKey('opening:7:self')).toBe(true);
    expect(isReversibleKey('receipt:abc:7')).toBe(false);
    expect(isReversibleKey(`rev:adj:${REQ}`)).toBe(false);
    expect(isReversibleKey(`adj:${REQ}#0`)).toBe(false);
  });
  it('🔴 RG 입고 완료(rgdone:<uuid>)도 되돌릴 수 있다 — 옛 원가 기록과 짝이 없는 원장만의 이동이다', () => {
    expect(isReversibleKey(`rgdone:${REQ}`)).toBe(true);
    expect(isReversibleKey(`rgdone:${REQ}#0:in`)).toBe(false);
    expect(isReversibleKey('rgdone:7')).toBe(false);
    expect(isReversibleKey(`rgship:${REQ}:7`)).toBe(false);
  });
});
