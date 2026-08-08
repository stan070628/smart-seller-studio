import { describe, it, expect } from 'vitest';
import { checkTotalSum, checkLineArithmetic } from '@/lib/receipt/verify';
import { RECEIPT_A, RECEIPT_B } from '@/lib/receipt/__tests__/fixtures';

describe('checkTotalSum — 품목 금액 합 = 결제 총액', () => {
  it('영수증 A는 통과한다', () => {
    const r = checkTotalSum(RECEIPT_A);
    expect(r.status).toBe('pass');
    expect(r.actual).toBe(587630);
    expect(r.expected).toBe(587630);
  });

  it('영수증 B는 할인 음수를 포함해 통과한다', () => {
    const r = checkTotalSum(RECEIPT_B);
    expect(r.status).toBe('pass');
    expect(r.actual).toBe(724310);
  });

  it('금액이 하나 틀리면 차액과 함께 실패한다', () => {
    const broken = {
      ...RECEIPT_A,
      lines: RECEIPT_A.lines.map((l) => (l.line_no === 1 ? { ...l, amount: 40783 } : l)),
    };
    const r = checkTotalSum(broken);
    expect(r.status).toBe('fail');
    expect(r.diff).toBe(-367047);
  });

  it('결제 총액을 못 읽었으면 건너뛴다', () => {
    const r = checkTotalSum({ ...RECEIPT_A, receipt_total: null });
    expect(r.status).toBe('skipped');
  });
});

describe('checkLineArithmetic — 수량 × 단가 = 금액', () => {
  it('영수증 A는 3줄 전부 통과한다', () => {
    const r = checkLineArithmetic(RECEIPT_A);
    expect(r.status).toBe('pass');
    expect(r.badLineNos).toEqual([]);
  });

  it('영수증 B는 할인 줄(음수)도 절대값으로 통과한다', () => {
    const r = checkLineArithmetic(RECEIPT_B);
    expect(r.status).toBe('pass');
    expect(r.badLineNos).toEqual([]);
  });

  it('틀린 줄의 번호를 짚어준다', () => {
    const broken = {
      ...RECEIPT_B,
      lines: RECEIPT_B.lines.map((l) => (l.line_no === 10 ? { ...l, unit_price: 2499 } : l)),
    };
    const r = checkLineArithmetic(broken);
    expect(r.status).toBe('fail');
    expect(r.badLineNos).toEqual([10]);
  });

  it('단가를 못 읽은 줄은 검사에서 제외한다', () => {
    const partial = {
      ...RECEIPT_A,
      lines: RECEIPT_A.lines.map((l) => (l.line_no === 2 ? { ...l, unit_price: null } : l)),
    };
    const r = checkLineArithmetic(partial);
    expect(r.status).toBe('pass');
    expect(r.badLineNos).toEqual([]);
  });

  it('검사할 줄이 하나도 없으면 건너뛴다', () => {
    const none = {
      ...RECEIPT_A,
      lines: RECEIPT_A.lines.map((l) => ({ ...l, unit_price: null })),
    };
    expect(checkLineArithmetic(none).status).toBe('skipped');
  });
});
