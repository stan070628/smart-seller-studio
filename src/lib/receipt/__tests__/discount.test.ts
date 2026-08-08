import { describe, it, expect } from 'vitest';
import { attributeDiscounts, netAmountOf } from '@/lib/receipt/discount';
import { RECEIPT_A, RECEIPT_B } from '@/lib/receipt/__tests__/fixtures';

describe('attributeDiscounts', () => {
  it('할인 줄을 직전 비할인 줄에 연결한다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    expect(lines.find((l) => l.line_no === 3)?.applies_to_line_no).toBe(2);
    expect(lines.find((l) => l.line_no === 5)?.applies_to_line_no).toBe(4);
  });

  it('비할인 줄의 귀속 대상은 null이다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    expect(lines.find((l) => l.line_no === 2)?.applies_to_line_no).toBeNull();
  });

  it('할인이 없는 영수증은 전부 null이다', () => {
    const lines = attributeDiscounts(RECEIPT_A.lines);
    expect(lines.every((l) => l.applies_to_line_no === null)).toBe(true);
  });

  it('첫 줄이 할인이면 귀속 대상이 없어 null로 둔다', () => {
    const orphan = [
      { line_no: 1, item_code: '16612', item_label: 'CPN', quantity: 1, unit_price: 1000, amount: -1000, is_discount: true, tax_type: 'taxable' as const },
    ];
    expect(attributeDiscounts(orphan)[0].applies_to_line_no).toBeNull();
  });

  it('할인 줄 다음의 할인 줄도 같은 품목에 붙는다', () => {
    const twoDiscounts = [
      { line_no: 1, item_code: 'A', item_label: '상품', quantity: 1, unit_price: 10000, amount: 10000, is_discount: false, tax_type: 'taxable' as const },
      { line_no: 2, item_code: 'C1', item_label: '쿠폰1', quantity: 1, unit_price: 1000, amount: -1000, is_discount: true, tax_type: 'taxable' as const },
      { line_no: 3, item_code: 'C2', item_label: '쿠폰2', quantity: 1, unit_price: 2000, amount: -2000, is_discount: true, tax_type: 'taxable' as const },
    ];
    const lines = attributeDiscounts(twoDiscounts);
    expect(lines[1].applies_to_line_no).toBe(1);
    expect(lines[2].applies_to_line_no).toBe(1);
  });
});

describe('netAmountOf — 할인 반영 금액', () => {
  it('할인이 붙은 품목은 차감된 금액을 낸다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    expect(netAmountOf(lines, 2)).toBe(129950);
    expect(netAmountOf(lines, 4)).toBe(129950);
  });

  it('할인이 없는 품목은 원래 금액 그대로다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    expect(netAmountOf(lines, 1)).toBe(269910);
  });

  it('할인이 두 건 붙으면 모두 차감한다', () => {
    const twoDiscounts = attributeDiscounts([
      { line_no: 1, item_code: 'A', item_label: '상품', quantity: 1, unit_price: 10000, amount: 10000, is_discount: false, tax_type: 'taxable' as const },
      { line_no: 2, item_code: 'C1', item_label: '쿠폰1', quantity: 1, unit_price: 1000, amount: -1000, is_discount: true, tax_type: 'taxable' as const },
      { line_no: 3, item_code: 'C2', item_label: '쿠폰2', quantity: 1, unit_price: 2000, amount: -2000, is_discount: true, tax_type: 'taxable' as const },
    ]);
    expect(netAmountOf(twoDiscounts, 1)).toBe(7000);
  });

  it('없는 줄 번호를 물으면 0을 낸다', () => {
    const lines = attributeDiscounts(RECEIPT_A.lines);
    expect(netAmountOf(lines, 999)).toBe(0);
  });
});
