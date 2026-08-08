import { describe, it, expect } from 'vitest';
import { selectConfirmable, mappingUpsertFrom, type ConfirmCandidate } from '@/lib/receipt/confirm';

function line(over: Partial<ConfirmCandidate> = {}): ConfirmCandidate {
  return {
    line_no: 1,
    is_discount: false,
    decision: 'ingest',
    product_cost_id: 'prod-1',
    entry_type: 'normal',
    items_per_box: null,
    subdivision_unit: null,
    cost_entry_id: null,
    ...over,
  };
}

describe('selectConfirmable', () => {
  it('조건을 갖춘 줄은 확정 대상이다', () => {
    const r = selectConfirmable([line()]);
    expect(r.confirmable.map((l) => l.line_no)).toEqual([1]);
    expect(r.skipped).toEqual([]);
  });

  it('이미 확정된 줄은 건너뛴다 — 멱등성의 근거', () => {
    const r = selectConfirmable([line({ cost_entry_id: 'entry-1' })]);
    expect(r.confirmable).toEqual([]);
    expect(r.skipped[0].reason).toBe('already_confirmed');
  });

  it('decision이 ingest가 아니면 건너뛴다', () => {
    const r = selectConfirmable([line({ decision: 'skip' }), line({ line_no: 2, decision: 'pending' })]);
    expect(r.confirmable).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['not_ingest', 'not_ingest']);
  });

  it('할인 줄은 건너뛴다', () => {
    const r = selectConfirmable([line({ is_discount: true, decision: 'skip' })]);
    expect(r.skipped[0].reason).toBe('discount_line');
  });

  it('판매상품이 없으면 거절한다', () => {
    const r = selectConfirmable([line({ product_cost_id: null })]);
    expect(r.confirmable).toEqual([]);
    expect(r.skipped[0].reason).toBe('no_product');
  });

  it('입고 방식이 없으면 거절한다', () => {
    const r = selectConfirmable([line({ entry_type: null })]);
    expect(r.skipped[0].reason).toBe('no_entry_type');
  });

  it('소분인데 포장 수량이 없으면 거절한다', () => {
    const r = selectConfirmable([line({ entry_type: 'subdivision', subdivision_unit: 10 })]);
    expect(r.skipped[0].reason).toBe('missing_subdivision_params');
  });

  it('소분인데 소분 갯수가 없으면 거절한다', () => {
    const r = selectConfirmable([line({ entry_type: 'subdivision', items_per_box: 36 })]);
    expect(r.skipped[0].reason).toBe('missing_subdivision_params');
  });

  it('소분 파라미터가 다 있으면 통과한다', () => {
    const r = selectConfirmable([line({ entry_type: 'subdivision', items_per_box: 36, subdivision_unit: 10 })]);
    expect(r.confirmable.map((l) => l.line_no)).toEqual([1]);
  });

  it('line_no 오름차순으로 낸다 — 소분 이월이 순서에 의존한다', () => {
    const r = selectConfirmable([line({ line_no: 5 }), line({ line_no: 2 }), line({ line_no: 9 })]);
    expect(r.confirmable.map((l) => l.line_no)).toEqual([2, 5, 9]);
  });

  it('지정한 줄만 거를 수 있다', () => {
    const r = selectConfirmable([line({ line_no: 1 }), line({ line_no: 2 })], [2]);
    expect(r.confirmable.map((l) => l.line_no)).toEqual([2]);
    expect(r.skipped).toEqual([]);
  });
});

describe('mappingUpsertFrom', () => {
  const base = {
    line_no: 1, is_discount: false, decision: 'ingest' as const,
    product_cost_id: 'prod-1', entry_type: 'normal' as const,
    items_per_box: null, subdivision_unit: null, cost_entry_id: null,
  };

  it('품번과 확정 값을 기억할 형태로 낸다', () => {
    const r = mappingUpsertFrom({ ...base, item_code: '713160', item_label: 'KS노랑타월36CT' });
    expect(r).toEqual({
      item_code: '713160',
      item_label: 'KS노랑타월36CT',
      product_cost_id: 'prod-1',
      default_decision: 'ingest',
      default_entry_type: 'normal',
      items_per_box: null,
      subdivision_unit: null,
    });
  });

  it('소분 파라미터도 함께 기억한다', () => {
    const r = mappingUpsertFrom({
      ...base, item_code: '713160', item_label: 'KS노랑타월36CT',
      entry_type: 'subdivision', items_per_box: 36, subdivision_unit: 10,
    });
    expect(r?.items_per_box).toBe(36);
    expect(r?.subdivision_unit).toBe(10);
  });

  it('품번이 없으면 기억할 수 없다', () => {
    expect(mappingUpsertFrom({ ...base, item_code: null, item_label: '봉투' })).toBeNull();
  });

  it('확정 시 default_decision은 항상 ingest다', () => {
    const r = mappingUpsertFrom({ ...base, item_code: '999', item_label: 'x' });
    expect(r?.default_decision).toBe('ingest');
  });
});
