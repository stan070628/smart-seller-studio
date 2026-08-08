/**
 * 줄 수정 유효성.
 *
 * 부분 수정이므로 **패치 단독이 아니라 현재 값과 합친 결과**를 판정한다.
 * entry_type만 subdivision으로 바꾸는 요청은 이미 items_per_box가 저장돼
 * 있으면 유효하고 없으면 무효다 — 패치만 보면 이 구분을 할 수 없다.
 */

export interface LineState {
  is_discount: boolean;
  decision: 'pending' | 'ingest' | 'skip';
  product_cost_id: string | null;
  entry_type: 'normal' | 'subdivision' | null;
  items_per_box: number | null;
  subdivision_unit: number | null;
  cost_entry_id: string | null;
}

/** 보내지 않은 필드는 그대로 두고, null은 "지운다"는 뜻이다 */
export interface LinePatch {
  decision?: 'pending' | 'ingest' | 'skip';
  product_cost_id?: string | null;
  entry_type?: 'normal' | 'subdivision' | null;
  items_per_box?: number | null;
  subdivision_unit?: number | null;
}

export interface ValidateResult {
  next: LineState;
  errors: string[];
}

function pick<T>(patch: Record<string, unknown>, key: string, current: T): T {
  return key in patch ? (patch[key] as T) : current;
}

export function validateLinePatch(patch: LinePatch, current: LineState): ValidateResult {
  const p = patch as Record<string, unknown>;

  const next: LineState = {
    is_discount: current.is_discount,
    cost_entry_id: current.cost_entry_id,
    decision: pick(p, 'decision', current.decision),
    product_cost_id: pick(p, 'product_cost_id', current.product_cost_id),
    entry_type: pick(p, 'entry_type', current.entry_type),
    items_per_box: pick(p, 'items_per_box', current.items_per_box),
    subdivision_unit: pick(p, 'subdivision_unit', current.subdivision_unit),
  };

  const errors: string[] = [];

  // 확정된 줄을 고치면 cost_entries와 초안이 어긋난다
  if (current.cost_entry_id != null) {
    errors.push('이미 입고로 확정된 줄은 수정할 수 없습니다.');
    return { next: current, errors };
  }
  if (current.is_discount) {
    errors.push('할인 줄은 입고 대상이 아닙니다.');
    return { next: current, errors };
  }

  if (next.decision === 'ingest') {
    if (!next.product_cost_id) errors.push('입고할 상품을 선택해야 합니다.');
    if (!next.entry_type) errors.push('입고 방식을 선택해야 합니다.');
  }

  if (next.entry_type === 'subdivision') {
    if (next.items_per_box != null && next.items_per_box < 1) {
      errors.push('박스당 개수는 1 이상이어야 합니다.');
    }
    if (next.subdivision_unit != null && next.subdivision_unit < 1) {
      errors.push('소분 단위는 1 이상이어야 합니다.');
    }
    if (!next.items_per_box || !next.subdivision_unit) {
      if (!errors.some((e) => e.includes('1 이상'))) {
        errors.push('소분 입고에는 박스당 개수와 소분 단위가 모두 필요합니다.');
      }
    }
  }

  return { next, errors };
}
