import { describe, it, expect } from 'vitest';
import { draftBadge, draftProgress, type DraftLike, type ProgressLine } from '@/lib/receipt/view';

function draft(over: Partial<DraftLike> = {}): DraftLike {
  return { ocr_status: 'parsed', verify_status: 'matched', status: 'draft', ...over };
}

describe('draftBadge', () => {
  it('판독 대기는 대기로 표시한다', () => {
    expect(draftBadge(draft({ ocr_status: 'pending' }))).toEqual({
      label: '판독 대기', tone: 'neutral', busy: true,
    });
  });

  it('판독 중은 진행 표시를 켠다', () => {
    const b = draftBadge(draft({ ocr_status: 'parsing' }));
    expect(b.label).toBe('판독 중');
    expect(b.busy).toBe(true);
  });

  it('판독 실패가 검산 상태보다 우선한다', () => {
    const b = draftBadge(draft({ ocr_status: 'failed', verify_status: 'matched' }));
    expect(b.label).toBe('판독 실패');
    expect(b.tone).toBe('danger');
    expect(b.busy).toBe(false);
  });

  it('검산 통과', () => {
    expect(draftBadge(draft())).toEqual({ label: '검산 통과', tone: 'ok', busy: false });
  });

  it('검산 불일치는 경고다 — 막지는 않는다', () => {
    const b = draftBadge(draft({ verify_status: 'mismatch' }));
    expect(b.label).toBe('검산 불일치');
    expect(b.tone).toBe('warn');
  });

  it('검산 불가는 중립이다 — 합계를 못 읽었을 뿐 틀렸다는 뜻이 아니다', () => {
    expect(draftBadge(draft({ verify_status: 'unreadable' })).tone).toBe('neutral');
  });

  it('완료와 폐기는 판독·검산보다 우선한다', () => {
    expect(draftBadge(draft({ status: 'done' })).label).toBe('입고 완료');
    expect(draftBadge(draft({ status: 'discarded' })).label).toBe('폐기');
  });
});

describe('draftProgress', () => {
  const L = (over: Partial<ProgressLine>): ProgressLine => ({
    is_discount: false, decision: 'ingest', product_cost_id: 'p', cost_entry_id: null, ...over,
  });

  it('빈 초안', () => {
    expect(draftProgress([])).toEqual({ total: 0, confirmed: 0, ready: 0, blocked: 0, undecided: 0 });
  });

  it('할인 줄은 어디에도 세지 않는다', () => {
    const r = draftProgress([L({ is_discount: true, decision: 'skip', product_cost_id: null })]);
    expect(r.total).toBe(0);
  });

  it('확정된 줄과 확정 가능한 줄을 나눈다', () => {
    const r = draftProgress([
      L({ cost_entry_id: 'e1' }),
      L({}),
      L({}),
    ]);
    expect(r).toEqual({ total: 3, confirmed: 1, ready: 2, blocked: 0, undecided: 0 });
  });

  it('상품이 없으면 막힌 줄이다', () => {
    const r = draftProgress([L({ product_cost_id: null })]);
    expect(r.blocked).toBe(1);
    expect(r.ready).toBe(0);
  });

  it('아직 정하지 않은 줄을 따로 센다 — 사람이 손대야 할 곳이다', () => {
    const r = draftProgress([L({ decision: 'pending', product_cost_id: null })]);
    expect(r.undecided).toBe(1);
    expect(r.blocked).toBe(0);
  });

  it('제외한 줄은 총계에 들어가되 어디에도 안 걸린다', () => {
    const r = draftProgress([L({ decision: 'skip', product_cost_id: null })]);
    expect(r).toEqual({ total: 1, confirmed: 0, ready: 0, blocked: 0, undecided: 0 });
  });
});
