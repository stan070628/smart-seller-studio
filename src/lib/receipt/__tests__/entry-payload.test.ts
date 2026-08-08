import { describe, it, expect } from 'vitest';
import { buildEntryPayload } from '@/lib/receipt/entry-payload';
import { attributeDiscounts } from '@/lib/receipt/discount';
import { calculateSubdivision } from '@/lib/cost-management/subdivision';
import { RECEIPT_A, RECEIPT_B } from '@/lib/receipt/__tests__/fixtures';

describe('buildEntryPayload — 일반 입고', () => {
  it('할인이 붙은 품목은 차감된 단가를 낸다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    const payload = buildEntryPayload({
      lines,
      lineNo: 2,
      receivedAt: '2026-08-08',
      entryType: 'normal',
    });
    // (164,950 - 35,000) / 5 = 25,990
    expect(payload).toEqual({
      received_at: '2026-08-08',
      quantity: 5,
      unit_cost: 25990,
      unit_shipping_fee: 0,
    });
  });

  it('할인 전 단가(32,990)를 쓰지 않는다 — 원가 오염 회귀 방지', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    const payload = buildEntryPayload({ lines, lineNo: 2, receivedAt: '2026-08-08', entryType: 'normal' });
    expect(payload.unit_cost).not.toBe(32990);
  });

  it('할인이 없으면 영수증 단가와 같다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    const payload = buildEntryPayload({ lines, lineNo: 1, receivedAt: '2026-08-08', entryType: 'normal' });
    expect(payload.unit_cost).toBe(29990);
  });

  it('나누어떨어지지 않으면 반올림한다', () => {
    const lines = attributeDiscounts([
      { line_no: 1, item_code: 'A', item_label: '상품', quantity: 3, unit_price: 1000, amount: 3001, is_discount: false, tax_type: 'taxable' as const },
    ]);
    const payload = buildEntryPayload({ lines, lineNo: 1, receivedAt: '2026-08-08', entryType: 'normal' });
    expect(payload.unit_cost).toBe(1000);
  });
});

describe('buildEntryPayload — 소분 입고', () => {
  it('총 구매가와 사입 총량을 낸다', () => {
    const lines = attributeDiscounts(RECEIPT_A.lines);
    const payload = buildEntryPayload({
      lines,
      lineNo: 1,
      receivedAt: '2026-08-08',
      entryType: 'subdivision',
      itemsPerBox: 36,
      subdivisionUnit: 10,
    });
    expect(payload).toEqual({
      received_at: '2026-08-08',
      unit_cost: 407830,
      purchase_quantity: 612,
      subdivision_unit: 10,
      unit_shipping_fee: 0,
      unit_rg_shipping_fee: 0,
    });
  });

  it('기존 소분 계산기에 그대로 넘어간다', () => {
    const lines = attributeDiscounts(RECEIPT_A.lines);
    const payload = buildEntryPayload({
      lines, lineNo: 1, receivedAt: '2026-08-08',
      entryType: 'subdivision', itemsPerBox: 36, subdivisionUnit: 10,
    });
    const calc = calculateSubdivision({
      purchaseQuantity: payload.purchase_quantity as number,
      totalPurchaseCost: payload.unit_cost,
      subdivisionUnit: payload.subdivision_unit as number,
      carryoverQuantity: 0,
      carryoverUnitCost: 0,
    });
    expect(calc.sellablePacks).toBe(61);
    expect(calc.newCarryoverQuantity).toBe(2);
    expect(calc.packUnitCost).toBe(6664);
  });

  it('소분인데 포장당 개수가 없으면 예외를 던진다', () => {
    const lines = attributeDiscounts(RECEIPT_A.lines);
    expect(() =>
      buildEntryPayload({ lines, lineNo: 1, receivedAt: '2026-08-08', entryType: 'subdivision', subdivisionUnit: 10 }),
    ).toThrow('itemsPerBox');
  });
});

describe('buildEntryPayload — 거부해야 하는 입력', () => {
  it('할인 줄로는 입고를 만들지 않는다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    expect(() =>
      buildEntryPayload({ lines, lineNo: 3, receivedAt: '2026-08-08', entryType: 'normal' }),
    ).toThrow('할인 줄');
  });

  it('없는 줄 번호는 예외를 던진다', () => {
    const lines = attributeDiscounts(RECEIPT_A.lines);
    expect(() =>
      buildEntryPayload({ lines, lineNo: 999, receivedAt: '2026-08-08', entryType: 'normal' }),
    ).toThrow('찾을 수 없');
  });
});
