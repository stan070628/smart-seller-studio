import { describe, it, expect } from 'vitest';
import { validateLinePatch, type LineState, type LinePatch } from '@/lib/receipt/line-patch';

const cur = (over: Partial<LineState> = {}): LineState => ({
  is_discount: false,
  decision: 'pending',
  product_cost_id: null,
  entry_type: null,
  items_per_box: null,
  subdivision_unit: null,
  cost_entry_id: null,
  ...over,
});

function ok(patch: LinePatch, state = cur()) {
  const r = validateLinePatch(patch, state);
  expect(r.errors).toEqual([]);
  return r.next;
}

describe('validateLinePatch', () => {
  it('빈 패치는 현재 값을 그대로 낸다', () => {
    expect(ok({})).toEqual(cur());
  });

  it('패치가 현재 값 위에 덮인다', () => {
    const next = ok({ decision: 'ingest', product_cost_id: 'p1', entry_type: 'normal' });
    expect(next.decision).toBe('ingest');
    expect(next.product_cost_id).toBe('p1');
  });

  it('확정된 줄은 고칠 수 없다', () => {
    const r = validateLinePatch({ decision: 'skip' }, cur({ cost_entry_id: 'e1' }));
    expect(r.errors).toContain('이미 입고로 확정된 줄은 수정할 수 없습니다.');
  });

  it('할인 줄은 고칠 수 없다', () => {
    const r = validateLinePatch({ decision: 'ingest' }, cur({ is_discount: true }));
    expect(r.errors).toContain('할인 줄은 입고 대상이 아닙니다.');
  });

  it('입고로 정하려면 상품이 있어야 한다', () => {
    const r = validateLinePatch({ decision: 'ingest', entry_type: 'normal' }, cur());
    expect(r.errors).toContain('입고할 상품을 선택해야 합니다.');
  });

  it('입고로 정하려면 입고 방식이 있어야 한다', () => {
    const r = validateLinePatch({ decision: 'ingest', product_cost_id: 'p1' }, cur());
    expect(r.errors).toContain('입고 방식을 선택해야 합니다.');
  });

  it('🔴 현재 값과 합쳐서 판정한다 — 방식만 바꿔도 통과한다', () => {
    const state = cur({ decision: 'ingest', product_cost_id: 'p1', entry_type: 'normal' });
    const next = ok({ entry_type: 'subdivision', items_per_box: 36, subdivision_unit: 10 }, state);
    expect(next.entry_type).toBe('subdivision');
    expect(next.product_cost_id).toBe('p1');
  });

  it('🔴 저장된 소분 값이 있으면 방식만 바꿔도 유효하다', () => {
    const state = cur({
      decision: 'ingest', product_cost_id: 'p1', entry_type: 'normal',
      items_per_box: 36, subdivision_unit: 10,
    });
    expect(validateLinePatch({ entry_type: 'subdivision' }, state).errors).toEqual([]);
  });

  it('소분인데 값이 없으면 거절한다', () => {
    const state = cur({ decision: 'ingest', product_cost_id: 'p1' });
    const r = validateLinePatch({ entry_type: 'subdivision' }, state);
    expect(r.errors).toContain('소분 입고에는 박스당 개수와 소분 단위가 모두 필요합니다.');
  });

  it('소분 값은 양수여야 한다', () => {
    const state = cur({ decision: 'ingest', product_cost_id: 'p1' });
    const r = validateLinePatch(
      { entry_type: 'subdivision', items_per_box: 0, subdivision_unit: 10 }, state);
    expect(r.errors).toContain('박스당 개수는 1 이상이어야 합니다.');
  });

  it('제외로 정할 때는 상품이 없어도 된다', () => {
    expect(ok({ decision: 'skip' }).decision).toBe('skip');
  });

  it('상품을 null로 지우는 것과 안 보내는 것을 구분한다', () => {
    const state = cur({ product_cost_id: 'p1', decision: 'skip' });
    expect(ok({}, state).product_cost_id).toBe('p1');
    expect(ok({ product_cost_id: null }, state).product_cost_id).toBeNull();
  });
});
