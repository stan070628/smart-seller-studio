import { describe, it, expect } from 'vitest';
import { validateLinePatch, type LineState, type LinePatch } from '@/lib/receipt/line-patch';
import { selectConfirmable, type ConfirmCandidate } from '@/lib/receipt/confirm';
import { draftProgress, type ProgressLine } from '@/lib/receipt/view';

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

  it('🔴 상품 없이 입고로 정할 수 있다 — 화면의 입력 순서다', () => {
    // 사람은 「입고」를 먼저 누르고 그 다음에 상품을 고른다.
    // 여기서 막으면 상품 드롭다운이 뜨지 않아 영원히 진행할 수 없다
    const next = ok({ decision: 'ingest' });
    expect(next.decision).toBe('ingest');
    expect(next.product_cost_id).toBeNull();
  });

  it('🔴 입고 방식을 안 정한 상태도 저장된다', () => {
    expect(ok({ decision: 'ingest', product_cost_id: 'p1' }).entry_type).toBeNull();
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

  it('🔴 소분 값을 아직 안 넣은 상태도 저장된다', () => {
    // 소분을 골라야 입력란이 나타나므로, 여기서 막으면 값을 넣을 방법이 없다
    const state = cur({ decision: 'ingest', product_cost_id: 'p1' });
    expect(ok({ entry_type: 'subdivision' }, state).entry_type).toBe('subdivision');
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

/**
 * 🔴 세 순수 함수를 함께 건다.
 *
 * 2026-08-09 실물 사용에서 「입고」 버튼이 전혀 눌리지 않는 교착이 났다.
 * `validateLinePatch`는 "입고면 상품이 있어야 한다"고 막았고 화면은
 * "입고여야 상품 드롭다운을 보여준다"였다. **각각의 단위 테스트는 전부 통과했다.**
 *
 * 함수 하나만 보면 규칙이 옳아 보이므로, 화면이 실제로 밟는 순서를 여기서 건다.
 */
describe('화면 입력 순서 통과 (교착 회귀)', () => {
  const base: LineState = {
    is_discount: false, decision: 'pending', product_cost_id: null, entry_type: null,
    items_per_box: null, subdivision_unit: null, cost_entry_id: null,
  };

  function step(state: LineState, patch: LinePatch): LineState {
    const r = validateLinePatch(patch, state);
    expect(r.errors).toEqual([]);   // 어느 단계도 막히면 안 된다
    return r.next;
  }

  it('일반 입고: 입고 → 상품 → 방식 순서로 끝까지 간다', () => {
    let s = base;
    s = step(s, { decision: 'ingest' });
    s = step(s, { product_cost_id: 'p1', entry_type: 'normal' });

    const { confirmable, skipped } = selectConfirmable([{ line_no: 1, ...s } as ConfirmCandidate]);
    expect(skipped).toEqual([]);
    expect(confirmable).toHaveLength(1);
  });

  it('소분 입고: 방식을 먼저 고르고 값을 나중에 넣어도 끝까지 간다', () => {
    let s = base;
    s = step(s, { decision: 'ingest' });
    s = step(s, { product_cost_id: 'p1', entry_type: 'normal' });
    s = step(s, { entry_type: 'subdivision' });          // 이 순간엔 값이 없다
    s = step(s, { items_per_box: 36 });
    s = step(s, { subdivision_unit: 10 });

    const { confirmable } = selectConfirmable([{ line_no: 1, ...s } as ConfirmCandidate]);
    expect(confirmable).toHaveLength(1);
  });

  it('🔴 중간 상태는 저장되되 확정은 막힌다 — 완결성 판정은 확정 시점의 몫이다', () => {
    const s = step(base, { decision: 'ingest' });        // 상품 없음

    const { confirmable, skipped } = selectConfirmable([{ line_no: 1, ...s } as ConfirmCandidate]);
    expect(confirmable).toEqual([]);
    expect(skipped[0].reason).toBe('no_product');
  });

  it('🔴 소분 값이 빠진 채로는 확정되지 않는다', () => {
    let s = step(base, { decision: 'ingest' });
    s = step(s, { product_cost_id: 'p1', entry_type: 'subdivision' });

    const { skipped } = selectConfirmable([{ line_no: 1, ...s } as ConfirmCandidate]);
    expect(skipped[0].reason).toBe('missing_subdivision_params');
  });

  it('🔴 draftProgress의 blocked에 실제로 도달한다', () => {
    // 이 집계는 "입고인데 상품이 안 붙은 줄"을 세는데,
    // 고치기 전 규칙에서는 그 상태를 만들 수가 없어 영원히 0이었다
    const s = step(base, { decision: 'ingest' });
    const p = draftProgress([{ line_no: 1, ...s } as unknown as ProgressLine]);
    expect(p.blocked).toBe(1);
    expect(p.ready).toBe(0);
  });
});
