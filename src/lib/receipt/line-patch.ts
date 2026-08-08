/**
 * 줄 수정 유효성.
 *
 * 부분 수정이므로 **패치 단독이 아니라 현재 값과 합친 결과**를 판정한다.
 *
 * 🔴 **미완성 상태를 막지 않는다.** 사람은 "입고할 것"을 먼저 정하고 상품을
 * 나중에 고른다. 저장 시점에 상품을 요구하면 그 순서를 밟을 수 없고, 실제로
 * 2026-08-09 실물 사용에서 「입고」 버튼이 전혀 눌리지 않는 교착이 났다.
 *
 * **완결성은 확정 시점이 판정한다** — `selectConfirmable()`이 `no_product`·
 * `no_entry_type`·`missing_subdivision_params`로 걸러낸다. 같은 규칙을 두 곳에
 * 두면, 저장을 막는 쪽이 화면의 입력 순서를 강제하게 된다.
 *
 * 여기서 막는 것은 **순서와 무관하게 항상 틀린 것**뿐이다: 확정된 줄 수정,
 * 할인 줄 수정, 음수·0인 소분 값.
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

  // 값 자체가 틀린 것만 막는다. "입고인데 상품이 없다"처럼 아직 덜 채운 상태는
  // 정상적인 중간 단계이므로 통과시킨다 — 확정 시점에 selectConfirmable()이 판정한다
  if (next.items_per_box != null && next.items_per_box < 1) {
    errors.push('박스당 개수는 1 이상이어야 합니다.');
  }
  if (next.subdivision_unit != null && next.subdivision_unit < 1) {
    errors.push('소분 단위는 1 이상이어야 합니다.');
  }

  return { next, errors };
}
