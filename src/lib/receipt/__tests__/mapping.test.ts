import { describe, it, expect } from 'vitest';
import { applyMappings, type ItemMapRow } from '@/lib/receipt/mapping';
import { attributeDiscounts } from '@/lib/receipt/discount';
import { RECEIPT_A, RECEIPT_B } from '@/lib/receipt/__tests__/fixtures';

const MAPS: ItemMapRow[] = [
  {
    item_code: '713160',
    product_cost_id: 'prod-towel',
    default_decision: 'ingest',
    default_entry_type: 'subdivision',
    items_per_box: 36,
    subdivision_unit: 10,
  },
  {
    item_code: '674362',
    product_cost_id: null,
    default_decision: 'skip',
    default_entry_type: null,
    items_per_box: null,
    subdivision_unit: null,
  },
  {
    item_code: '690437',
    product_cost_id: 'prod-bag',
    default_decision: 'ask',
    default_entry_type: 'normal',
    items_per_box: null,
    subdivision_unit: null,
  },
];

describe('applyMappings', () => {
  it('매핑된 품목은 결정과 상품을 물려받는다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_A.lines), MAPS);
    const towel = rows.find((r) => r.line_no === 1)!;
    expect(towel.decision).toBe('ingest');
    expect(towel.product_cost_id).toBe('prod-towel');
    expect(towel.entry_type).toBe('subdivision');
    expect(towel.items_per_box).toBe(36);
    expect(towel.subdivision_unit).toBe(10);
  });

  it('개인용으로 기억된 품목은 skip이다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_B.lines), MAPS);
    expect(rows.find((r) => r.line_no === 7)!.decision).toBe('skip');
  });

  it('ask로 기억된 품목은 pending으로 둔다 — 매번 묻는다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_B.lines), MAPS);
    const bag = rows.find((r) => r.line_no === 1)!;
    expect(bag.decision).toBe('pending');
    expect(bag.product_cost_id).toBe('prod-bag');
  });

  it('매핑이 없는 품목은 pending이고 상품이 비어 있다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_B.lines), MAPS);
    const wine = rows.find((r) => r.line_no === 9)!;
    expect(wine.decision).toBe('pending');
    expect(wine.product_cost_id).toBeNull();
  });

  it('할인 줄은 항상 skip이다 — 입고를 만들지 않는다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_B.lines), MAPS);
    expect(rows.find((r) => r.line_no === 3)!.decision).toBe('skip');
    expect(rows.find((r) => r.line_no === 5)!.decision).toBe('skip');
  });

  it('할인 줄의 귀속 대상 line_no를 보존한다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_B.lines), MAPS);
    expect(rows.find((r) => r.line_no === 3)!.applies_to_line_no).toBe(2);
  });

  it('품번이 없는 줄은 매핑을 찾지 않고 pending이다', () => {
    const noCode = attributeDiscounts([
      { line_no: 1, item_code: null, item_label: '봉투', quantity: 1, unit_price: 100, amount: 100, is_discount: false, tax_type: 'taxable' as const },
    ]);
    const rows = applyMappings(noCode, MAPS);
    expect(rows[0].decision).toBe('pending');
    expect(rows[0].product_cost_id).toBeNull();
  });

  it('매핑에 포장 수량이 없으면 상품명에서 뽑아 제안한다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_B.lines), MAPS);
    expect(rows.find((r) => r.line_no === 11)!.items_per_box).toBe(60);
  });

  it('매핑의 포장 수량이 상품명 추출보다 우선한다', () => {
    const rows = applyMappings(attributeDiscounts(RECEIPT_A.lines), MAPS);
    const towel = rows.find((r) => r.line_no === 1)!;
    expect(towel.items_per_box).toBe(36);
  });

  it('줄 순서와 개수를 보존한다', () => {
    const lines = attributeDiscounts(RECEIPT_B.lines);
    const rows = applyMappings(lines, MAPS);
    expect(rows).toHaveLength(13);
    expect(rows.map((r) => r.line_no)).toEqual(lines.map((l) => l.line_no));
  });
});
