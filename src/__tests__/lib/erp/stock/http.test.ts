// src/__tests__/lib/erp/stock/http.test.ts
// parseAdjustItem 숫자 파싱은 엄격해야 한다 — Number(v)는 ''→0·[]→0·true→1로 조용히 통과시킨다.
import { describe, it, expect } from 'vitest';
import { parseAdjustItem, erpError } from '@/lib/erp/stock/http';
import { AdjustInputError } from '@/lib/erp/ledger/adjust';

const base = { location: 'self', mode: 'count', reason: 'count_diff', requestId: 'x' };
const AT = '2026-09-27T01:00:00.000Z';

describe('parseAdjustItem — 필수 숫자 칸(skuId·value)', () => {
  it.each([
    ['null', null],
    ['빈 문자열', ''],
    ['빈 배열', []],
    ['true', true],
  ])('skuId가 %s면 숫자가 아니므로 NaN(검사에서 400)', (_label, v) => {
    const p = parseAdjustItem({ ...base, skuId: v, value: 5 }, AT);
    expect(Number.isNaN(p.skuId)).toBe(true);
  });

  it.each([
    ['null', null],
    ['빈 문자열', ''],
    ['빈 배열', []],
    ['true', true],
  ])('value가 %s면 숫자가 아니므로 NaN(검사에서 400)', (_label, v) => {
    const p = parseAdjustItem({ ...base, skuId: 7, value: v }, AT);
    expect(Number.isNaN(p.value)).toBe(true);
  });

  it('진짜 숫자는 그대로 통과한다', () => {
    const p = parseAdjustItem({ ...base, skuId: 7, value: 5 }, AT);
    expect(p.skuId).toBe(7);
    expect(p.value).toBe(5);
  });

  it('true는 1로 조용히 바뀌지 않는다(불리언 SKU id가 실제 SKU 1을 가리키는 것을 막는다)', () => {
    const p = parseAdjustItem({ ...base, skuId: true, value: 5 }, AT);
    expect(p.skuId).not.toBe(1);
    expect(Number.isNaN(p.skuId)).toBe(true);
  });
});

describe('parseAdjustItem — 선택 숫자 칸(expected·unitCost)', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('%s는 입력 없음(undefined)이다', (_label, v) => {
    const p = parseAdjustItem({ ...base, skuId: 7, value: 5, expected: v, unitCost: v }, AT);
    expect(p.expected).toBeUndefined();
    expect(p.unitCost).toBeUndefined();
  });

  it('숫자는 그대로 쓴다', () => {
    const p = parseAdjustItem({ ...base, skuId: 7, value: 5, expected: 3, unitCost: 900 }, AT);
    expect(p.expected).toBe(3);
    expect(p.unitCost).toBe(900);
  });

  it.each([
    ['빈 문자열', ''],
    ['빈 배열', []],
    ['true', true],
  ])('%s는 0으로 읽지 않고 NaN이 된다(검사에서 400)', (_label, v) => {
    const p = parseAdjustItem({ ...base, skuId: 7, value: 5, expected: v, unitCost: v }, AT);
    expect(Number.isNaN(p.expected)).toBe(true);
    expect(Number.isNaN(p.unitCost)).toBe(true);
    // ''는 특히 0으로 읽으면 안 된다 — Number('') === 0이라 예전 optNum이 여기서 조용히 틀렸다
    expect(p.expected).not.toBe(0);
    expect(p.unitCost).not.toBe(0);
  });
});

describe('erpError — 500 경로', () => {
  it('원문 대신 마스킹한 문자열을 로그에 남긴다', () => {
    const logs: unknown[][] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => logs.push(args);
    try {
      const e = new Error('결제 실패 010-1234-5678');
      const res = erpError(e);
      expect(res.status).toBe(500);
      expect(logs).toHaveLength(1);
      const logged = logs[0].join(' ');
      expect(logged).not.toContain('010-1234-5678');
      expect(logged).toContain('010-****-5678');
    } finally {
      console.error = orig;
    }
  });

  it('AdjustInputError는 400이다(참고용 — 숫자 파싱 실패가 여기로 이어진다)', () => {
    expect(erpError(new AdjustInputError('x')).status).toBe(400);
  });
});
